'use client';

import { connectRealtime } from '@stormvpn/api-client';
import type { AdminNodeDto } from '@stormvpn/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** Pushes live KPIs and node telemetry from the WebSocket into the query cache. */
export function useAdminRealtime(enabled: boolean): 'connecting' | 'open' | 'closed' {
  const client = useQueryClient();
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  useEffect(() => {
    if (!enabled) return;
    const connection = connectRealtime({
      onStatus: setStatus,
      onMessage: (message) => {
        if (message.type === 'admin.stats') client.setQueryData(['admin', 'stats'], message.data);
        if (message.type === 'admin.node') {
          client.setQueryData<AdminNodeDto[]>(['admin', 'nodes'], (nodes) =>
            nodes?.map((node) =>
              node.id === message.data.id ? { ...node, ...message.data } : node,
            ),
          );
        }
      },
    });
    return () => connection.close();
  }, [client, enabled]);
  return status;
}
