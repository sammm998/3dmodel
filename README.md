# AI 3D Studio

AI 3D Studio is an AI-native architectural 3D modeller. You describe a building, speak to it, or import a floor plan, and it creates a **real, parametric 3D model**: walls, slabs, windows, doors, roofs, stairs, rooms and furniture. Each of these is a separate object with a persistent ID. When you click an object and ask for a change, the AI never redraws a picture. It produces **schema-validated operations**, and a deterministic geometry engine executes them.

> "Make this window 1.8 m wide and change its frame to black."
>
> → `{"op":"modify","id":"window_001","set":{"width":1.8}}` + `{"op":"set_material","ids":["window_001"],"slot":"frameMaterial","material":"aluminium_black"}`
>
> Only `window_001` changes. Its host wall's opening is re-cut, and the edit can be undone.

---

## Quick start

```bash
npm install
cp .env.example .env.local          # optional: DATABASE_URL, OPENAI_API_KEY / ANTHROPIC_API_KEY
npm run build && npm start          # http://localhost:3000   (or: npm run dev)
```

* **Without any configuration** the app runs fully:
  * projects are stored as JSON files in `./data`;
  * the assistant uses the built-in English/Swedish command interpreter.
* **PostgreSQL:** set `DATABASE_URL`. Tables are created automatically on first use, or run `npm run db:migrate`.
* **LLM:** set `OPENAI_API_KEY` (or any OpenAI-compatible `OPENAI_BASE_URL`) or `ANTHROPIC_API_KEY`. This enables:
  * free-form requests;
  * vision analysis of drawings;
  * server speech-to-text and text-to-speech.

  The UI always shows which interpreter answered.

### Tests

```bash
npm test               # 49 unit + integration tests (vitest)
npm run test:e2e       # Playwright end-to-end acceptance test (builds must exist: npm run build)
npm run typecheck && npm run lint
```

* **Export interoperability checks.** The integration tests also open the exported files in third-party tools when they are installed:
  * IFC in **IfcOpenShell** (`pip install ifcopenshell`);
  * GLB in **trimesh** (`pip install trimesh`).

  Every GLB is also checked with the Khronos **glTF Validator**.
* **E2E browser.** The end-to-end test runs Chromium with software WebGL (SwiftShader), so it needs no GPU. Set `PLAYWRIGHT_CHROMIUM_PATH` if your Chromium is not where Playwright expects it.

---

## What works (implemented and tested)

