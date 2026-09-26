'use client';

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'bg-popover text-popover-foreground data-[state=delayed-open]:animate-fade-in z-50 max-w-xs rounded-md border px-2.5 py-1.5 text-xs shadow-lg',
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
