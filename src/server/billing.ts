/**
 * Stripe subscriptions over the REST API (no SDK): Checkout for upgrades, the
 * Customer Portal for changes/cancellation, and a signature-verified webhook
 * that keeps each user's plan in sync with their subscription.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and one Price id per paid
 * plan and interval: STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PRO_YEARLY,
 * STRIPE_PRICE_STUDIO_MONTHLY, STRIPE_PRICE_STUDIO_YEARLY.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingInterval, PlanId } from '@/core/billing/plans';
import { getRepository } from './storage';
import type { UserRecord } from './storage/types';
import { HttpError } from './http';

const API = 'https://api.stripe.com/v1';
const PAID: Exclude<PlanId, 'free'>[] = ['pro', 'studio'];
const INTERVALS: BillingInterval[] = ['monthly', 'yearly'];

export function priceId(plan: PlanId, interval: BillingInterval): string | undefined {
  return process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`] || undefined;
}

export function planForPrice(id: string): PlanId | null {
  for (const p of PAID) for (const i of INTERVALS) if (priceId(p, i) === id) return p;
  return null;
}

export function billingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && PAID.some((p) => INTERVALS.some((i) => priceId(p, i)));
}

function encode(params: Record<string, string | number | boolean | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.append(k, String(v));
  return u.toString();
}

type StripeObject = Record<string, any>;

async function stripe(path: string, params?: Record<string, string | number | boolean | undefined>, method: 'GET' | 'POST' | 'DELETE' = 'POST'): Promise<StripeObject> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, 'Payments are not configured yet.');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' && params ? encode(params) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as StripeObject;
  if (!res.ok) {
    console.error('[billing] Stripe error', res.status, data?.error?.message);
    throw new HttpError(502, `Payment provider error: ${data?.error?.message ?? res.status}`);
  }
  return data;
}

async function ensureCustomer(user: UserRecord): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const c = await stripe('/customers', { email: user.email, name: user.name, 'metadata[userId]': user.id });
  await getRepository().updateUser(user.id, { stripeCustomerId: c.id });
  return c.id as string;
}

const hasActiveSubscription = (u: UserRecord) => !!u.stripeSubscriptionId && ['active', 'trialing', 'past_due'].includes(u.planStatus ?? '');

export async function createCheckout(user: UserRecord, plan: PlanId, interval: BillingInterval, origin: string): Promise<string> {
  if (!billingConfigured()) throw new HttpError(503, 'Payments are not configured yet.');
  // Existing subscribers change plan in the Customer Portal (proration handled by Stripe).
  if (hasActiveSubscription(user)) return createPortal(user, origin);
  const price = priceId(plan, interval);
  if (!price) throw new HttpError(400, `The ${plan} plan is not available with ${interval} billing.`);
  const customer = await ensureCustomer(user);
  const session = await stripe('/checkout/sessions', {
    mode: 'subscription',
    customer,
    client_reference_id: user.id,
    'line_items[0][price]': price,
    'line_items[0][quantity]': 1,
    'subscription_data[metadata][userId]': user.id,
    allow_promotion_codes: true,
    success_url: `${origin}/account?checkout=success`,
    cancel_url: `${origin}/pricing?checkout=cancelled`,
  });
  return session.url as string;
}

export async function createPortal(user: UserRecord, origin: string): Promise<string> {
  if (!user.stripeCustomerId) throw new HttpError(400, 'No billing account yet. Choose a plan first.');
  const s = await stripe('/billing_portal/sessions', { customer: user.stripeCustomerId, return_url: `${origin}/account` });
  return s.url as string;
}

/** Ends a subscription immediately (used when an account is deleted). */
export async function cancelSubscriptionNow(subscriptionId: string) {
  if (!process.env.STRIPE_SECRET_KEY) return;
  await stripe(`/subscriptions/${subscriptionId}`, undefined, 'DELETE').catch((e) => {
    console.error('[billing] could not cancel subscription', subscriptionId, e);
    throw new HttpError(502, 'Your subscription could not be cancelled automatically. Please cancel it in the billing portal first, then delete the account.');
  });
}

/** Verifies the Stripe-Signature header (v1 HMAC-SHA256) and returns the parsed event. */
export function verifyWebhook(payload: string, header: string | null, secret: string, toleranceSec = 300, now = Date.now()): StripeObject {
  if (!header) throw new HttpError(400, 'Missing Stripe-Signature header');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) throw new HttpError(400, 'Malformed Stripe-Signature header');
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) throw new HttpError(400, 'Webhook timestamp outside tolerance');
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest();
  const ok = sigs.some((s) => {
    const b = Buffer.from(s, 'hex');
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
  if (!ok) throw new HttpError(400, 'Invalid webhook signature');
  return JSON.parse(payload) as StripeObject;
}

async function applySubscription(sub: StripeObject) {
  const repo = getRepository();
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  let user = customerId ? await repo.getUserByStripeCustomer(customerId) : null;
  if (!user && sub.metadata?.userId) user = await repo.getUserById(sub.metadata.userId);
  if (!user) {
    console.warn('[billing] subscription for unknown customer', customerId);
    return;
  }
  const item = sub.items?.data?.[0];
  const plan = item?.price?.id ? planForPrice(item.price.id) : null;
  const status: string = sub.status;
  const active = ['active', 'trialing', 'past_due'].includes(status);
  const end = sub.current_period_end ?? item?.current_period_end;
  await repo.updateUser(user.id, {
    stripeCustomerId: customerId ?? user.stripeCustomerId,
    stripeSubscriptionId: status === 'canceled' ? null : sub.id,
    planStatus: status,
    plan: active && plan ? plan : 'free',
    currentPeriodEnd: end ? new Date(end * 1000).toISOString() : null,
  });
}

export async function handleWebhookEvent(event: StripeObject) {
  const obj = event.data?.object ?? {};
  switch (event.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription' || !obj.subscription) return;
      const repo = getRepository();
      if (obj.client_reference_id && obj.customer) {
        const u = await repo.getUserById(obj.client_reference_id);
        if (u && !u.stripeCustomerId) await repo.updateUser(u.id, { stripeCustomerId: obj.customer });
      }
      await applySubscription(await stripe(`/subscriptions/${obj.subscription}`, undefined, 'GET'));
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applySubscription(obj);
      return;
    default:
      return;
  }
}
