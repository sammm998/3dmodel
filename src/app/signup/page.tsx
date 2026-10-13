import type { Metadata } from 'next';
import { AuthLayout } from '@/client/site/AuthLayout';
import { AuthForm } from '@/client/site/AuthForm';
import { getPlan } from '@/core/billing/plans';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; plan?: string; interval?: string }> }) {
  const { next, plan, interval } = await searchParams;
  const paid = plan === 'pro' || plan === 'studio';
  return (
    <AuthLayout
      title={<>Start <span className="italic">designing.</span></>}
      subtitle={paid ? `Create your account, then continue to secure payment for ${getPlan(plan).name}.` : 'Free forever for three projects. No card required.'}
    >
      <AuthForm mode="signup" next={next} plan={plan} interval={interval} />
    </AuthLayout>
  );
}
