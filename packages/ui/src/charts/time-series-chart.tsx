'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../lib/cn';
import { type ChartToken, useChartColors } from './use-chart-colors';

export interface SeriesSpec {
  key: string;
  label: string;
  /** Categorical slot in fixed order: slot 1 first, never cycled. */
  color: Extract<ChartToken, '--chart-1' | '--chart-2'>;
}

export interface TimeSeriesChartProps<T extends Record<string, string | number>> {
  data: T[];
  xKey: keyof T & string;
  series: SeriesSpec[];
  formatValue: (value: number) => string;
  formatX?: (value: string) => string;
  height?: number;
  /** Area wash under the lines (10% opacity); false = plain lines. */
  area?: boolean;
  className?: string;
  title?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  colors,
  formatValue,
  formatX,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  label?: unknown;
  series: SeriesSpec[];
  colors: Record<ChartToken, string>;
  formatValue: (value: number) => string;
  formatX?: (value: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover min-w-40 rounded-lg border px-3 py-2 text-xs shadow-xl">
      <div className="text-muted-foreground mb-1.5">
        {formatX ? formatX(String(label)) : String(label)}
      </div>
      <div className="space-y-1">
        {series.map((spec) => {
          const entry = payload.find((item) => item.dataKey === spec.key);
          return (
            <div key={spec.key} className="flex items-center gap-2">
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ background: colors[spec.color] }}
                aria-hidden
              />
              <span className="text-foreground tabular font-semibold">
                {formatValue(Number(entry?.value ?? 0))}
              </span>
              <span className="text-muted-foreground">{spec.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Line/area time series following the StormVPN data-viz spec: 2px lines,
 * 10% area wash, hairline horizontal grid, crosshair tooltip listing every
 * series, a legend for 2+ series and an accessible table view.
 */
export function TimeSeriesChart<T extends Record<string, string | number>>({
  data,
  xKey,
  series,
  formatValue,
  formatX,
  height = 240,
  area = true,
  className,
  title,
}: TimeSeriesChartProps<T>) {
  const colors = useChartColors();
  return (
    <figure className={cn('flex flex-col gap-3', className)}>
      {series.length > 1 ? (
        <figcaption className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
          {series.map((spec) => (
            <span key={spec.key} className="inline-flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-[3px]"
                style={{ background: colors?.[spec.color] }}
                aria-hidden
              />
              {spec.label}
            </span>
          ))}
        </figcaption>
      ) : null}
      <div style={{ height }} className="w-full">
        {colors ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data as Record<string, string | number>[]}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke={colors['--chart-grid']} strokeWidth={1} />
              <XAxis
                dataKey={xKey as string}
                tickLine={false}
                axisLine={{ stroke: colors['--chart-grid'] }}
                tick={{ fill: colors['--chart-axis'], fontSize: 11 }}
                tickFormatter={formatX}
                minTickGap={24}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={64}
                tick={{ fill: colors['--chart-axis'], fontSize: 11 }}
                tickFormatter={(value: number) => formatValue(value)}
              />
              <Tooltip
                cursor={{ stroke: colors['--chart-axis'], strokeWidth: 1 }}
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={props.payload}
                    label={props.label}
                    series={series}
                    colors={colors}
                    formatValue={formatValue}
                    formatX={formatX}
                  />
                )}
              />
              {series.map((spec) => (
                <Area
                  key={spec.key}
                  type="monotone"
                  dataKey={spec.key}
                  name={spec.label}
                  stroke={colors[spec.color]}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill={colors[spec.color]}
                  fillOpacity={area ? 0.1 : 0}
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 2,
                    stroke: colors['--chart-surface'],
                    fill: colors[spec.color],
                  }}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : null}
      </div>
      <details className="text-muted-foreground text-xs">
        <summary className="hover:text-foreground cursor-pointer select-none">
          View as table{title ? ` – ${title}` : ''}
        </summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border">
          <table className="w-full text-left">
            <thead className="bg-card sticky top-0">
              <tr>
                <th className="px-3 py-1.5 font-medium">Date</th>
                {series.map((spec) => (
                  <th key={spec.key} className="px-3 py-1.5 text-right font-medium">
                    {spec.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {data.map((row) => (
                <tr key={String(row[xKey])} className="border-t">
                  <td className="px-3 py-1">
                    {formatX ? formatX(String(row[xKey])) : String(row[xKey])}
                  </td>
                  {series.map((spec) => (
                    <td key={spec.key} className="text-foreground px-3 py-1 text-right">
                      {formatValue(Number(row[spec.key] ?? 0))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
