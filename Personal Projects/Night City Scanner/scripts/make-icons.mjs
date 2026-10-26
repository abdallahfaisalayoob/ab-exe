// Renders public/icons/icon.svg into the PNG icons and iOS launch images.
// Uses Playwright's Chromium; run with `npm run icons` after editing the SVG.
// Set PLAYWRIGHT_PATH to use a Playwright install outside this project.
const pw = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icons/icon.svg'), 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const icons = [
  ['icons/icon-192.png', 192, 1],
  ['icons/icon-512.png', 512, 1],
  ['icons/apple-touch-icon.png', 180, 1],
  // Maskable: keep artwork inside the 80% safe zone.
  ['icons/icon-maskable-512.png', 512, 0.8],
];
const splashes = [
  [1206, 2622],
  [1320, 2868],
  [1179, 2556],
  [1290, 2796],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [out, size, scale] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#07080c;display:grid;place-items:center;height:100vh">
    <img src="${dataUrl}" style="width:${size * scale}px;height:${size * scale}px"></body></html>`);
  writeFileSync(join(root, 'public', out), await page.screenshot({ type: 'png' }));
}
for (const [w, h] of splashes) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;height:100vh;display:grid;place-items:center;
    background: radial-gradient(120% 60% at 50% 110%, rgba(255,42,109,.18), transparent 60%), radial-gradient(90% 50% at 50% -10%, rgba(45,226,230,.14), transparent 60%), #07080c;">
    <div style="text-align:center;font:600 ${Math.round(w / 26)}px ui-monospace,monospace;letter-spacing:.3em;color:#eef3f8">
      <img src="${dataUrl}" style="width:${Math.round(w / 3.2)}px;border-radius:${Math.round(w / 14)}px;display:block;margin:0 auto ${Math.round(w / 16)}px">
      NIGHT CITY<br><span style="color:#2de2e6;font-size:.6em;letter-spacing:.6em">SCANNER</span>
    </div></body></html>`);
  writeFileSync(join(root, 'public', `splash/splash-${w}x${h}.png`), await page.screenshot({ type: 'png' }));
}
await browser.close();
console.log('icons and launch images written');
