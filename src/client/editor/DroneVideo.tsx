'use client';
import { useEffect, useState } from 'react';
import { Clapperboard, Download, Loader2, RotateCcw, X } from 'lucide-react';
import { useEditor, type VideoSettings } from '../store/editor';
import { Button, Dialog, DialogContent } from '../ui/primitives';
import { cn } from '../lib/utils';

const LENGTHS = [
  { s: 30, label: '30 s', hint: 'Teaser' },
  { s: 60, label: '1 min', hint: 'Full tour' },
  { s: 90, label: '1.5 min', hint: 'Slow, cinematic' },
];
const QUALITIES = [
  { w: 1280, h: 720, label: '720p', hint: 'Faster to render' },
  { w: 1920, h: 1080, label: '1080p', hint: 'Full HD' },
];

export function startDroneVideo(settings: VideoSettings) {
  const st = useEditor.getState();
  if (st.video.url) URL.revokeObjectURL(st.video.url);
  st.set({
    walkMode: false,
    selection: [],
    droneMode: true,
    viewMode: 'presentation',
    video: { status: 'recording', progress: 0, settings, returnViewMode: st.viewMode },
  });
}

export function cancelDroneVideo() {
  const st = useEditor.getState();
  st.set({ droneMode: false, viewMode: st.video.returnViewMode ?? st.viewMode, video: { status: 'idle', progress: 0 } });
}

/** Choose length and quality, then preview and download the finished video. */
export function VideoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const video = useEditor((s) => s.video);
  const [seconds, setSeconds] = useState(60);
  const [quality, setQuality] = useState(1);
  const done = video.status === 'done' && video.url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={done ? 'Your drone video' : 'Create a drone video'}
        description={done ? 'Rendered frame by frame from the model.' : 'A camera flight around the building, in through the entrance, through every room and up the stairs, then out again.'}
        className="max-w-[620px]"
      >
        <div className="space-y-4 p-4">
          {done ? (
            <>
              <video src={video.url} controls autoPlay muted playsInline className="aspect-video w-full rounded-lg bg-black" data-testid="video-preview" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11.5px] text-ink-400">
                  {video.settings ? `${video.settings.width}×${video.settings.height} · ${video.settings.fps} fps · ${video.settings.seconds} s` : ''} · {video.mime}
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => useEditor.getState().set({ video: { status: 'idle', progress: 0 } })}>
                    <RotateCcw className="h-4 w-4" /> Make another
                  </Button>
                  <Button asChild variant="primary">
                    <a href={video.url} download={video.filename} data-testid="video-download">
                      <Download className="h-4 w-4" /> Download
                    </a>
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="panel-title mb-2">Length</div>
                <div className="grid grid-cols-3 gap-2">
                  {LENGTHS.map((l) => (
                    <button key={l.s} onClick={() => setSeconds(l.s)} className={cn('rounded-lg border p-3 text-left transition', seconds === l.s ? 'border-accent/50 bg-accent-soft' : 'border-white/[0.07] hover:bg-white/[0.03]')}>
                      <div className="text-[13px] font-medium text-ink-100">{l.label}</div>
                      <div className="text-[11px] text-ink-400">{l.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="panel-title mb-2">Quality</div>
                <div className="grid grid-cols-2 gap-2">
                  {QUALITIES.map((q, i) => (
                    <button key={q.label} onClick={() => setQuality(i)} className={cn('rounded-lg border p-3 text-left transition', quality === i ? 'border-accent/50 bg-accent-soft' : 'border-white/[0.07] hover:bg-white/[0.03]')}>
                      <div className="text-[13px] font-medium text-ink-100">{q.label}</div>
                      <div className="text-[11px] text-ink-400">{q.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11.5px] leading-relaxed text-ink-400">
                Uses the current environment and sun. Rendering runs on this computer and takes roughly as long as the video, more on slower machines — keep this tab open.
              </p>
              {video.status === 'error' ? <p className="text-[12px] text-danger">Recording failed: {video.error}</p> : null}
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="lg"
                  data-testid="video-start"
                  onClick={() => {
                    onOpenChange(false);
                    startDroneVideo({ seconds, width: QUALITIES[quality].w, height: QUALITIES[quality].h, fps: 30 });
                  }}
                >
                  <Clapperboard className="h-4 w-4" /> Record video
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Progress overlay while frames are rendered and encoded. */
export function DroneHud() {
  const video = useEditor((s) => s.video);
  const [t0] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const pct = Math.round(video.progress * 100);
  const elapsed = (Date.now() - t0) / 1000;
  const eta = video.progress > 0.03 ? Math.max(0, Math.round((elapsed / video.progress) * (1 - video.progress))) : null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center" data-testid="drone-hud">
      <div className="glass pointer-events-auto flex w-[min(460px,92%)] items-center gap-3 rounded-xl px-4 py-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-[12px] text-ink-100">
            <span>Recording drone video…</span>
            <span className="tabular-nums text-ink-300">
              {pct}%{eta !== null ? ` · ~${eta >= 60 ? `${Math.floor(eta / 60)} min ` : ''}${eta % 60} s left` : ''}
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Button size="iconSm" variant="ghost" onClick={cancelDroneVideo} aria-label="Cancel recording">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
