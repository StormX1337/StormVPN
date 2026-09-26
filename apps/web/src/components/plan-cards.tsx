import { cn, formatBytes, formatCurrency, intervalLabel } from '@stormvpn/ui';
import type { PlanDto } from '@stormvpn/types';
import { Check } from 'lucide-react';
import type * as React from 'react';

export function PlanCards({
  plans,
  currentPlanId,
  renderAction,
}: {
  plans: PlanDto[];
  currentPlanId?: string | null;
  renderAction: (plan: PlanDto) => React.ReactNode;
}) {
  const featured = plans.find((plan) => plan.slug === 'pro')?.id;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {plans.map((plan) => {
        const current = plan.id === currentPlanId;
        return (
          <div
            key={plan.id}
            className={cn(
              'relative flex flex-col gap-5 rounded-2xl border bg-card p-6 shadow-sm',
              plan.id === featured && 'border-primary/50 shadow-lg shadow-primary/10',
              current && 'ring-2 ring-primary/60',
            )}
          >
            {plan.id === featured ? (
              <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-0.5 text-xs font-semibold text-white">
                Most popular
              </span>
            ) : null}
            <div className="space-y-1">
              <h3 className="font-semibold">{plan.name}</h3>
              <p className="min-h-10 text-sm text-muted-foreground">{plan.description}</p>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight">{plan.isFree ? 'Free' : formatCurrency(plan.priceCents, plan.currency)}</span>
              {plan.isFree ? null : <span className="text-sm text-muted-foreground">/ {intervalLabel(plan.billingInterval, plan.intervalCount)}</span>}
            </div>
            {plan.trialDays > 0 ? <p className="-mt-3 text-xs text-status-good">{plan.trialDays}-day free trial</p> : null}
            <ul className="flex-1 space-y-2 text-sm">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-status-good" /> {plan.maxDevices} device{plan.maxDevices > 1 ? 's' : ''} · {plan.maxSessions} simultaneous
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-status-good" />
                {plan.trafficLimitBytes === null ? 'Unlimited traffic' : `${formatBytes(plan.trafficLimitBytes, 0)} per month`}
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-status-good" />
                {plan.allowedCountries.length === 0 ? 'All locations' : `${plan.allowedCountries.length} locations`}
              </li>
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2 text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {feature}
                </li>
              ))}
            </ul>
            {renderAction(plan)}
          </div>
        );
      })}
    </div>
  );
}
