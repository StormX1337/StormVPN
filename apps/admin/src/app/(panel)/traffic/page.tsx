import type { Metadata } from 'next';
import { TrafficView } from '@/components/traffic-view';

export const metadata: Metadata = { title: 'Traffic' };

export default function Page() {
  return <TrafficView />;
}
