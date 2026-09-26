import type {
  AdminConnectionDto,
  AdminNodeDto,
  AdminPlanDto,
  AdminSecurityEventDto,
  AdminServerDto,
  AdminStatsDto,
  AdminSubscriptionDto,
  AdminTrafficDto,
  AdminUserDto,
  AuditLogDto,
  AuthResultDto,
  CheckoutSessionDto,
  ConnectionDto,
  ConnectResultDto,
  CouponDto,
  DeviceDto,
  EnrollmentTokenDto,
  InvoiceDto,
  LoginResultDto,
  Paginated,
  PaymentDto,
  PeerDto,
  PlanDto,
  PublicIpDto,
  RiskFlagDto,
  Role,
  SecurityEventDto,
  ServerDto,
  ServerStatus,
  SessionDto,
  SubscriptionOverviewDto,
  SystemSettingsDto,
  TrafficSummaryDto,
  TwoFactorSetupDto,
  UserDto,
  VpnStatusDto,
  WireGuardConfigDto,
} from '@stormvpn/types';
import type {
  ChangePasswordInput,
  CheckoutInput,
  CouponCreateInput,
  CreateConnectionInput,
  CreateDeviceInput,
  ListServersQuery,
  LoginInput,
  PlanCreateInput,
  PlanUpdateInput,
  RegisterInput,
  ServerCreateInput,
  ServerUpdateInput,
  SettingsUpdateInput,
  UpdateProfileInput,
  WireGuardConfigInput,
} from '@stormvpn/validation';
import { HttpClient, type HttpOptions } from './http';

type Query = Record<string, string | number | boolean | undefined | null>;
export type SelectionInfo = ConnectResultDto['selection'];
export type AdminNodeDetail = {
  node: AdminNodeDto;
  history: {
    at: string;
    cpuPercent: number;
    memoryPercent: number;
    loadPercent: number;
    activeConnections: number;
    rxBps: number;
    txBps: number;
  }[];
};
export type RecommendedServer = { server: ServerDto; score: number | null; reason: string };

