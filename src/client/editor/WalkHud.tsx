'use client';
import { Footprints, LogOut, MousePointerClick } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Button } from '../ui/primitives';
import { stopWalk } from './walk';

const KEYS: [string, string][] = [
  ['W A S D', 'Walk'],
  ['Mouse', 'Look around'],
  ['Shift', 'Run'],
  ['Space', 'Jump'],
  ['E / Q', 'Floor up / down'],
  ['F', 'Fly mode (Space up, C down)'],
  ['Esc', 'Pause'],
  ['X', 'Leave walk mode'],
];

/** Overlay for the first-person walk view. */
export function WalkHud() {
  const locked = useEditor((s) => s.walkLocked);
  const info = useEditor((s) => s.walkInfo);
  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-testid="walk-hud">
      {locked ? (
        <>
          <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 shadow-[0_0_0_2px_rgba(0,0,0,0.35)]" />
          <div className="glass absolute left-4 top-4 flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-ink-100">
            <Footprints className="h-3.5 w-3.5 text-accent" /> {info.level || 'Walking'}
            {info.fly ? <span className="rounded bg-accent-soft px-1.5 text-[10.5px] text-accent">fly</span> : null}
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-4 py-1.5 text-[11.5px] text-ink-200 backdrop-blur">
            WASD walk · Shift run · E/Q change floor · Esc pause
          </div>
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0 grid place-items-center bg-black/35 backdrop-blur-[2px]">
          <div className="glass w-[min(420px,90%)] rounded-2xl p-6 text-center animate-fade-in">
            <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
              <Footprints className="h-5 w-5" />
            </div>
            <div className="text-[16px] font-semibold text-ink-100">Walk inside the model</div>
            <div className="mt-1 text-[12.5px] text-ink-300">Explore the building in first person — walls and glass are solid, doors are open and stairs can be climbed.</div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-left text-[12px]">
              {KEYS.map(([k, v]) => (
                <div key={k} className="contents">
                  <span className="kbd justify-self-start text-[11px]">{k}</span>
                  <span className="text-ink-200">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-center gap-2">
              <Button id="walk-lock" variant="primary" size="lg" data-testid="walk-start">
                <MousePointerClick className="h-4 w-4" /> {info.level ? 'Continue walking' : 'Click to start'}
              </Button>
              <Button variant="secondary" size="lg" onClick={stopWalk}>
                <LogOut className="h-4 w-4" /> Exit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
