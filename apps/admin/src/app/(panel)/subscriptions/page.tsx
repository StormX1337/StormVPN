import type { Metadata } from 'next';
import { SubscriptionsView } from '@/components/billing-views';

export const metadata: Metadata = { title: 'Subscriptions' };

export default function Page() {
  return <SubscriptionsView />;
}
