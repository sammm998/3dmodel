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

### Deploying (e.g. Railway)

* **Start command:** `npm start`, which listens on `$PORT`. `railway.json` already configures the build, the start command and a health check on `/api/health`.
* **No external database is needed.** Without `DATABASE_URL`, projects are stored as files.
  * On Railway, add a **Volume** with mount path `/app/data` (or set `DATA_DIR`) so projects survive redeploys.
  * Without a volume, the home page warns that projects are lost on each redeploy.
* **Optional PostgreSQL.** In Railway, use *New → Database → PostgreSQL* and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the app service. Do not use the `localhost` value from `.env.example`.
* **If `DATABASE_URL` is set but unreachable,** the app falls back to file storage instead of failing. The reason is shown on the dashboard and in `/api/health`.

### Accounts, plans and payments

* **Accounts.** Email + password (scrypt hashes, HttpOnly session cookie, rate-limited sign-in). Every project belongs to one account; the studio (`/app`, `/project/*`, `/account`) requires signing in, share links stay public and read-only. Projects created before accounts existed are given to the **first account** that signs up. Users can delete their account and all data from `/account`.
* **Plans** are defined in `src/core/billing/plans.ts` (Free / Pro / Studio, EUR). The server enforces them: project count, monthly AI requests (LLM commands, AI drawing recognition, server speech-to-text) and IFC/DXF export. Edits handled by the built-in interpreter are unlimited.
* **Admins.** `ADMIN_EMAILS=you@example.com` gives those accounts the Studio plan without paying.
* **Stripe (optional until you charge).** Without Stripe keys the pricing page works and upgrades are disabled with a notice. To take payments:
  1. In Stripe, create the products **Pro** and **Studio**, each with a monthly and a yearly recurring price matching `plans.ts`. Put the four price ids in `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_STUDIO_MONTHLY` and `STRIPE_PRICE_STUDIO_YEARLY`.
  2. Set `STRIPE_SECRET_KEY`.
  3. Add a webhook endpoint `https://<your-domain>/api/billing/webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
  4. Enable the **Customer Portal** (Settings → Billing → Customer portal) so customers can switch plans, update cards, see invoices and cancel.
* **Before launch:** set `APP_URL`, `COMPANY_NAME`, `CONTACT_EMAIL` (footer and legal pages), review `/terms` and `/privacy` with your own legal details, and use PostgreSQL or a Railway volume so accounts and projects persist.

### Tests

```bash
npm test               # unit + integration tests (vitest); add TEST_DATABASE_URL to also run the account tests against PostgreSQL
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

* **Website and accounts.** Landing page, pricing (Free / Pro / Studio with monthly/yearly billing), sign-up and sign-in, a projects dashboard with plan usage, an account page (plan, usage, Stripe billing portal, account deletion), terms and privacy pages. Plan limits are enforced on the server.

