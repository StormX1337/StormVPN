'use client';

import { Button, Card } from '@stormvpn/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { keys, useSubscription } from '@/lib/queries';

export default function BillingSuccessPage() {
  const client = useQueryClient();
  const { data } = useSubscription();
  const active = data?.subscription?.provider === 'STRIPE';
  useEffect(() => {
    // Stripe webhooks usually arrive within seconds – poll until the plan is active.
    if (active) return;
    const timer = setInterval(() => void client.invalidateQueries({ queryKey: keys.subscription }), 2000);
    return () => clearInterval(timer);
  }, [active, client]);
  return (
    <Card className="mx-auto mt-10 max-w-lg items-center gap-4 p-8 text-center">
      <CheckCircle2 className="size-12 text-status-good" />
      <h1 className="text-2xl font-semibold">Thank you!</h1>
      <p className="text-muted-foreground">
        {active ? `Your ${data?.subscription?.plan.name} plan is active.` : 'We are confirming your payment. This usually takes a few seconds…'}
      </p>
      <Button asChild variant="brand">
        <Link href="/dashboard">Connect now</Link>
      </Button>
    </Card>
  );
}
