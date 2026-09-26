'use client';

import { Button, Logo, Skeleton, ThemeToggle } from '@stormvpn/ui';
import { EyeOff, Gauge, Globe2, KeyRound, MonitorSmartphone, ServerCog, ShieldCheck, Zap } from 'lucide-react';
import Link from 'next/link';
import { usePlans } from '@/lib/queries';
import { PlanCards } from './plan-cards';

const FEATURES = [
  { icon: Zap, title: 'WireGuard® speed', text: 'Modern cryptography (Curve25519, ChaCha20-Poly1305) with minimal overhead and instant reconnects.' },
  { icon: ServerCog, title: 'Own infrastructure', text: 'Every node is operated by StormVPN – no rented third-party VPN capacity.' },
  { icon: EyeOff, title: 'No activity logs', text: 'We never record destinations, DNS queries or traffic content – only aggregated volume for fair use.' },
  { icon: KeyRound, title: 'Keys stay yours', text: 'Private keys are generated on your device. Our servers only ever see your public key.' },
  { icon: Gauge, title: 'Smart Quick Connect', text: 'Load balancing picks the best server by load, latency and capacity in milliseconds.' },
  { icon: MonitorSmartphone, title: 'Every platform', text: 'Windows, macOS, Linux, Android, iOS and routers – manage all devices in one dashboard.' },
];

export function Landing() {
  const { data: plans, isLoading } = usePlans();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Logo />
          <nav className="ml-auto hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-4">
            <ThemeToggle />
            <Button asChild variant="ghost">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild variant="brand" className="hidden sm:inline-flex">
              <Link href="/register">Get StormVPN</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="hero-glow relative overflow-hidden">
        <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 pt-20 pb-24 text-center md:pt-28">
          <span className="inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-status-good" /> WireGuard® · Own global network · No logs
          </span>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Weather any network.{' '}
            <span className="bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">Stay private with StormVPN.</span>
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            A fast, modern VPN on infrastructure we run ourselves. Connect in one click, manage every device, and keep full control of your keys.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="brand" size="lg">
              <Link href="/register">Start for free</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#pricing">See plans</a>
            </Button>
          </div>
          <div className="mt-6 grid w-full max-w-3xl grid-cols-3 gap-4 rounded-2xl border bg-card/60 p-5 text-left backdrop-blur">
            {[
              ['9+', 'locations'],
              ['10 Gbit/s', 'per node'],
              ['0', 'activity logs'],
            ].map(([value, label]) => (
              <div key={label}>
                <div className="text-2xl font-semibold">{value}</div>
                <div className="text-sm text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-4 py-20">
        <div className="mb-10 max-w-2xl space-y-2">
          <h2 className="text-3xl font-semibold tracking-tight">Built for privacy, engineered for speed</h2>
          <p className="text-muted-foreground">Security-first architecture from the key exchange to the billing system.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border bg-card p-6 transition hover:border-primary/40">
              <div className="mb-4 inline-flex rounded-xl bg-gradient-to-br from-sky-500/15 to-indigo-500/15 p-2.5">
                <Icon className="size-5 text-sky-400" />
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="border-t bg-card/30">
        <div className="mx-auto w-full max-w-6xl px-4 py-20">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Simple pricing</h2>
            <p className="mt-2 text-muted-foreground">Start free. Upgrade for more devices, locations and unlimited traffic. Cancel anytime.</p>
          </div>
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-96 rounded-2xl" />
              ))}
            </div>
          ) : (
            <PlanCards
              plans={plans ?? []}
              renderAction={(plan) => (
                <Button asChild variant={plan.slug === 'pro' ? 'brand' : 'outline'}>
                  <Link href={`/register?plan=${plan.slug}`}>{plan.isFree ? 'Start free' : plan.trialDays ? `Try ${plan.trialDays} days free` : 'Get started'}</Link>
                </Button>
              )}
            />
          )}
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p className="flex items-center gap-2">
            <Globe2 className="size-4" /> © {new Date().getFullYear()} StormVPN. WireGuard is a registered trademark of Jason A. Donenfeld.
          </p>
        </div>
      </footer>
    </div>
  );
}
