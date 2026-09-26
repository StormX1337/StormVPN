'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-9 items-center gap-1 rounded-lg p-1',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'focus-visible:ring-ring/50 data-[state=active]:bg-card data-[state=active]:text-foreground inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-4 outline-none', className)} {...props} />;
}
