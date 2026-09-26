import type { Metadata } from 'next';
import { CouponsView } from '@/components/catalog-views';

export const metadata: Metadata = { title: 'Coupons' };

export default function Page() {
  return <CouponsView />;
}
