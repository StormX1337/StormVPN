import type { Metadata } from 'next';
import { PaymentsView } from '@/components/billing-views';

export const metadata: Metadata = { title: 'Payments' };

export default function Page() {
  return <PaymentsView />;
}
