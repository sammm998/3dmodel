'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Box, Building2, ChefHat, FileUp, Home, Loader2, MoreHorizontal, Plus, Sofa, Sparkles, Trash2 } from 'lucide-react';
import { api } from '@/client/lib/api';
import { STARTERS } from '@/core/generator/starters';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, TooltipProvider } from '@/client/ui/primitives';
import { cn, timeAgo } from '@/client/lib/utils';
import type { ProjectSummary } from '@/server/storage/types';
import type { PublicUser } from '@/server/auth';
import { api as apiClient, type Usage } from '@/client/lib/api';
import { AppHeader } from '@/client/site/AppHeader';
import { getPlan } from '@/core/billing/plans';
import Link from 'next/link';

const STARTER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'scandinavian-villa': Home,
  'luxury-apartment': Sofa,
  'contemporary-office': Building2,
  'minimalist-kitchen': ChefHat,
};

/** Isometric line illustration used as a placeholder thumbnail. */
function IsoArt({ accent, variant }: { accent: string; variant: number }) {
  const blocks = [
    [
      [40, 60, 70, 34, 40],
      [110, 74, 34, 26, 18],
    ],
    [[50, 52, 90, 50, 14]],
    [[70, 72, 46, 30, 62]],
    [
      [45, 70, 80, 40, 14],
      [70, 60, 20, 12, 8],
    ],
  ][variant % 4];
  return (
    <svg viewBox="0 0 200 130" className="h-full w-full">
      <defs>
        <linearGradient id={`g${variant}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity="0.35" />
          <stop offset="1" stopColor={accent} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path d="M0 95 L100 45 L200 95 L100 145 Z" fill="#18171308" />
      {blocks.map(([x, y, w, d, h], i) => {
        const iso = (px: number, py: number, pz: number) => `${100 + (px - py) * 0.85},${y + (px + py) * 0.42 - pz}`;
        const x0 = x - 60;
        const y0 = 0;
        const top = [iso(x0, y0, h), iso(x0 + w, y0, h), iso(x0 + w, y0 + d, h), iso(x0, y0 + d, h)].join(' ');
        const left = [iso(x0, y0 + d, 0), iso(x0 + w, y0 + d, 0), iso(x0 + w, y0 + d, h), iso(x0, y0 + d, h)].join(' ');
        const right = [iso(x0 + w, y0, 0), iso(x0 + w, y0 + d, 0), iso(x0 + w, y0 + d, h), iso(x0 + w, y0, h)].join(' ');
        return (
          <g key={i} stroke={accent} strokeOpacity="0.7" strokeWidth="0.8">
            <polygon points={left} fill="#ffffff80" />
            <polygon points={right} fill={`url(#g${variant})`} />
            <polygon points={top} fill="#ffffffb0" />
          </g>
        );
      })}
    </svg>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [me, setMe] = useState<{ user: PublicUser | null; usage?: Usage } | null>(null);
  const [health, setHealth] = useState<{ storage: string; storageOk?: boolean; storageError?: string | null; databaseFallbackReason?: string | null; storagePersistent?: boolean; ai: { configured: boolean; provider: string | null; model: string | null } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    apiClient.me().then(setMe).catch(() => {});
    return api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e) => {
        setError(e.message);
        setProjects([]);
      });
  };
  useEffect(() => {
    void refresh();
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  const create = async (opts: { name: string; starterId?: string; prompt?: string; importDrawing?: boolean }) => {
    setBusy(opts.importDrawing ? 'import' : opts.starterId ?? 'new');
    setError(null);
    try {
      const { project } = await api.createProject({ name: opts.name, starterId: opts.starterId });
      router.push(`/project/${project.id}${opts.importDrawing ? '?import=1' : opts.prompt ? `?prompt=${encodeURIComponent(opts.prompt)}` : ''}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const nameFromPrompt = (p: string) => {
    const m = p.match(/\b(villa|house|room|office|apartment|kitchen|cabin|living room|bedroom|hus|rum|kontor|lägenhet|kök|stuga)\b/i);
    return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} concept` : 'New project';
  };

  const usage = me?.usage;
  const plan = me?.user ? getPlan(me.user.plan) : null;
  const atProjectLimit = !!usage && usage.projectLimit !== null && usage.projects >= usage.projectLimit;
  const firstName = me?.user?.name?.split(' ')[0];

  return (
    <TooltipProvider>
      <div className="theme-light min-h-screen bg-paper text-char">
        <AppHeader user={me?.user ?? null} />

        <main className="mx-auto max-w-7xl px-5 pb-24 sm:px-8">
          <section className="grid gap-10 pt-14 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
            <div>
              <div className="eyebrow">{firstName ? `Welcome, ${firstName}` : 'Your studio'}</div>
              <h1 className="mt-4 font-display text-[44px] leading-[1] tracking-[-0.015em] sm:text-[60px]">
                What are we <span className="italic text-bronze">building</span> today?
              </h1>
            </div>
            {usage && plan ? (
              <div className="card-light p-5" data-testid="usage-card">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-char-3">{plan.name} plan · this month</span>
                  {plan.id === 'free' ? (
                    <Link href="/pricing" className="text-bronze hover:underline">
                      Upgrade
                    </Link>
                  ) : (
                    <Link href="/account" className="text-char-3 hover:text-char">
                      Manage
                    </Link>
                  )}
                </div>
                <Meter label="AI requests" value={usage.aiRequests} max={usage.aiLimit} />
                <Meter label="Projects" value={usage.projects} max={usage.projectLimit} />
              </div>
            ) : null}
          </section>

          <section className="mt-10">
            <form
              className="flex items-center gap-2 rounded-[22px] border border-char/[0.12] bg-white/80 p-2 shadow-card transition focus-within:border-bronze/50 focus-within:shadow-lift"
              onSubmit={(e) => {
                e.preventDefault();
                if (prompt.trim()) void create({ name: nameFromPrompt(prompt), prompt: prompt.trim() });
              }}
            >
              <Sparkles className="ml-3 h-4 w-4 shrink-0 text-bronze" />
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A two-storey Scandinavian villa with floor-to-ceiling windows and a pool…"
                className="h-12 flex-1 bg-transparent text-[15px] text-char outline-none placeholder:text-char-4"
                data-testid="home-prompt"
              />
              <button type="submit" disabled={!prompt.trim() || !!busy} className="btn-dark h-11 px-5">
                {busy === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Create
              </button>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <button onClick={() => create({ name: 'Untitled project' })} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-char-2 transition hover:bg-char/[0.05] disabled:opacity-50" data-testid="new-blank">
                <Plus className="h-3.5 w-3.5" /> Blank project
              </button>
              <button onClick={() => create({ name: 'Imported drawing', importDrawing: true })} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-char-2 transition hover:bg-char/[0.05] disabled:opacity-50">
                <FileUp className="h-3.5 w-3.5" /> From a floor plan
              </button>
              {busy ? (
                <span className="ml-2 inline-flex items-center gap-2 text-char-3" data-testid="home-busy">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-bronze" /> Creating project…
                </span>
              ) : null}
            </div>
            {error ? (
              <div className="mt-3 rounded-xl border border-red-800/15 bg-red-50 px-4 py-3 text-[13px] text-red-800" data-testid="home-error">
                {error}
                {atProjectLimit ? (
                  <>
                    {' '}
                    <Link href="/pricing" className="font-medium underline underline-offset-2">
                      See plans
                    </Link>
                  </>
                ) : null}
              </div>
            ) : null}
            {health && health.storageOk === false ? (
              <div className="mt-3 rounded-xl border border-red-800/15 bg-red-50 px-4 py-3 text-[13px] text-red-800" data-testid="storage-error">
                Projects cannot be saved right now: {health.storageError || 'storage is not writable'}
              </div>
            ) : health && (health.databaseFallbackReason || health.storagePersistent === false) ? (
              <div className="mt-3 rounded-xl border border-amber-800/15 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900" data-testid="storage-warning">
                {health.databaseFallbackReason ? <div>The database is not reachable, so projects are stored on the server&apos;s disk instead. Reason: {health.databaseFallbackReason}</div> : null}
                {health.storagePersistent === false ? <div>Projects saved on the server&apos;s disk are lost when the app is redeployed. Add a volume (mount path <span className="font-mono">/app/data</span>) or a PostgreSQL database to keep them.</div> : null}
              </div>
            ) : null}
          </section>

          <section className="mt-16">
            <div className="mb-5 flex items-end justify-between border-b border-char/[0.1] pb-4">
              <h2 className="font-display text-[30px] leading-none">Your projects</h2>
              {projects?.length ? <span className="text-[12.5px] text-char-4">{projects.length} total</span> : null}
            </div>
            {projects === null ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[232px] animate-pulse rounded-2xl bg-char/[0.05]" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-char/20 p-12 text-center text-[14px] text-char-3">No projects yet — describe something above or start from an example below.</div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="project-list">
                {projects.map((p, i) => (
                  <div key={p.id} className="group relative overflow-hidden rounded-2xl border border-char/[0.09] bg-white/60 shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-lift">
                    <button className="block w-full text-left" onClick={() => router.push(`/project/${p.id}`)}>
                      <div className="aspect-[16/10] overflow-hidden bg-paper-2">
                        {p.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                        ) : (
                          <IsoArt accent="#8f6a3c" variant={i} />
                        )}
                      </div>
                      <div className="px-4 py-3.5">
                        <div className="truncate text-[14.5px] font-medium">{p.name}</div>
                        <div className="mt-0.5 text-[12px] text-char-4">
                          {p.elementCount} objects · edited {timeAgo(p.updatedAt)}
                        </div>
                      </div>
                    </button>
                    <div className={cn('absolute right-2.5 top-2.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100')}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-char shadow-card backdrop-blur hover:bg-white" aria-label="Project actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-danger"
                            onSelect={async () => {
                              if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
                              await api.deleteProject(p.id);
                              void refresh();
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete project
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mt-16">
            <div className="mb-5 flex items-end justify-between border-b border-char/[0.1] pb-4">
              <h2 className="font-display text-[30px] leading-none">Start from an example</h2>
              <span className="hidden text-[12.5px] text-char-4 sm:inline">Fully parametric — every element is editable.</span>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STARTERS.map((s, i) => {
                const Icon = STARTER_ICONS[s.id] ?? Box;
                return (
                  <button
                    key={s.id}
                    onClick={() => create({ name: s.name, starterId: s.id })}
                    disabled={!!busy}
                    className="group overflow-hidden rounded-2xl border border-char/[0.09] bg-white/60 text-left shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-lift disabled:opacity-60"
                    data-testid={`starter-${s.id}`}
                  >
                    <div className="relative aspect-[16/10] bg-gradient-to-br from-paper-2 to-paper-3">
                      <IsoArt accent="#8f6a3c" variant={i} />
                      {busy === s.id ? (
                        <div className="absolute inset-0 grid place-items-center bg-paper/60">
                          <Loader2 className="h-5 w-5 animate-spin text-bronze" />
                        </div>
                      ) : null}
                    </div>
                    <div className="px-4 py-3.5">
                      <div className="flex items-center gap-2 text-[14.5px] font-medium">
                        <Icon className="h-4 w-4 text-bronze" /> {s.name}
                      </div>
                      <div className="mt-1 text-[12.5px] leading-relaxed text-char-3">{s.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </TooltipProvider>
  );
}

function Meter({ label, value, max }: { label: string; value: number; max: number | null }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mt-3.5">
      <div className="flex justify-between text-[12.5px]">
        <span className="text-char-2">{label}</span>
        <span className="tabular-nums text-char-3">
          {value.toLocaleString('en-US')} / {max === null ? '∞' : max.toLocaleString('en-US')}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-char/[0.07]">
        <div className={cn('h-full rounded-full transition-all duration-700', pct > 90 ? 'bg-red-700' : 'bg-bronze')} style={{ width: `${max === null ? 6 : pct}%` }} />
      </div>
    </div>
  );
}
