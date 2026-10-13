import { handle, json } from '@/server/http';
import { handleWebhookEvent, verifyWebhook } from '@/server/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stripe webhook: subscribe to checkout.session.completed and customer.subscription.*. */
export const POST = handle(async (req: Request) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'Webhook secret not configured' }, 503);
  const payload = await req.text();
  const event = verifyWebhook(payload, req.headers.get('stripe-signature'), secret);
  await handleWebhookEvent(event);
  return json({ received: true });
});
