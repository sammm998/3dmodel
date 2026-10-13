'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CreditCard, Loader2, LogOut, Trash2 } from 'lucide-react';
import type { PublicUser } from '@/server/auth';
import { formatPrice, getPlan } from '@/core/billing/plans';
import { api, type Usage } from '../lib/api';
import { AppHeader } from './AppHeader';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null);

export function AccountView({ user, usage, billing, checkoutSuccess }: { user: PublicUser; usage: Usage; billing: boolean; checkoutSuccess: boolean }) {
  const plan = getPlan(user.plan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portal = async () => {
    setBusy(true);
    setError(null);
    try {
      window.location.href = (await api.billingPortal()).url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const rows: [string, string][] = [
    ['Name', user.name],
    ['Email', user.email],
    ['Member since', date(user.createdAt) ?? ''],
  ];
  return (
    <div className="theme-light min-h-screen bg-paper text-char">
      <AppHeader user={user} />
      <main className="mx-auto max-w-4xl px-5 pb-24 pt-14 sm:px-8">
        <div className="eyebrow">Account</div>
        <h1 className="mt-4 font-display text-[52px] leading-none tracking-[-0.015em]">
          Plan &amp; <span className="italic">billing</span>
        </h1>

        {checkoutSuccess ? (
          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-emerald-800/15 bg-emerald-50 px-5 py-4 text-[14px] text-emerald-900" data-testid="checkout-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Thank you — your payment went through. Your plan updates as soon as the payment provider confirms the subscription (usually within seconds). Refresh this page if it still shows the old plan.
            </div>
          </div>
        ) : null}

        <section className="card-light mt-10 p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="text-[13px] text-char-3">Current plan</div>
              <div className="mt-1 font-display text-[44px] leading-none" data-testid="account-plan">
                {plan.name}
              </div>
              <div className="mt-2 text-[13.5px] text-char-3">
                {plan.monthly === 0 ? 'Free forever' : `${formatPrice(plan.monthly)} / month, or ${formatPrice(plan.yearly)} / month billed yearly`}
                {user.subscribedPlan !== user.plan ? ' · included with your administrator access' : ''}
              </div>
              {user.planStatus && user.planStatus !== 'active' ? <div className="mt-2 text-[13px] text-amber-800">Subscription status: {user.planStatus.replace('_', ' ')}</div> : null}
              {user.currentPeriodEnd && user.subscribedPlan !== 'free' ? <div className="mt-1 text-[13px] text-char-3">Renews or ends on {date(user.currentPeriodEnd)}</div> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {user.hasBilling ? (
                <button onClick={portal} disabled={busy} className="btn-line h-10 px-5 text-[13.5px]">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Manage billing &amp; invoices
                </button>
              ) : null}
              {plan.id !== 'studio' ? (
                <Link href="/pricing" className="btn-dark h-10 px-5 text-[13.5px]">
                  {plan.id === 'free' ? 'Upgrade' : 'Change plan'}
                </Link>
              ) : null}
            </div>
          </div>
          {!billing && plan.id === 'free' ? <p className="mt-5 text-[12.5px] text-char-4">Online payments are being set up; upgrades will be available shortly.</p> : null}
          {error ? <p className="mt-5 text-[13px] text-red-800">{error}</p> : null}

          <div className="mt-8 grid gap-6 border-t border-char/[0.08] pt-6 sm:grid-cols-2">
            <UsageBlock label="AI requests this month" value={usage.aiRequests} max={usage.aiLimit} note={`Resets on the 1st (period ${usage.period}).`} />
            <UsageBlock label="Projects" value={usage.projects} max={usage.projectLimit} />
          </div>
        </section>

        <section className="card-light mt-6 p-8">
          <div className="text-[13px] text-char-3">Profile</div>
          <dl className="mt-4 divide-y divide-char/[0.08]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-6 py-3 text-[14px]">
                <dt className="text-char-3">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
          <button
            onClick={async () => {
              await api.logout().catch(() => {});
              window.location.href = '/';
            }}
            className="mt-6 inline-flex items-center gap-2 text-[13.5px] text-char-3 hover:text-char"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </section>

        <DeleteAccount />
      </main>
    </div>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="mt-6 rounded-2xl border border-red-900/15 p-8">
      <div className="text-[15px] font-medium">Delete account</div>
      <p className="mt-1 text-[13.5px] leading-relaxed text-char-3">Permanently deletes your account, all projects, versions and uploaded files, and ends any subscription immediately. This cannot be undone.</p>
      {open ? (
        <form
          className="mt-5 flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.deleteAccount(String(new FormData(e.currentTarget).get('password') ?? ''));
              window.location.href = '/';
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          <input name="password" type="password" required autoComplete="current-password" placeholder="Confirm with your password" className="input-light h-10 max-w-xs" />
          <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-full bg-red-800 px-5 text-[13.5px] font-medium text-white transition hover:bg-red-900 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete everything
          </button>
          <button type="button" onClick={() => setOpen(false)} className="h-10 px-3 text-[13.5px] text-char-3 hover:text-char">
            Cancel
          </button>
        </form>
      ) : (
        <button onClick={() => setOpen(true)} className="mt-5 text-[13.5px] text-red-800 underline-offset-4 hover:underline">
          Delete my account…
        </button>
      )}
      {error ? <p className="mt-3 text-[13px] text-red-800">{error}</p> : null}
    </section>
  );
}

function UsageBlock({ label, value, max, note }: { label: string; value: number; max: number | null; note?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 4;
  return (
    <div>
      <div className="flex justify-between text-[13.5px]">
        <span>{label}</span>
        <span className="tabular-nums text-char-3">
          {value.toLocaleString('en-US')} / {max === null ? 'unlimited' : max.toLocaleString('en-US')}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-char/[0.07]">
        <div className={pct > 90 ? 'h-full rounded-full bg-red-700' : 'h-full rounded-full bg-bronze'} style={{ width: `${pct}%` }} />
      </div>
      {note ? <div className="mt-2 text-[12px] text-char-4">{note}</div> : null}
    </div>
  );
}
