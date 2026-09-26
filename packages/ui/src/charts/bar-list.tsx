'use client';

import { cn } from '../lib/cn';
import { Tooltip } from '../components/tooltip';

export interface BarListItem {
  id: string;
  label: string;
  value: number;
  detail?: string;
}

/**
 * Single-series horizontal bars (one hue, no legend – the title names the
 * series). Thin bars with a 4px rounded data-end, value at the tip in text
 * ink, per-bar hover/focus tooltip with a hit target larger than the mark.
 */
export function BarList({ items, formatValue, className, emptyLabel = 'No data' }: { items: BarListItem[]; formatValue: (value: number) => string; className?: string; emptyLabel?: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {items.map((item) => (
        <li key={item.id}>
          <Tooltip
            content={
              <span>
                <strong className="text-foreground">{formatValue(item.value)}</strong> <span className="text-muted-foreground">{item.label}</span>
                {item.detail ? <span className="block text-muted-foreground">{item.detail}</span> : null}
              </span>
            }
          >
            <button type="button" className="group grid w-full grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-1.5 text-left text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50">
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="relative h-2.5">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-chart-1 transition-[filter] group-hover:brightness-110"
                  style={{ width: `${Math.max(1, (item.value / max) * 100)}%` }}
                />
              </span>
              <span className="tabular text-xs text-foreground">{formatValue(item.value)}</span>
            </button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
