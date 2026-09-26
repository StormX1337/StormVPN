'use client';

import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  formatRelative,
  Input,
  NativeSelect,
  PageHeader,
  Skeleton,
  StatusBadge,
  toast,
} from '@stormvpn/ui';
import { DevicePlatform, type DeviceDto } from '@stormvpn/types';
import { createDeviceSchema } from '@stormvpn/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileKey2, MonitorSmartphone, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { keys, useDevices, usePeers, useSubscription } from '@/lib/queries';
import { ConfigDialog } from './config-dialog';
import { PLATFORM_LABEL, PlatformIcon } from './platform-icon';
import { useProvision } from './use-provision';

function AddDeviceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const [error, setError] = useState<string>();
  const create = useMutation({
    mutationFn: (input: { name: string; platform: DevicePlatform }) => api.devices.create(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.devices });
      void client.invalidateQueries({ queryKey: keys.subscription });
      toast.success('Device added');
      onOpenChange(false);
    },
    onError: (caught) => setError(errorMessage(caught)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const parsed = createDeviceSchema.safeParse({ name: form.get('name'), platform: form.get('platform') });
            if (!parsed.success) return setError(parsed.error.issues[0]!.message);
            setError(undefined);
            create.mutate(parsed.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>Add device</DialogTitle>
            <DialogDescription>Each device gets its own WireGuard keys per server.</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="device-name" error={error}>
            <Input id="device-name" name="name" placeholder="e.g. Work laptop" autoFocus />
          </Field>
          <Field label="Platform" htmlFor="device-platform">
            <NativeSelect id="device-platform" name="platform" defaultValue="WINDOWS">
              {Object.values(DevicePlatform).map((platform) => (
                <option key={platform} value={platform}>
                  {PLATFORM_LABEL[platform]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Add device
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PeersDialog({ device, onClose }: { device: DeviceDto | null; onClose: () => void }) {
  const client = useQueryClient();
  const { data: peers = [] } = usePeers(device?.id ?? null);
  const revoke = useMutation({
    mutationFn: (peerId: string) => api.devices.revokePeer(device!.id, peerId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.peers(device!.id) });
      void client.invalidateQueries({ queryKey: keys.devices });
      toast.success('Configuration revoked on the server');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={device !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Configurations for {device?.name}</DialogTitle>
          <DialogDescription>Revoking a configuration removes the key from the VPN node within seconds.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border">
          {peers.map((peer) => (
            <li key={peer.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{peer.serverName}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {peer.ipv4Address} · {peer.publicKey.slice(0, 16)}…
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={peer.status} />
                <Button size="sm" variant="ghost" aria-label="Revoke configuration" disabled={revoke.isPending} onClick={() => revoke.mutate(peer.id)}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
          {peers.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">No configurations yet</li> : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function DevicesView() {
  const client = useQueryClient();
  const { data: devices, isLoading } = useDevices();
  const { data: overview } = useSubscription();
  const { data: servers = [] } = useQuery({ queryKey: keys.servers({ onlyAvailable: true }), queryFn: () => api.servers.list({ onlyAvailable: true }) });
  const [adding, setAdding] = useState(false);
  const [peersFor, setPeersFor] = useState<DeviceDto | null>(null);
  const [removing, setRemoving] = useState<DeviceDto | null>(null);
  const [configFor, setConfigFor] = useState<DeviceDto | null>(null);
  const [serverId, setServerId] = useState('');
  const { provision, pending, config, close } = useProvision();
  const max = overview?.subscription?.plan.maxDevices ?? 0;

  const remove = useMutation({
    mutationFn: (id: string) => api.devices.remove(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.devices });
      void client.invalidateQueries({ queryKey: keys.subscription });
      toast.success('Device removed and its keys revoked');
      setRemoving(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title="Devices"
        description={`${devices?.length ?? 0} of ${max} devices used on your plan`}
        actions={
          <Button onClick={() => setAdding(true)} disabled={(devices?.length ?? 0) >= max}>
            <Plus /> Add device
          </Button>
        }
      />
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-44" />
          ))}
        </div>
      ) : devices?.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => (
            <Card key={device.id} className="gap-5">
              <div className="flex items-start gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl border bg-muted">
                  <PlatformIcon platform={device.platform} className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{device.name}</p>
                  <p className="text-sm text-muted-foreground">{PLATFORM_LABEL[device.platform]}</p>
                </div>
                {device.connected ? <StatusBadge status="CONNECTED" /> : <Badge variant="outline">Idle</Badge>}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Last activity</dt>
                  <dd>{formatRelative(device.lastSeenAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Active configs</dt>
                  <dd>{device.activePeers}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setConfigFor(device)}>
                  <FileKey2 /> Get config
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPeersFor(device)}>
                  Manage configs
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto text-destructive" aria-label={`Remove ${device.name}`} onClick={() => setRemoving(device)}>
                  <Trash2 />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<MonitorSmartphone />}
          title="No devices yet"
          description="Add Windows, macOS, Linux, Android, iOS or router devices and generate secure WireGuard configurations."
          action={<Button onClick={() => setAdding(true)}>Add your first device</Button>}
        />
      )}

      <AddDeviceDialog open={adding} onOpenChange={setAdding} />
      <PeersDialog device={peersFor} onClose={() => setPeersFor(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'device'}?`}
        description="All WireGuard configurations of this device stop working immediately."
        confirmLabel="Remove device"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
      <Dialog open={configFor !== null} onOpenChange={(open) => !open && setConfigFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>WireGuard config for {configFor?.name}</DialogTitle>
            <DialogDescription>Keys are generated in your browser. Pick a location or let Quick Connect choose.</DialogDescription>
          </DialogHeader>
          <Field label="Server" htmlFor="config-server">
            <NativeSelect id="config-server" value={serverId} onChange={(event) => setServerId(event.target.value)}>
              <option value="">Quick Connect (best server)</option>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.countryName} · {server.city} · {server.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => {
                if (!configFor) return;
                provision({ deviceId: configFor.id, serverId: serverId || undefined }, 'config');
                setConfigFor(null);
              }}
            >
              Generate configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfigDialog config={config} onClose={close} />
    </>
  );
}