/** Typed StormVPN API (v1). */
export function createApiClient(options: HttpOptions = {}) {
  const http = new HttpClient(options);
  const id = (value: string) => encodeURIComponent(value);

  return {
    http,
    auth: {
      register: (input: RegisterInput) => http.post<AuthResultDto>('/auth/register', input),
      login: (input: LoginInput) =>
        http.request<LoginResultDto>('POST', '/auth/login', { body: input, noRefresh: true }),
      loginMfa: (mfaToken: string, code: string) =>
        http.request<AuthResultDto>('POST', '/auth/login/mfa', {
          body: { mfaToken, code },
          noRefresh: true,
        }),
      logout: () => http.request<void>('POST', '/auth/logout', { body: {}, noRefresh: true }),
      verifyEmail: (token: string) =>
        http.request<{ user: UserDto }>('POST', '/auth/verify-email', {
          body: { token },
          noRefresh: true,
        }),
      resendVerification: () => http.post<{ sent: boolean }>('/auth/resend-verification'),
      forgotPassword: (email: string) =>
        http.request<{ sent: boolean }>('POST', '/auth/forgot-password', {
          body: { email },
          noRefresh: true,
        }),
      resetPassword: (token: string, password: string) =>
        http.request<void>('POST', '/auth/reset-password', {
          body: { token, password },
          noRefresh: true,
        }),
    },
    user: {
      me: () => http.get<UserDto>('/user'),
      update: (input: UpdateProfileInput) => http.patch<UserDto>('/user', input),
      ip: () => http.get<PublicIpDto>('/user/ip'),
    },
    account: {
      changePassword: (input: ChangePasswordInput) => http.post<void>('/account/password', input),
      setupTwoFactor: () => http.post<TwoFactorSetupDto>('/account/2fa/setup'),
      enableTwoFactor: (code: string) =>
        http.post<{ backupCodes: string[] }>('/account/2fa/enable', { code }),
      disableTwoFactor: (password: string, code: string) =>
        http.post<void>('/account/2fa/disable', { password, code }),
      regenerateBackupCodes: (code: string) =>
        http.post<{ backupCodes: string[] }>('/account/2fa/backup-codes', { code }),
      sessions: () => http.get<SessionDto[]>('/account/sessions'),
      revokeSession: (sessionId: string) => http.delete<void>(`/account/sessions/${id(sessionId)}`),
      revokeOtherSessions: () => http.delete<{ revoked: number }>('/account/sessions'),
      securityEvents: () => http.get<SecurityEventDto[]>('/account/security-events'),
      delete: (password: string) => http.delete<void>('/account', { password, confirm: 'DELETE' }),
    },
    devices: {
      list: () => http.get<DeviceDto[]>('/devices'),
      create: (input: CreateDeviceInput) => http.post<DeviceDto>('/devices', input),
      rename: (deviceId: string, name: string) =>
        http.patch<void>(`/devices/${id(deviceId)}`, { name }),
      remove: (deviceId: string) => http.delete<void>(`/devices/${id(deviceId)}`),
      peers: (deviceId: string) => http.get<PeerDto[]>(`/devices/${id(deviceId)}/peers`),
      revokePeer: (deviceId: string, peerId: string) =>
        http.delete<void>(`/devices/${id(deviceId)}/peers/${id(peerId)}`),
    },
    servers: {
      list: (query: Partial<ListServersQuery> = {}) =>
        http.get<ServerDto[]>('/servers', query as Query),
      get: (serverId: string) => http.get<ServerDto>(`/servers/${id(serverId)}`),
      recommended: (query: { country?: string; region?: string } = {}) =>
        http.get<RecommendedServer>('/servers/recommended', query),
      favorite: (serverId: string) => http.put<void>(`/servers/${id(serverId)}/favorite`),
      unfavorite: (serverId: string) => http.delete<void>(`/servers/${id(serverId)}/favorite`),
    },
    connections: {
      status: () => http.get<VpnStatusDto>('/connections/status'),
      active: () => http.get<ConnectionDto[]>('/connections'),
      history: (limit = 20) => http.get<ConnectionDto[]>('/connections/history', { limit }),
      connect: (input: CreateConnectionInput) => http.post<ConnectResultDto>('/connections', input),
      disconnect: (connectionId: string) =>
        http.delete<ConnectionDto>(`/connections/${id(connectionId)}`),
    },
    wireguard: {
      config: (input: WireGuardConfigInput) =>
        http.post<WireGuardConfigDto & { selection: SelectionInfo }>('/wireguard/config', input),
    },
    traffic: {
      summary: (days = 30) => http.get<TrafficSummaryDto>('/traffic/summary', { days }),
    },
    plans: {
      list: () => http.get<PlanDto[]>('/plans'),
    },
    subscription: {
      get: () => http.get<SubscriptionOverviewDto>('/subscription'),
    },
    billing: {
      checkout: (input: CheckoutInput) => http.post<CheckoutSessionDto>('/billing/checkout', input),
      portal: () => http.post<{ url: string }>('/billing/portal'),
      changePlan: (planId: string) =>
        http.post<SubscriptionOverviewDto>('/billing/change-plan', { planId }),
      cancel: () => http.post<SubscriptionOverviewDto>('/billing/cancel'),
      resume: () => http.post<SubscriptionOverviewDto>('/billing/resume'),
      invoices: () => http.get<InvoiceDto[]>('/billing/invoices'),
      validateCoupon: (code: string, planId?: string) =>
        http.post<CouponDto>('/billing/coupons/validate', { code, planId }),
    },
    admin: {
      stats: () => http.get<AdminStatsDto>('/admin/stats'),
      users: (query: Query = {}) => http.get<Paginated<AdminUserDto>>('/admin/users', query),
      user: (userId: string) => http.get<Record<string, unknown>>(`/admin/users/${id(userId)}`),
      suspendUser: (userId: string, reason: string) =>
        http.post<void>(`/admin/users/${id(userId)}/suspend`, { reason }),
      unsuspendUser: (userId: string) => http.post<void>(`/admin/users/${id(userId)}/unsuspend`),
      setRole: (userId: string, role: Role) =>
        http.patch<void>(`/admin/users/${id(userId)}/role`, { role }),
      revokeUserSessions: (userId: string) =>
        http.post<{ revoked: number }>(`/admin/users/${id(userId)}/sessions/revoke`),
      disconnectUser: (userId: string) =>
        http.post<{ disconnected: number }>(`/admin/users/${id(userId)}/disconnect`),
      grantPlan: (userId: string, planId: string, days?: number) =>
        http.post<void>(`/admin/users/${id(userId)}/grant-plan`, { planId, days }),
      subscriptions: (query: Query = {}) =>
        http.get<Paginated<AdminSubscriptionDto>>('/admin/subscriptions', query),
      cancelSubscription: (subscriptionId: string, immediately = false) =>
        http.post<void>(`/admin/subscriptions/${id(subscriptionId)}/cancel`, { immediately }),
      syncSubscription: (subscriptionId: string) =>
        http.post<void>(`/admin/subscriptions/${id(subscriptionId)}/sync`),
      payments: (query: Query = {}) => http.get<Paginated<PaymentDto>>('/admin/payments', query),
      plans: () => http.get<AdminPlanDto[]>('/admin/plans'),
      createPlan: (input: PlanCreateInput) => http.post<AdminPlanDto>('/admin/plans', input),
      updatePlan: (planId: string, input: PlanUpdateInput) =>
        http.patch<AdminPlanDto>(`/admin/plans/${id(planId)}`, input),
      deletePlan: (planId: string) => http.delete<void>(`/admin/plans/${id(planId)}`),
      coupons: () => http.get<CouponDto[]>('/admin/coupons'),
      createCoupon: (input: CouponCreateInput) => http.post<CouponDto>('/admin/coupons', input),
      updateCoupon: (
        couponId: string,
        input: { isActive?: boolean; validUntil?: string | null; maxRedemptions?: number | null },
      ) => http.patch<CouponDto>(`/admin/coupons/${id(couponId)}`, input),
      servers: () => http.get<AdminServerDto[]>('/admin/servers'),
      server: (serverId: string) => http.get<AdminServerDto>(`/admin/servers/${id(serverId)}`),
      createServer: (input: ServerCreateInput) =>
        http.post<AdminServerDto>('/admin/servers', input),
      updateServer: (serverId: string, input: ServerUpdateInput) =>
        http.patch<AdminServerDto>(`/admin/servers/${id(serverId)}`, input),
      deleteServer: (serverId: string) => http.delete<void>(`/admin/servers/${id(serverId)}`),
      setServerStatus: (serverId: string, status: ServerStatus) =>
        http.post<AdminServerDto>(`/admin/servers/${id(serverId)}/status`, { status }),
      setKillSwitch: (serverId: string, engaged: boolean, reason: string) =>
        http.post<AdminServerDto>(`/admin/servers/${id(serverId)}/kill-switch`, {
          engaged,
          reason,
        }),
      enrollmentToken: (serverId: string) =>
        http.post<EnrollmentTokenDto>(`/admin/servers/${id(serverId)}/enrollment-token`),
      nodes: () => http.get<AdminNodeDto[]>('/admin/nodes'),
      node: (nodeId: string) => http.get<AdminNodeDetail>(`/admin/nodes/${id(nodeId)}`),
      deleteNode: (nodeId: string) => http.delete<void>(`/admin/nodes/${id(nodeId)}`),
      connections: (query: Query = {}) =>
        http.get<Paginated<AdminConnectionDto>>('/admin/connections', query),
      terminateConnection: (connectionId: string) =>
        http.delete<void>(`/admin/connections/${id(connectionId)}`),
      traffic: (query: { from?: string; to?: string } = {}) =>
        http.get<AdminTrafficDto>('/admin/traffic', query),
      logs: (query: Query = {}) => http.get<Paginated<AuditLogDto>>('/admin/logs', query),
      securityEvents: (query: Query = {}) =>
        http.get<Paginated<AdminSecurityEventDto>>('/admin/security/events', query),
      resolveSecurityEvent: (eventId: string) =>
        http.post<void>(`/admin/security/events/${id(eventId)}/resolve`),
      riskFlags: () => http.get<RiskFlagDto[]>('/admin/security/risk-flags'),
      createRiskFlag: (input: {
        subjectType: 'USER' | 'IP';
        subjectValue: string;
        reason: string;
        score: number;
        expiresInHours?: number | null;
      }) => http.post<{ created: boolean }>('/admin/security/risk-flags', input),
      resolveRiskFlag: (flagId: string) =>
        http.post<void>(`/admin/security/risk-flags/${id(flagId)}/resolve`),
      settings: () => http.get<SystemSettingsDto>('/admin/settings'),
      updateSettings: (input: SettingsUpdateInput) =>
        http.patch<SystemSettingsDto>('/admin/settings', input),
    },
  };
}

export type StormApi = ReturnType<typeof createApiClient>;
