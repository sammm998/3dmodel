import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="theme-light min-h-screen bg-paper text-char">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-20 sm:px-8">
        <div className="eyebrow">Legal</div>
        <h1 className="mt-5 font-display text-[52px] leading-none tracking-[-0.015em]">{title}</h1>
        <p className="mt-4 text-[13px] text-char-4">Last updated {updated}</p>
        <div className="mt-12 space-y-5 text-[15px] leading-[1.75] text-char-2 [&_h2]:mt-12 [&_h2]:font-display [&_h2]:text-[28px] [&_h2]:leading-tight [&_h2]:text-char [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function legalEntity() {
  return {
    company: process.env.COMPANY_NAME || 'AI 3D Studio',
    email: process.env.CONTACT_EMAIL || null,
  };
}
