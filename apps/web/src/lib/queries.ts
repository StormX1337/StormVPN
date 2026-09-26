'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { connectRealtime } from '@stormvpn/api-client';
import { useEffect } from 'react';
import { api } from './api';

export const keys = {
  me: ['me'] as const,
  status: ['vpn-status'] as const,
  servers: (filters: object) => ['servers', filters] as const,
  recommended: ['servers', 'recommended'] as const,
  devices: ['devices'] as const,
  peers: (deviceId: string) => ['devices', deviceId, 'peers'] as const,
  traffic: (days: number) => ['traffic', days] as const,
  subscription: ['subscription'] as const,
  plans: ['plans'] as const,
  invoices: ['invoices'] as const,
  sessions: ['sessions'] as const,
  securityEvents: ['security-events'] as const,
  history: ['connections', 'history'] as const,
  ip: ['public-ip'] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.user.me() });
export const useVpnStatus = () =>
  useQuery({
    queryKey: keys.status,
    queryFn: () => api.connections.status(),
    refetchInterval: 15_000,
  });
export const useDevices = () =>
  useQuery({ queryKey: keys.devices, queryFn: () => api.devices.list() });
export const usePeers = (deviceId: string | null) =>
  useQuery({
    queryKey: keys.peers(deviceId ?? ''),
    queryFn: () => api.devices.peers(deviceId!),
    enabled: !!deviceId,
  });
export const useTraffic = (days = 30) =>
  useQuery({
    queryKey: keys.traffic(days),
    queryFn: () => api.traffic.summary(days),
    refetchInterval: 60_000,
  });
export const useSubscription = () =>
  useQuery({ queryKey: keys.subscription, queryFn: () => api.subscription.get() });
export const usePlans = () =>
  useQuery({ queryKey: keys.plans, queryFn: () => api.plans.list(), staleTime: 5 * 60_000 });
export const useInvoices = () =>
  useQuery({ queryKey: keys.invoices, queryFn: () => api.billing.invoices() });
export const useSessions = () =>
  useQuery({ queryKey: keys.sessions, queryFn: () => api.account.sessions() });
export const useSecurityEvents = () =>
  useQuery({ queryKey: keys.securityEvents, queryFn: () => api.account.securityEvents() });
export const useHistory = () =>
  useQuery({ queryKey: keys.history, queryFn: () => api.connections.history(25) });
export const usePublicIp = () =>
  useQuery({ queryKey: keys.ip, queryFn: () => api.user.ip(), refetchInterval: 60_000 });
export const useRecommended = (enabled = true) =>
  useQuery({
    queryKey: keys.recommended,
    queryFn: () => api.servers.recommended(),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });

/** Live updates over WebSocket; polling in the hooks above stays as a fallback. */
export function useRealtime(enabled: boolean): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const connection = connectRealtime({
      onMessage: (message) => {
        if (message.type === 'connection.updated') {
          void client.invalidateQueries({ queryKey: keys.status });
          void client.invalidateQueries({ queryKey: ['connections'] });
          void client.invalidateQueries({ queryKey: keys.devices });
        }
        if (message.type === 'account.suspended') window.location.assign('/login?suspended=1');
      },
    });
    return () => connection.close();
  }, [client, enabled]);
}
