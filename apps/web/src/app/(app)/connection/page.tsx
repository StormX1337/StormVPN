import type { Metadata } from 'next';
import { ConnectionView } from '@/components/connection-view';

export const metadata: Metadata = { title: 'Connection' };

export default function ConnectionPage() {
  return <ConnectionView />;
}
