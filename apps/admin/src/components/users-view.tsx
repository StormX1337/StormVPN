'use client';

import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  formatDateTime,
  formatRelative,
  humanize,
  Input,
  NativeSelect,
  PageHeader,
  Pagination,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@stormvpn/ui';
import { Role, type AdminUserDto } from '@stormvpn/types';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';

type Detail = {
  status: string;
  suspendedReason: string | null;
  devices: { id: string; name: string; platform: string }[];
  subscriptions: {
    id: string;
    status: string;
    plan: { name: string };
    provider: string;
    currentPeriodEnd: string | null;
  }[];
  sessions: {
    id: string;
    ipAddress: string | null;
    userAgent: string | null;
    lastUsedAt: string;
  }[];
  securityEvents: {
    id: string;
    type: string;
    severity: string;
    createdAt: string;
    ipAddress: string | null;
  }[];
  riskFlags: { id: string; reason: string; score: number }[];
  peers: {
    id: string;
    server: { name: string };
    ipv4Address: string;
    status: string;
    disabledReason: string | null;
  }[];
};

function UserDetail({ user, onClose }: { user: AdminUserDto | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [planId, setPlanId] = useState('');
  const [days, setDays] = useState('30');
  const { data: detail } = useQuery({
    queryKey: ['admin', 'user', user?.id],
    queryFn: () => api.admin.user(user!.id) as Promise<Detail>,
    enabled: !!user,
  });
  const { data: plans = [] } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => api.admin.plans(),
    enabled: !!user,
  });
  const invalidate = [
    ['admin', 'users'],
    ['admin', 'user', user?.id ?? ''],
  ];
  const suspend = useAction(() => api.admin.suspendUser(user!.id, reason), {
    success: 'User suspended',
    invalidate,
  });
  const unsuspend = useAction(() => api.admin.unsuspendUser(user!.id), {
    success: 'User reactivated',
    invalidate,
  });
  const setRole = useAction((role: Role) => api.admin.setRole(user!.id, role), {
    success: 'Role updated',
    invalidate,
  });
  const revoke = useAction(() => api.admin.revokeUserSessions(user!.id), {
    success: (r) => `${(r as { revoked: number }).revoked} session(s) revoked`,
    invalidate,
  });
  const disconnect = useAction(() => api.admin.disconnectUser(user!.id), {
    success: 'Connections terminated',
    invalidate,
  });
  const grant = useAction(
    () => api.admin.grantPlan(user!.id, planId, days ? Number(days) : undefined),
    { success: 'Plan granted', invalidate },
  );

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        {user ? (
          <>
            <DialogHeader>
              <DialogTitle>{user.email}</DialogTitle>
              <DialogDescription>
                {user.name ?? 'No name'} · joined {formatDateTime(user.createdAt)} · risk score{' '}
                {user.riskScore}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={user.status} />
              <StatusBadge
                tone={user.emailVerified ? 'good' : 'warning'}
                label={user.emailVerified ? 'Email verified' : 'Email unverified'}
              />
              <StatusBadge
                tone={user.twoFactorEnabled ? 'good' : 'neutral'}
                label={user.twoFactorEnabled ? '2FA on' : '2FA off'}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="gap-3 p-4">
                <h4 className="text-sm font-semibold">Account actions</h4>
                {user.status === 'ACTIVE' ? (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Reason for suspension (shown in audit log)"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={reason.trim().length < 3 || suspend.isPending}
                      onClick={() => suspend.mutate(undefined)}
                    >
                      Suspend user
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p className="text-muted-foreground">
                      Reason: {detail?.suspendedReason ?? user.suspendedReason ?? '—'}
                    </p>
                    <Button
                      size="sm"
                      disabled={unsuspend.isPending}
                      onClick={() => unsuspend.mutate(undefined)}
                    >
                      Unsuspend user
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => revoke.mutate(undefined)}>
                    Revoke sessions
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => disconnect.mutate(undefined)}>
                    Terminate connections
                  </Button>
                </div>
                <Field label="Role" htmlFor="role">
                  <NativeSelect
                    id="role"
                    value={user.role}
                    onChange={(event) => setRole.mutate(event.target.value as Role)}
                  >
                    {Object.values(Role).map((role) => (
                      <option key={role} value={role}>
                        {humanize(role)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </Card>
              <Card className="gap-3 p-4">
                <h4 className="text-sm font-semibold">Grant complimentary plan</h4>
                <NativeSelect
                  value={planId}
                  onChange={(event) => setPlanId(event.target.value)}
                  aria-label="Plan"
                >
                  <option value="">Select plan…</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  type="number"
                  min={1}
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  aria-label="Days"
                  placeholder="Days (empty = unlimited)"
                />
                <Button
                  size="sm"
                  disabled={!planId || grant.isPending}
                  onClick={() => grant.mutate(undefined)}
                >
                  Grant plan
                </Button>
                <h4 className="pt-2 text-sm font-semibold">Subscriptions</h4>
                <ul className="space-y-1 text-sm">
                  {detail?.subscriptions.map((subscription) => (
                    <li key={subscription.id} className="flex items-center justify-between gap-2">
                      <span>
                        {subscription.plan.name}{' '}
                        <span className="text-muted-foreground text-xs">
                          ({subscription.provider.toLowerCase()})
                        </span>
                      </span>
                      <StatusBadge status={subscription.status} />
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="gap-2 p-4">
                <h4 className="text-sm font-semibold">Devices & peers</h4>
                <ul className="space-y-1 text-sm">
                  {detail?.peers.map((peer) => (
                    <li key={peer.id} className="flex justify-between gap-2">
                      <span className="font-mono text-xs">
                        {peer.server.name} · {peer.ipv4Address}
                      </span>
                      <StatusBadge
                        status={peer.status}
                        label={peer.disabledReason ? humanize(peer.disabledReason) : undefined}
                      />
                    </li>
                  ))}
                  {detail?.peers.length === 0 ? (
                    <li className="text-muted-foreground">
                      {detail.devices.length} device(s), no peers
                    </li>
                  ) : null}
                </ul>
              </Card>
              <Card className="gap-2 p-4">
                <h4 className="text-sm font-semibold">Recent security events</h4>
                <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                  {detail?.securityEvents.map((event) => (
                    <li key={event.id} className="flex justify-between gap-2">
                      <span>{humanize(event.type)}</span>
                      <span className="text-muted-foreground text-xs">
                        {formatRelative(event.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function UsersView() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminUserDto | null>(null);
  const deferred = useDeferredValue(search);
  const { data } = useQuery({
    queryKey: ['admin', 'users', deferred, status, page],
    queryFn: () => api.admin.users({ search: deferred, status, page, pageSize: 25 }),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader title="Users" description={data ? `${data.total} accounts` : undefined} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative sm:w-80">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            className="pl-9"
            placeholder="Search email or name"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            aria-label="Search users"
          />
        </div>
        <NativeSelect
          className="sm:w-44"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="BANNED">Banned</option>
        </NativeSelect>
      </div>
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Devices</TableHead>
              <TableHead>Live</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="font-medium">{user.email}</div>
                  <div className="text-muted-foreground text-xs">
                    {humanize(user.role)}
                    {user.twoFactorEnabled ? ' · 2FA' : ''}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={user.status} />
                </TableCell>
                <TableCell>{user.planName ?? '—'}</TableCell>
                <TableCell className="tabular">{user.deviceCount}</TableCell>
                <TableCell className="tabular">{user.activeConnections}</TableCell>
                <TableCell className="tabular">{user.riskScore}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatRelative(user.lastLoginAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setSelected(user)}>
                    Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data ? (
          <div className="px-4">
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
            />
          </div>
        ) : null}
      </Card>
      <UserDetail user={selected} onClose={() => setSelected(null)} />
    </>
  );
}
