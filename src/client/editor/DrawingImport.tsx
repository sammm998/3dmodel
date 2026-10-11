'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CircleDot, DoorOpen, FileUp, Hand, Loader2, MousePointer2, PanelTop, PenLine, Ruler, ScanLine, Sparkles, SquareDashed, Trash2, Wand2 } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Badge, Button, Dialog, DialogContent, IconButton, Separator } from '../ui/primitives';
import { cn } from '../lib/utils';
import { api } from '../lib/api';
import { calibrate, FloorPlan, planToOperations, type PlanOpening, type PlanPoint, type PlanRoom, type PlanWall } from '@/core/plan/plan';
import { analysisToPlan, detectWallsFromRaster, detectWallsFromSegments, openingWidthsToMeters, type Segment } from '@/core/plan/detect';
import { applyOperations } from '@/core/ops/apply';
import { emptyScene } from '@/core/schema/scene';
import { parseLength } from '@/core/schema/units';

type Tool = 'select' | 'wall' | 'door' | 'window' | 'room' | 'calibrate' | 'pan';
const MAX_DIM = 1600;
let seq = 0;
const nid = (p: string) => `${p}${Date.now().toString(36)}${++seq}`;

interface Loaded {
  dataUrl: string;
  width: number;
  height: number;
  gray: Uint8ClampedArray | null;
  filename: string;
  kind: 'image' | 'pdf' | 'dxf';
}

async function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not load image'));
    img.src = url;
  });
}

function canvasToLoaded(canvas: HTMLCanvasElement, filename: string, kind: Loaded['kind']): Loaded {
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) * (data[i * 4 + 3] / 255) + 255 * (1 - data[i * 4 + 3] / 255);
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, gray, filename, kind };
}

async function loadRaster(file: Blob, filename: string): Promise<Loaded> {
  const url = URL.createObjectURL(file);
  try {
    const img = await imageFromUrl(url);
    const s = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return canvasToLoaded(c, filename, 'image');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadPdf(file: Blob, filename: string): Promise<Loaded> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = MAX_DIM / Math.max(vp0.width, vp0.height);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as never).promise;
  return canvasToLoaded(c, filename, 'pdf');
}

const DXF_UNITS: Record<number, number> = { 1: 39.37, 2: 3.2808, 4: 1000, 5: 100, 6: 1 };

async function loadDxf(file: Blob, filename: string, forcedUnitsPerMeter?: number): Promise<{ loaded: Loaded; plan: FloorPlan; units: number }> {
  const { default: DxfParser } = await import('dxf-parser');
  const parsed = new DxfParser().parseSync(await file.text());
  if (!parsed) throw new Error('Could not parse DXF');
  const segs: Segment[] = [];
  for (const e of parsed.entities as unknown as { type: string; layer: string; vertices?: { x: number; y: number }[]; shape?: boolean }[]) {
    const v = e.vertices ?? [];
    if (e.type === 'LINE' && v.length >= 2) segs.push({ a: v[0], b: v[1], layer: e.layer });
    if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && v.length >= 2) {
      for (let i = 0; i < v.length - 1; i++) segs.push({ a: v[i], b: v[i + 1], layer: e.layer });
      if (e.shape) segs.push({ a: v[v.length - 1], b: v[0], layer: e.layer });
    }
  }
  if (!segs.length) throw new Error('The DXF contains no LINE or POLYLINE entities');
  const xs = segs.flatMap((s) => [s.a.x, s.b.x]);
  const ys = segs.flatMap((s) => [s.a.y, s.b.y]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const ext = Math.max(maxX - minX, maxY - minY) || 1;
  const header = (parsed as unknown as { header?: Record<string, number> }).header ?? {};
  const units = forcedUnitsPerMeter ?? DXF_UNITS[header.$INSUNITS] ?? (ext > 500 ? 1000 : 1);
  const margin = 40;
  const s = (MAX_DIM - 2 * margin) / ext;
  const T = (p: PlanPoint) => ({ x: (p.x - minX) * s + margin, y: (maxY - p.y) * s + margin });
  const tsegs = segs.map((q) => ({ a: T(q.a), b: T(q.b), layer: q.layer }));
  const W = Math.round((maxX - minX) * s + 2 * margin);
  const H = Math.round((maxY - minY) * s + 2 * margin);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1b1f27';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const q of tsegs) {
    ctx.moveTo(q.a.x, q.a.y);
    ctx.lineTo(q.b.x, q.b.y);
  }
  ctx.stroke();
  const pxPerMeter = s * units;
  const walls = detectWallsFromSegments(tsegs, pxPerMeter);
  return {
    loaded: { ...canvasToLoaded(c, filename, 'dxf'), gray: null },
    units,
    plan: FloorPlan.parse({ width: W, height: H, unitsPerMeter: pxPerMeter, scaleSource: 'dxf_units', walls }),
  };
}

