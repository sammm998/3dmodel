import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Box, FileUp, Footprints, History, Layers, Mic, MousePointerClick, Share2, Type } from 'lucide-react';
import { SiteHeader } from '@/client/site/SiteHeader';
import { SiteFooter } from '@/client/site/SiteFooter';
import { PricingTable } from '@/client/site/PricingTable';
import { getSessionUser } from '@/server/session';
import { billingConfigured } from '@/server/billing';
import { effectivePlan } from '@/server/auth';

export const dynamic = 'force-dynamic';

const FAQ = [
  {
    q: 'Is this an image generator?',
    a: 'No. Every model is made of real parametric elements — walls with thickness, windows hosted in walls, slabs, roofs, stairs and furniture — with persistent ids. When you ask for a change, the AI edits those objects instead of producing a new picture.',
  },
  {
    q: 'Which formats can I export?',
    a: 'GLB, OBJ and STL on every plan; IFC for BIM tools and DXF for CAD on Pro and Studio. Exports come from the same parametric model you see in the studio.',
  },
  {
    q: 'Can I start from an existing drawing?',
    a: 'Yes. Upload a PDF, image or DXF floor plan, calibrate a known dimension, review the detected walls and openings, and the studio builds the model at real scale.',
  },
  {
    q: 'What counts as an AI request?',
    a: 'Each instruction sent to the language model, each automatic drawing recognition and each server speech transcription. Simple, unambiguous edits are handled by the built-in interpreter in your browser and are always unlimited.',
  },
  {
    q: 'Can I cancel at any time?',
    a: 'Yes. Plans renew monthly or yearly and can be changed or cancelled from your account; you keep access until the end of the paid period. Your projects stay available on the Free plan.',
  },
  {
    q: 'Where are my projects stored?',
    a: 'In your account on our servers. Projects are private to you; a share link gives read-only access to a single project until you revoke it.',
  },
];

function Figure({ src, alt, caption, priority, className, width, height }: { src: string; alt: string; caption?: string; priority?: boolean; className?: string; width: number; height: number }) {
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-[22px] border border-char/[0.08] bg-paper-3 shadow-lift">
        <Image src={src} alt={alt} width={width} height={height} priority={priority} sizes="(min-width: 1280px) 1200px, 100vw" className="h-auto w-full" />
      </div>
      {caption ? <figcaption className="mt-3 text-[12.5px] text-char-4">{caption}</figcaption> : null}
    </figure>
  );
}

