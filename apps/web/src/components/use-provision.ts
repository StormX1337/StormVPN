'use client';

import { toast } from '@stormvpn/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { keys } from '@/lib/queries';
import { type GeneratedConfig, provisionConfig, type ProvisionTarget } from '@/lib/wireguard';

/** Shared flow for Quick Connect / Connect / Generate config. */
export function useProvision() {
  const client = useQueryClient();
  const [config, setConfig] = useState<GeneratedConfig | null>(null);
  const mutation = useMutation({
    mutationFn: ({ target, mode }: { target: ProvisionTarget; mode: 'connect' | 'config' }) => provisionConfig(target, mode),
    onSuccess: (result) => {
      setConfig(result);
      void client.invalidateQueries({ queryKey: keys.status });
      void client.invalidateQueries({ queryKey: keys.devices });
      void client.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return {
    provision: (target: ProvisionTarget, mode: 'connect' | 'config' = 'connect') => mutation.mutate({ target, mode }),
    pending: mutation.isPending,
    config,
    close: () => setConfig(null),
  };
}
