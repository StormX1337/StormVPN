'use client';

import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  LiveDot,
  Logo,
  ThemeToggle,
} from '@stormvpn/ui';
import { CreditCard, Gauge, LogOut, Menu, MonitorSmartphone, Server, Shield, User, Waypoints } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type * as React from 'react';
import { api } from '@/lib/api';
import { useMe, useRealtime, useVpnStatus } from '@/lib/queries';
import { VerifyEmailBanner } from './verify-email-banner';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: Gauge },
  { href: '/servers', label: 'Servers', icon: Server },
  { href: '/connection', label: 'Connection', icon: Waypoints },
  { href: '/devices', label: 'Devices', icon: MonitorSmartphone },
  { href: '/subscription', label: 'Subscription', icon: CreditCard },
  { href: '/account', label: 'Account', icon: User },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
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

async function logout() {
  await api.auth.logout().catch(() => undefined);
  window.location.assign('/login');
}

function ConnectionPill() {
  const { data } = useVpnStatus();
  const connected = data?.connected ?? false;
  return (
    <Link href="/connection" className="hidden items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-xs font-medium sm:flex">
      <LiveDot tone={connected ? 'good' : 'critical'} />
      {connected ? `Protected · ${data?.connection?.server.name}` : 'Not protected'}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: user } = useMe();
  const [open, setOpen] = useState(false);
  useRealtime(Boolean(user));

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r bg-sidebar px-4 py-5 lg:flex">
        <Link href="/dashboard" className="px-2">
          <Logo />
        </Link>
        <NavLinks />
        <div className="mt-auto rounded-xl border bg-gradient-to-br from-sky-500/10 to-indigo-500/10 p-4 text-xs text-muted-foreground">
          <Shield className="mb-2 size-4 text-foreground" />
          WireGuard® with per-device keys generated on your device.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
          <Link href="/dashboard" className="lg:hidden">
            <Logo compact />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ConnectionPill />
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                  <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-xs font-semibold text-white">
                    {(user?.name ?? user?.email ?? '?').charAt(0).toUpperCase()}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/account">
                    <User /> Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/subscription">
                    <CreditCard /> Subscription
                  </Link>
                </DropdownMenuItem>
                {user && (user.role === 'ADMIN' || user.role === 'SUPPORT') ? (
                  <DropdownMenuItem asChild>
                    <a href="/admin">
                      <Shield /> Admin panel
                    </a>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="top-0 left-0 h-dvh max-h-dvh w-72 translate-x-0 translate-y-0 rounded-none rounded-r-2xl">
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            <Logo className="mb-4" />
            <NavLinks onNavigate={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">
          {user && !user.emailVerified ? <VerifyEmailBanner /> : null}
          {children}
        </main>
      </div>
    </div>
  );
}