export default async function Landing() {
  const user = await getSessionUser();
  const signedIn = !!user;
  return (
    <div className="theme-light min-h-screen bg-paper text-char">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(24,23,19,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(24,23,19,0.045)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-20 sm:px-8 sm:pt-28">
          <div className="mx-auto max-w-4xl text-center">
            <div className="eyebrow animate-rise">AI-native parametric modeling</div>
            <h1 className="mt-6 animate-rise font-display text-[52px] leading-[0.98] tracking-[-0.02em] [animation-delay:80ms] sm:text-[84px]">
              Architecture, drafted <span className="italic text-bronze">in conversation.</span>
            </h1>
            <p className="mx-auto mt-7 max-w-2xl animate-rise text-[17px] leading-relaxed text-char-3 [animation-delay:160ms]">
              Describe a building, speak, or import a floor plan. AI 3D Studio builds a real parametric model — walls, openings, slabs, roofs and stairs — that you refine element by element, walk through, and export to BIM.
            </p>
            <div className="mt-10 flex animate-rise flex-col items-center justify-center gap-3 [animation-delay:240ms] sm:flex-row">
              <Link href={signedIn ? '/app' : '/signup'} className="btn-dark h-12 px-7 text-[15px]" data-testid="hero-cta">
                {signedIn ? 'Open the studio' : 'Start free'} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/pricing" className="btn-line h-12 px-7 text-[15px]">
                See pricing
              </Link>
            </div>
            <p className="mt-4 animate-rise text-[12.5px] text-char-4 [animation-delay:300ms]">Free plan · no card required · runs in your browser</p>
          </div>

          <Figure
            className="mx-auto mt-16 max-w-6xl animate-rise [animation-delay:380ms]"
            src="/marketing/hero.jpg"
            width={1800}
            height={1050}
            alt="A two-storey Scandinavian villa with large glazing and a pool, rendered in the studio at golden hour"
            caption="Modern Scandinavian villa from the example library — every wall, window and slab is an editable object, rendered live in the browser."
            priority
          />
        </div>
      </section>

      {/* Formats strip */}
      <section className="border-y border-char/[0.08] bg-paper-2/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-5 py-6 text-[12px] uppercase tracking-[0.2em] text-char-3 sm:px-8">
          <span>Exports</span>
          {['IFC', 'DXF', 'GLB', 'OBJ', 'STL'].map((f) => (
            <span key={f} className="font-display text-[22px] normal-case tracking-normal text-char">
              {f}
            </span>
          ))}
          <span>· English &amp; Swedish · Text, voice &amp; drawings</span>
        </div>
      </section>

      {/* Three ways in */}
      <section id="how" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-28 sm:px-8">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="min-w-0">
            <div className="eyebrow">How it works</div>
            <h2 className="mt-5 font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[56px]">
              Three ways in. <span className="italic">One real model.</span>
            </h2>
            <p className="mt-6 max-w-md text-[15.5px] leading-relaxed text-char-3">
              Whatever you start from, the result is the same: a structured scene of building elements with real dimensions in metres — not a mesh, not a picture.
            </p>
          </div>
          <ol className="divide-y divide-char/[0.1] border-y border-char/[0.1]">
            {[
              { n: '01', icon: Type, t: 'Describe it', d: '“A two-storey villa, 240 m², floor-to-ceiling windows, white plaster and a pool.” Size, storeys, rooms, materials and roof are read from your words.' },
              { n: '02', icon: Mic, t: 'Say it', d: 'Click the microphone and talk in English or Swedish. Your words appear live in the prompt and are carried out when you stop — undo is one click away.' },
              { n: '03', icon: FileUp, t: 'Trace it', d: 'Upload a floor plan as PDF, image or DXF. Calibrate one known dimension, review the detected walls, doors and windows, then generate.' },
            ].map(({ n, icon: Icon, t, d }) => (
              <li key={n} className="grid grid-cols-[64px_1fr] gap-4 py-8">
                <div className="font-display text-[34px] leading-none text-bronze">{n}</div>
                <div>
                  <div className="flex items-center gap-2.5 text-[17px] font-medium">
                    <Icon className="h-4 w-4 text-char-3" strokeWidth={1.6} /> {t}
                  </div>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-char-3">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Click to edit */}
      <section id="product" className="scroll-mt-20 bg-char text-paper">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-28 sm:px-8 lg:grid-cols-[1fr_1.15fr]">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-paper/50">Click to prompt</div>
            <h2 className="mt-5 font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[56px]">
              Point at it. <span className="italic text-accent">Tell it what to become.</span>
            </h2>
            <p className="mt-6 max-w-md text-[15.5px] leading-relaxed text-paper/65">
              Select a window, a wall or a whole façade and say what you want. The studio turns it into precise, validated operations on those exact elements, tells you exactly what changed, and asks first before anything drastic. Undo is one step away.
            </p>
            <div className="mt-10 overflow-hidden rounded-2xl border border-paper/10 bg-paper/[0.04]">
              <div className="flex items-center gap-2 border-b border-paper/10 px-5 py-3 text-[12px] text-paper/50">
                <MousePointerClick className="h-3.5 w-3.5" /> Selected · Entrance hall window 1
              </div>
              <div className="px-5 py-4 text-[15px] text-paper">“Make this window 40 cm wider and use black aluminium frames.”</div>
              <pre className="overflow-x-auto border-t border-paper/10 bg-black/25 px-5 py-4 font-mono text-[12px] leading-relaxed text-paper/70">
{`modify        window_001   width  +0.40 m
set_material  window_001   frame  aluminium_black
✓ validated · 1 element · undo available`}
              </pre>
            </div>
          </div>
          <Figure src="/marketing/editor.jpg" width={1680} height={1000} alt="The studio after the instruction above: the selected window was widened and the assistant reports exactly what changed" />
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-7xl px-5 py-28 sm:px-8">
        <div className="max-w-2xl">
          <div className="eyebrow">The studio</div>
          <h2 className="mt-5 font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[56px]">
            From first sketch <span className="italic">to delivery.</span>
          </h2>
        </div>
        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          <div className="card-light overflow-hidden">
            <Image src="/marketing/interior.jpg" alt="First-person view of the open stair inside the villa" width={1600} height={1000} sizes="(min-width: 1024px) 600px, 100vw" className="h-auto w-full" />
            <div className="p-8">
              <div className="flex items-center gap-2.5 text-[17px] font-medium">
                <Footprints className="h-4 w-4 text-bronze" strokeWidth={1.6} /> Walk inside
              </div>
              <p className="mt-2 text-[14.5px] leading-relaxed text-char-3">Step into the model in first person. Collision with walls and glazing, stairs you can climb, and Q/E to move between storeys.</p>
            </div>
          </div>
          <div className="card-light overflow-hidden">
            <Image src="/marketing/modeling.jpg" alt="Modeling mode with room areas, the scene tree and exact wall dimensions in the inspector" width={1680} height={1000} sizes="(min-width: 1024px) 600px, 100vw" className="h-auto w-full" />
            <div className="p-8">
              <div className="flex items-center gap-2.5 text-[17px] font-medium">
                <Layers className="h-4 w-4 text-bronze" strokeWidth={1.6} /> Precise when you need it
              </div>
              <p className="mt-2 text-[14.5px] leading-relaxed text-char-3">Exact dimensions in the inspector, snapping move/rotate/resize gizmos, a measuring tool, levels and a full scene tree — direct manipulation and language, side by side.</p>
            </div>
          </div>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {[
            { icon: Box, t: 'Hand off to any tool', d: 'IFC for BIM, DXF for CAD, and GLB, OBJ or STL for visualisation and printing.' },
            { icon: History, t: 'Versions and undo', d: 'Every edit is a transaction. Save named versions and restore any of them.' },
            { icon: Share2, t: 'Share a link', d: 'Send clients a read-only 3D view of a project. Revoke it whenever you like.' },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="card-light p-8">
              <Icon className="h-5 w-5 text-bronze" strokeWidth={1.5} />
              <div className="mt-5 text-[17px] font-medium">{t}</div>
              <p className="mt-2 text-[14.5px] leading-relaxed text-char-3">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Wide render */}
      <section className="mx-auto max-w-7xl px-5 sm:px-8">
        <Figure src="/marketing/office.jpg" width={1176} height={998} alt="A five-storey contemporary office with a glazed curtain wall" caption="Contemporary office, five storeys — façades, slabs, stairs and every desk are editable elements." className="mx-auto max-w-4xl" />
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="eyebrow">Pricing</div>
          <h2 className="mt-5 font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[56px]">
            Start free. <span className="italic">Grow into it.</span>
          </h2>
          <p className="mt-5 text-[15.5px] leading-relaxed text-char-3">Every plan includes the full studio. Paid plans add unlimited projects, more AI requests and professional exports.</p>
        </div>
        <div className="mt-12">
          <PricingTable signedIn={signedIn} currentPlan={user ? effectivePlan(user) : null} billingEnabled={billingConfigured()} />
        </div>
        <p className="mt-8 text-center text-[13.5px]">
          <Link href="/pricing" className="inline-flex items-center gap-1 text-char-2 underline-offset-4 hover:underline">
            Compare plans in detail <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 border-t border-char/[0.08]">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-28 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="eyebrow">Questions</div>
            <h2 className="mt-5 font-display text-[44px] leading-[1.02] tracking-[-0.015em]">Good to know.</h2>
          </div>
          <div className="divide-y divide-char/[0.1] border-y border-char/[0.1]">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-6 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16.5px] font-medium">
                  {f.q}
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-char/15 text-char-3 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-char-3">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-5 pb-24 sm:px-8">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[32px] bg-char px-8 py-20 text-center text-paper sm:px-16">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(246,243,236,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(246,243,236,0.05)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_60%_80%_at_50%_100%,black,transparent)]" />
          <h2 className="relative font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[64px]">
            Your next scheme, <span className="italic text-accent">one sentence away.</span>
          </h2>
          <div className="relative mt-10 flex justify-center">
            <Link href={signedIn ? '/app' : '/signup'} className="inline-flex h-12 items-center gap-2 rounded-full bg-paper px-7 text-[15px] font-medium text-char transition hover:bg-white">
              {signedIn ? 'Open the studio' : 'Create your free account'} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
