import type { Metadata } from 'next';
import { ConnectionsView } from '@/components/ops-views';

export const metadata: Metadata = { title: 'Connections' };

export default function Page() {
  return <ConnectionsView />;
}
