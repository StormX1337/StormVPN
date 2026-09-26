'use client';

import { TimeSeriesChart } from '@stormvpn/ui/charts';
import { formatBytes } from '@stormvpn/ui';
import type { TrafficPointDto } from '@stormvpn/types';

/**
 * Daily traffic: download (server → you) in slot 1, upload (you → server) in
 * slot 2. Counters are reported from the server's perspective (tx = download).
 */
export function TrafficChart({ daily, height = 240 }: { daily: TrafficPointDto[]; height?: number }) {
  const data = daily.map((point) => ({ date: point.date, download: point.txBytes, upload: point.rxBytes }));
  return (
    <TimeSeriesChart
      data={data}
      xKey="date"
      height={height}
      title="Daily traffic"
      series={[
        { key: 'download', label: 'Download', color: '--chart-1' },
        { key: 'upload', label: 'Upload', color: '--chart-2' },
      ]}
      formatValue={(value) => formatBytes(value, 1)}
      formatX={(value) => new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
    />
  );
}
