'use client';

import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CountryFlag,
  EmptyState,
  formatBytes,
  LiveDot,
  LoadMeter,
  PageHeader,
  Skeleton,
  StatTile,
  toast,
} from '@stormvpn/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Gauge, MonitorSmartphone, Power, ShieldCheck, ShieldOff, Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { keys, useDevices, useRecommended, useSubscription, useTraffic, useVpnStatus } from '@/lib/queries';
import { ConfigDialog } from './config-dialog';
import { DeviceSelect } from './device-select';
import { SessionTimer } from './session-timer';
import { TrafficChart } from './traffic-chart';
import { useProvision } from './use-provision';

function useSelectedDevice() {
  const { data: devices } = useDevices();
  const [deviceId, setDeviceId] = useState('');
  useEffect(() => {
    if (devices?.length && !devices.some((device) => device.id === deviceId)) setDeviceId(devices[0]!.id);
  }, [devices, deviceId]);
  return { devices: devices ?? [], deviceId, setDeviceId };
}

function StatusHero() {
  const { data: status, isLoading } = useVpnStatus();
  const client = useQueryClient();
  const { devices, deviceId, setDeviceId } = useSelectedDevice();
  const { provision, pending, config, close } = useProvision();
  const disconnect = useMutation({
    mutationFn: (id: string) => api.connections.disconnect(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.status }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (isLoading) return <Skeleton className="h-64 lg:col-span-2" />;
  const connection = status?.connection ?? null;
  const connected = status?.connected ?? false;
  const connecting = connection?.status === 'CONNECTING';

  return (
    <Card className="relative overflow-hidden lg:col-span-2">
      <div
        className={`pointer-events-none absolute -top-24 -right-24 size-72 rounded-full blur-3xl ${connected ? 'bg-emerald-500/15' : 'bg-rose-500/10'}`}
        aria-hidden
      />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className={`flex size-20 shrink-0 items-center justify-center rounded-2xl border ${connected ? 'bg-emerald-500/10' : 'bg-muted'}`}>
          {connected ? <ShieldCheck className="size-10 text-status-good" /> : <ShieldOff className="size-10 text-status-critical" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LiveDot tone={connected ? 'good' : connecting ? 'progress' : 'critical'} />
            {connected ? 'Connected' : connecting ? 'Waiting for handshake…' : 'Disconnected'}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{connected ? 'Your connection is protected' : 'You are not protected'}</h2>
          <p className="text-sm text-muted-foreground">
            {connection ? (
              <>
                <CountryFlag code={connection.server.countryCode} /> {connection.server.city}, {connection.server.countryName} · {connection.server.name}
              </>
            ) : (
              'Quick Connect picks the fastest server with the lowest load for you.'
            )}
          </p>
        </div>
      </div>
      <dl className="relative grid grid-cols-2 gap-4 border-t pt-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Public IP</dt>
          <dd className="tabular font-medium">{status?.publicIp ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Session time</dt>
          <dd className="font-medium">
            <SessionTimer since={connected ? (connection?.connectedAt ?? null) : null} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tunnel address</dt>
          <dd className="tabular font-medium">{connection?.assignedIpv4 ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Device</dt>
          <dd className="truncate font-medium">{connection?.deviceName ?? '—'}</dd>
        </div>
      </dl>
      <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center">
        {devices.length === 0 ? (
          <Button asChild variant="brand">
            <Link href="/devices">
              <MonitorSmartphone /> Add a device to connect
            </Link>
          </Button>
        ) : (
          <>
            {devices.length > 1 ? (
              <div className="sm:w-56">
                <DeviceSelect devices={devices} value={deviceId} onChange={setDeviceId} />
              </div>
            ) : null}
            <Button variant="brand" size="lg" disabled={pending || !deviceId} onClick={() => provision({ deviceId }, 'connect')}>
              <Zap /> {connection ? 'Reconnect' : 'Quick Connect'}
            </Button>
            {connection ? (
              <Button variant="outline" size="lg" disabled={disconnect.isPending} onClick={() => disconnect.mutate(connection.id)}>
                <Power /> Disconnect
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="lg">
              <Link href="/servers">Choose server</Link>
            </Button>
          </>
        )}
      </div>
      <ConfigDialog config={config} onClose={close} />
    </Card>
  );
}

function RecommendedCard({ enabled }: { enabled: boolean }) {
  const { data, isLoading, error } = useRecommended(enabled);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Quick Connect target</CardTitle>
          <CardDescription>Chosen by load, latency and your plan</CardDescription>
        </div>
        <Gauge className="size-4 text-muted-foreground" />
      </CardHeader>
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : data ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <CountryFlag code={data.server.countryCode} className="text-2xl" />
            <div>
              <p className="font-semibold">{data.server.name}</p>
              <p className="text-sm text-muted-foreground">
                {data.server.city}, {data.server.countryName}
              </p>
            </div>
          </div>
          <LoadMeter value={data.server.load} label={`${data.server.name} load`} />
          <p className="text-xs text-muted-foreground">{data.reason}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{error ? errorMessage(error) : 'No subscription yet.'}</p>
      )}
    </Card>
  );
}

export function DashboardView() {
  const { data: status } = useVpnStatus();
  const { data: overview } = useSubscription();
  const { data: traffic } = useTraffic(30);
  const plan = overview?.subscription?.plan;
  const connection = status?.connection;
  const limit = traffic?.limitBytes ?? null;
  const used = (traffic?.rxBytes ?? 0) + (traffic?.txBytes ?? 0);

  return (
    <>
      <PageHeader title="Dashboard" description={plan ? `${plan.name} plan` : undefined} />
      {overview && !overview.subscription ? (
        <EmptyState
          icon={<Zap />}
          title="Choose a plan to start"
          description="Pick a plan – including a free tier – to unlock StormVPN servers."
          action={
            <Button asChild variant="brand">
              <Link href="/subscription">View plans</Link>
            </Button>
          }
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <StatusHero />
        <RecommendedCard enabled={Boolean(overview?.subscription)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Download (session)" value={formatBytes(connection?.txBytes ?? 0)} icon={<ArrowDownToLine />} hint={connection ? connection.server.name : 'Not connected'} />
        <StatTile label="Upload (session)" value={formatBytes(connection?.rxBytes ?? 0)} icon={<ArrowUpFromLine />} hint={connection ? connection.server.name : 'Not connected'} />
        <StatTile
          label="Traffic this month"
          value={formatBytes(used)}
          hint={limit ? `of ${formatBytes(limit)} included` : 'Unlimited'}
          icon={<Gauge />}
        />
        <StatTile
          label="Devices"
          value={`${overview?.usage.devicesUsed ?? 0} / ${plan?.maxDevices ?? 0}`}
          hint={`${overview?.usage.activeConnections ?? 0} active connection(s)`}
          icon={<MonitorSmartphone />}
        />
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Traffic – last 30 days</CardTitle>
            <CardDescription>Volume only. StormVPN never logs destinations or DNS queries.</CardDescription>
          </div>
        </CardHeader>
        {traffic ? <TrafficChart daily={traffic.daily} /> : <Skeleton className="h-60" />}
      </Card>
    </>
  );
}
