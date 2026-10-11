'use client';
import { Aperture, Box, Camera, Download, Eye, Footprints, Grid3x3, Magnet, Maximize, Move, MousePointer2, Palette, Redo2, RotateCw, Ruler, Save, Scaling, Undo2 } from 'lucide-react';
import { useEditor, type Tool, type ViewPreset } from '../store/editor';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, IconButton, Separator, Tooltip } from '../ui/primitives';
import { MaterialGrid } from './MaterialPicker';
import { captureImage } from './capture';
import { downloadBlob, cn } from '../lib/utils';
import { viewportHandles } from '../three/registry';

const TOOLS: { id: Tool; label: string; key: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'move', label: 'Move', key: 'G', icon: Move },
  { id: 'rotate', label: 'Rotate', key: 'R', icon: RotateCw },
  { id: 'scale', label: 'Scale / resize', key: 'S', icon: Scaling },
  { id: 'measure', label: 'Measure', key: 'M', icon: Ruler },
];

export function BottomToolbar({ onExport, onSave }: { onExport: () => void; onSave: () => void }) {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const selection = useEditor((s) => s.selection);
  const custom = useEditor((s) => s.scene.materials);
  const saveState = useEditor((s) => s.saveState);
  const dirty = useEditor((s) => s.dirty);
  const readOnly = useEditor((s) => s.readOnly);
  const st = useEditor.getState;

  const render = async () => {
    if (st().viewMode === 'modeling') st().set({ viewMode: 'realistic' });
    await new Promise((r) => setTimeout(r, 400));
    const blob = await captureImage(2);
    if (blob) downloadBlob(blob, `${st().projectName.replace(/\W+/g, '_')}_render.png`, 'image/png');
    st().notify('Rendered still image downloaded', 'success');
  };

  return (
    <div className="glass pointer-events-auto flex items-center gap-0.5 rounded-xl px-1.5 py-1" data-testid="toolbar">
      <IconButton label="Undo" shortcut="⌘Z" onClick={() => st().undo()} disabled={!canUndo || readOnly} data-testid="undo">
        <Undo2 className="h-4 w-4" />
      </IconButton>
      <IconButton label="Redo" shortcut="⇧⌘Z" onClick={() => st().redo()} disabled={!canRedo || readOnly}>
        <Redo2 className="h-4 w-4" />
      </IconButton>
      <Separator vertical />
      {TOOLS.map((t) => (
        <IconButton key={t.id} label={t.label} shortcut={t.key} active={tool === t.id} onClick={() => st().set({ tool: t.id, measure: { points: [] } })} disabled={readOnly && t.id !== 'select' && t.id !== 'measure'}>
          <t.icon className="h-4 w-4" />
        </IconButton>
      ))}
      <Separator vertical />
      <DropdownMenu>
        <Tooltip content="Material editor">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-ink-300" disabled={readOnly} aria-label="Material editor">
              <Palette className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent side="top" className="max-h-[60vh] w-[320px] overflow-auto p-2">
          <DropdownMenuLabel>{selection.length ? `Apply to ${selection.length} selected` : 'Select objects first'}</DropdownMenuLabel>
          <MaterialGrid
            custom={custom}
            onPick={(id) => {
              if (!selection.length) return st().notify('Select objects first', 'warn');
              const r = st().apply([{ op: 'set_material', ids: selection, material: id }], 'Set material', { scopeIds: selection });
              if (!r.ok) st().notify(r.errors[0], 'danger');
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton label="Render still image" onClick={render}>
        <Camera className="h-4 w-4" />
      </IconButton>
      <IconButton label="Export" shortcut="E" onClick={onExport} data-testid="export-button">
        <Download className="h-4 w-4" />
      </IconButton>
      <IconButton label={saveState === 'saving' ? 'Saving…' : dirty ? 'Save' : 'Saved'} shortcut="⌘S" onClick={onSave} disabled={readOnly} data-testid="save-button" className={cn(dirty && 'text-accent')}>
        <Save className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

const PRESETS: { id: ViewPreset; label: string }[] = [
  { id: 'iso', label: '3D' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'right', label: 'Side' },
];

export function ViewControls() {
  const cam = useEditor((s) => s.camera);
  const showGrid = useEditor((s) => s.showGrid);
  const snap = useEditor((s) => s.snap);
  const gridSize = useEditor((s) => s.gridSize);
  const walk = useEditor((s) => s.walkMode);
  const viewMode = useEditor((s) => s.viewMode);
  const pathTrace = useEditor((s) => s.pathTrace);
  const samples = useEditor((s) => s.pathTraceSamples);
  const st = useEditor.getState;
  return (
    <div className="glass pointer-events-auto flex items-center gap-0.5 rounded-xl px-1 py-1">
      {viewMode !== 'modeling' ? (
        <>
          <Tooltip content="Path-traced render: global illumination, soft shadows and true glass. Converges over a few seconds; any camera move restarts it.">
            <Button variant="ghost" size="sm" className={cn('h-7 gap-1 px-2 text-[11px] text-ink-300', pathTrace && 'bg-accent-soft text-accent')} onClick={() => st().set({ pathTrace: !pathTrace, pathTraceSamples: 0 })} data-testid="pathtrace">
              <Aperture className="h-3.5 w-3.5" /> {pathTrace ? `Path tracing · ${samples} spp` : 'Path trace'}
            </Button>
          </Tooltip>
          <Separator vertical />
        </>
      ) : null}
      {PRESETS.map((p) => (
        <Button key={p.id} variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-ink-300" onClick={() => st().requestView(p.id)}>
          {p.label}
        </Button>
      ))}
      <Separator vertical />
      <IconButton label={cam === 'perspective' ? 'Switch to orthographic' : 'Switch to perspective'} size="iconSm" active={cam === 'orthographic'} onClick={() => { st().set({ camera: cam === 'perspective' ? 'orthographic' : 'perspective' }); setTimeout(() => st().requestView('fit'), 30); }}>
        <Box className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton label="Walkthrough (WASD, Esc to exit)" size="iconSm" active={walk} onClick={() => st().set({ walkMode: !walk })}>
        <Footprints className="h-3.5 w-3.5" />
      </IconButton>
      {viewMode === 'modeling' ? (
        <IconButton label="Grid" size="iconSm" active={showGrid} onClick={() => st().set({ showGrid: !showGrid })}>
          <Grid3x3 className="h-3.5 w-3.5" />
        </IconButton>
      ) : null}
      <DropdownMenu>
        <Tooltip content={`Snap ${snap ? `on · ${gridSize * 100} cm` : 'off'}`}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" className={cn('text-ink-300', snap && 'bg-accent-soft text-accent')} aria-label="Snap settings">
              <Magnet className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => st().set({ snap: !snap })}>{snap ? 'Disable snapping' : 'Enable snapping'}</DropdownMenuItem>
          {[0.01, 0.05, 0.1, 0.25, 0.5, 1].map((g) => (
            <DropdownMenuItem key={g} onSelect={() => st().set({ gridSize: g, snap: true })}>
              {g >= 1 ? `${g} m` : `${g * 100} cm`} {gridSize === g ? '✓' : ''}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton
        label="Fullscreen"
        size="iconSm"
        onClick={() => {
          const el = viewportHandles.container?.parentElement;
          if (document.fullscreenElement) void document.exitFullscreen();
          else void el?.requestFullscreen?.();
        }}
      >
        <Maximize className="h-3.5 w-3.5" />
      </IconButton>
      {viewMode === 'presentation' ? (
        <IconButton label="Exit presentation" size="iconSm" onClick={() => st().set({ viewMode: 'realistic' })}>
          <Eye className="h-3.5 w-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}
