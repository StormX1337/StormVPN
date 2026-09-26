'use client';

import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  EmptyState,
  LiveDot,
  Logo,
  Skeleton,
  ThemeToggle,
} from '@stormvpn/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BadgePercent,
  Boxes,
  CreditCard,
  Gauge,
  Layers,
  LogOut,
  Menu,
  Network,
  ScrollText,
  Server,
  Settings,
  ShieldAlert,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type * as React from 'react';
import { api } from '@/lib/api';
import { useAdminRealtime } from '@/lib/realtime';

const NAV = [
  { href: '/', label: 'Overview', icon: Gauge },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { href: '/payments', label: 'Payments', icon: Wallet },
  { href: '/servers', label: 'Servers', icon: Server },
  { href: '/nodes', label: 'Nodes', icon: Boxes },
  { href: '/connections', label: 'Connections', icon: Network },
  { href: '/traffic', label: 'Traffic', icon: Activity },
  { href: '/plans', label: 'Plans', icon: Layers },
  { href: '/coupons', label: 'Coupons', icon: BadgePercent },
  { href: '/logs', label: 'Audit logs', icon: ScrollText },
  { href: '/security', label: 'Security', icon: ShieldAlert },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active && 'bg-accent text-foreground shadow-[inset_2px_0_0_var(--primary)]',
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useQuery({ queryKey: ['me'], queryFn: () => api.user.me() });
  const [open, setOpen] = useState(false);
  const staff = user?.role === 'ADMIN' || user?.role === 'SUPPORT';
  const live = useAdminRealtime(staff);

  if (isLoading) return <Skeleton className="m-8 h-40" />;
  if (!staff) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState
          icon={<ShieldAlert />}
          title="Access denied"
          description="This area is restricted to StormVPN staff."
          action={
            <Button asChild variant="outline">
              <a href="/dashboard">Back to dashboard</a>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="bg-sidebar sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r px-3 py-5 lg:flex">
        <div className="flex items-center gap-2 px-2">
          <Logo />
        </div>
        <span className="bg-primary/15 text-primary mx-2 w-fit rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase">
          Admin
        </span>
        <Nav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu />
          </Button>
          <span className="text-muted-foreground flex items-center gap-2 text-xs">
            <LiveDot
              tone={live === 'open' ? 'good' : live === 'connecting' ? 'progress' : 'critical'}
            />
            {live === 'open' ? 'Live' : live === 'connecting' ? 'Connecting…' : 'Offline – polling'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {user.email} · {user.role.toLowerCase()}
            </span>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={async () => {
                await api.auth.logout().catch(() => undefined);
                window.location.assign('/admin/login');
              }}
            >
              <LogOut />
            </Button>
          </div>
        </header>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="top-0 left-0 h-dvh max-h-dvh w-72 translate-x-0 translate-y-0 rounded-none rounded-r-2xl">
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            <Logo className="mb-2" />
            <Nav onNavigate={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
        <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
