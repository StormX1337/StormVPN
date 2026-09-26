import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SubscriptionView } from '@/components/subscription-view';

export const metadata: Metadata = { title: 'Subscription' };

export default function SubscriptionPage() {
  return (
    <Suspense>
      <SubscriptionView />
    </Suspense>
  );
}
