'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { PLANS, formatPrice, type BillingInterval, type PlanId } from '@/core/billing/plans';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

export function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-char/15 bg-white/60 p-1 text-[13px]" role="radiogroup" aria-label="Billing interval">
      {(['monthly', 'yearly'] as const).map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn('rounded-full px-4 py-1.5 transition', value === v ? 'bg-char text-paper' : 'text-char-3 hover:text-char')}
        >
          {v === 'monthly' ? 'Monthly' : 'Yearly'}
          {v === 'yearly' ? <span className={cn('ml-1.5 text-[11px]', value === v ? 'text-accent' : 'text-bronze')}>save ~17%</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Plan cards. Paid plans start Stripe Checkout for signed-in users; signed-out
 * visitors create an account first and continue to checkout afterwards.
 */
export function PricingTable({ signedIn, currentPlan, billingEnabled }: { signedIn: boolean; currentPlan?: PlanId | null; billingEnabled: boolean }) {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>('yearly');
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (plan: PlanId) => {
    setError(null);
    if (plan === 'free') {
      router.push(signedIn ? '/app' : '/signup');
      return;
    }
    if (!signedIn) {
      router.push(`/signup?plan=${plan}&interval=${interval}`);
      return;
    }
    setBusy(plan);
    try {
      const { url } = await api.checkout(plan, interval);
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex justify-center">
        <IntervalToggle value={interval} onChange={setInterval} />
      </div>
      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {PLANS.map((p) => {
          const price = interval === 'yearly' ? p.yearly : p.monthly;
          const current = currentPlan === p.id;
          return (
            <div
              key={p.id}
              className={cn(
                'relative flex flex-col rounded-[28px] border p-8 transition',
                p.highlight ? 'border-char bg-char text-paper shadow-lift' : 'border-char/[0.1] bg-white/55 text-char shadow-card',
              )}
              data-testid={`plan-${p.id}`}
            >
              {p.highlight ? <div className="absolute -top-3 left-8 rounded-full bg-accent px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-char">Most chosen</div> : null}
              <div className="font-display text-[34px] leading-none">{p.name}</div>
              <p className={cn('mt-3 min-h-[40px] text-[13.5px] leading-relaxed', p.highlight ? 'text-paper/70' : 'text-char-3')}>{p.tagline}</p>
              <div className="mt-6 flex items-end gap-2">
                <span className="font-display text-[56px] leading-[0.9] tracking-tight">{formatPrice(price)}</span>
                <span className={cn('pb-1.5 text-[13px]', p.highlight ? 'text-paper/60' : 'text-char-4')}>{p.monthly === 0 ? 'forever' : '/ month'}</span>
              </div>
              <div className={cn('mt-1 h-5 text-[12px]', p.highlight ? 'text-paper/50' : 'text-char-4')}>
                {p.monthly > 0 ? (interval === 'yearly' ? `${formatPrice(p.yearly * 12)} billed yearly` : 'billed monthly') : ''}
              </div>
              <button
                onClick={() => choose(p.id)}
                disabled={!!busy || current}
                className={cn(
                  'mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-full text-[14px] font-medium transition disabled:opacity-60',
                  p.highlight ? 'bg-paper text-char hover:bg-white' : 'border border-char/20 hover:border-char/50 hover:bg-char/[0.03]',
                )}
                data-testid={`choose-${p.id}`}
              >
                {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {current ? 'Your current plan' : p.id === 'free' ? (signedIn ? 'Open studio' : 'Start free') : `Choose ${p.name}`}
              </button>
              <ul className="mt-8 space-y-3 text-[13.5px]">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-3">
                    <Check className={cn('mt-0.5 h-4 w-4 shrink-0', p.highlight ? 'text-accent' : 'text-bronze')} strokeWidth={1.75} />
                    <span className={p.highlight ? 'text-paper/85' : 'text-char-2'}>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {error ? <p className="mt-6 text-center text-[13px] text-red-700">{error}</p> : null}
      {!billingEnabled ? (
        <p className="mt-6 text-center text-[12.5px] text-char-4">
          Online payments are being set up. <Link href="/signup" className="underline underline-offset-2">Start free</Link> today — your projects carry over when you upgrade.
        </p>
      ) : null}
    </div>
  );
}
