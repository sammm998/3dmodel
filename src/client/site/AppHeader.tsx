'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Settings, Sparkles } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/primitives';
import { api } from '../lib/api';
import type { PublicUser } from '@/server/auth';
import { getPlan } from '@/core/billing/plans';
import { Brand } from './Brand';

export function AppHeader({ user }: { user: PublicUser | null }) {
  const router = useRouter();
  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  return (
    <header className="sticky top-0 z-40 border-b border-char/[0.07] bg-paper/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-8">
          <Brand href="/app" />
          <nav className="hidden items-center gap-6 text-[13.5px] text-char-3 sm:flex">
            <Link href="/app" className="text-char">
              Projects
            </Link>
            <Link href="/pricing" className="transition hover:text-char">
              Plans
            </Link>
          </nav>
        </div>
        {user ? (
          <div className="flex items-center gap-3">
            {user.plan === 'free' ? (
              <Link href="/pricing" className="hidden items-center gap-1.5 rounded-full border border-bronze/30 bg-bronze/[0.06] px-3 py-1.5 text-[12.5px] text-bronze transition hover:bg-bronze/10 sm:inline-flex">
                <Sparkles className="h-3.5 w-3.5" /> Upgrade
              </Link>
            ) : (
              <span className="hidden rounded-full border border-char/15 px-3 py-1.5 text-[12px] text-char-3 sm:inline">{getPlan(user.plan).name} plan</span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="grid h-9 w-9 place-items-center rounded-full bg-char text-[12px] font-medium text-paper transition hover:bg-char-2" aria-label="Account menu" data-testid="account-menu">
                  {initials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="px-2 py-1.5 text-[11.5px] text-ink-300">{user.email}</div>
                <DropdownMenuItem onSelect={() => router.push('/account')}>
                  <Settings className="h-3.5 w-3.5" /> Account &amp; billing
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    await api.logout().catch(() => {});
                    window.location.href = '/';
                  }}
                  data-testid="sign-out"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    </header>
  );
}
