import { Armchair, Box, BrickWall, Columns3, DoorOpen, Footprints, Home, Layers, LayoutGrid, Mountain, PanelTop, RectangleHorizontal, Square, SquareDashed, Waves, Minus } from 'lucide-react';
import type { ElementType } from '@/core/schema/elements';

const ICONS: Record<ElementType, React.ComponentType<{ className?: string }>> = {
  wall: BrickWall,
  window: PanelTop,
  door: DoorOpen,
  slab: Layers,
  roof: Home,
  skylight: Square,
  stair: Footprints,
  column: Columns3,
  beam: Minus,
  room: SquareDashed,
  furniture: Armchair,
  terrain: Mountain,
  pool: Waves,
  box: Box,
};

export function ElementIcon({ type, className }: { type: ElementType; className?: string }) {
  const I = ICONS[type] ?? RectangleHorizontal;
  return <I className={className} />;
}

export { LayoutGrid };
