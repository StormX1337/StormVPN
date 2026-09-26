'use client';

import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  CopyButton,
  CountryFlag,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  formatDateTime,
  Input,
  LoadMeter,
  NativeSelect,
  PageHeader,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@stormvpn/ui';
import { type AdminServerDto, type EnrollmentTokenDto, getCountry, Region, ServerClass } from '@stormvpn/types';
import { serverCreateSchema } from '@stormvpn/validation';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Plus, Power, ShieldOff, Trash2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';

const invalidate = [['admin', 'servers'], ['admin', 'nodes']];

function ServerFormDialog({ server, open, onOpenChange }: { server: AdminServerDto | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [error, setError] = useState<string>();
  const save = useAction(
    (input: Record<string, unknown>) => (server ? api.admin.updateServer(server.id, input as never) : api.admin.createServer(input as never)),
    { success: server ? 'Server updated' : 'Server created', invalidate, onDone: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
            const country = getCountry(form.countryCode);
            const input = {
              name: form.name,
              hostname: form.hostname,
              countryCode: form.countryCode,
              city: form.city,
              region: form.region,
              latitude: form.latitude ? Number(form.latitude) : (country?.lat ?? null),
              longitude: form.longitude ? Number(form.longitude) : (country?.lon ?? null),
              publicIpv4: form.publicIpv4,
              publicIpv6: form.publicIpv6 || null,
              wireguardPort: Number(form.wireguardPort),
              serverClass: form.serverClass,
              capacity: Number(form.capacity),
              bandwidthCapacityMbps: Number(form.bandwidthCapacityMbps),
              wgSubnetV4: form.wgSubnetV4,
              wgSubnetV6: form.wgSubnetV6 || null,
              dnsServers: form.dnsServers ? form.dnsServers.split(',').map((entry) => entry.trim()).filter(Boolean) : [],
            };
            const parsed = serverCreateSchema.safeParse(input);
            if (!parsed.success) {
              const issue = parsed.error.issues[0]!;
              return setError(`${issue.path.join('.')}: ${issue.message}`);
            }
            setError(undefined);
            const { name: _name, ...update } = parsed.data;
            save.mutate(server ? update : parsed.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>{server ? `Edit ${server.name}` : 'Add VPN server'}</DialogTitle>
            <DialogDescription>After creating the server, issue an enrollment token and run the node installer on the host.</DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" placeholder="DE-FRA-03" defaultValue={server?.name} disabled={!!server} required />
            </Field>
            <Field label="Hostname" htmlFor="hostname" className="sm:col-span-2">
              <Input id="hostname" name="hostname" placeholder="de-fra-03.nodes.example.com" defaultValue={server?.hostname} required />
            </Field>
            <Field label="Country (ISO)" htmlFor="countryCode">
              <Input id="countryCode" name="countryCode" maxLength={2} placeholder="DE" defaultValue={server?.countryCode} required />
            </Field>
            <Field label="City" htmlFor="city">
              <Input id="city" name="city" defaultValue={server?.city} required />
            </Field>
            <Field label="Region" htmlFor="region">
              <NativeSelect id="region" name="region" defaultValue={server?.region ?? 'EUROPE'}>
                {Object.values(Region).map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Public IPv4" htmlFor="publicIpv4">
              <Input id="publicIpv4" name="publicIpv4" defaultValue={server?.publicIpv4} required />
            </Field>
            <Field label="Public IPv6" htmlFor="publicIpv6">
              <Input id="publicIpv6" name="publicIpv6" defaultValue={server?.publicIpv6 ?? ''} />
            </Field>
            <Field label="WireGuard port" htmlFor="wireguardPort">
              <Input id="wireguardPort" name="wireguardPort" type="number" defaultValue={server?.wireguardPort ?? 51820} />
            </Field>
            <Field label="Class" htmlFor="serverClass">
              <NativeSelect id="serverClass" name="serverClass" defaultValue={server?.serverClass ?? 'STANDARD'}>
                {Object.values(ServerClass).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Max connections" htmlFor="capacity">
              <Input id="capacity" name="capacity" type="number" defaultValue={server?.capacity ?? 500} />
            </Field>
            <Field label="Bandwidth (Mbit/s)" htmlFor="bandwidthCapacityMbps">
              <Input id="bandwidthCapacityMbps" name="bandwidthCapacityMbps" type="number" defaultValue={server?.bandwidthCapacityMbps ?? 1000} />
            </Field>
            <Field label="Client subnet IPv4" htmlFor="wgSubnetV4" hint="Unique per server">
              <Input id="wgSubnetV4" name="wgSubnetV4" defaultValue={server?.wgSubnetV4 ?? '10.80.0.0/20'} />
            </Field>
            <Field label="Client subnet IPv6" htmlFor="wgSubnetV6">
              <Input id="wgSubnetV6" name="wgSubnetV6" placeholder="fd80:1::/64" defaultValue={server?.wgSubnetV6 ?? ''} />
            </Field>
            <Field label="DNS override" htmlFor="dnsServers" hint="Empty = node resolver">
              <Input id="dnsServers" name="dnsServers" placeholder="10.80.0.1" defaultValue={server?.dnsServers.join(', ')} />
            </Field>
            <Field label="Latitude" htmlFor="latitude">
              <Input id="latitude" name="latitude" type="number" step="any" defaultValue={server?.latitude ?? ''} />
            </Field>
            <Field label="Longitude" htmlFor="longitude">
              <Input id="longitude" name="longitude" type="number" step="any" defaultValue={server?.longitude ?? ''} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {server ? 'Save changes' : 'Create server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ServersView() {
  const { data: servers = [] } = useQuery({ queryKey: ['admin', 'servers'], queryFn: () => api.admin.servers(), refetchInterval: 15_000 });
  const [editing, setEditing] = useState<AdminServerDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AdminServerDto | null>(null);
  const [killTarget, setKillTarget] = useState<AdminServerDto | null>(null);
  const [killReason, setKillReason] = useState('');
  const [enrollment, setEnrollment] = useState<EnrollmentTokenDto | null>(null);

  const status = useAction(({ id, value }: { id: string; value: 'ACTIVE' | 'DISABLED' | 'MAINTENANCE' }) => api.admin.setServerStatus(id, value), { success: 'Status updated', invalidate });
  const remove = useAction((id: string) => api.admin.deleteServer(id), { success: 'Server removed', invalidate, onDone: () => setDeleting(null) });
  const kill = useAction(({ id, engaged }: { id: string; engaged: boolean }) => api.admin.setKillSwitch(id, engaged, killReason || 'released'), {
    success: 'Kill switch updated',
    invalidate,
    onDone: () => {
      setKillTarget(null);
      setKillReason('');
    },
  });
  const token = useAction((id: string) => api.admin.enrollmentToken(id), { onDone: setEnrollment });

  return (
    <>
      <PageHeader
        title="Servers"
        description={`${servers.length} servers in the catalogue`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Add server
          </Button>
        }
      />
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Server</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Admin state</TableHead>
              <TableHead>Node</TableHead>
              <TableHead className="w-40">Load</TableHead>
              <TableHead>Peers</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Subnet</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {servers.map((server) => (
              <TableRow key={server.id}>
                <TableCell>
                  <div className="font-mono text-xs font-semibold">{server.name}</div>
                  <div className="text-xs text-muted-foreground">{server.hostname}</div>
                </TableCell>
                <TableCell>
                  <CountryFlag code={server.countryCode} /> {server.city}
                </TableCell>
                <TableCell className="text-xs">{server.serverClass}</TableCell>
                <TableCell>
                  <StatusBadge status={server.status} />
                  {server.killSwitchEngaged ? <StatusBadge className="ml-1" tone="critical" label="Kill switch" /> : null}
                </TableCell>
                <TableCell>{server.nodeStatus ? <StatusBadge status={server.nodeStatus} /> : <span className="text-xs text-muted-foreground">not enrolled</span>}</TableCell>
                <TableCell>
                  <LoadMeter value={server.load} label={`${server.name} load`} />
                </TableCell>
                <TableCell className="tabular">
                  {server.peerCount} <span className="text-xs text-muted-foreground">/ {server.activeConnections} live</span>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {server.publicIpv4}:{server.wireguardPort}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{server.wgSubnetV4}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${server.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(server)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => token.mutate(server.id)}>
                        <KeyRound /> Enrollment token
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => status.mutate({ id: server.id, value: 'ACTIVE' })}>
                        <Power /> Activate
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => status.mutate({ id: server.id, value: 'MAINTENANCE' })}>
                        <Wrench /> Maintenance
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => status.mutate({ id: server.id, value: 'DISABLED' })}>Disable</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {server.killSwitchEngaged ? (
                        <DropdownMenuItem onSelect={() => kill.mutate({ id: server.id, engaged: false })}>Release kill switch</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem variant="destructive" onSelect={() => setKillTarget(server)}>
                          <ShieldOff /> Kill switch
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(server)}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ServerFormDialog key={editing?.id ?? 'new'} server={editing} open={creating || editing !== null} onOpenChange={(open) => !open && (setCreating(false), setEditing(null))} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Peers on this server are revoked. Servers with history are archived instead of hard-deleted."
        confirmLabel="Delete server"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
      <ConfirmDialog
        open={killTarget !== null}
        onOpenChange={(open) => !open && setKillTarget(null)}
        title={`Engage kill switch on ${killTarget?.name}?`}
        description="The node drops every WireGuard peer on its next sync (seconds) and receives no new users until released."
        confirmLabel="Engage kill switch"
        destructive
        pending={kill.isPending}
        onConfirm={() => killTarget && kill.mutate({ id: killTarget.id, engaged: true })}
      >
        <Textarea placeholder="Reason (required, audited)" value={killReason} onChange={(event) => setKillReason(event.target.value)} />
      </ConfirmDialog>
      <Dialog open={enrollment !== null} onOpenChange={(open) => !open && setEnrollment(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Enrollment token</DialogTitle>
            <DialogDescription>Single use, expires {formatDateTime(enrollment?.expiresAt)}. Run on the new node as root:</DialogDescription>
          </DialogHeader>
          <pre className="overflow-x-auto rounded-lg border bg-muted/60 p-3 font-mono text-xs whitespace-pre-wrap break-all">{enrollment?.installCommand}</pre>
          <div className="flex gap-2">
            <CopyButton value={enrollment?.installCommand ?? ''} label="Copy command" />
            <CopyButton value={enrollment?.enrollmentToken ?? ''} label="Copy token only" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
