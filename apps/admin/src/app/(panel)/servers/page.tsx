import type { Metadata } from 'next';
import { ServersView } from '@/components/servers-view';

export const metadata: Metadata = { title: 'Servers' };

export default function Page() {
  return <ServersView />;
}
