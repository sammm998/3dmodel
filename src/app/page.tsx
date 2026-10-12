'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Box, Building2, ChefHat, Cpu, Database, FileUp, Home, Loader2, MoreHorizontal, Plus, Sofa, Sparkles, Trash2 } from 'lucide-react';
import { api } from '@/client/lib/api';
import { STARTERS } from '@/core/generator/starters';
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, TooltipProvider } from '@/client/ui/primitives';
import { cn, timeAgo } from '@/client/lib/utils';
import type { ProjectSummary } from '@/server/storage/types';

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
      <path d="M0 95 L100 45 L200 95 L100 145 Z" fill="#ffffff06" />
      {blocks.map(([x, y, w, d, h], i) => {
        const iso = (px: number, py: number, pz: number) => `${100 + (px - py) * 0.85},${y + (px + py) * 0.42 - pz}`;
        const x0 = x - 60;
        const y0 = 0;
        const top = [iso(x0, y0, h), iso(x0 + w, y0, h), iso(x0 + w, y0 + d, h), iso(x0, y0 + d, h)].join(' ');
        const left = [iso(x0, y0 + d, 0), iso(x0 + w, y0 + d, 0), iso(x0 + w, y0 + d, h), iso(x0, y0 + d, h)].join(' ');
        const right = [iso(x0 + w, y0, 0), iso(x0 + w, y0 + d, 0), iso(x0 + w, y0 + d, h), iso(x0 + w, y0, h)].join(' ');
        return (
          <g key={i} stroke={accent} strokeOpacity="0.7" strokeWidth="0.8">
            <polygon points={left} fill="#ffffff0a" />
            <polygon points={right} fill={`url(#g${variant})`} />
            <polygon points={top} fill="#ffffff14" />
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
  const [health, setHealth] = useState<{ storage: string; storageOk?: boolean; storageError?: string | null; databaseFallbackReason?: string | null; storagePersistent?: boolean; ai: { configured: boolean; provider: string | null; model: string | null } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e) => {
        setError(e.message);
        setProjects([]);
      });
  useEffect(() => {
    void refresh();
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  const create = async (opts: { name: string; starterId?: string; prompt?: string }) => {
    setBusy(opts.starterId ?? 'new');
    try {
      const { project } = await api.createProject({ name: opts.name, starterId: opts.starterId });
      router.push(`/project/${project.id}${opts.prompt ? `?prompt=${encodeURIComponent(opts.prompt)}` : ''}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const nameFromPrompt = (p: string) => {
    const m = p.match(/\b(villa|house|room|office|apartment|kitchen|cabin|living room|bedroom|hus|rum|kontor|lägenhet|kök|stuga)\b/i);
    return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} concept` : 'New project';
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-ink-900">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(226,184,107,0.12),transparent)]" />
        <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-[#a7793a] text-ink-950 shadow-glow">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[14px] font-semibold tracking-tight text-ink-100">AI 3D Studio</div>
              <div className="text-[11px] text-ink-400">Parametric architecture, directed by language</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            {health ? (
              <>
                <Badge tone={health.storage === 'postgres' ? 'success' : 'neutral'}>
                  <Database className="h-3 w-3" /> {health.storage === 'postgres' ? 'PostgreSQL' : 'Local file storage'}
                </Badge>
                <Badge tone={health.ai.configured ? 'success' : 'warn'}>
                  <Cpu className="h-3 w-3" /> {health.ai.configured ? `${health.ai.provider} · ${health.ai.model}` : 'Built-in interpreter (no LLM key)'}
                </Badge>
              </>
            ) : null}
          </div>
        </header>

        <main className="relative mx-auto max-w-6xl px-6 pb-20">
          <section className="mx-auto mt-10 max-w-3xl text-center">
            <h1 className="text-[40px] font-semibold leading-tight tracking-tight text-ink-100">
              Describe it. <span className="bg-gradient-to-r from-accent to-[#f6dfb0] bg-clip-text text-transparent">Build it.</span> Refine it.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed text-ink-300">
              Generate real, editable building models — walls, windows, roofs and furniture as parametric objects. Click any element and tell the AI how to change it.
            </p>
            <form
              className="glass mx-auto mt-7 flex items-center gap-2 rounded-2xl p-2 text-left"
              onSubmit={(e) => {
                e.preventDefault();
                if (prompt.trim()) void create({ name: nameFromPrompt(prompt), prompt: prompt.trim() });
              }}
            >
              <Sparkles className="ml-2 h-4 w-4 shrink-0 text-accent" />
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A two-storey Scandinavian villa with floor-to-ceiling windows and a pool…"
                className="h-10 flex-1 bg-transparent text-[14px] text-ink-100 outline-none placeholder:text-ink-400"
                data-testid="home-prompt"
              />
              <Button variant="primary" size="lg" type="submit" disabled={!prompt.trim() || !!busy}>
                {busy === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Create
              </Button>
            </form>
            <div className="mt-3 flex items-center justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => create({ name: 'Untitled project' })} disabled={!!busy} data-testid="new-blank">
                <Plus className="h-3.5 w-3.5" /> Blank project
              </Button>
              <Button variant="ghost" size="sm" onClick={async () => {
                setBusy('import');
                const { project } = await api.createProject({ name: 'Imported drawing' });
                router.push(`/project/${project.id}?import=1`);
              }} disabled={!!busy}>
                <FileUp className="h-3.5 w-3.5" /> From a floor plan
              </Button>
            </div>
            {busy ? <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-ink-300" data-testid="home-busy"><Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> Creating project…</div> : null}
            {error ? <div className="mt-3 text-[12px] text-danger" data-testid="home-error">{error}</div> : null}
            {health && health.storageOk === false ? (
              <div className="mx-auto mt-3 max-w-xl rounded-lg border border-danger/30 bg-danger/[0.08] px-3 py-2 text-left text-[12px] text-danger" data-testid="storage-error">
                Projects cannot be saved right now: {health.storageError || 'storage is not writable'}
              </div>
            ) : health && (health.databaseFallbackReason || health.storagePersistent === false) ? (
              <div className="mx-auto mt-3 max-w-xl rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2 text-left text-[12px] leading-relaxed text-warn" data-testid="storage-warning">
                {health.databaseFallbackReason ? <div>The database is not reachable, so projects are stored on the server&apos;s disk instead. Reason: {health.databaseFallbackReason}</div> : null}
                {health.storagePersistent === false ? <div>Projects saved on the server&apos;s disk are lost when the app is redeployed. Add a volume (mount path <span className="font-mono">/app/data</span>) or a PostgreSQL database to keep them.</div> : null}
              </div>
            ) : null}
          </section>

          <section className="mt-14">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <h2 className="text-[15px] font-semibold text-ink-100">Start from an example</h2>
                <p className="text-[12px] text-ink-400">Fully parametric — every element is editable.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {STARTERS.map((s, i) => {
                const Icon = STARTER_ICONS[s.id] ?? Box;
                return (
                  <button key={s.id} onClick={() => create({ name: s.name, starterId: s.id })} disabled={!!busy} className="group overflow-hidden rounded-xl border border-white/[0.07] bg-ink-850 text-left transition hover:-translate-y-0.5 hover:border-accent/40" data-testid={`starter-${s.id}`}>
                    <div className="relative h-32 bg-gradient-to-br from-ink-800 to-ink-900">
                      <IsoArt accent={s.accent} variant={i} />
                      {busy === s.id ? (
                        <div className="absolute inset-0 grid place-items-center bg-black/40">
                          <Loader2 className="h-5 w-5 animate-spin text-accent" />
                        </div>
                      ) : null}
                    </div>
                    <div className="p-3">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-100">
                        <Icon className="h-3.5 w-3.5 text-accent" /> {s.name}
                      </div>
                      <div className="mt-1 text-[11.5px] leading-relaxed text-ink-400">{s.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-12">
            <h2 className="mb-3 text-[15px] font-semibold text-ink-100">Your projects</h2>
            {projects === null ? (
              <div className="flex items-center gap-2 text-[12.5px] text-ink-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-[12.5px] text-ink-400">No projects yet. Describe something above or open an example.</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="project-list">
                {projects.map((p, i) => (
                  <div key={p.id} className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-ink-850 transition hover:border-white/15">
                    <button className="block w-full text-left" onClick={() => router.push(`/project/${p.id}`)}>
                      <div className="h-32 bg-ink-800">
                        {p.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <IsoArt accent="#8a91a0" variant={i} />
                        )}
                      </div>
                      <div className="p-3">
                        <div className="truncate text-[13px] font-medium text-ink-100">{p.name}</div>
                        <div className="mt-0.5 text-[11px] text-ink-400">
                          {p.elementCount} objects · edited {timeAgo(p.updatedAt)}
                        </div>
                      </div>
                    </button>
                    <div className={cn('absolute right-2 top-2 opacity-0 transition group-hover:opacity-100')}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="iconSm" variant="secondary" aria-label="Project actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
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
        </main>
      </div>
    </TooltipProvider>
  );
}
