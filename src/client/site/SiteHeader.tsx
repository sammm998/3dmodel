import Link from 'next/link';
import { getSessionUser } from '@/server/session';
import { Brand } from './Brand';

export async function SiteHeader({ active }: { active?: 'pricing' | 'product' }) {
  const user = await getSessionUser();
  return (
    <header className="sticky top-0 z-40 border-b border-char/[0.07] bg-paper/80 backdrop-blur-xl supports-[backdrop-filter]:bg-paper/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Brand />
        <nav className="hidden items-center gap-8 text-[13.5px] text-char-3 md:flex">
          <Link href="/#product" className={active === 'product' ? 'text-char' : 'transition hover:text-char'}>
            Product
          </Link>
          <Link href="/#how" className="transition hover:text-char">
            How it works
          </Link>
          <Link href="/pricing" className={active === 'pricing' ? 'text-char' : 'transition hover:text-char'}>
            Pricing
          </Link>
          <Link href="/#faq" className="transition hover:text-char">
            FAQ
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <Link href="/app" className="btn-dark h-9 px-4 text-[13px]" data-testid="open-studio">
              Open studio
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden h-9 items-center px-3 text-[13.5px] text-char-2 transition hover:text-char sm:inline-flex">
                Sign in
              </Link>
              <Link href="/signup" className="btn-dark h-9 px-4 text-[13px]">
                Start free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
