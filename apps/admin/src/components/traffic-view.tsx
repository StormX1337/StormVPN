'use client';

import { Button, Card, CardDescription, CardHeader, CardTitle, cn, formatBytes, PageHeader, Skeleton, StatTile, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@stormvpn/ui';
import { BarList, TimeSeriesChart } from '@stormvpn/ui/charts';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

export function TrafficView() {
  const [days, setDays] = useState(30);
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const { data, isPlaceholderData } = useQuery({
    queryKey: ['admin', 'traffic', days],
    queryFn: () => api.admin.traffic({ from }),
    placeholderData: (previous) => previous,
  });
  return (
    <>
      <PageHeader title="Traffic" description="Aggregated volume only – StormVPN never logs destinations." />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
        {RANGES.map((range) => (
          <Button key={range.days} size="sm" variant={range.days === days ? 'secondary' : 'ghost'} aria-pressed={range.days === days} onClick={() => setDays(range.days)}>
            {range.days === days ? <Check className="size-4 stroke-[3]" /> : null}
            {range.label}
          </Button>
        ))}
      </div>
      <div className={cn('flex flex-col gap-4 transition-opacity', isPlaceholderData && 'opacity-60')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Total volume" value={data ? formatBytes(data.totalRxBytes + data.totalTxBytes, 2) : '—'} />
          <StatTile label="Download (to clients)" value={data ? formatBytes(data.totalTxBytes, 2) : '—'} />
          <StatTile label="Upload (from clients)" value={data ? formatBytes(data.totalRxBytes, 2) : '—'} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Daily traffic</CardTitle>
          </CardHeader>
          {data ? (
            <TimeSeriesChart
              data={data.daily.map((day) => ({ date: day.date, download: day.txBytes, upload: day.rxBytes }))}
              xKey="date"
              title="Daily traffic"
              series={[
                { key: 'download', label: 'Download (to clients)', color: '--chart-1' },
                { key: 'upload', label: 'Upload (from clients)', color: '--chart-2' },
              ]}
              formatValue={(value) => formatBytes(value)}
              formatX={(value) => new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            />
          ) : (
            <Skeleton className="h-64" />
          )}
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>By server</CardTitle>
                <CardDescription>Total volume in the selected range</CardDescription>
              </div>
            </CardHeader>
            <BarList items={(data?.byServer ?? []).map((row) => ({ id: row.serverId, label: row.serverName, value: row.rxBytes + row.txBytes, detail: `↓ ${formatBytes(row.txBytes)} · ↑ ${formatBytes(row.rxBytes)}` }))} formatValue={(value) => formatBytes(value)} />
          </Card>
          <Card className="p-0">
            <div className="px-5 pt-5">
              <h3 className="text-sm font-semibold">Top accounts by volume</h3>
              <p className="text-sm text-muted-foreground">For fair-use and abuse review</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                  <TableHead className="text-right">Upload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.topUsers.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell>{row.email}</TableCell>
                    <TableCell className="tabular text-right">{formatBytes(row.txBytes)}</TableCell>
                    <TableCell className="tabular text-right">{formatBytes(row.rxBytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
