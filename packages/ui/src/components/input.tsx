import type * as React from 'react';
import { cn } from '../lib/cn';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-input bg-background/60 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 flex h-10 w-full min-w-0 rounded-lg border px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input bg-background/60 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 flex min-h-20 w-full rounded-lg border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]',
        className,
      )}
      {...props}
    />
  );
}

export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'border-input bg-background/60 focus-visible:border-ring focus-visible:ring-ring/40 flex h-10 w-full rounded-lg border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn('text-sm leading-none font-medium select-none', className)}
      {...props}
    />
  );
}

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, error, hint, children, className }: FieldProps) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
