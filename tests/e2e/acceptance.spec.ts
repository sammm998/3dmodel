/**
 * Required end-to-end acceptance test (spec §17), run against the real app
 * in Chromium with WebGL: create project → prompt-to-scene → orbit →
 * click-select a window → AI edit → other windows unchanged → undo → save →
 * reload → export a GLB and validate it with the Khronos glTF validator.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// @ts-expect-error no types shipped
import validator from 'gltf-validator';

type El = { id: string; type: string; width?: number; frameMaterial?: string; hostId?: string };
const state = (page: Page) => page.evaluate(() => (window as any).__AI3D__.getState().scene.elements as El[]);
const ofType = (els: El[], t: string) => els.filter((e) => e.type === t);

test('acceptance: prompt → select window → edit → undo → save → reload → GLB', async ({ page }) => {
  // 0. The studio requires an account: signed-out visitors are sent to sign in.
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);

  // 1. Landing page → create an account → dashboard
  await page.goto('/');
  await page.getByTestId('hero-cta').click();
  await expect(page).toHaveURL(/\/signup/);
  await page.locator('input[name=name]').fill('Acceptance Tester');
  await page.locator('input[name=email]').fill(`acceptance-${Date.now()}@example.com`);
  await page.locator('input[name=password]').fill('acceptance-pass-1');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL(/\/app$/);
  await expect(page.getByTestId('usage-card')).toBeVisible();

  // 2. Create a project
  await page.getByTestId('new-blank').click();
  await page.waitForURL(/\/project\//);
  const projectUrl = page.url();
  await page.waitForFunction(() => (window as any).__AI3D__?.getState().projectId);

  // 3. Prompt
  const prompt = 'Create a rectangular room that is 6m long, 4m wide, and 2.7m high, with a door and two windows.';
  await page.getByTestId('prompt-input').fill(prompt);
  await page.getByTestId('send').click();

  // 4. Real editable elements exist in the scene and are rendered as Three.js objects
  await expect.poll(async () => ofType(await state(page), 'wall').length).toBe(4);
  let els = await state(page);
  expect(ofType(els, 'window')).toHaveLength(2);
  expect(ofType(els, 'door')).toHaveLength(1);
  expect(ofType(els, 'slab')).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => (window as any).__AI3D__.registeredCount())).toBeGreaterThanOrEqual(8);
  await page.screenshot({ path: 'test-results/acceptance-1-generated.png' });

  // 5. Orbit the camera with the mouse
  const canvas = page.locator('[data-testid="viewport"] canvas');
  const box = (await canvas.boundingBox())!;
  const camBefore = await page.evaluate(() => (window as any).__AI3D__.cameraPosition());
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.32, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const camAfter = await page.evaluate(() => (window as any).__AI3D__.cameraPosition());
  expect(Math.hypot(camAfter[0] - camBefore[0], camAfter[2] - camBefore[2])).toBeGreaterThan(0.5);

  // 6. Click one window in the viewport (real raycast picking)
  const windows = ofType(els, 'window');
  let target: El | null = null;
  for (const w of windows) {
    const p = await page.evaluate((id) => (window as any).__AI3D__.projectElement(id), w.id);
    const hit = await page.evaluate(([x, y]) => (window as any).__AI3D__.pickAt(x, y), [p.x, p.y]);
    if (hit === w.id) {
      await page.mouse.click(p.x, p.y);
      target = w;
      break;
    }
  }
  expect(target, 'a window must be visible and clickable').not.toBeNull();
  await expect.poll(() => page.evaluate(() => (window as any).__AI3D__.getState().selection)).toEqual([target!.id]);
  await expect(page.getByTestId('selection-context')).toContainText('Window');
  const other = windows.find((w) => w.id !== target!.id)!;

  // 7. Edit the selected window through the assistant
  await page.getByTestId('prompt-input').fill('Make this window 1.8m wide and change its frame to black.');
  await page.getByTestId('send').click();

  // 8. The selected window changed
  await expect.poll(async () => (await state(page)).find((e) => e.id === target!.id)?.width).toBe(1.8);
  els = await state(page);
  expect(els.find((e) => e.id === target!.id)?.frameMaterial).toBe('aluminium_black');
  // 9. The other window is unchanged
  expect(els.find((e) => e.id === other.id)).toEqual(other);
  await page.screenshot({ path: 'test-results/acceptance-2-edited.png' });

  // 10. Undo
  await page.getByTestId('undo').click();
  await expect.poll(async () => (await state(page)).find((e) => e.id === target!.id)?.width).toBe(1.2);

  // 11. Save
  await page.getByTestId('save-button').click();
  await expect.poll(() => page.evaluate(() => (window as any).__AI3D__.getState().dirty)).toBe(false);
  const savedIds = (await state(page)).map((e) => e.id).sort();

  // 12. Reload and see the saved geometry
  await page.goto(projectUrl);
  await page.waitForFunction(() => (window as any).__AI3D__?.getState().projectId);
  await expect.poll(async () => (await state(page)).map((e) => e.id).sort()).toEqual(savedIds);
  await expect.poll(() => page.evaluate(() => (window as any).__AI3D__.registeredCount())).toBeGreaterThanOrEqual(8);
  expect((await state(page)).find((e) => e.id === target!.id)?.width).toBe(1.2);
  await page.screenshot({ path: 'test-results/acceptance-3-reloaded.png' });

  // 13. Export a real GLB
  await page.getByTestId('export-button').click();
  await page.getByTestId('format-glb').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('do-export').click()]);
  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  const file = 'test-results/acceptance-export.glb';
  await download.saveAs(file);
  const bytes = new Uint8Array(readFileSync(file));
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('glTF');

  // 14. The file is a valid glTF 2.0 asset that other tools can open
  const report = await validator.validateBytes(bytes);
  expect(report.issues.numErrors).toBe(0);
  const jsonLen = new DataView(bytes.buffer).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLen)));
  expect(json.nodes.some((n: { name?: string }) => n.name?.includes(`[${target!.id}]`))).toBe(true);
  try {
    const out = execFileSync('python3', ['-c', 'import sys,trimesh; s=trimesh.load(sys.argv[1]); print(len(s.geometry))', file]).toString();
    expect(Number(out.trim())).toBeGreaterThan(5);
  } catch (e) {
    if (!String(e).includes('No module named')) throw e;
  }
});
