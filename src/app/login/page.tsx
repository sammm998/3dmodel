import type { Metadata } from 'next';
import { AuthLayout } from '@/client/site/AuthLayout';
import { AuthForm } from '@/client/site/AuthForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthLayout title={<>Welcome <span className="italic">back.</span></>} subtitle="Sign in to continue to your projects.">
      <AuthForm mode="login" next={next} />
    </AuthLayout>
  );
}
