import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/server/session';
import { publicUser, usageOf } from '@/server/auth';
import { billingConfigured } from '@/server/billing';
import { AccountView } from '@/client/site/AccountView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/account');
  const { checkout } = await searchParams;
  return <AccountView user={publicUser(user)} usage={await usageOf(user)} billing={billingConfigured()} checkoutSuccess={checkout === 'success'} />;
}
