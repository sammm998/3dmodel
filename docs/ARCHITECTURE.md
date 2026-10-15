# Architecture

## 1. Scene data model (`src/core/schema`)

A scene is plain JSON validated with Zod.

```ts
Scene {
  schemaVersion: 1, units: 'm',
  levels:   [{ id: 'level_0', name, elevation, height }],
  elements: Element[],                 // discriminated union on `type`
  groups, materials (custom), views (saved cameras), settings, counters
}
```

**Conventions**

* Units: meters.
* Axes: Y up. Plan coordinates are `(x, z)`, and `+z` is south, towards the default camera.
* Angles: radians, except fields named `*Deg`.
* IDs are allocated per type prefix from monotonic `counters`, so an ID is never reused, even after a delete.

| Type | Key parameters |
| --- | --- |
| `wall` | `start`, `end`, `height`, `thickness`, `baseOffset`, `material`, `interiorMaterial`, `exterior`. Virtual `length`. |
| `window` | `hostId`, `offset` (along the wall), `width`, `height`, `sillHeight`, `style`, mullions, `frameMaterial`, `glazingMaterial` |
| `door` | `hostId`, `offset`, `width`, `height`, `doorType`, `swing`, `leafMaterial`, `frameMaterial` |
| `slab` | `polygon`, `thickness`, `elevation` (top), `material`, `role` |
| `roof` | `roofType` (flat/gable/hip/shed), `center`, `width`, `depth`, `rotation`, `pitchDeg`, `overhang`, `thickness`, `baseOffset`, `ridgeAxis`, `parapetHeight` |
| `skylight` | `hostId` (roof), `u`, `v`, `width`, `length` |
| `stair`, `column`, `beam`, `room`, `furniture`, `terrain`, `pool`, `box` | see `elements.ts` |

* **Separation of concerns:**
  * Visual geometry is **never stored**; it is derived from these parameters.
  * BIM-oriented data lives in `element.bim` (e.g. `isExternal`, `loadBearing`) and is exported to IFC property sets.
  * Relationships are explicit. Openings and skylights reference their host. Wall joins are derived from coincident endpoints.

## 2. Geometry (`src/core/geometry`)

* **Walls**
  * Built from a 2D outline in wall-local `(u, v)` space and extruded by the wall thickness.
  * Openings that touch the floor (doors) become notches in the outline; all others become holes.
  * Lid faces are split so the exterior and interior finishes can use different materials.
  * Corner joins come from `computeWallExtensions` (half-thickness extension at L and T joints).
* **Roofs** are built in a generation frame (ridge along local x) as per-face prisms with real thickness.
  * The eave plane passes through the wall top at the outer face.
  * Gable and shed roofs get gable infill.
  * Skylights sample the analytic roof height function to sit on the slope.
* **UVs** are in meters on every primitive, so textures keep their physical size.
* **Rectilinear decomposition (`rectilinear.ts`)** is used by the generator:
  1. Labelled rectangles (blocks, rooms) are rasterised onto the irregular grid of their edges.
  2. Edges between different labels become partition walls. Edges against empty cells become façade walls, with an outward normal.
  3. Cell outlines become slabs and room zones.

## 3. Operation language (`src/core/ops`)

All mutations go through `applyOperations(scene, ops, { scopeIds })`:

```ts
{ op: 'modify', id, set?, scale?, add?, translate?, moveAlongHost?, moveNormal?, rotateDeg?, anchor? }
{ op: 'create', element: { type, ... }, ref?: '$name' }      // later ops may reference '$name'
{ op: 'delete', id }            { op: 'delete_where', types, roomId?, levelId? }
{ op: 'replace', id, element }  { op: 'set_material', ids, material, slot? }
{ op: 'define_material', material }   { op: 'set_level', id, height?, preserveOpeningProportions? }
{ op: 'add_level', ... }        { op: 'generate_building', program, mode }   { op: 'group', ids, name }
```

The engine guarantees the following:

1. **Pure and transactional.** The input scene is never mutated. On any error the result has `ok: false`, and the caller must not commit.
2. **Validation.**
   * Every touched element is re-parsed with Zod.
   * The whole scene is then checked: referential integrity, known materials, openings inside their host wall bounds and height, no zero-length walls.
   * Overlapping openings produce warnings.
