'use client';

import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  formatBytes,
  formatCurrency,
  formatDate,
  Input,
  NativeSelect,
  PageHeader,
  StatusBadge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@stormvpn/ui';
import { type AdminPlanDto, BillingInterval, CouponDuration, ServerClass } from '@stormvpn/types';
import { couponCreateSchema, planCreateSchema } from '@stormvpn/validation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';

const GB = 1024 ** 3;
const list = (value: string) => value.split(',').map((entry) => entry.trim()).filter(Boolean);

function PlanDialog({ plan, open, onOpenChange }: { plan: AdminPlanDto | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [error, setError] = useState<string>();
  const save = useAction((input: Record<string, unknown>) => (plan ? api.admin.updatePlan(plan.id, input) : api.admin.createPlan(input as never)), {
    success: plan ? 'Plan updated' : 'Plan created',
    invalidate: [['admin', 'plans']],
    onDone: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
            const classes = Object.values(ServerClass).filter((value) => form[`class_${value}`] === 'on');
            const input = {
              slug: form.slug,
              name: form.name,
              description: form.description || null,
              priceCents: Math.round(Number(form.price) * 100),
              currency: form.currency,
              billingInterval: form.billingInterval,
              intervalCount: Number(form.intervalCount),
              trialDays: Number(form.trialDays),
              maxDevices: Number(form.maxDevices),
              maxSessions: Number(form.maxSessions),
              trafficLimitBytes: form.trafficGb ? Math.round(Number(form.trafficGb) * GB) : null,
              allowedCountries: list(form.allowedCountries ?? ''),
              serverClasses: classes,
              priority: Number(form.priority),
              features: (form.features ?? '').split('\n').map((line) => line.trim()).filter(Boolean),
              isActive: form.isActive === 'on',
              isPublic: form.isPublic === 'on',
              sortOrder: Number(form.sortOrder),
            };
            const parsed = planCreateSchema.safeParse(input);
            if (!parsed.success) {
              const issue = parsed.error.issues[0]!;
              return setError(`${issue.path.join('.')}: ${issue.message}`);
            }
            setError(undefined);
            const { slug: _slug, ...update } = parsed.data;
            save.mutate(plan ? update : parsed.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>{plan ? `Edit ${plan.name}` : 'Create plan'}</DialogTitle>
            <DialogDescription>Price changes create a new Stripe price; existing subscribers keep their current price.</DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Slug" htmlFor="slug">
              <Input id="slug" name="slug" defaultValue={plan?.slug} disabled={!!plan} required />
            </Field>
            <Field label="Name" htmlFor="plan-name" className="sm:col-span-2">
              <Input id="plan-name" name="name" defaultValue={plan?.name} required />
            </Field>
            <Field label="Description" htmlFor="description" className="sm:col-span-3">
              <Input id="description" name="description" defaultValue={plan?.description ?? ''} />
            </Field>
            <Field label="Price" htmlFor="price">
              <Input id="price" name="price" type="number" step="0.01" min="0" defaultValue={plan ? plan.priceCents / 100 : 0} />
            </Field>
            <Field label="Currency" htmlFor="currency">
              <Input id="currency" name="currency" maxLength={3} defaultValue={plan?.currency ?? 'eur'} />
            </Field>
            <Field label="Billing interval" htmlFor="billingInterval">
              <div className="flex gap-2">
                <Input name="intervalCount" type="number" min={1} max={12} defaultValue={plan?.intervalCount ?? 1} className="w-16" aria-label="Interval count" />
                <NativeSelect id="billingInterval" name="billingInterval" defaultValue={plan?.billingInterval ?? 'MONTH'}>
                  {Object.values(BillingInterval).map((value) => (
                    <option key={value} value={value}>
                      {value.toLowerCase()}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </Field>
            <Field label="Trial days" htmlFor="trialDays">
              <Input id="trialDays" name="trialDays" type="number" min={0} defaultValue={plan?.trialDays ?? 0} />
            </Field>
            <Field label="Max devices" htmlFor="maxDevices">
              <Input id="maxDevices" name="maxDevices" type="number" min={1} defaultValue={plan?.maxDevices ?? 3} />
            </Field>
            <Field label="Max simultaneous" htmlFor="maxSessions">
              <Input id="maxSessions" name="maxSessions" type="number" min={1} defaultValue={plan?.maxSessions ?? 3} />
            </Field>
            <Field label="Traffic / month (GB)" htmlFor="trafficGb" hint="Empty = unlimited">
              <Input id="trafficGb" name="trafficGb" type="number" min={0} defaultValue={plan?.trafficLimitBytes ? plan.trafficLimitBytes / GB : ''} />
            </Field>
            <Field label="Allowed countries" htmlFor="allowedCountries" hint="Comma separated ISO codes, empty = all">
              <Input id="allowedCountries" name="allowedCountries" defaultValue={plan?.allowedCountries.join(', ')} />
            </Field>
            <Field label="Priority" htmlFor="priority" hint="0–100, ≥ 50 gets reserved headroom">
              <Input id="priority" name="priority" type="number" min={0} max={100} defaultValue={plan?.priority ?? 0} />
            </Field>
            <Field label="Sort order" htmlFor="sortOrder">
              <Input id="sortOrder" name="sortOrder" type="number" min={0} defaultValue={plan?.sortOrder ?? 0} />
            </Field>
            <fieldset className="grid gap-2 sm:col-span-3">
              <legend className="mb-1 text-sm font-medium">Server classes</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                {Object.values(ServerClass).map((value) => (
                  <label key={value} className="flex items-center gap-2">
                    <input type="checkbox" name={`class_${value}`} defaultChecked={plan ? plan.serverClasses.includes(value) : value === 'STANDARD'} className="size-4 accent-[var(--primary)]" />
                    {value.toLowerCase()}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Features (one per line)" htmlFor="features" className="sm:col-span-3">
              <Textarea id="features" name="features" rows={4} defaultValue={plan?.features.join('\n')} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={plan?.isActive ?? true} className="size-4 accent-[var(--primary)]" /> Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPublic" defaultChecked={plan?.isPublic ?? true} className="size-4 accent-[var(--primary)]" /> Public
            </label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {plan ? 'Save plan' : 'Create plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PlansView() {
  const { data: plans = [] } = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api.admin.plans() });
  const [editing, setEditing] = useState<AdminPlanDto | null>(null);
  const [creating, setCreating] = useState(false);
  const remove = useAction((id: string) => api.admin.deletePlan(id), { success: 'Plan deactivated', invalidate: [['admin', 'plans']] });
  return (
    <>
      <PageHeader
        title="Plans"
        description="Plans, limits and prices are data – nothing is hard-coded."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create plan
          </Button>
        }
      />
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Plan</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Limits</TableHead>
              <TableHead>Classes</TableHead>
              <TableHead>Stripe</TableHead>
              <TableHead>Subscribers</TableHead>
              <TableHead>State</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>
                  <div className="font-medium">{plan.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{plan.slug}</div>
                </TableCell>
                <TableCell className="tabular">
                  {plan.isFree ? 'Free' : `${formatCurrency(plan.priceCents, plan.currency)} / ${plan.intervalCount > 1 ? `${plan.intervalCount} ` : ''}${plan.billingInterval.toLowerCase()}`}
                  {plan.trialDays ? <div className="text-xs text-muted-foreground">{plan.trialDays}-day trial</div> : null}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {plan.maxDevices} devices · {plan.maxSessions} sessions · {plan.trafficLimitBytes === null ? 'unlimited' : formatBytes(plan.trafficLimitBytes, 0)}
                  <div>{plan.allowedCountries.length ? plan.allowedCountries.join(', ') : 'all countries'}</div>
                </TableCell>
                <TableCell className="text-xs">{plan.serverClasses.map((value) => value.toLowerCase()).join(', ')}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{plan.stripePriceId ?? '—'}</TableCell>
                <TableCell className="tabular">{plan.subscriberCount}</TableCell>
                <TableCell>
                  <StatusBadge tone={plan.isActive ? 'good' : 'neutral'} label={plan.isActive ? (plan.isPublic ? 'Public' : 'Hidden') : 'Inactive'} />
                </TableCell>
                <TableCell className="space-x-1 text-right">
                  <Button size="sm" variant="outline" onClick={() => setEditing(plan)}>
                    Edit
                  </Button>
                  {plan.isActive ? (
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(plan.id)}>
                      Deactivate
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <PlanDialog key={editing?.id ?? 'new'} plan={editing} open={creating || editing !== null} onOpenChange={(open) => !open && (setCreating(false), setEditing(null))} />
    </>
  );
}

export function CouponsView() {
  const { data: coupons = [] } = useQuery({ queryKey: ['admin', 'coupons'], queryFn: () => api.admin.coupons() });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const create = useAction((input: Record<string, unknown>) => api.admin.createCoupon(input as never), {
    success: 'Coupon created',
    invalidate: [['admin', 'coupons']],
    onDone: () => setOpen(false),
  });
  const toggle = useAction(({ id, isActive }: { id: string; isActive: boolean }) => api.admin.updateCoupon(id, { isActive }), { invalidate: [['admin', 'coupons']] });
  return (
    <>
      <PageHeader
        title="Coupons"
        description="Discount codes are synchronised to Stripe promotion codes."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> Create coupon
          </Button>
        }
      />
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Code</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Redeemed</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coupons.map((coupon) => (
              <TableRow key={coupon.id}>
                <TableCell>
                  <div className="font-mono font-semibold">{coupon.code}</div>
                  <div className="text-xs text-muted-foreground">{coupon.name}</div>
                </TableCell>
                <TableCell>{coupon.percentOff ? `${coupon.percentOff}%` : formatCurrency(coupon.amountOffCents ?? 0, coupon.currency ?? 'eur')}</TableCell>
                <TableCell className="text-muted-foreground">
                  {coupon.duration.toLowerCase()}
                  {coupon.durationInMonths ? ` · ${coupon.durationInMonths} months` : ''}
                </TableCell>
                <TableCell className="tabular">
                  {coupon.timesRedeemed}
                  {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ''}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(coupon.validUntil)}</TableCell>
                <TableCell>
                  <Switch checked={coupon.isActive} onCheckedChange={(checked) => toggle.mutate({ id: coupon.id, isActive: checked })} aria-label={`Toggle ${coupon.code}`} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
              const percent = form.kind === 'percent';
              const input = {
                code: form.code,
                name: form.name || null,
                percentOff: percent ? Number(form.value) : null,
                amountOffCents: percent ? null : Math.round(Number(form.value) * 100),
                currency: percent ? null : form.currency || 'eur',
                duration: form.duration,
                durationInMonths: form.duration === 'REPEATING' ? Number(form.durationInMonths) : null,
                maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
                validUntil: form.validUntil || null,
              };
              const parsed = couponCreateSchema.safeParse(input);
              if (!parsed.success) return setError(parsed.error.issues[0]!.message);
              setError(undefined);
              create.mutate({ ...input, code: parsed.data.code });
            }}
          >
            <DialogHeader>
              <DialogTitle>Create coupon</DialogTitle>
            </DialogHeader>
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code" htmlFor="code">
                <Input id="code" name="code" className="uppercase" required />
              </Field>
              <Field label="Name" htmlFor="coupon-name">
                <Input id="coupon-name" name="name" />
              </Field>
              <Field label="Type" htmlFor="kind">
                <NativeSelect id="kind" name="kind" defaultValue="percent">
                  <option value="percent">Percent off</option>
                  <option value="amount">Amount off</option>
                </NativeSelect>
              </Field>
              <Field label="Value" htmlFor="value">
                <Input id="value" name="value" type="number" step="0.01" min="0" required />
              </Field>
              <Field label="Duration" htmlFor="duration">
                <NativeSelect id="duration" name="duration" defaultValue="ONCE">
                  {Object.values(CouponDuration).map((value) => (
                    <option key={value} value={value}>
                      {value.toLowerCase()}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Months (repeating)" htmlFor="durationInMonths">
                <Input id="durationInMonths" name="durationInMonths" type="number" min={1} />
              </Field>
              <Field label="Max redemptions" htmlFor="maxRedemptions">
                <Input id="maxRedemptions" name="maxRedemptions" type="number" min={1} />
              </Field>
              <Field label="Valid until" htmlFor="validUntil">
                <Input id="validUntil" name="validUntil" type="date" />
              </Field>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                Create coupon
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