| Area | Status |
| --- | --- |
| **Typed scene schema** | 14 element types (Zod) with persistent ids (`wall_014`), levels, custom materials, saved views. BIM data is stored separately from geometry. Everything is in meters. |
| **Parametric geometry** | Walls with real cut openings, clean corner joins and separate interior/exterior finishes. Also windows (frames, mullions, sashes, glazing), doors (hinged, double, sliding, sliding glass, garage), polygon slabs, roofs (flat with parapet, gable with gable infill, hip, shed), skylights placed on the roof slope, stairs, columns, beams, pools, terrain with pool cut-outs, and 23 parametric furniture types. All of it is generated deterministically from parameters. Textures use world-scale UVs. |
| **Prompt → building** | Text becomes a validated `BuildingProgram`, which a deterministic generator turns into rectilinear rooms, partitions, slabs, doors, windows, stairs, roofs, furniture, terrace, pool and terrain. Supports multi-block layouts (e.g. house + garage), multiple storeys, and automatic room layout from bedroom/bathroom counts. |
| **Click-to-edit** | Real raycast picking, edge-outline highlight, name and dimension labels, a properties inspector, and multi-select (Shift). Selection context is sent to the AI. Edits outside the selection are flagged and need confirmation. |
| **Operations engine** | `create` / `modify` (set, scale, add, translate, move along host, move normal, rotate) / `delete` / `delete_where` / `replace` / `set_material` / `define_material` / `set_level` / `add_level` / `generate_building` / `group`. Runs are transactional, validated, and produce diffs and a risk classification.<br>**Dependent updates:**<ul><li>joined walls stretch;</li><li>hosted openings follow their wall;</li><li>deleting a host cascades to its openings;</li><li>changing level height updates walls, roofs and stairs.</li></ul> |
| **AI change preview** | Shows the list of changes with before → after per field, dependent updates, warnings, destructive and out-of-scope tags, and **Apply / Cancel / Refine** buttons. Simple in-scope edits can auto-apply with Undo (configurable). |
| **AI providers** | Provider-agnostic (OpenAI chat-completions or any compatible endpoint, Anthropic Messages). Uses forced tool calling with a JSON schema generated from the same Zod schemas. Invalid operations are dropped and reported. Model output is never executed as code. |
| **Built-in interpreter** | Deterministic English/Swedish parser for common modelling commands (dimensions, percentages, "by 50 cm", move left/right relative to the camera, materials and colours by slot, roof pitch/type, skylights, door types, replace, delete, furniture removal per room, ceiling height with proportional windows, add windows/doors/furniture). If a request is ambiguous it asks instead of guessing. |
| **Voice** | Push-to-talk using the Web Speech API (sv-SE / en-US). Server STT (OpenAI transcription) when configured. Spoken replies through browser speech synthesis. Permission and error handling. |
| **Drawing → 3D** | Accepts PNG/JPG/WebP, PDF (first page via pdf.js) and DXF. Includes:<ul><li>**two-point scale calibration** (dimensions are never guessed);</li><li>local CV wall detection (thick-line bands, gaps classified as door or window) and DXF parallel-line-pair detection;</li><li>optional vision-LLM analysis that also reads dimension strings and suggests a scale, which you must confirm;</li><li>low-confidence items shown dashed and listed for review;</li><li>a 2D editor to draw, select, drag endpoints, delete, add openings and label rooms;</li><li>generation into a replaced scene, the active level, or a new level.</li></ul> |
| **Rendering** | **Modeling** mode: technical materials, grid, room/area labels, dimensions.<br>**Realistic** mode: procedural PBR textures (oak, walnut, brick, concrete, marble, tiles, plaster, metal, …), sun with soft shadows, IBL reflections, N8AO ambient occlusion, SMAA.<br>**Presentation** mode: clean UI, saved viewpoints with animated transitions, high-resolution stills, and a **progressive GPU path tracer** (global illumination and true glass). |
| **Viewport** | Orbit, pan and zoom; perspective/orthographic; 3D, top, front and side presets; WASD walkthrough with pointer lock; move/rotate/resize gizmos with grid and angle snapping that commit validated, undoable operations; vertex-snapping measure tool; fullscreen. |
| **Projects** | Dashboard with four parametric starter projects, create/rename/delete, autosave (debounced, with retry), thumbnails, undo/redo (150 steps), named versions with restore, read-only share links, uploaded drawings kept in object storage. |
| **Export** | **GLB** (textured or lightweight; one named node per element with `extras.elementId`), **OBJ + MTL**, **STL** (m or mm), **IFC4**, **DXF** plans, **PNG**. Server-side export endpoint: `GET /api/projects/:id/export?format=glb|obj|mtl|stl|ifc|dxf`. |

### Verified end-to-end acceptance test

`tests/e2e/acceptance.spec.ts` runs the required workflow in a real browser against the production build:

1. create a project;
2. prompt "6 m × 4 m × 2.7 m room with a door and two windows";
3. assert 4 walls, a floor slab, 1 door and 2 windows exist as rendered Three.js objects;
4. orbit with the mouse;
5. click a window, which is selected by raycasting;
6. "Make this window 1.8m wide and change its frame to black";
7. assert width 1.8 and frame `aluminium_black`, and that the other window is byte-for-byte unchanged;
8. undo;
9. save;
10. reload and assert the same geometry;
11. export a GLB, validate it with the Khronos glTF Validator, and load it in trimesh.

---

## Honest limitations

* **The LLM path was not exercised against a live provider in this environment.** The configured key was rejected. Provider code is covered by integration tests with a mocked HTTP endpoint, and the UI falls back to the built-in interpreter with a visible notice. Model quality depends on the model you configure.
* **Drawing recognition is assistive, not automatic CAD conversion:**
  * The local detector expects CAD-like plans with thick wall lines.
  * Hand sketches, scanned blueprints and curved walls need AI analysis and/or manual tracing.
  * Text labels are only read by the vision model; there is no local OCR.
  * Only rectilinear room enclosures become room zones automatically.
  * Elevations and sections can be traced as plans but are not interpreted as such.
* **IFC export simplifications:**
  * Walls, slabs, columns and spaces are true extrusions, and openings are real IfcOpeningElements.
  * Roofs, stairs, beams, windows, doors and furniture use tessellated bodies.
  * Wall joins are geometric overlaps, not `IfcRelConnectsPathElements`.