| Area | Status |
| --- | --- |
| **Typed scene schema** | 14 element types (Zod) with persistent ids (`wall_014`), levels, custom materials, saved views. BIM data is stored separately from geometry. Everything is in meters. |
| **Parametric geometry** | Walls with real cut openings, clean corner joins and separate interior/exterior finishes. Also windows (frames, mullions, sashes, glazing), doors (hinged, double, sliding, sliding glass, garage), polygon slabs, roofs (flat with parapet, gable with gable infill, hip, shed), skylights placed on the roof slope, stairs, columns, beams, pools, terrain with pool cut-outs, and 23 parametric furniture types. All of it is generated deterministically from parameters. Textures use world-scale UVs. |
| **Prompt → building** | Text becomes a validated `BuildingProgram`, which a deterministic generator turns into rectilinear rooms, partitions, slabs, doors, windows, stairs, roofs, furniture, terrace, pool and terrain. Supports multi-block layouts (e.g. house + garage), multiple storeys, and automatic room layout from bedroom/bathroom counts. |
| **Click-to-edit** | Real raycast picking, edge-outline highlight, name and dimension labels, a properties inspector, and multi-select (Shift). Selection context is sent to the AI. Edits outside the selection are flagged and need confirmation. |
| **Operations engine** | `create` / `modify` (set, scale, add, translate, move along host, move normal, rotate) / `delete` / `delete_where` / `replace` / `set_material` / `define_material` / `set_level` / `add_level` / `generate_building` / `group`. Runs are transactional, validated, and produce diffs and a risk classification.<br>**Dependent updates:**<ul><li>joined walls stretch;</li><li>hosted openings follow their wall;</li><li>deleting a host cascades to its openings;</li><li>changing level height updates walls, roofs and stairs.</li></ul> |
| **AI change preview** | Shows the list of changes with before → after per field, dependent updates, warnings, destructive and out-of-scope tags, and **Apply / Cancel / Refine** buttons. Simple in-scope edits can auto-apply with Undo (configurable). |
| **AI providers** | Provider-agnostic (OpenAI chat-completions or any compatible endpoint; Anthropic via the official SDK, default `claude-opus-5-5`, with server-side refusal fallback). Uses tool calling with a JSON schema generated from the same Zod schemas. Invalid operations are dropped and reported. Model output is never executed as code. |
| **Built-in interpreter** | Deterministic English/Swedish parser for common modelling commands (dimensions, percentages, "by 50 cm", move left/right relative to the camera, materials and colours by slot, roof pitch/type, skylights, door types, replace, delete, furniture removal per room, ceiling height with proportional windows, add windows/doors/furniture). If a request is ambiguous it asks instead of guessing. |
| **Voice** | Push-to-talk using the Web Speech API (sv-SE / en-US). Server STT (OpenAI transcription) when configured. Spoken replies through browser speech synthesis. Permission and error handling. |
| **Drawing → 3D** | Accepts PNG/JPG/WebP, PDF (first page via pdf.js) and DXF. Includes:<ul><li>**two-point scale calibration** (dimensions are never guessed);</li><li>local CV wall detection (thick-line bands, gaps classified as door or window) and DXF parallel-line-pair detection;</li><li>optional vision-LLM analysis that also reads dimension strings and suggests a scale, which you must confirm;</li><li>low-confidence items shown dashed and listed for review;</li><li>a 2D editor to draw, select, drag endpoints, delete, add openings and label rooms;</li><li>generation into a replaced scene, the active level, or a new level.</li></ul> |
| **Rendering** | **Modeling** mode: technical materials, grid, room/area labels, dimensions.<br>**Realistic** mode: procedural PBR textures (oak, walnut, brick, concrete, marble, tiles, plaster, metal, …), sun with soft shadows, IBL reflections, N8AO ambient occlusion, SMAA.<br>**Presentation** mode: clean UI, saved viewpoints with animated transitions, and high-resolution PNG stills (up to 4× pixel ratio). |
| **Viewport** | Orbit, pan and zoom; perspective/orthographic; 3D, top, front and side presets; **Walk inside** first-person mode (pointer-lock mouse look, WASD, Shift to run, Space to jump, E/Q between storeys, F to fly, collision against walls/glazing/furniture, gravity onto floors and stairs, frame-rate independent physics); smooth animated camera transitions and adaptive render quality; move/rotate/resize gizmos with grid and angle snapping that commit validated, undoable operations; vertex-snapping measure tool; fullscreen. |
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
  * Realistic and Presentation modes are a real-time rasterizer: PBR, shadows, IBL and AO, so global illumination is approximate.
  * **Photo** (top bar) path traces the current view in the browser (three-gpu-pathtracer 0.0.27 on three r186): light bounces, soft shadows, reflections and refractive glass. It converges over a few seconds to minutes depending on the GPU; there is no denoiser yet, so stop early for a slightly grainy draft.
  * Materials use photographed, CC0 PBR scans from [Poly Haven](https://polyhaven.com) (wood floors, decking, plaster, concrete, brick, marble, linen, leather, lawn, gravel). The server fetches them through Poly Haven's public API, caches them in `DATA_DIR/texture-cache` and serves them same-origin (`/api/textures/:asset/:map`); the browser tints each scan to the material's colour. If the server cannot reach Poly Haven the procedural textures are used instead. The interface shows the required "powered by Poly Haven" credit.
  * Sites get trees and shrubs (planted clear of the house, terrace, pool and entrance); furniture is parametric, so a scanned digital twin of a real building will still look more "lived in".
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
    three/                  R3F viewport, scene objects, materials (procedural textures), gizmo, lighting
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
* **Path tracing in the browser** for photos (no render farm). A server-side Blender/Cycles job fed by the GLB export remains an option for very large images.

See `docs/ARCHITECTURE.md` for the schema, the operation language and the drawing pipeline in detail.
