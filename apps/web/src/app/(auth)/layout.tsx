import { Logo } from '@stormvpn/ui';
import Link from 'next/link';
import type * as React from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="hero-glow relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden />
      <Link href="/" className="relative mb-8">
        <Logo />
      </Link>
      <div className="animate-fade-in bg-card/80 relative w-full max-w-md rounded-2xl border p-6 shadow-2xl backdrop-blur sm:p-8">
        {children}
      </div>
      <p className="text-muted-foreground relative mt-6 text-xs">
        Protected by WireGuard® · No activity logs
      </p>
    </div>
  );
}
