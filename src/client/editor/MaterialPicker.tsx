'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import * as Popover from '@radix-ui/react-dropdown-menu';
import { MATERIALS, resolveMaterial, type MaterialCategory } from '@/core/materials/library';
import type { CustomMaterial } from '@/core/schema/scene';
import { swatchStyle } from '../three/materials';
import { cn } from '../lib/utils';

const ORDER: MaterialCategory[] = ['wood', 'plaster', 'paint', 'concrete', 'masonry', 'stone', 'ceramic', 'metal', 'glass', 'fabric', 'landscape'];

export function MaterialSwatch({ id, custom, className }: { id: string; custom?: CustomMaterial[]; className?: string }) {
  const def = resolveMaterial(id, custom);
  return <span className={cn('inline-block h-4 w-4 shrink-0 rounded border border-white/15', className)} style={swatchStyle(def)} />;
}

export function MaterialGrid({ value, onPick, custom = [], filter }: { value?: string; onPick: (id: string) => void; custom?: CustomMaterial[]; filter?: string }) {
  const q = (filter ?? '').toLowerCase();
  const items = MATERIALS.filter((m) => !q || m.name.toLowerCase().includes(q) || m.keywords.some((k) => k.includes(q)));
  return (
    <div className="space-y-2">
      {ORDER.map((cat) => {
        const list = items.filter((m) => m.category === cat);
        if (!list.length) return null;
        return (
          <div key={cat}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-400">{cat}</div>
            <div className="grid grid-cols-2 gap-1">
              {list.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onPick(m.id)}
                  className={cn('flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] transition', value === m.id ? 'border-accent/50 bg-accent-soft text-accent' : 'border-white/[0.05] text-ink-200 hover:bg-white/[0.05]')}
                  title={m.id}
                >
                  <span className="h-5 w-5 shrink-0 rounded border border-white/15" style={swatchStyle(m)} />
                  <span className="truncate">{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {custom.length ? (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-400">custom</div>
          <div className="grid grid-cols-2 gap-1">
            {custom.map((m) => (
              <button key={m.id} onClick={() => onPick(m.id)} className="flex items-center gap-1.5 rounded-md border border-white/[0.05] px-1.5 py-1 text-[11px] text-ink-200 hover:bg-white/[0.05]">
                <MaterialSwatch id={m.id} custom={custom} className="h-5 w-5" />
                <span className="truncate">{m.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MaterialPicker({ value, onChange, custom, allowNone }: { value?: string; onChange: (id: string | undefined) => void; custom?: CustomMaterial[]; allowNone?: boolean }) {
  const [filter, setFilter] = useState('');
  const def = value ? resolveMaterial(value, custom) : null;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="field flex items-center gap-1.5 text-left">
          {value ? <MaterialSwatch id={value} custom={custom} /> : <span className="h-4 w-4 rounded border border-dashed border-white/20" />}
          <span className="flex-1 truncate">{def ? def.name : 'Same as primary'}</span>
          <ChevronDown className="h-3 w-3 text-ink-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="left" align="start" sideOffset={8} className="z-[95] max-h-[70vh] w-[300px] overflow-auto rounded-xl border border-white/10 bg-ink-800/95 p-2 shadow-panel backdrop-blur-xl animate-fade-in">
          <input autoFocus className="field mb-2" placeholder="Search materials…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          {allowNone ? (
            <Popover.Item className="mb-1 cursor-default rounded-md px-2 py-1 text-[11px] text-ink-300 outline-none data-[highlighted]:bg-white/5" onSelect={() => onChange(undefined)}>
              Same as primary
            </Popover.Item>
          ) : null}
          <MaterialGrid value={value} onPick={(id) => onChange(id)} custom={custom} filter={filter} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
