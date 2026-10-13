'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

const safeNext = (n: string | undefined) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/app');

export function AuthForm({ mode, next, plan, interval }: { mode: 'login' | 'signup'; next?: string; plan?: string; interval?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await api.signup({ name: String(fd.get('name') ?? ''), email: String(fd.get('email') ?? ''), password: String(fd.get('password') ?? '') });
      else await api.login({ email: String(fd.get('email') ?? ''), password: String(fd.get('password') ?? '') });
      if (plan === 'pro' || plan === 'studio') {
        try {
          const { url } = await api.checkout(plan, interval === 'monthly' ? 'monthly' : 'yearly');
          window.location.href = url;
          return;
        } catch {
          // Payments unavailable: continue into the studio on the Free plan.
        }
      }
      router.replace(safeNext(next));
      router.refresh();
    } catch (err) {
      const m = (err as Error).message;
      setError(/Validation failed/.test(m) ? (mode === 'signup' ? 'Check your name, email and a password of at least 8 characters.' : 'Enter your email and password.') : m);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid={`${mode}-form`}>
      {mode === 'signup' ? (
        <label className="block">
          <span className="mb-1.5 block text-[13px] text-char-2">Name</span>
          <input name="name" required autoComplete="name" className="input-light" placeholder="Ada Lovelace" />
        </label>
      ) : null}
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-char-2">Email</span>
        <input name="email" type="email" required autoComplete="email" className="input-light" placeholder="you@studio.com" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-char-2">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={mode === 'signup' ? 8 : undefined}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          className="input-light"
          placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
        />
      </label>
      {error ? (
        <p className="rounded-xl border border-red-800/15 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800" role="alert" data-testid="auth-error">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="btn-dark h-12 w-full text-[15px]" data-testid="auth-submit">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {mode === 'signup' ? (plan === 'pro' || plan === 'studio' ? 'Create account & continue to payment' : 'Create free account') : 'Sign in'}
        {!busy ? <ArrowRight className="h-4 w-4" /> : null}
      </button>
      <p className="pt-2 text-center text-[13.5px] text-char-3">
        {mode === 'signup' ? (
          <>
            Already have an account?{' '}
            <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="text-char underline underline-offset-4">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to AI 3D Studio?{' '}
            <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="text-char underline underline-offset-4">
              Create an account
            </Link>
          </>
        )}
      </p>
      {mode === 'signup' ? (
        <p className="text-center text-[12px] leading-relaxed text-char-4">
          By creating an account you agree to the <Link href="/terms" className="underline underline-offset-2">Terms</Link> and <Link href="/privacy" className="underline underline-offset-2">Privacy policy</Link>.
        </p>
      ) : null}
    </form>
  );
}
