'use client';

import {
  Button,
  Card,
  formatCurrency,
  formatDate,
  formatDateTime,
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
} from '@stormvpn/ui';
import { SubscriptionStatus } from '@stormvpn/types';
import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';

export function SubscriptionsView() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search);
  const { data } = useQuery({
    queryKey: ['admin', 'subscriptions', status, deferred, page],
    queryFn: () => api.admin.subscriptions({ status, search: deferred, page }),
    placeholderData: (previous) => previous,
  });
  const invalidate = [['admin', 'subscriptions']];
  const cancel = useAction((id: string) => api.admin.cancelSubscription(id), { success: 'Cancellation scheduled', invalidate });
  const sync = useAction((id: string) => api.admin.syncSubscription(id), { success: 'Synchronised with Stripe', invalidate });

  return (
    <>
      <PageHeader title="Subscriptions" description={data ? `${data.total} subscriptions` : undefined} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input className="sm:w-72" placeholder="Search customer email" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search" />
        <NativeSelect className="sm:w-48" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.values(SubscriptionStatus).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Customer</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Period end</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.userEmail}</TableCell>
                <TableCell>{row.planName}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                  {row.cancelAtPeriodEnd ? <span className="ml-2 text-xs text-muted-foreground">cancels at period end</span> : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{row.provider.toLowerCase()}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(row.currentPeriodEnd)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                <TableCell className="space-x-1 text-right">
                  {row.stripeSubscriptionId ? (
                    <Button size="sm" variant="ghost" onClick={() => sync.mutate(row.id)}>
                      Sync
                    </Button>
                  ) : null}
                  {['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(row.status) && !row.cancelAtPeriodEnd ? (
                    <Button size="sm" variant="outline" onClick={() => cancel.mutate(row.id)}>
                      Cancel
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data ? (
          <div className="px-4">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </div>
        ) : null}
      </Card>
    </>
  );
}

export function PaymentsView() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search);
  const { data } = useQuery({
    queryKey: ['admin', 'payments', deferred, page],
    queryFn: () => api.admin.payments({ search: deferred, page }),
    placeholderData: (previous) => previous,
  });
  return (
    <>
      <PageHeader title="Payments" description="Stripe payments recorded from webhooks." />
      <Input className="sm:w-72" placeholder="Search customer email" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search" />
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Customer</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.userEmail}</TableCell>
                <TableCell className="tabular">{formatCurrency(row.amountCents, row.currency)}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground">{row.failureReason ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(row.paidAt ?? row.createdAt)}</TableCell>
              </TableRow>
            ))}
            {data?.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No payments yet
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {data ? (
          <div className="px-4">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </div>
        ) : null}
      </Card>
    </>
  );
}
