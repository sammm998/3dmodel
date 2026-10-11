import type { BuildingProgramInput } from './program';

export interface StarterProject {
  id: string;
  name: string;
  description: string;
  prompt: string;
  program: BuildingProgramInput;
  accent: string;
}

export const STARTERS: StarterProject[] = [
  {
    id: 'scandinavian-villa',
    name: 'Modern Scandinavian Villa',
    description: 'Two storeys, floor-to-ceiling glazing, white plaster, oak details, terrace and pool.',
    prompt: 'Create a modern Scandinavian villa, 240 square meters, two floors, floor-to-ceiling windows, white plaster exterior, oak details, and a swimming pool.',
    accent: '#c9a273',
    program: {
      name: 'Scandinavian Villa',
      kind: 'villa',
      blocks: [
        { name: 'Main', x: 0, z: 0, width: 15, depth: 8, floors: 2 },
        { name: 'Garage', x: 15, z: 1.5, width: 6.5, depth: 6.5, floors: 1, garage: true },
      ],
      floorHeight: 2.9,
      wallThickness: 0.3,
      exteriorMaterial: 'plaster_white',
      interiorMaterial: 'paint_white',
      floorMaterial: 'oak_floor',
      windows: { style: 'floor_to_ceiling', density: 'medium', frameMaterial: 'aluminium_black' },
      doors: { count: 1, type: 'hinged', material: 'oak' },
      roof: { type: 'flat', material: 'concrete', overhang: 0.25 },
      program: { bedrooms: 3, bathrooms: 2, living: true, kitchen: true, dining: true, offices: 0 },
      furnish: true,
      extras: { pool: { width: 4, length: 11, side: 'front' }, terrace: { depth: 4, side: 'front', material: 'wood_deck' }, terrain: true, stairs: true },
    },
  },
  {
    id: 'luxury-apartment',
    name: 'Luxury Apartment Interior',
    description: 'Open-plan living with marble kitchen, master suite and spa bathroom.',
    prompt: 'Create a luxury apartment interior with an open-plan living room and kitchen, two bedrooms, a marble bathroom and walnut details.',
    accent: '#8a6a4a',
    program: {
      name: 'Luxury Apartment',
      kind: 'apartment',
      blocks: [{ x: 0, z: 0, width: 16, depth: 10, floors: 1 }],
      floorHeight: 3.0,
      exteriorMaterial: 'plaster_beige',
      interiorMaterial: 'paint_white',
      floorMaterial: 'oak_floor',
      windows: { style: 'floor_to_ceiling', frameMaterial: 'aluminium_black', density: 'medium' },
      doors: { count: 1, material: 'walnut' },
      roof: { type: 'none' },
      rooms: [
        { name: 'Entrance hall', function: 'hall', level: 0, x: 0, z: 0, width: 2.6, depth: 10 },
        { name: 'Living Room', function: 'living', level: 0, x: 2.6, z: 4.5, width: 7.4, depth: 5.5 },
        { name: 'Kitchen', function: 'kitchen', level: 0, x: 2.6, z: 0, width: 4.2, depth: 4.5 },
        { name: 'Dining', function: 'dining', level: 0, x: 6.8, z: 0, width: 3.2, depth: 4.5 },
        { name: 'Master bedroom', function: 'bedroom', level: 0, x: 10, z: 4.5, width: 6, depth: 5.5 },
        { name: 'Bedroom 2', function: 'bedroom', level: 0, x: 10, z: 0, width: 3.6, depth: 4.5 },
        { name: 'Bathroom', function: 'bathroom', level: 0, x: 13.6, z: 0, width: 2.4, depth: 4.5 },
      ],
      furnish: true,
      extras: { terrain: false, stairs: false },
    },
  },
  {
    id: 'contemporary-office',
    name: 'Contemporary Office',
    description: 'Five-storey office building with a full glass curtain-wall facade.',
    prompt: 'Create a contemporary office building with five floors and a glass facade.',
    accent: '#5b7c99',
    program: {
      name: 'Contemporary Office',
      kind: 'office',
      blocks: [{ x: 0, z: 0, width: 30, depth: 16, floors: 5 }],
      floorHeight: 3.6,
      wallThickness: 0.3,
      exteriorMaterial: 'concrete',
      interiorMaterial: 'paint_white',
      floorMaterial: 'concrete_polished',
      windows: { style: 'curtain', frameMaterial: 'aluminium_black' },
      doors: { count: 1, type: 'double', material: 'glass_clear' },
      roof: { type: 'flat', material: 'concrete', overhang: 0.2 },
      furnish: true,
      extras: { terrain: true, stairs: true },
    },
  },
  {
    id: 'minimalist-kitchen',
    name: 'Minimalist Kitchen',
    description: 'Calm kitchen with oak floor, white cabinetry, marble island and dining table.',
    prompt: 'Create a minimalist kitchen with an island, oak floor, white walls and a dining table.',
    accent: '#d8d2c6',
    program: {
      name: 'Minimalist Kitchen',
      kind: 'interior',
      blocks: [{ x: 0, z: 0, width: 7, depth: 6, floors: 1 }],
      floorHeight: 2.8,
      exteriorMaterial: 'paint_white',
      interiorMaterial: 'paint_white',
      floorMaterial: 'oak_floor',
      windows: { count: 3, style: 'standard', frameMaterial: 'aluminium_black', width: 1.6, height: 1.5 },
      doors: { count: 1, material: 'oak' },
      roof: { type: 'none' },
      rooms: [
        { name: 'Kitchen', function: 'kitchen', level: 0, x: 0, z: 0, width: 7, depth: 3.2 },
        { name: 'Dining', function: 'dining', level: 0, x: 0, z: 3.2, width: 7, depth: 2.8 },
      ],
      furnish: true,
      extras: { terrain: false, stairs: false },
    },
  },
];
