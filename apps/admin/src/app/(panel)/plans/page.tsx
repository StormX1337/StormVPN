import type { Metadata } from 'next';
import { PlansView } from '@/components/catalog-views';

export const metadata: Metadata = { title: 'Plans' };

export default function Page() {
  return <PlansView />;
}
