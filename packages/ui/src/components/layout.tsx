import type * as React from 'react';
import { cn } from '../lib/cn';

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="bg-muted text-muted-foreground rounded-full p-3 [&_svg]:size-5">{icon}</div>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Stat tile: label · value (auto-compacted by the caller) · optional delta/hint.
 * Values use proportional figures; the label is sentence case.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm', className)}>
      <div className="text-muted-foreground flex items-center justify-between text-sm">
        <span>{label}</span>
        {icon ? <span className="text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  );
}

export function CountryFlag({ code, className }: { code: string; className?: string }) {
  const flag = code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
  return (
    <span
      className={cn('text-base leading-none', className)}
      role="img"
      aria-label={code.toUpperCase()}
    >
      {flag}
    </span>
  );
}
