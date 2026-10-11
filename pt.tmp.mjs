import { chromium } from '@playwright/test';
const S = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => { if (logs.length < 3) logs.push(`pageerror: ${e.stack}`); });
page.on('console', (m) => { if (m.type() === 'error' && logs.length < 6) logs.push(`console: ${m.text()}`); });
const r = await (await fetch('http://localhost:3000/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'PT', starterId: 'scandinavian-villa' }) })).json();
await page.goto(`http://localhost:3000/project/${r.project.id}`);
await page.waitForTimeout(6000);
await page.getByTestId('pathtrace').click();
for (let i = 0; i < 12; i++) { await page.waitForTimeout(10000); const n = await page.evaluate(() => window.__AI3D__.getState().pathTraceSamples); console.log('spp', n); if (n >= 12) break; }
await page.screenshot({ path: `${S}/pathtrace.png` });
console.log(logs.join('\n'));
await browser.close();
