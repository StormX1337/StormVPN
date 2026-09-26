'use client';

import { formatDuration } from '@stormvpn/ui';
import { useEffect, useState } from 'react';

export function SessionTimer({ since }: { since: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!since) return <span>—</span>;
  return <span className="tabular">{formatDuration((now - new Date(since).getTime()) / 1000)}</span>;
}
