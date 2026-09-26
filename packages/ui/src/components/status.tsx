import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  MinusCircle,
  Wrench,
  XCircle,
} from 'lucide-react';
import type * as React from 'react';
import { cn } from '../lib/cn';

export type StatusTone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'progress';

const TONE_STYLE: Record<
  StatusTone,
  { color: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  good: { color: 'text-status-good', Icon: CheckCircle2 },
  warning: { color: 'text-status-warning', Icon: AlertTriangle },
  serious: { color: 'text-status-serious', Icon: Wrench },
  critical: { color: 'text-status-critical', Icon: XCircle },
  neutral: { color: 'text-status-neutral', Icon: MinusCircle },
  progress: { color: 'text-status-warning', Icon: Loader2 },
};

const TONES: Record<string, StatusTone> = {
  ONLINE: 'good',
  ACTIVE: 'good',
  CONNECTED: 'good',
  PAID: 'good',
  SUCCEEDED: 'good',
  TRIALING: 'good',
  DEGRADED: 'warning',
  PAST_DUE: 'warning',
  INCOMPLETE: 'warning',
  OPEN: 'warning',
  PENDING: 'warning',
  MEDIUM: 'warning',
  CONNECTING: 'progress',
  MAINTENANCE: 'serious',
  HIGH: 'serious',
  OFFLINE: 'critical',
  FAILED: 'critical',
  SUSPENDED: 'critical',
  BANNED: 'critical',
  UNPAID: 'critical',
  UNCOLLECTIBLE: 'critical',
  CRITICAL: 'critical',
};

export function toneOf(status: string): StatusTone {
  return TONES[status] ?? 'neutral';
}

export function humanize(value: string): string {
  const text = value.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Status indicator: icon + label (never color alone), neutral text ink. */
export function StatusBadge({
  status,
  tone,
  label,
  className,
}: {
  status?: string;
  tone?: StatusTone;
  label?: string;
  className?: string;
}) {
  const resolved = tone ?? toneOf(status ?? '');
  const { color, Icon } = TONE_STYLE[resolved];
  return (
    <span
      className={cn(
        'bg-background/40 text-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        className,
      )}
    >
      <Icon
        className={cn('size-3.5', color, resolved === 'progress' && 'animate-spin')}
        aria-hidden
      />
      {label ?? humanize(status ?? 'unknown')}
    </span>
  );
}

/** Small pulsing dot for live states. */
export function LiveDot({ tone = 'good', className }: { tone?: StatusTone; className?: string }) {
  const bg = {
    good: 'bg-status-good',
    warning: 'bg-status-warning',
    serious: 'bg-status-serious',
    critical: 'bg-status-critical',
    neutral: 'bg-status-neutral',
    progress: 'bg-status-warning',
  }[tone];
  return (
    <span className={cn('relative inline-flex size-2.5', className)} aria-hidden>
      {tone === 'good' || tone === 'progress' ? (
        <span
          className={cn('animate-pulse-ring absolute inline-flex size-full rounded-full', bg)}
        />
      ) : null}
      <span className={cn('relative inline-flex size-2.5 rounded-full', bg)} />
    </span>
  );
}

export { CircleDashed };