function distToSeg(p: PlanPoint, a: PlanPoint, b: PlanPoint) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const l2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2));
  return { d: Math.hypot(a.x + ex * t - p.x, a.y + ey * t - p.y), t };
}

export function DrawingImportDialog() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [plan, setPlan] = useState<FloorPlan>(FloorPlan.parse({ width: 1000, height: 800 }));
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<{ upm: number; conf: number } | null>(null);
  const [calib, setCalib] = useState<PlanPoint[]>([]);
  const [calibText, setCalibText] = useState('');
  const [chain, setChain] = useState<PlanPoint | null>(null);
  const [cursor, setCursor] = useState<PlanPoint | null>(null);
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });
  const [assetId, setAssetId] = useState<string | null>(null);
  const [target, setTarget] = useState<'replace' | 'active' | 'newLevel'>('replace');
  const [dxfFile, setDxfFile] = useState<File | null>(null);
  const [dxfUnits, setDxfUnits] = useState<number>(1000);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'pan' | 'handle'; wallId?: string; end?: 'a' | 'b'; x: number; y: number; tx: number; ty: number } | null>(null);
  const projectId = useEditor((s) => s.projectId);
  const aiInfo = useEditor((s) => s.aiInfo);
  const hasScene = useEditor((s) => s.scene.elements.length > 0);

  const reset = () => {
    setLoaded(null);
    setPlan(FloorPlan.parse({ width: 1000, height: 800 }));
    setSel(null);
    setNotes([]);
    setSuggested(null);
    setCalib([]);
    setError(null);
    setAssetId(null);
    setDxfFile(null);
  };

  const fit = useCallback((w: number, h: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const s = Math.min(box.width / w, box.height / h) * 0.95;
    setView({ s, tx: (box.width - w * s) / 2, ty: (box.height - h * s) / 2 });
  }, []);

  const ingest = useCallback(
    async (file: File) => {
      setError(null);
      setBusy('Reading drawing…');
      try {
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        const isDxf = /\.dxf$/i.test(file.name);
        if (isDxf) {
          setDxfFile(file);
          const r = await loadDxf(file, file.name);
          setDxfUnits(r.units);
          setLoaded(r.loaded);
          setPlan(r.plan);
          setNotes([`DXF units: ${r.units === 1000 ? 'millimeters' : r.units === 100 ? 'centimeters' : r.units === 1 ? 'meters' : 'imperial'} — verify below. ${r.plan.walls.length} wall(s) found from parallel line pairs.`]);
          requestAnimationFrame(() => fit(r.loaded.width, r.loaded.height));
        } else {
          const l = isPdf ? await loadPdf(file, file.name) : await loadRaster(file, file.name);
          setLoaded(l);
          setPlan(FloorPlan.parse({ width: l.width, height: l.height }));
          requestAnimationFrame(() => fit(l.width, l.height));
        }
        if (projectId) {
          api
            .uploadAsset(projectId, file, 'drawing')
            .then((r) => {
              setAssetId(r.asset.id);
              window.dispatchEvent(new Event('ai3d:assets-changed'));
            })
            .catch((e) => setNotes((n) => [...n, `Upload to project storage failed: ${e.message}`]));
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [projectId, fit],
  );

  // Open via custom events from anywhere in the editor.
  useEffect(() => {
    const h = async (e: Event) => {
      const detail = (e as CustomEvent).detail as File | { assetId: string } | undefined;
      reset();
      setOpen(true);
      if (detail instanceof File) void ingest(detail);
      else if (detail && 'assetId' in detail) {
        setBusy('Loading drawing…');
        try {
          const res = await fetch(`/api/assets/${detail.assetId}`);
          const blob = await res.blob();
          const name = decodeURIComponent(res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? 'drawing');
          const f = new File([blob], name, { type: blob.type });
          await ingest(f);
          setAssetId(detail.assetId);
          const meta = (await api.listAssets(useEditor.getState().projectId!)).assets.find((a) => a.id === detail.assetId);
          const saved = (meta?.analysis as { plan?: unknown } | null)?.plan;
          if (saved) {
            const p = FloorPlan.safeParse(saved);
            if (p.success) setPlan(p.data);
          }
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(null);
        }
      }
    };
    window.addEventListener('ai3d:import-drawing', h);
    return () => window.removeEventListener('ai3d:import-drawing', h);
  }, [ingest]);

  // ---- coordinate helpers ----
  const toPlan = (e: { clientX: number; clientY: number }): PlanPoint => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.s, y: (e.clientY - r.top - view.ty) / view.s };
  };
  const snapTol = 10 / view.s;
  const snapPoint = (p: PlanPoint, from: PlanPoint | null, free: boolean): PlanPoint => {
    for (const w of plan.walls) for (const q of [w.a, w.b]) if (Math.hypot(q.x - p.x, q.y - p.y) < snapTol) return { ...q };
    if (from && !free) {
      const dx = p.x - from.x;
      const dy = p.y - from.y;
      const ang = Math.atan2(dy, dx);
      const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      if (Math.abs(ang - snapped) < (8 * Math.PI) / 180) {
        const L = Math.hypot(dx, dy);
        return { x: from.x + Math.cos(snapped) * L, y: from.y + Math.sin(snapped) * L };
      }
    }
    return p;
  };
  const hitWall = (p: PlanPoint) => {
    let best: { w: PlanWall; d: number; t: number } | null = null;
    for (const w of plan.walls) {
      const r = distToSeg(p, w.a, w.b);
      if (r.d < 8 / view.s && (!best || r.d < best.d)) best = { w, ...r };
    }
    return best;
  };

  const upm = plan.unitsPerMeter;
  const metersText = (units: number) => (upm ? `${(units / upm).toFixed(2)} m` : `${Math.round(units)} px`);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!loaded) return;
    const p = toPlan(e);
    if (e.button === 1 || tool === 'pan' || e.altKey) {
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      return;
    }
    if (tool === 'select') {
      for (const w of plan.walls) {
        for (const end of ['a', 'b'] as const) {
          if (sel === w.id && Math.hypot(w[end].x - p.x, w[end].y - p.y) < 9 / view.s) {
            drag.current = { kind: 'handle', wallId: w.id, end, x: 0, y: 0, tx: 0, ty: 0 };
            return;
          }
        }
      }
      const op = plan.openings.find((o) => {
        const w = plan.walls.find((x) => x.id === o.wallId);
        if (!w) return false;
        const c = { x: w.a.x + (w.b.x - w.a.x) * o.t, y: w.a.y + (w.b.y - w.a.y) * o.t };
        return Math.hypot(c.x - p.x, c.y - p.y) < 10 / view.s;
      });
      if (op) return setSel(op.id);
      const room = plan.rooms.find((r) => Math.hypot(r.at.x - p.x, r.at.y - p.y) < 14 / view.s);
      if (room) return setSel(room.id);
      const hw = hitWall(p);
      setSel(hw ? hw.w.id : null);
      if (!hw) drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      return;
    }
    if (tool === 'wall') {
      const q = snapPoint(p, chain, e.shiftKey);
      if (chain && Math.hypot(q.x - chain.x, q.y - chain.y) > 2 / view.s) {
        const w: PlanWall = { id: nid('w'), a: chain, b: q, thickness: null, exterior: false, confidence: 1, source: 'user' };
        setPlan((pl) => ({ ...pl, walls: [...pl.walls, w] }));
      }
      setChain(q);
      return;
    }
    if (tool === 'door' || tool === 'window') {
      const hw = hitWall(p);
      if (!hw) return setError('Click on a wall to place the opening');
      const o: PlanOpening = { id: nid('o'), type: tool, wallId: hw.w.id, t: hw.t, width: tool === 'door' ? 0.9 : 1.2, height: null, sillHeight: null, confidence: 1, source: 'user' };
      setPlan((pl) => ({ ...pl, openings: [...pl.openings, o] }));
      setSel(o.id);
      setError(null);
      return;
    }
    if (tool === 'room') {
      const r: PlanRoom = { id: nid('r'), name: `Room ${plan.rooms.length + 1}`, at: p, confidence: 1 };
      setPlan((pl) => ({ ...pl, rooms: [...pl.rooms, r] }));
      setSel(r.id);
      setTool('select');
      return;
    }
    if (tool === 'calibrate') {
      const q = snapPoint(p, calib[0] ?? null, e.shiftKey);
      setCalib((c) => (c.length >= 2 ? [q] : [...c, q]));
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!loaded) return;
    const p = toPlan(e);
    setCursor(tool === 'wall' || tool === 'calibrate' ? snapPoint(p, tool === 'wall' ? chain : calib.length === 1 ? calib[0] : null, e.shiftKey) : p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y }));
    if (d.kind === 'handle' && d.wallId && d.end) {
      const q = snapPoint(p, null, true);
      setPlan((pl) => ({ ...pl, walls: pl.walls.map((w) => (w.id === d.wallId ? { ...w, [d.end!]: q, confidence: 1 } : w)) }));
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const s = Math.max(0.05, Math.min(20, v.s * f));
      return { s, tx: mx - ((mx - v.tx) / v.s) * s, ty: my - ((my - v.ty) / v.s) * s };
    });
  };

  // Keyboard: Esc ends chains, Delete removes selection.
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        if (chain) {
          e.preventDefault();
          e.stopPropagation();
          setChain(null);
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        setPlan((pl) => ({
          ...pl,
          walls: pl.walls.filter((w) => w.id !== sel),
          openings: pl.openings.filter((o) => o.id !== sel && o.wallId !== sel),
          rooms: pl.rooms.filter((r) => r.id !== sel),
        }));
        setSel(null);
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [open, chain, sel]);

  // ---- detection ----
  const detectLocal = () => {
    if (!loaded?.gray) return;
    setBusy('Detecting walls…');
    setTimeout(() => {
      try {
        const r = detectWallsFromRaster(loaded.gray!, loaded.width, loaded.height);
        setPlan((pl) => ({ ...pl, walls: r.walls, openings: r.openings }));
        setNotes([`Local detection found ${r.walls.length} wall(s) and ${r.openings.length} opening(s) (ink threshold ${r.threshold}, typical wall ${r.medianThicknessPx.toFixed(0)} px). Review dashed items before generating.`]);
        if (!r.walls.length) setError('No thick wall lines were found. Trace walls manually with the Wall tool or try AI analysis.');
      } finally {
        setBusy(null);
      }
    }, 20);
  };

  const detectAI = async () => {
    if (!loaded) return;
    setBusy('AI is reading the drawing…');
    setError(null);
    try {
      // Send a compressed JPEG to keep the request small.
      const img = await imageFromUrl(loaded.dataUrl);
      const c = document.createElement('canvas');
      c.width = loaded.width;
      c.height = loaded.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      const res = await fetch('/api/ai/analyze-drawing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: c.toDataURL('image/jpeg', 0.85), width: loaded.width, height: loaded.height, assetId: assetId ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error);
      const r = analysisToPlan(data.analysis, plan);
      setPlan((pl) => ({ ...r.plan, unitsPerMeter: pl.unitsPerMeter, scaleSource: pl.scaleSource }));
      if (r.suggestedUnitsPerMeter) setSuggested({ upm: r.suggestedUnitsPerMeter, conf: r.scaleConfidence });
      setNotes([`${data.analysis.provider} found ${r.plan.walls.length} walls, ${r.plan.openings.length} openings, ${r.plan.rooms.length} rooms.`, ...(data.analysis.notes ?? [])]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const applyCalibration = () => {
    if (calib.length !== 2) return;
    const m = parseLength(calibText);
    if (!m) return setError('Enter a distance such as "4.5 m" or "4500 mm"');
    try {
      const u = calibrate(calib[0], calib[1], m);
      setPlan((pl) => ({ ...pl, unitsPerMeter: u, scaleSource: 'calibration' }));
      setError(null);
      setTool('select');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const review = useMemo(() => [...plan.walls.filter((w) => w.confidence < 0.6), ...plan.openings.filter((o) => o.confidence < 0.6)], [plan]);

  const generate = async () => {
    if (!plan.unitsPerMeter) return;
    const st = useEditor.getState();
    const prepared = { ...plan, openings: openingWidthsToMeters(plan.openings, plan.unitsPerMeter) };
    let base = st.scene;
    let levelId = st.activeLevelId;
    if (target === 'replace') {
      base = { ...emptyScene(), counters: st.scene.counters, materials: st.scene.materials, settings: st.scene.settings };
      base.levels[0].height = plan.wallHeight;
      levelId = base.levels[0].id;
    } else if (target === 'newLevel') {
      const r = applyOperations(base, [{ op: 'add_level', height: plan.wallHeight }]);
      base = r.scene;
      levelId = base.levels[base.levels.length - 1].id;
    }
    try {
      const { ops, warnings } = planToOperations(prepared, { levelId });
      const r = applyOperations(base, ops);
      if (!r.ok) return setError(r.errors.slice(0, 3).join(' · '));
      st.commitScene(r.scene, `Import ${loaded?.filename ?? 'drawing'}`);
      const counts = r.changes.filter((c) => c.kind === 'created').reduce<Record<string, number>>((a, c) => ((a[c.type] = (a[c.type] ?? 0) + 1), a), {});
      const what = Object.entries(counts).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', ');
      st.addChat({ role: 'assistant', text: `Generated ${what} from ${loaded?.filename ?? 'the drawing'} (scale: ${plan.unitsPerMeter.toFixed(1)} units/m via ${plan.scaleSource.replace('_', ' ')}).${warnings.length ? `\n\nNotes: ${warnings.join(' ')}` : ''}`, provider: 'drawing import', status: 'applied', summary: r.summary });
      if (assetId) void api.saveAssetAnalysis(assetId, { plan, generatedAt: new Date().toISOString() });
      st.requestView('iso');
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const selWall = plan.walls.find((w) => w.id === sel);
  const selOpening = plan.openings.find((o) => o.id === sel);
  const selRoom = plan.rooms.find((r) => r.id === sel);
  const updOpening = (patch: Partial<PlanOpening>) => setPlan((pl) => ({ ...pl, openings: pl.openings.map((o) => (o.id === sel ? { ...o, ...patch, confidence: 1, source: o.source === 'raster' || o.source === 'ai' ? (patch.width !== undefined ? 'user' : o.source) : o.source } : o)) }));
  const updWall = (patch: Partial<PlanWall>) => setPlan((pl) => ({ ...pl, walls: pl.walls.map((w) => (w.id === sel ? { ...w, ...patch, confidence: 1 } : w)) }));
  const k = view.s;

  const TOOLS: { id: Tool; label: string; icon: React.ComponentType<{ className?: string }>; key: string }[] = [
    { id: 'select', label: 'Select / edit (drag endpoints)', icon: MousePointer2, key: 'V' },
    { id: 'pan', label: 'Pan (or Alt-drag / middle mouse)', icon: Hand, key: 'H' },
    { id: 'calibrate', label: 'Calibrate scale: pick two points, enter real distance', icon: Ruler, key: 'C' },
    { id: 'wall', label: 'Draw walls (click-click, Esc to finish, Shift = free angle)', icon: PenLine, key: 'W' },
    { id: 'door', label: 'Place door on a wall', icon: DoorOpen, key: 'D' },
    { id: 'window', label: 'Place window on a wall', icon: PanelTop, key: 'N' },
    { id: 'room', label: 'Label a room', icon: SquareDashed, key: 'R' },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent wide title="Drawing → 3D" description="Upload a floor plan, calibrate the scale, detect or trace walls, correct anything uncertain, then generate an editable parametric model.">
        {!loaded ? (
          <label
            className="m-5 flex h-[56vh] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] text-center transition hover:border-accent/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void ingest(f);
            }}
          >
            {busy ? <Loader2 className="h-6 w-6 animate-spin text-accent" /> : <FileUp className="h-7 w-7 text-accent" />}
            <div className="text-[14px] font-medium text-ink-100">{busy ?? 'Drop a floor plan here or click to browse'}</div>
            <div className="max-w-md text-[12px] text-ink-300">PNG / JPG / WebP images, scanned blueprints, hand sketches, PDF drawings (first page) and DXF files. Elevations and sections can be traced manually.</div>
            {error ? <div className="text-[12px] text-danger">{error}</div> : null}
            <input type="file" accept="image/*,.pdf,.dxf" hidden onChange={(e) => e.target.files?.[0] && ingest(e.target.files[0])} data-testid="drawing-file" />
          </label>
        ) : (
          <div className="flex h-[74vh]">
            <div className="flex w-12 flex-col items-center gap-1 border-r border-white/[0.06] py-2">
              {TOOLS.map((t) => (
                <IconButton key={t.id} label={t.label} side="right" active={tool === t.id} onClick={() => { setTool(t.id); setChain(null); }} data-testid={`plan-tool-${t.id}`}>
                  <t.icon className="h-4 w-4" />
                </IconButton>
              ))}
            </div>
            <div ref={boxRef} className="relative min-w-0 flex-1 overflow-hidden bg-[#0e1013]">
              <svg
                ref={svgRef}
                className={cn('h-full w-full select-none', tool === 'pan' ? 'cursor-grab' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair')}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => (drag.current = null)}
                onDoubleClick={() => setChain(null)}
                onWheel={onWheel}
                data-testid="plan-canvas"
              >
                <g transform={`translate(${view.tx} ${view.ty}) scale(${k})`}>
                  <image href={loaded.dataUrl} width={loaded.width} height={loaded.height} opacity={0.85} />
                  {plan.rooms.map((r) => (
                    <g key={r.id}>
                      <circle cx={r.at.x} cy={r.at.y} r={5 / k} fill={sel === r.id ? '#f0c97f' : '#7aa7ff'} />
                      <text x={r.at.x + 8 / k} y={r.at.y + 4 / k} fontSize={13 / k} fill="#7aa7ff" style={{ paintOrder: 'stroke' }} stroke="#0e1013" strokeWidth={3 / k}>
                        {r.name}
                      </text>
                    </g>
                  ))}
                  {plan.walls.map((w) => {
                    const thick = upm ? (w.thickness ?? (w.exterior ? Math.max(plan.defaultThickness, 0.25) : plan.defaultThickness)) * upm : 6 / k;
                    const unsure = w.confidence < 0.6;
                    return (
                      <g key={w.id}>
                        <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={sel === w.id ? '#f0c97f' : unsure ? '#f5b84a' : w.exterior ? '#5fd39a' : '#7aa7ff'} strokeOpacity={0.45} strokeWidth={thick} strokeLinecap="square" />
                        <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={sel === w.id ? '#f0c97f' : unsure ? '#f5b84a' : '#e3e6eb'} strokeWidth={1.5 / k} strokeDasharray={unsure ? `${6 / k} ${4 / k}` : undefined} />
                        {sel === w.id
                          ? [w.a, w.b].map((p, i) => <rect key={i} x={p.x - 5 / k} y={p.y - 5 / k} width={10 / k} height={10 / k} fill="#0b0d10" stroke="#f0c97f" strokeWidth={1.5 / k} />)
                          : null}
                      </g>
                    );
                  })}
                  {plan.openings.map((o) => {
                    const w = plan.walls.find((x) => x.id === o.wallId);
                    if (!w) return null;
                    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
                    const ux = (w.b.x - w.a.x) / L;
                    const uy = (w.b.y - w.a.y) / L;
                    const widthUnits = o.source === 'raster' || o.source === 'ai' ? o.width : upm ? o.width * upm : o.width * 50;
                    const cx = w.a.x + (w.b.x - w.a.x) * o.t;
                    const cy = w.a.y + (w.b.y - w.a.y) * o.t;
                    const color = sel === o.id ? '#f0c97f' : o.confidence < 0.6 ? '#f5b84a' : o.type === 'door' ? '#ff9f7a' : '#8fd3ff';
                    return (
                      <g key={o.id}>
                        <line x1={cx - (ux * widthUnits) / 2} y1={cy - (uy * widthUnits) / 2} x2={cx + (ux * widthUnits) / 2} y2={cy + (uy * widthUnits) / 2} stroke={color} strokeWidth={7 / k} strokeLinecap="butt" />
                        <circle cx={cx} cy={cy} r={3 / k} fill={color} />
                      </g>
                    );
                  })}
                  {chain && cursor && tool === 'wall' ? <line x1={chain.x} y1={chain.y} x2={cursor.x} y2={cursor.y} stroke="#f0c97f" strokeWidth={2 / k} strokeDasharray={`${5 / k} ${4 / k}`} /> : null}
                  {chain && cursor && tool === 'wall' ? (
                    <text x={(chain.x + cursor.x) / 2} y={(chain.y + cursor.y) / 2 - 8 / k} fontSize={12 / k} fill="#f0c97f">
                      {metersText(Math.hypot(cursor.x - chain.x, cursor.y - chain.y))}
                    </text>
                  ) : null}
                  {calib.length ? (
                    <g>
                      {calib.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r={5 / k} fill="#ff6bd6" />
                      ))}
                      {calib.length === 2 || (tool === 'calibrate' && cursor) ? (
                        <line x1={calib[0].x} y1={calib[0].y} x2={(calib[1] ?? cursor)!.x} y2={(calib[1] ?? cursor)!.y} stroke="#ff6bd6" strokeWidth={2 / k} />
                      ) : null}
                    </g>
                  ) : null}
                </g>
              </svg>
              {busy ? (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <div className="flex items-center gap-2 rounded-lg bg-ink-800 px-3 py-2 text-[12.5px] text-ink-100">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" /> {busy}
                  </div>
                </div>
              ) : null}
              <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 font-mono text-[10.5px] text-ink-300">
                {cursor ? `${Math.round(cursor.x)}, ${Math.round(cursor.y)} px` : ''} · zoom {(k * 100).toFixed(0)}% · wheel to zoom
              </div>
            </div>
            <div className="flex w-[300px] flex-col overflow-y-auto border-l border-white/[0.06]">
              <div className="space-y-3 p-3">
                <div>
                  <div className="panel-title mb-1.5">1 · Scale</div>
                  {upm ? (
                    <div className="flex items-center gap-1.5 text-[12px] text-success" data-testid="scale-status">
                      <Check className="h-3.5 w-3.5" /> 1 m = {upm.toFixed(1)} units <Badge tone="success">{plan.scaleSource.replace('_', ' ')}</Badge>
                    </div>
                  ) : (
                    <div className="flex items-start gap-1.5 text-[12px] text-warn" data-testid="scale-status">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Not calibrated — dimensions are unknown. Use the ruler tool on a known distance.
                    </div>
                  )}
                  {loaded.kind === 'dxf' && dxfFile ? (
                    <label className="mt-2 flex items-center justify-between text-[11.5px] text-ink-300">
                      DXF drawing units
                      <select
                        className="field w-32"
                        value={dxfUnits}
                        onChange={async (e) => {
                          const u = Number(e.target.value);
                          setDxfUnits(u);
                          const r = await loadDxf(dxfFile, dxfFile.name, u);
                          setPlan(r.plan);
                        }}
                      >
                        <option value={1000}>millimeters</option>
                        <option value={100}>centimeters</option>
                        <option value={1}>meters</option>
                        <option value={39.37}>inches</option>
                        <option value={3.2808}>feet</option>
                      </select>
                    </label>
                  ) : null}
                  {tool === 'calibrate' || calib.length ? (
                    <div className="mt-2 space-y-1.5 rounded-lg border border-[#ff6bd6]/30 bg-[#ff6bd6]/[0.06] p-2">
                      <div className="text-[11px] text-ink-200">{calib.length < 2 ? `Click ${2 - calib.length} more point(s) on a known dimension.` : `Measured ${Math.round(Math.hypot(calib[1].x - calib[0].x, calib[1].y - calib[0].y))} units. Real distance:`}</div>
                      {calib.length === 2 ? (
                        <div className="flex gap-1.5">
                          <input autoFocus className="field" placeholder="e.g. 4.5 m or 4500 mm" value={calibText} onChange={(e) => setCalibText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyCalibration()} data-testid="calib-input" />
                          <Button size="sm" variant="primary" onClick={applyCalibration} data-testid="calib-apply">
                            Set
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {suggested && !upm ? (
                    <div className="mt-2 rounded-lg border border-info/25 bg-info/[0.06] p-2 text-[11px] text-ink-200">
                      AI read dimension annotations suggesting 1 m ≈ {suggested.upm.toFixed(1)} px (confidence {(suggested.conf * 100).toFixed(0)}%).
                      <div className="mt-1.5 flex gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setPlan((pl) => ({ ...pl, unitsPerMeter: suggested.upm, scaleSource: 'ai_dimension' }))}>
                          Use suggested scale
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setTool('calibrate')}>
                          Calibrate instead
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <Separator />
                <div>
                  <div className="panel-title mb-1.5">2 · Detect or trace</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button size="sm" variant="secondary" onClick={detectLocal} disabled={!loaded.gray || !!busy} data-testid="detect-local">
                      <ScanLine className="h-3.5 w-3.5" /> Detect walls
                    </Button>
                    <Button size="sm" variant="secondary" onClick={detectAI} disabled={!aiInfo?.vision || !!busy} title={aiInfo?.vision ? 'Vision LLM analysis' : 'Needs a configured vision-capable LLM'}>
                      <Sparkles className="h-3.5 w-3.5" /> AI analysis
                    </Button>
                  </div>
                  <div className="mt-1.5 text-[10.5px] leading-relaxed text-ink-400">Local detection finds thick straight wall lines (CAD-style plans). Hand sketches usually need AI analysis or manual tracing with the wall tool.</div>
                  {notes.map((n, i) => (
                    <div key={i} className="mt-1.5 text-[11px] text-ink-300">
                      {n}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge>{plan.walls.length} walls</Badge>
                  <Badge>{plan.openings.length} openings</Badge>
                  <Badge>{plan.rooms.length} rooms</Badge>
                  {review.length ? <Badge tone="warn">{review.length} need review</Badge> : null}
                </div>
                {review.length ? (
                  <Button size="sm" variant="ghost" onClick={() => setPlan((pl) => ({ ...pl, walls: pl.walls.map((w) => ({ ...w, confidence: 1 })), openings: pl.openings.map((o) => ({ ...o, confidence: 1 })) }))}>
                    <Check className="h-3.5 w-3.5" /> Mark all as reviewed
                  </Button>
                ) : null}
                {selWall ? (
                  <div className="space-y-1.5 rounded-lg border border-white/[0.07] p-2">
                    <div className="flex items-center justify-between text-[11.5px] text-ink-100">
                      Wall · {metersText(Math.hypot(selWall.b.x - selWall.a.x, selWall.b.y - selWall.a.y))}
                      <IconButton label="Delete wall" size="iconSm" onClick={() => { setPlan((pl) => ({ ...pl, walls: pl.walls.filter((w) => w.id !== sel), openings: pl.openings.filter((o) => o.wallId !== sel) })); setSel(null); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                    <label className="flex items-center gap-2 text-[11.5px] text-ink-300">
                      <input type="checkbox" className="accent-[#e2b86b]" checked={selWall.exterior} onChange={(e) => updWall({ exterior: e.target.checked })} /> Exterior wall
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[11.5px] text-ink-300">
                      Thickness (m)
                      <input className="field w-24" type="number" step={0.01} value={selWall.thickness ?? ''} placeholder="default" onChange={(e) => updWall({ thickness: e.target.value ? Number(e.target.value) : null })} />
                    </label>
                  </div>
                ) : null}
                {selOpening ? (
                  <div className="space-y-1.5 rounded-lg border border-white/[0.07] p-2">
                    <div className="flex items-center justify-between text-[11.5px] text-ink-100">
                      Opening
                      <IconButton label="Delete opening" size="iconSm" onClick={() => { setPlan((pl) => ({ ...pl, openings: pl.openings.filter((o) => o.id !== sel) })); setSel(null); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                    <select className="field" value={selOpening.type} onChange={(e) => updOpening({ type: e.target.value as 'door' })}>
                      <option value="door">Door</option>
                      <option value="window">Window</option>
                    </select>
                    <label className="flex items-center justify-between gap-2 text-[11.5px] text-ink-300">
                      Width (m)
                      <input
                        className="field w-24"
                        type="number"
                        step={0.05}
                        value={selOpening.source === 'raster' || selOpening.source === 'ai' ? (upm ? Number((selOpening.width / upm).toFixed(2)) : '') : selOpening.width}
                        placeholder={upm ? '' : 'calibrate first'}
                        onChange={(e) => updOpening({ width: Number(e.target.value), source: 'user' })}
                      />
                    </label>
                  </div>
                ) : null}
                {selRoom ? (
                  <div className="space-y-1.5 rounded-lg border border-white/[0.07] p-2">
                    <div className="text-[11.5px] text-ink-100">Room label</div>
                    <input className="field" value={selRoom.name} onChange={(e) => setPlan((pl) => ({ ...pl, rooms: pl.rooms.map((r) => (r.id === sel ? { ...r, name: e.target.value } : r)) }))} onKeyDown={(e) => e.stopPropagation()} />
                  </div>
                ) : null}
                <Separator />
                <div className="space-y-1.5">
                  <div className="panel-title">3 · Generate</div>
                  <label className="flex items-center justify-between gap-2 text-[11.5px] text-ink-300">
                    Wall height (m)
                    <input className="field w-24" type="number" step={0.1} value={plan.wallHeight} onChange={(e) => setPlan((pl) => ({ ...pl, wallHeight: Math.max(1, Number(e.target.value) || 2.7) }))} />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-[11.5px] text-ink-300">
                    Default thickness (m)
                    <input className="field w-24" type="number" step={0.01} value={plan.defaultThickness} onChange={(e) => setPlan((pl) => ({ ...pl, defaultThickness: Math.max(0.05, Number(e.target.value) || 0.2) }))} />
                  </label>
                  <select className="field" value={target} onChange={(e) => setTarget(e.target.value as 'replace')}>
                    <option value="replace">Replace current scene</option>
                    <option value="active" disabled={!hasScene}>
                      Add to active level
                    </option>
                    <option value="newLevel" disabled={!hasScene}>
                      Add as a new level on top
                    </option>
                  </select>
                  {error ? <div className="text-[11.5px] text-danger">{error}</div> : null}
                  <Button variant="primary" className="w-full" onClick={generate} disabled={!upm || !plan.walls.length} data-testid="plan-generate">
                    <Wand2 className="h-4 w-4" /> Generate 3D model
                  </Button>
                  {!upm ? <div className="text-[10.5px] text-ink-400">Calibrate the scale first — dimensions are never guessed.</div> : null}
                  {review.length ? (
                    <div className="flex items-start gap-1 text-[10.5px] text-warn">
                      <CircleDot className="mt-0.5 h-3 w-3" /> {review.length} detected item(s) have low confidence (dashed orange).
                    </div>
                  ) : null}
                  <Button variant="ghost" size="sm" className="w-full" onClick={reset}>
                    Load another drawing
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
