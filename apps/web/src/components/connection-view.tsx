'use client';
import type * as React from 'react';

import {
  Alert,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CountryFlag,
  EmptyState,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatRelative,
  PageHeader,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@stormvpn/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { History, Power, ShieldAlert, Waypoints } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { keys, useHistory, useVpnStatus } from '@/lib/queries';
import { SessionTimer } from './session-timer';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2.5 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export function ConnectionView() {
  const client = useQueryClient();
  const { data: status, isLoading } = useVpnStatus();
  const { data: history } = useHistory();
  const disconnect = useMutation({
    mutationFn: (id: string) => api.connections.disconnect(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.status });
      void client.invalidateQueries({ queryKey: keys.history });
      toast.success('Session ended. Also switch off the tunnel in your WireGuard app.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const connection = status?.connection;

  return (
    <>
      <PageHeader title="Connection" description="Live WireGuard session details reported by the VPN node." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Current session</CardTitle>
              <CardDescription>Updates live when your node reports a handshake.</CardDescription>
            </div>
            {connection ? <StatusBadge status={connection.status} /> : null}
          </CardHeader>
          {isLoading ? (
            <Skeleton className="h-56" />
          ) : connection ? (
            <>
              <dl>
                <Row label="Server">
                  <CountryFlag code={connection.server.countryCode} /> {connection.server.name} · {connection.server.city}
                </Row>
                <Row label="Endpoint">{connection.server.publicIpv4}:51820 (UDP)</Row>
                <Row label="WireGuard status">
                  {connection.lastHandshakeAt ? `Handshake ${formatRelative(connection.lastHandshakeAt)}` : 'No handshake yet'}
                </Row>
                <Row label="Connected since">{formatDateTime(connection.connectedAt)}</Row>
                <Row label="Session duration">
                  <SessionTimer since={connection.connectedAt} />
                </Row>
                <Row label="Download / Upload">
                  {formatBytes(connection.txBytes)} / {formatBytes(connection.rxBytes)}
                </Row>
                <Row label="Tunnel address">{connection.assignedIpv4 ?? '—'}</Row>
                <Row label="Device">{connection.deviceName ?? 'Config file'}</Row>
              </dl>
              <div>
                <Button variant="outline" disabled={disconnect.isPending} onClick={() => disconnect.mutate(connection.id)}>
                  <Power /> End session
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Waypoints />}
              title="No active connection"
              description="Use Quick Connect or pick a server to create a secure WireGuard tunnel."
              action={
                <Button asChild variant="brand">
                  <Link href="/dashboard">Quick Connect</Link>
                </Button>
              }
            />
          )}
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Kill switch & DNS</CardTitle>
              <CardDescription>Enforced by the client on your device</CardDescription>
            </div>
            <ShieldAlert className="size-4 text-muted-foreground" />
          </CardHeader>
          <dl>
            <Row label="Kill switch">
              <StatusBadge tone={status?.killSwitch.supportedByClient ? 'good' : 'warning'} label={status?.killSwitch.supportedByClient ? 'Managed by app' : 'Configure in app'} />
            </Row>
            <Row label="DNS leak protection">
              <StatusBadge tone="good" label="StormVPN DNS" />
            </Row>
            <Row label="IPv6">
              <StatusBadge tone="good" label="Tunnelled (::/0)" />
            </Row>
          </dl>
          <Alert className="text-xs">
            <ShieldAlert />
            <span>
              Web configs route all IPv4 + IPv6 traffic and DNS through the tunnel. In the WireGuard app enable “Block untunneled traffic” for a system kill switch.
            </span>
          </Alert>
        </Card>
      </div>
      <Card className="p-0">
        <div className="flex items-center gap-2 px-5 pt-5">
          <History className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Recent sessions</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Server</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Traffic</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(history ?? []).map((item) => {
              const end = item.endedAt ? new Date(item.endedAt).getTime() : Date.now();
              const start = new Date(item.connectedAt ?? item.startedAt).getTime();
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <CountryFlag code={item.server.countryCode} /> {item.server.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.deviceName ?? 'Config file'}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(item.startedAt)}</TableCell>
                  <TableCell className="tabular">{item.connectedAt ? formatDuration((end - start) / 1000) : '—'}</TableCell>
                  <TableCell className="tabular text-muted-foreground">{formatBytes(item.rxBytes + item.txBytes)}</TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                </TableRow>
              );
            })}
            {history?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No sessions yet
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
