'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Aperture, Download, Loader2, Square } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Button, Dialog, DialogContent } from '../ui/primitives';
import { viewportHandles } from '../three/registry';
import type { PhotoRender } from '../three/photo';
import { cn } from '../lib/utils';

const SIZES = [
  { w: 1280, label: 'Standard', hint: '1280 px · fast' },
  { w: 1920, label: 'High', hint: '1920 px · print' },
];

/** Sample counts where the image reads as draft / good / final. */
const STAGES = [
  { n: 32, label: 'Draft' },
  { n: 160, label: 'Good' },
  { n: 512, label: 'Final' },
];

/**
 * Photorealistic still of the current view: the scene is path traced (real light
 * bounces, soft shadows, refractive glass) and refines until it is clean.
 */
export function PhotoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const job = useRef<PhotoRender | null>(null);
  const [size, setSize] = useState(0);
  const [phase, setPhase] = useState<'preparing' | 'rendering' | 'done' | 'error'>('preparing');
  const [samples, setSamples] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const max = STAGES[STAGES.length - 1].n;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const cam = viewportHandles.camera as THREE.PerspectiveCamera | undefined;
    const box = viewportHandles.container?.getBoundingClientRect();
    // Same framing as the viewport, kept within photographic proportions.
    const a = Math.min(2.4, Math.max(0.75, box && box.height > 0 ? box.width / box.height : 16 / 9));
    setAspect(a);
    setSamples(0);
    setError(null);
    setPhase('preparing');
    if (!cam || !cam.isPerspectiveCamera) {
      setPhase('error');
      setError('Switch to the 3D (perspective) view first — photos are taken from the 3D camera.');
      return;
    }
    // Let the dialog lay out the canvas, then build the path-traced scene.
    const t = setTimeout(async () => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const w = SIZES[size].w;
      const h = Math.round(w / a);
      try {
        // The path tracer is large: load it only when a photo is taken.
        const { startPhotoRender } = await import('../three/photo');
        const r = await startPhotoRender({
          canvas,
          width: w,
          height: h,
          scene: useEditor.getState().scene,
          camera: cam,
          maxSamples: max,
          onReady: () => !cancelled && setPhase('rendering'),
          onSample: (n) => {
            if (cancelled) return;
            setSamples(n);
            if (n >= max) setPhase('done');
          },
        });
        if (cancelled) r.dispose();
        else job.current = r;
      } catch (e) {
        if (!cancelled) {
          setPhase('error');
          setError(`This browser or GPU could not path trace the scene (${(e as Error).message}).`);
        }
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
      job.current?.dispose();
      job.current = null;
    };
  }, [open, size, max]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${useEditor.getState().projectName.replace(/\W+/g, '_') || 'render'}_photo.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  };

  const stage = [...STAGES].reverse().find((s) => samples >= s.n)?.label ?? 'Refining';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Photorealistic image" description="Path traced from the current 3D view: light bounces between surfaces, soft shadows, real reflections and glass. The image sharpens as it renders." wide>
        <div className="space-y-3 p-4" data-testid="photo-dialog">
          <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: String(aspect) }}>
            <canvas ref={canvasRef} className="h-full w-full" data-testid="photo-canvas" />
            {phase === 'preparing' ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-[12.5px] text-ink-200">
                <Loader2 className="h-4 w-4 animate-spin" /> Preparing the scene for path tracing…
              </div>
            ) : null}
            {phase === 'error' ? <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12.5px] text-warn">{error}</div> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, (samples / max) * 100)}%` }} />
              </div>
              <span className="text-[11.5px] tabular-nums text-ink-300" data-testid="photo-samples">
                {phase === 'rendering' || phase === 'done' ? `${stage} · ${samples} samples` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {SIZES.map((s, i) => (
                <button key={s.w} onClick={() => setSize(i)} className={cn('rounded-md border px-2 py-1 text-[11px] transition', i === size ? 'border-accent/50 bg-accent/10 text-ink-100' : 'border-white/[0.07] text-ink-300 hover:text-ink-100')} title={s.hint}>
                  {s.label}
                </button>
              ))}
              {phase === 'rendering' ? (
                <Button size="sm" variant="ghost" onClick={() => { job.current?.stop(); setPhase('done'); }}>
                  <Square className="h-3.5 w-3.5" /> Stop here
                </Button>
              ) : null}
              <Button size="sm" onClick={download} disabled={samples < 1} data-testid="photo-download">
                <Download className="h-3.5 w-3.5" /> Download PNG
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { Aperture as PhotoIcon };
