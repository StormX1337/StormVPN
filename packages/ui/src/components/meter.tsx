import { cn } from '../lib/cn';

export function loadTone(
  percent: number,
  overloadThreshold = 85,
): 'normal' | 'warning' | 'critical' {
  if (percent >= overloadThreshold) return 'critical';
  if (percent >= 60) return 'warning';
  return 'normal';
}

/**
 * Meter: the fill carries severity (accent → warning → critical); the track is
 * a lighter step of the same hue so state reads across the whole bar.
 * The numeric value is always printed next to it (never color alone).
 */
export function LoadMeter({
  value,
  label,
  className,
  showValue = true,
  overloadThreshold,
}: {
  value: number;
  label?: string;
  className?: string;
  showValue?: boolean;
  overloadThreshold?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const tone = loadTone(clamped, overloadThreshold);
  const fill = {
    normal: 'bg-chart-1',
    warning: 'bg-status-warning',
    critical: 'bg-status-critical',
  }[tone];
  const track = {
    normal: 'bg-chart-1/15',
    warning: 'bg-status-warning/20',
    critical: 'bg-status-critical/20',
  }[tone];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn('h-1.5 min-w-16 flex-1 overflow-hidden rounded-full', track)}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label={label ?? 'Load'}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', fill)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showValue ? (
        <span className="tabular text-muted-foreground w-10 text-right text-xs">
          {Math.round(clamped)}%
        </span>
      ) : null}
    </div>
  );
}
