import type * as React from 'react';
import { cn } from '../lib/cn';

export function Separator({ className, orientation = 'horizontal' }: { className?: string; orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    />
  );
}

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
    />
  );
}

export function Alert({ className, variant = 'default', ...props }: React.ComponentProps<'div'> & { variant?: 'default' | 'warning' | 'destructive' | 'success' }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
        variant === 'default' && 'bg-accent/40',
        variant === 'warning' && 'border-status-warning/40 bg-status-warning/10',
        variant === 'destructive' && 'border-destructive/40 bg-destructive/10',
        variant === 'success' && 'border-status-good/40 bg-status-good/10',
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return <kbd className={cn('rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]', className)} {...props} />;
}
