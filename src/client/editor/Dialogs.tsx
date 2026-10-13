'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, Download, Link2, Link2Off, Lock } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Badge, Button, Dialog, DialogContent } from '../ui/primitives';
import { downloadBlob, cn } from '../lib/utils';
import { exportGLB, exportOBJ, exportSTL } from '@/core/export/meshExport';
import { exportIFC } from '@/core/export/ifc';
import { exportDXF } from '@/core/export/dxf';
import { MaterialManager } from '../three/materials';
import { captureImage } from './capture';
import { api } from '../lib/api';
import { getPlan, type ExportFormat } from '@/core/billing/plans';

type Format = 'glb' | 'glb-plain' | 'obj' | 'stl' | 'stl-mm' | 'ifc' | 'dxf' | 'png';

const FORMATS: { id: Format; title: string; ext: string; desc: string; limits?: string; tag?: string }[] = [
  { id: 'glb', title: 'glTF Binary (GLB) — textured', ext: '.glb', tag: 'Recommended', desc: 'Blender, SketchUp, Unreal, Unity, three.js, Windows 3D Viewer. One named node per element with id/type in extras, PBR materials with embedded textures. Meters, +Y up.' },
  { id: 'glb-plain', title: 'glTF Binary (GLB) — lightweight', ext: '.glb', desc: 'Same geometry with untextured PBR colours. Much smaller file.' },
  { id: 'obj', title: 'Wavefront OBJ + MTL', ext: '.obj / .mtl', desc: 'Universal mesh format with one object per element and material colours.', limits: 'No textures, no hierarchy, no metadata.' },
  { id: 'stl', title: 'STL (meters)', ext: '.stl', desc: 'Binary STL for 3D printing / CAM. Geometry only.', limits: 'No materials. Many slicers assume millimeters — use the mm variant for printing.' },
  { id: 'stl-mm', title: 'STL (millimeters)', ext: '.stl', desc: 'Same as above, scaled ×1000 for slicers.' },
  { id: 'ifc', title: 'IFC4 (BIM)', ext: '.ifc', tag: 'BIM', desc: 'Revit, ArchiCAD, Solibri, BIMcollab, BlenderBIM. Storeys, IfcWall extrusions with real openings (IfcOpeningElement), IfcWindow/IfcDoor, IfcSlab, IfcSpace, IfcRoof, IfcStair, materials and property sets.', limits: 'Roofs, stairs, windows, doors and furniture use tessellated bodies (not parametric IFC types). Wall joins are geometric overlaps, not IfcRelConnectsPathElements.' },
  { id: 'dxf', title: 'DXF floor plans', ext: '.dxf', desc: 'AutoCAD / LibreCAD 2D plans per level: wall outlines with openings, door swings, windows, rooms with areas, furniture and exterior dimensions. Units: meters.', limits: 'Dimension annotations are lines + text, not associative DIMENSION entities.' },
  { id: 'png', title: 'Rendered image (PNG)', ext: '.png', desc: 'High-resolution still of the current camera view in the current display mode.' },
];

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [format, setFormat] = useState<Format>('glb');
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = useEditor((s) => s.selection);
  const name = useEditor((s) => s.projectName);
  // Plan gating for professional formats (signed-out share viewers get the Free formats).
  const [allowed, setAllowed] = useState<ExportFormat[]>(getPlan('free').limits.exportFormats);
  useEffect(() => {
    if (!open) return;
    api
      .me()
      .then((r) => setAllowed(getPlan(r.user?.plan ?? 'free').limits.exportFormats))
      .catch(() => {});
  }, [open]);
  const baseFormat = (f: Format): ExportFormat | null => (f === 'glb-plain' ? 'glb' : f === 'stl-mm' ? 'stl' : f === 'png' ? null : (f as ExportFormat));
  const locked = (f: Format) => {
    const b = baseFormat(f);
    return b !== null && !allowed.includes(b);
  };

  const run = async () => {
    if (locked(format)) {
      window.open('/pricing', '_blank');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const st = useEditor.getState();
      const scene = st.scene;
      const base = name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'model';
      const ids = selectionOnly && selection.length ? new Set(selection) : undefined;
      switch (format) {
        case 'glb': {
          const mm = new MaterialManager('realistic', scene.materials);
          const buf = await exportGLB(scene, { ids, material: (ref) => (ref === '__room' ? mm.get('paint_white') : mm.get(ref)) });
          downloadBlob(buf, `${base}.glb`, 'model/gltf-binary');
          break;
        }
        case 'glb-plain':
          downloadBlob(await exportGLB(scene, { ids }), `${base}.glb`, 'model/gltf-binary');
          break;
        case 'obj': {
          const { obj, mtl } = exportOBJ(scene, { ids, mtlFileName: `${base}.mtl` });
          downloadBlob(obj, `${base}.obj`, 'text/plain');
          setTimeout(() => downloadBlob(mtl, `${base}.mtl`, 'text/plain'), 300);
          break;
        }
        case 'stl':
        case 'stl-mm':
          downloadBlob(exportSTL(scene, { ids, unit: format === 'stl-mm' ? 'mm' : 'm' }), `${base}${format === 'stl-mm' ? '_mm' : ''}.stl`, 'model/stl');
          break;
        case 'ifc':
          downloadBlob(exportIFC(selectionOnly && ids ? { ...scene, elements: scene.elements.filter((e) => ids.has(e.id) || ('hostId' in e && ids.has(e.hostId))) } : scene, { projectName: name, projectId: st.projectId ?? undefined }).content, `${base}.ifc`, 'application/x-step');
          break;
        case 'dxf':
          downloadBlob(exportDXF(scene), `${base}.dxf`, 'application/dxf');
          break;
        case 'png': {
          onOpenChange(false);
          await new Promise((r) => setTimeout(r, 200));
          const blob = await captureImage(2);
          if (blob) downloadBlob(blob, `${base}.png`, 'image/png');
          break;
        }
      }
      st.notify(`Exported ${FORMATS.find((f) => f.id === format)!.title}`, 'success');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Export model" description="Real geometry with true dimensions in meters. Exports run locally in your browser." className="max-w-[640px]">
        <div className="space-y-1.5 p-4">
          {FORMATS.map((f) => (
            <button key={f.id} onClick={() => setFormat(f.id)} className={cn('w-full rounded-lg border p-3 text-left transition', format === f.id ? 'border-accent/50 bg-accent-soft' : 'border-white/[0.06] hover:bg-white/[0.03]')} data-testid={`format-${f.id}`}>
              <div className="flex items-center gap-2">
                <span className={cn('grid h-4 w-4 place-items-center rounded-full border', format === f.id ? 'border-accent bg-accent text-ink-950' : 'border-white/20')}>{format === f.id ? <Check className="h-3 w-3" /> : null}</span>
                <span className="text-[12.5px] font-medium text-ink-100">{f.title}</span>
                <span className="font-mono text-[10.5px] text-ink-400">{f.ext}</span>
                {f.tag ? <Badge tone="accent">{f.tag}</Badge> : null}
                {locked(f.id) ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-accent/30 px-2 py-0.5 text-[10.5px] text-accent">
                    <Lock className="h-3 w-3" /> Pro
                  </span>
                ) : null}
              </div>
              <div className="ml-6 mt-1 text-[11.5px] leading-relaxed text-ink-300">{f.desc}</div>
              {f.limits ? <div className="ml-6 mt-1 text-[11px] text-warn/90">Limitations: {f.limits}</div> : null}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3">
          <label className={cn('flex items-center gap-2 text-[12px] text-ink-200', (!selection.length || format === 'dxf' || format === 'png') && 'opacity-40')}>
            <input type="checkbox" className="accent-[#cdab74]" disabled={!selection.length || format === 'dxf' || format === 'png'} checked={selectionOnly} onChange={(e) => setSelectionOnly(e.target.checked)} />
            Selected objects only ({selection.length})
          </label>
          <div className="flex items-center gap-2">
            {error ? <span className="text-[11.5px] text-danger">{error}</span> : null}
            {locked(format) ? (
              <Button variant="primary" onClick={run} data-testid="do-export">
                <Lock className="h-4 w-4" /> Upgrade to export {format.toUpperCase()}
              </Button>
            ) : (
              <Button variant="primary" onClick={run} loading={busy} data-testid="do-export">
                <Download className="h-4 w-4" /> Export
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ShareDialog({ open, onOpenChange, token, setToken }: { open: boolean; onOpenChange: (v: boolean) => void; token: string | null; setToken: (t: string | null) => void }) {
  const projectId = useEditor((s) => s.projectId);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = token && typeof window !== 'undefined' ? `${window.location.origin}/share/${token}` : '';
  const create = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const r = await api.share(projectId);
      setToken(r.token);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!projectId) return;
    await api.unshare(projectId);
    setToken(null);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Share read-only link" description="Anyone with the link can orbit, inspect and walk through the saved model. They cannot edit it.">
        <div className="space-y-3 p-4">
          {token ? (
            <>
              <div className="flex gap-1.5">
                <input readOnly className="field font-mono text-[11px]" value={url} />
                <Button
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
                </Button>
              </div>
              <div className="flex justify-between">
                <a href={url} target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">
                  Open shared view
                </a>
                <Button size="sm" variant="ghost" onClick={revoke}>
                  <Link2Off className="h-3.5 w-3.5" /> Revoke link
                </Button>
              </div>
              <div className="text-[11px] text-ink-400">The shared view always shows the latest saved state of this project.</div>
            </>
          ) : (
            <Button variant="primary" onClick={create} loading={busy} disabled={!projectId}>
              <Link2 className="h-4 w-4" /> Create share link
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
