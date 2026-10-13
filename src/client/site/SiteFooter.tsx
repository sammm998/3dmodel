import Link from 'next/link';
import { Brand } from './Brand';

export function SiteFooter() {
  const company = process.env.COMPANY_NAME || 'AI 3D Studio';
  const email = process.env.CONTACT_EMAIL;
  return (
    <footer className="border-t border-char/[0.08] bg-paper-2/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Brand />
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-char-3">Parametric architecture, directed by language. Built for architects, designers and the people they build for.</p>
        </div>
        <div>
          <div className="eyebrow mb-4">Product</div>
          <ul className="space-y-2.5 text-[13.5px] text-char-2">
            <li><Link href="/#product" className="hover:text-char">Features</Link></li>
            <li><Link href="/#how" className="hover:text-char">How it works</Link></li>
            <li><Link href="/pricing" className="hover:text-char">Pricing</Link></li>
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-4">Account</div>
          <ul className="space-y-2.5 text-[13.5px] text-char-2">
            <li><Link href="/signup" className="hover:text-char">Create account</Link></li>
            <li><Link href="/login" className="hover:text-char">Sign in</Link></li>
            <li><Link href="/app" className="hover:text-char">Open studio</Link></li>
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-4">Company</div>
          <ul className="space-y-2.5 text-[13.5px] text-char-2">
            <li><Link href="/terms" className="hover:text-char">Terms of service</Link></li>
            <li><Link href="/privacy" className="hover:text-char">Privacy policy</Link></li>
            {email ? <li><a href={`mailto:${email}`} className="hover:text-char">{email}</a></li> : null}
          </ul>
        </div>
      </div>
      <div className="border-t border-char/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 px-5 py-6 text-[12px] text-char-4 sm:flex-row sm:px-8">
          <span>© {new Date().getFullYear()} {company}. All rights reserved.</span>
          <span>Designed for architects, made in the browser.</span>
        </div>
      </div>
    </footer>
  );
}
