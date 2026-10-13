import Link from 'next/link';
import { cn } from '../lib/utils';

/** Mark: an axonometric line cube, drawn like a construction sketch. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-7 w-7', className)} fill="none" aria-hidden>
      <path d="M16 3.5 27.5 10v12L16 28.5 4.5 22V10Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M4.5 10 16 16.5 27.5 10M16 16.5v12" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M10.2 6.8 21.8 13.2v6.3" stroke="currentColor" strokeOpacity=".45" strokeWidth="1" />
    </svg>
  );
}

export function Brand({ href = '/', tone = 'dark', className }: { href?: string; tone?: 'dark' | 'light'; className?: string }) {
  return (
    <Link href={href} className={cn('group inline-flex items-center gap-2.5', tone === 'dark' ? 'text-char' : 'text-ink-100', className)} aria-label="AI 3D Studio home">
      <BrandMark className="transition-transform duration-500 group-hover:rotate-[30deg]" />
      <span className="font-display text-[22px] leading-none tracking-[-0.01em]">
        AI 3D <span className="italic">Studio</span>
      </span>
    </Link>
  );
}