3. **Dependencies.**
   * Moving a wall endpoint stretches the walls joined to it, but only along their own axis, so they stay straight. Otherwise the joint is released and a warning is reported.
   * Hosted openings keep their world position when the wall changes length.
   * Deletes cascade to hosted children.
   * Level height changes propagate to walls, roofs, stairs and columns.
4. **Diff and risk.**
   * Each change is recorded as `{ id, kind, fields: [{ field, before, after }], dependent, outOfScope }`.
   * `requiresConfirmation` is set for:
     * destructive changes;
     * any edit outside the selection scope;
     * more than 25 changes.

## 4. AI pipeline

```
utterance ─┬─ LLM configured? ── /api/ai/command ── forced tool call `propose_scene_operations`
           │                                         └─ Zod parse → valid ops + reported invalid ops
           └─ otherwise ───────── built-in interpreter (EN/SV rules) → ops
ops → client dry-run (applyOperations) → auto-apply (simple, in scope) | preview card (Apply/Cancel/Refine)
```

**The context sent to the model (`buildAiContext`)** contains:

* the selected elements in full;
* related elements (host wall, sibling openings, containing room);
* levels and counts;
* the scene bounds;
* an index of up to 250 elements, with structure before furniture;
* the camera's plan vectors, so "left" and "right" mean the user's left and right.

**The system prompt** documents the element fields, the operation language, the material IDs, and these rules:

* never edit unselected objects;
* prefer relative operations;
* keep openings inside their wall;
* ask instead of guessing.

## 5. Drawing → 3D (`src/core/plan`, `src/client/editor/DrawingImport.tsx`)

1. **Load** the drawing:
   * images are downscaled to at most 1600 px;
   * PDFs are rendered from page 1 with pdf.js;
   * DXF `LINE`/`LWPOLYLINE`/`POLYLINE` entities are rasterised for display and kept as vectors, with units taken from `$INSUNITS`, which the user can override.
2. **Detect** walls and openings with one of three methods:
   * **Raster:** an Otsu threshold, then horizontal and vertical ink bands within a plausible thickness range become wall centre-lines. Collinear pieces are merged, and the gaps between them become openings: a window if there are glazing lines across the gap, otherwise a door. Joints are closed by extend-to-joint and endpoint welding. Walls on the outer boundary are marked exterior.
   * **DXF:** parallel, overlapping line pairs 6–60 cm apart become centre-line walls, with the measured thickness.
   * **Vision LLM:** returns walls, openings, rooms and readable dimension strings in pixel coordinates. The scale is only *suggested* from the dimensions (median estimate, with a confidence value).
3. **Calibrate.** Either:
   * pick two points and enter a known distance; or
   * accept the DXF units or the AI-suggested scale explicitly.

   Generation stays disabled until the scale is known.
4. **Review and correct** in the 2D editor. Low-confidence items are drawn dashed orange and counted as "need review".
5. **Generate.** `planToOperations` creates walls (with refs), hosted openings at their measured positions, a floor slab (the closed exterior loop, or the bounding box with a warning) and room zones. All of it is applied through the same operation engine and is undoable.

## 6. Persistence

* **Repository interface** (`src/server/storage/types.ts`) with two implementations:
  * **PostgreSQL** tables `projects` (JSONB scene and chat, thumbnail, share token), `project_versions` and `assets`. Migrations are idempotent, take an advisory lock, and run on the first request.
  * **File repository**, used when `DATABASE_URL` is unset.
* **Binary uploads** go through `ObjectStorage` (local filesystem by default).
* **The client autosaves** 1.5 s after a change. A save that races with newer edits keeps the project dirty.

## 7. Rendering modes

| Mode | Purpose |
| --- | --- |
| Modeling | Technical, untextured materials; grid, axes, room/area labels; fast interaction |
| Realistic | Procedural PBR textures, sun and hemisphere light, 4k soft shadows, procedural IBL (RoomEnvironment), N8AO, SMAA, gradient sky |
| Presentation | UI hidden; saved viewpoints with eased transitions; PNG stills at up to 4× pixel ratio |

| Photo | Progressive GPU path tracing of the current view (`src/client/three/photo.ts`): a clean copy of the building built with the same materials (refractive glass), the realistic sky rendered to an HDR equirect as image-based light, the sun as a directional light; downloadable PNG |

The three interactive modes are real-time rasterisation, which is interactive and approximate; Photo is the physically based still.
