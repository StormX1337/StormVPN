'use client';

import { toast } from '@stormvpn/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from './errors';

/** Mutation with toast feedback and cache invalidation of admin query keys. */
export function useAction<TArg, TResult = unknown>(
  fn: (arg: TArg) => Promise<TResult>,
  options: {
    success?: string | ((result: TResult) => string);
    invalidate?: string[][];
    onDone?: (result: TResult) => void;
  } = {},
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      for (const key of options.invalidate ?? []) void client.invalidateQueries({ queryKey: key });
      const message =
        typeof options.success === 'function' ? options.success(result) : options.success;
      if (message) toast.success(message);
      options.onDone?.(result);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
