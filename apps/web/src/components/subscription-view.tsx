'use client';

import {
  Alert,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  formatBytes,
  formatCurrency,
  formatDate,
  Input,
  LoadMeter,
  PageHeader,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@stormvpn/ui';
import type { PlanDto } from '@stormvpn/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, ExternalLink, Receipt, Tag } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { keys, useInvoices, usePlans, useSubscription, useTraffic } from '@/lib/queries';
import { PlanCards } from './plan-cards';

export function SubscriptionView() {
  const client = useQueryClient();
  const params = useSearchParams();
  const { data: overview, isLoading } = useSubscription();
  const { data: plans = [] } = usePlans();
  const { data: invoices = [] } = useInvoices();
  const { data: traffic } = useTraffic(30);
  const [coupon, setCoupon] = useState('');
  const [switchTo, setSwitchTo] = useState<PlanDto | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const subscription = overview?.subscription ?? null;
  const paid = subscription?.provider === 'STRIPE';

  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.subscription });
    void client.invalidateQueries({ queryKey: keys.invoices });
  };
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const checkout = useMutation({
    mutationFn: (planId: string) => api.billing.checkout({ planId, couponCode: coupon.trim() || undefined }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError,
  });
  const portal = useMutation({ mutationFn: () => api.billing.portal(), onSuccess: ({ url }) => window.location.assign(url), onError });
  const changePlan = useMutation({
    mutationFn: (planId: string) => api.billing.changePlan(planId),
    onSuccess: () => {
      refresh();
      setSwitchTo(null);
      toast.success('Plan updated');
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => api.billing.cancel(),
    onSuccess: () => {
      refresh();
      setConfirmCancel(false);
      toast.success('Your subscription ends at the end of the billing period');
    },
    onError,
  });
  const resume = useMutation({ mutationFn: () => api.billing.resume(), onSuccess: refresh, onError });
  const validateCoupon = useMutation({
    mutationFn: () => api.billing.validateCoupon(coupon.trim()),
    onSuccess: (result) =>
      toast.success(`Coupon valid: ${result.percentOff ? `${result.percentOff}% off` : formatCurrency(result.amountOffCents ?? 0, result.currency ?? 'eur')}`),
    onError,
  });

  const actionFor = (plan: PlanDto) => {
    if (plan.id === subscription?.plan.id) return <Button disabled variant="outline">Current plan</Button>;
    if (plan.isFree) {
      return paid ? (
        <Button variant="outline" onClick={() => setConfirmCancel(true)}>
          Downgrade to free
        </Button>
      ) : (
        <Button variant="outline" disabled>
          Included
        </Button>
      );
    }
    if (paid) {
      const upgrade = plan.priceCents > (subscription?.plan.priceCents ?? 0);
      return (
        <Button variant={upgrade ? 'brand' : 'outline'} onClick={() => setSwitchTo(plan)}>
          {upgrade ? 'Upgrade' : 'Downgrade'}
        </Button>
      );
    }
    return (
      <Button variant="brand" disabled={checkout.isPending} onClick={() => checkout.mutate(plan.id)}>
        {overview?.trialEligible && plan.trialDays > 0 ? `Start ${plan.trialDays}-day trial` : 'Subscribe'}
      </Button>
    );
  };

  return (
    <>
      <PageHeader
        title="Subscription"
        description="Manage your plan, payment method and invoices."
        actions={
          paid ? (
            <Button variant="outline" disabled={portal.isPending} onClick={() => portal.mutate()}>
              <CreditCard /> Billing portal <ExternalLink className="size-3" />
            </Button>
          ) : null
        }
      />
      {params.get('checkout') === 'canceled' ? (
        <Alert>
          <CreditCard /> <span>Checkout was cancelled – no payment was taken.</span>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Current plan</CardTitle>
              <CardDescription>{subscription ? (paid ? 'Billed via Stripe' : 'No payment required') : 'No active plan'}</CardDescription>
            </div>
            {subscription ? <StatusBadge status={subscription.status} /> : null}
          </CardHeader>
          {isLoading ? (
            <Skeleton className="h-28" />
          ) : subscription ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Plan</p>
                <p className="text-xl font-semibold">{subscription.plan.name}</p>
                <p className="text-sm text-muted-foreground">
                  {subscription.plan.isFree ? 'Free' : `${formatCurrency(subscription.plan.priceCents, subscription.plan.currency)} / ${subscription.plan.billingInterval.toLowerCase()}`}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{subscription.cancelAtPeriodEnd ? 'Ends on' : subscription.status === 'TRIALING' ? 'Trial ends' : 'Next payment'}</p>
                <p className="font-medium">{formatDate(subscription.status === 'TRIALING' ? subscription.trialEnd : subscription.currentPeriodEnd)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Payment method</p>
                <p className="font-medium">
                  {subscription.paymentMethod ? `${subscription.paymentMethod.brand.toUpperCase()} •••• ${subscription.paymentMethod.last4}` : '—'}
                </p>
              </div>
              {paid ? (
                <div className="sm:col-span-3">
                  {subscription.cancelAtPeriodEnd ? (
                    <Button variant="outline" disabled={resume.isPending} onClick={() => resume.mutate()}>
                      Resume subscription
                    </Button>
                  ) : (
                    <Button variant="ghost" className="text-destructive" onClick={() => setConfirmCancel(true)}>
                      Cancel subscription
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Choose a plan below to get started.</p>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Usage this month</CardTitle>
          </CardHeader>
          <div className="space-y-4 text-sm">
            <div>
              <div className="mb-1 flex justify-between">
                <span className="text-muted-foreground">Devices</span>
                <span className="tabular">
                  {overview?.usage.devicesUsed ?? 0} / {subscription?.plan.maxDevices ?? 0}
                </span>
              </div>
              <LoadMeter value={((overview?.usage.devicesUsed ?? 0) / Math.max(1, subscription?.plan.maxDevices ?? 1)) * 100} showValue={false} label="Devices used" overloadThreshold={100} />
            </div>
            <div>
              <div className="mb-1 flex justify-between">
                <span className="text-muted-foreground">Traffic</span>
                <span className="tabular">
                  {formatBytes(overview?.usage.trafficUsedBytes ?? 0)}
                  {traffic?.limitBytes ? ` / ${formatBytes(traffic.limitBytes, 0)}` : ' · unlimited'}
                </span>
              </div>
              {traffic?.limitBytes ? (
                <LoadMeter value={((overview?.usage.trafficUsedBytes ?? 0) / traffic.limitBytes) * 100} showValue={false} label="Traffic used" overloadThreshold={100} />
              ) : null}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Active connections</span>
              <span className="tabular">
                {overview?.usage.activeConnections ?? 0} / {subscription?.plan.maxSessions ?? 0}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Plans</h2>
        {!paid ? (
          <div className="flex gap-2">
            <div className="relative">
              <Tag className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="w-48 pl-9 uppercase" placeholder="Coupon code" value={coupon} onChange={(event) => setCoupon(event.target.value)} aria-label="Coupon code" />
            </div>
            <Button variant="outline" disabled={!coupon.trim() || validateCoupon.isPending} onClick={() => validateCoupon.mutate()}>
              Apply
            </Button>
          </div>
        ) : null}
      </div>
      <PlanCards plans={plans} currentPlanId={subscription?.plan.id} renderAction={actionFor} />

      <Card className="p-0">
        <div className="flex items-center gap-2 px-5 pt-5">
          <Receipt className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Invoices</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-mono text-xs">{invoice.number ?? invoice.id.slice(0, 8)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(invoice.createdAt)}</TableCell>
                <TableCell className="tabular">{formatCurrency(invoice.amountDueCents, invoice.currency)}</TableCell>
                <TableCell>
                  <StatusBadge status={invoice.status} />
                </TableCell>
                <TableCell className="text-right">
                  {invoice.hostedInvoiceUrl ? (
                    <Button asChild size="sm" variant="ghost">
                      <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
                        View <ExternalLink className="size-3" />
                      </a>
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No invoices yet
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <ConfirmDialog
        open={switchTo !== null}
        onOpenChange={(open) => !open && setSwitchTo(null)}
        title={`Switch to ${switchTo?.name}?`}
        description="The price difference is prorated on your next invoice."
        confirmLabel="Switch plan"
        pending={changePlan.isPending}
        onConfirm={() => switchTo && changePlan.mutate(switchTo.id)}
      />
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel subscription?"
        description="You keep full access until the end of the current billing period, then move to the free plan."
        confirmLabel="Cancel at period end"
        destructive
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </>
  );
}
