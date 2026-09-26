'use client';

import { useId } from 'react';
import { cn } from '../lib/cn';

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  // Unique gradient id: several logos can be mounted at once (some hidden via display:none).
  const gradientId = `svpn-g-${useId().replace(/:/g, '')}`;
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <path
          d="M16 2 4 7v8c0 7.2 5.1 13.1 12 15 6.9-1.9 12-7.8 12-15V7L16 2Z"
          fill={`url(#${gradientId})`}
        />
        <path d="M17.8 8 11 17.2h4.6L14 24l7-9.6h-4.7L17.8 8Z" fill="#fff" />
      </svg>
      {compact ? null : <span className="text-sm font-extrabold tracking-[0.28em]">STORMVPN</span>}
    </span>
  );
}