* **Other export formats:**
  * DXF dimensions are lines plus text, not associative DIMENSION entities.
  * OBJ has no textures.
  * STL has no materials.
* **Walls and roofs:**
  * Walls are straight segments; there are no arcs or splines.
  * Joins extend centre-lines, which is good for L and T junctions but has no mitering for acute angles.
  * Skylights sit on the roof surface without cutting it.
* **Rendering:**
  * Realistic mode is a real-time rasterizer (approximate GI via AO and IBL).
  * The path tracer is the "final render" option. It runs in the browser on the user's GPU and converges over seconds to minutes.
  * There is no Blender/Cycles server pipeline.
* **Not implemented yet:**
  * multi-user accounts and authentication (share links are capability URLs);
  * real-time collaboration;
  * external text-to-3D / image-to-3D providers;
  * DWG import.

---

## Architecture

```
src/
  core/                     Pure TypeScript, shared by browser and server, fully unit-tested
    schema/                 Zod scene schema, units
    materials/library.ts    PBR material definitions (+ EN/SV keywords)
    geometry/               2D math, rectilinear cell decomposition, three.js builders (build3d.ts)
    scene/                  queries (anchors, dimensions, joins, rooms), element factory/defaults
    ops/                    operation schema, transactional engine (apply.ts), scene validation
    generator/              BuildingProgram schema, deterministic generator, furniture presets, starters
    ai/                     built-in interpreter, compact AI context builder
    plan/                   floor-plan model, calibration, raster/DXF/AI detection → operations
    export/                 GLB/OBJ/STL (meshExport), IFC4 (ifc.ts), DXF (dxf.ts)
  server/                   Next.js route-handler backend
    storage/                Repository interface: PostgreSQL (pg + SQL migrations) | JSON files; object storage
    ai/                     provider-agnostic LLM client (OpenAI / Anthropic), orchestrator, STT/TTS
  client/                   React UI
    store/editor.ts         Zustand store: scene, snapshot undo/redo, selection, modes, chat, proposals
    three/                  R3F viewport, scene objects, materials (procedural textures), gizmo, path tracer
    editor/                 Editor shell, sidebars, inspector, assistant, drawing import, dialogs
    ai/                     assistant flow (LLM → fallback → dry-run → apply/preview), voice input
  app/                      Next.js App Router pages + REST API
tests/                      unit, integration (exports validated by external tools), e2e (Playwright)
```

**Request flow for an AI edit**

1. The user selects objects and types or speaks.
2. The client builds a compact context: the selected elements in full, their neighbours (host wall, sibling openings, room), the levels, and an index of the rest of the scene.
3. The request goes to `/api/ai/command`. The LLM must call `propose_scene_operations`, and the arguments are validated with Zod. If no LLM is configured, the built-in interpreter runs locally instead.
4. The client **dry-runs** the operations with `applyOperations` against the current scene. This gives validation, a diff, and the risk and scope classification.
5. Simple edits are applied immediately. Anything destructive, outside the selection, or large shows a preview card.
6. Applying commits a new immutable scene snapshot, so undo is exact. Autosave persists the scene as JSON data.

### Technology decisions

* **TypeScript geometry and orchestration instead of a separate Python FastAPI service.**
  * The scene schema, operation engine and geometry builders must run identically in the browser (instant previews, offline undo, picking) and on the server (validation, export API).
  * One implementation avoids drift between two languages, and the whole engine is unit-testable in Node.
  * Python is used where it adds value: the test suite verifies IFC with IfcOpenShell and GLB with trimesh.
* **`pg` with SQL migrations instead of Prisma.** Fewer moving parts and no binary engine download. Scenes are stored as JSONB.
* **No Redis or job queue.** Every long operation (LLM calls, analysis) is request-scoped, and rendering happens on the client. A queue becomes necessary if a server-side render farm is added.
* **Local object storage** behind an interface (`ObjectStorage`). An S3 adapter is a drop-in.
* **shadcn/ui-style components** written directly on Radix primitives, the same approach as the shadcn CLI, kept in `src/client/ui`.
* **In-browser path tracing instead of Blender.** It can be verified here, works on the user's GPU, and needs no server infrastructure. A Blender pipeline can consume the GLB export.

See `docs/ARCHITECTURE.md` for the schema, the operation language and the drawing pipeline in detail.
