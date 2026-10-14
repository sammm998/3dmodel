import type { Metadata } from 'next';
import { Check, Minus } from 'lucide-react';
import { SiteHeader } from '@/client/site/SiteHeader';
import { SiteFooter } from '@/client/site/SiteFooter';
import { PricingTable } from '@/client/site/PricingTable';
import { getSessionUser } from '@/server/session';
import { billingConfigured } from '@/server/billing';
import { effectivePlan } from '@/server/auth';
import { PLANS } from '@/core/billing/plans';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pricing', description: 'Free, Pro and Studio plans for AI 3D Studio.' };

type Cell = boolean | string;
const ROWS: { label: string; cells: [Cell, Cell, Cell] }[] = [
  { label: 'Projects', cells: [String(PLANS[0].limits.projects), 'Unlimited', 'Unlimited'] },
  { label: 'AI requests per month', cells: PLANS.map((p) => p.limits.aiRequests.toLocaleString('en-US')) as [string, string, string] },
  { label: 'Built-in interpreter edits', cells: ['Unlimited', 'Unlimited', 'Unlimited'] },
  { label: 'Text, voice and drawing-to-3D', cells: [true, true, true] },
  { label: 'Click-to-prompt editing on real elements', cells: [true, true, true] },
  { label: 'Realistic renders, walk-through and drone videos', cells: [true, true, true] },
  { label: 'Version history and restore', cells: [true, true, true] },
  { label: 'Read-only share links', cells: [true, true, true] },
  { label: 'GLB, OBJ and STL export', cells: [true, true, true] },
  { label: 'IFC (BIM) export', cells: [false, true, true] },
  { label: 'DXF (CAD) export', cells: [false, true, true] },
  { label: 'Priority email support', cells: [false, false, true] },
];

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const user = await getSessionUser();
  const sp = await searchParams;
  return (
    <div className="theme-light min-h-screen bg-paper text-char">
      <SiteHeader active="pricing" />
      <section className="mx-auto max-w-7xl px-5 pb-10 pt-20 sm:px-8 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="eyebrow">Pricing</div>
          <h1 className="mt-6 font-display text-[52px] leading-[0.98] tracking-[-0.02em] sm:text-[76px]">
            Simple plans, <span className="italic text-bronze">serious tools.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[16.5px] leading-relaxed text-char-3">Every plan includes the complete studio. Upgrade for unlimited projects, more AI and professional exchange formats. Change or cancel at any time.</p>
          {sp.checkout === 'cancelled' ? <p className="mt-6 text-[13.5px] text-char-3">Checkout was cancelled — nothing was charged.</p> : null}
        </div>
        <div className="mt-14">
          <PricingTable signedIn={!!user} currentPlan={user ? effectivePlan(user) : null} billingEnabled={billingConfigured()} />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8">
        <h2 className="font-display text-[40px] leading-none tracking-[-0.01em]">Compare plans</h2>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-char/15 text-left">
                <th className="py-4 pr-4 font-normal text-char-4" />
                {PLANS.map((p) => (
                  <th key={p.id} className="w-[18%] py-4 text-center font-display text-[22px] font-normal">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label} className="border-b border-char/[0.08]">
                  <td className="py-4 pr-4 text-char-2">{r.label}</td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="py-4 text-center">
                      {c === true ? <Check className="mx-auto h-4 w-4 text-bronze" strokeWidth={1.8} /> : c === false ? <Minus className="mx-auto h-4 w-4 text-char-4/60" /> : <span className="text-char">{c}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-14 grid gap-10 md:grid-cols-2">
          {[
            ['What counts as an AI request?', 'Each instruction sent to the language model, each automatic drawing recognition and each server speech transcription. Clear, simple edits are handled by the built-in interpreter in your browser and never count.'],
            ['What happens when I reach a limit?', 'Nothing is lost. You can keep editing with the built-in interpreter, and new AI requests resume at the start of the next month or right away when you upgrade.'],
            ['Can I switch or cancel?', 'Yes — from the billing portal in your account, at any time. After cancelling you keep the plan until the end of the paid period.'],
            ['How do I pay?', 'Securely by card through Stripe. We never see or store your card details. Invoices are available in the billing portal.'],
          ].map(([q, a]) => (
            <div key={q}>
              <div className="text-[16px] font-medium">{q}</div>
              <p className="mt-2 text-[14.5px] leading-relaxed text-char-3">{a}</p>
            </div>
          ))}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
