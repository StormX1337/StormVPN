import type { Metadata } from 'next';
import { NodesView } from '@/components/nodes-view';

export const metadata: Metadata = { title: 'Nodes' };

export default function Page() {
  return <NodesView />;
}
