'use client';

import {
  Alert,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  formatBitrate,
  formatBytes,
  formatCompact,
  formatNumber,
  formatRelative,
  LoadMeter,
  PageHeader,
  Skeleton,
  StatTile,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@stormvpn/ui';
import { BarList, TimeSeriesChart } from '@stormvpn/ui/charts';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Boxes,
  CreditCard,
  Network,
  Server,
  Users,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

export function Overview() {
  const { data: stats } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.admin.stats(),
    refetchInterval: 30_000,
  });
  const { data: nodes } = useQuery({
    queryKey: ['admin', 'nodes'],
    queryFn: () => api.admin.nodes(),
    refetchInterval: 30_000,
  });
  const { data: traffic } = useQuery({
    queryKey: ['admin', 'traffic', 30],
    queryFn: () => api.admin.traffic(),
    refetchInterval: 120_000,
  });

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          stats ? `Updated ${formatRelative(stats.generatedAt)}` : 'Live platform health'
        }
      />
      {stats?.maintenanceMode ? (
        <Alert variant="warning">
          <Wrench />{' '}
          <span>Maintenance mode is active – new connections are blocked for customers.</span>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {stats ? (
          <>
            <StatTile
              label="Online nodes"
              value={`${stats.onlineNodes} / ${stats.totalNodes}`}
              icon={<Boxes />}
              hint={stats.degradedNodes ? `${stats.degradedNodes} degraded` : 'All healthy'}
            />
            <StatTile
              label="Active users"
              value={formatNumber(stats.activeUsers)}
              icon={<Users />}
              hint={`${formatNumber(stats.totalUsers)} registered`}
            />
            <StatTile
              label="Active VPN connections"
              value={formatNumber(stats.activeConnections)}
              icon={<Network />}
            />
            <StatTile
              label="Traffic today"
              value={formatBytes(stats.trafficTodayBytes, 2)}
              icon={<Activity />}
            />
            <StatTile
              label="API requests today"
              value={formatCompact(stats.apiRequests)}
              icon={<Server />}
              hint={`${stats.activeSubscriptions} paid subscriptions`}
            />
            <StatTile
              label="API errors today"
              value={formatNumber(stats.apiErrors)}
              icon={<AlertTriangle />}
              hint={
                stats.apiRequests
                  ? `${((stats.apiErrors / stats.apiRequests) * 100).toFixed(2)}% error rate`
                  : '—'
              }
            />
          </>
        ) : (
          Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-28" />)
        )}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Network traffic – last 30 days</CardTitle>
              <CardDescription>Aggregated volume across all nodes</CardDescription>
            </div>
          </CardHeader>
          {traffic ? (
            <TimeSeriesChart
              data={traffic.daily.map((day) => ({
                date: day.date,
                download: day.txBytes,
                upload: day.rxBytes,
              }))}
              xKey="date"
              title="Network traffic"
              series={[
                { key: 'download', label: 'Download (to clients)', color: '--chart-1' },
                { key: 'upload', label: 'Upload (from clients)', color: '--chart-2' },
              ]}
              formatValue={(value) => formatBytes(value)}
              formatX={(value) =>
                new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
              }
            />
          ) : (
            <Skeleton className="h-64" />
          )}
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Traffic by server</CardTitle>
              <CardDescription>Last 30 days, total volume</CardDescription>
            </div>
          </CardHeader>
          <BarList
            items={(traffic?.byServer ?? []).slice(0, 8).map((row) => ({
              id: row.serverId,
              label: row.serverName,
              value: row.rxBytes + row.txBytes,
            }))}
            formatValue={(value) => formatBytes(value)}
          />
        </Card>
      </div>
      <Card className="p-0">
        <div className="flex items-center justify-between px-5 pt-5">
          <h3 className="text-sm font-semibold">Nodes</h3>
          <Link href="/nodes" className="text-muted-foreground hover:text-foreground text-sm">
            View all
          </Link>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Server</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-40">Load</TableHead>
              <TableHead>CPU</TableHead>
              <TableHead>RAM</TableHead>
              <TableHead>Bandwidth</TableHead>
              <TableHead>Connections</TableHead>
              <TableHead>Heartbeat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(nodes ?? []).map((node) => (
              <TableRow key={node.id}>
                <TableCell className="font-mono text-xs">{node.serverName}</TableCell>
                <TableCell>
                  <StatusBadge status={node.status} />
                </TableCell>
                <TableCell>
                  <LoadMeter value={node.metrics.load} label={`${node.serverName} load`} />
                </TableCell>
                <TableCell className="tabular">{node.metrics.cpuPercent.toFixed(0)}%</TableCell>
                <TableCell className="tabular">{node.metrics.memoryPercent.toFixed(0)}%</TableCell>
                <TableCell className="tabular text-muted-foreground">
                  {formatBitrate(Math.max(node.metrics.rxBps, node.metrics.txBps))}
                </TableCell>
                <TableCell className="tabular">{node.metrics.activeConnections}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatRelative(node.lastHeartbeatAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <CreditCard className="size-3.5" /> KPIs refresh every 5 seconds over WebSocket.
      </p>
    </>
  );
}
