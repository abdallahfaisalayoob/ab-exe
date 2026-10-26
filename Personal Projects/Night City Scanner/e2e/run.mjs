/**
 * End-to-end test of the production build in headless Chromium, emulating an
 * iPhone 16 Pro viewport (402×874 @3x, touch). Chromium is not iOS Safari:
 * this verifies application logic and rendering, not Safari-specific
 * behaviour (see README › Real-device checklist).
 *
 *   npm run build && npm run test:e2e
 *
 * Needs Playwright with Chromium. If Playwright is installed elsewhere, set
 * PLAYWRIGHT_PATH to its index.js. Screenshots go to e2e/output/.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'e2e', 'output');
mkdirSync(out, { recursive: true });
const pwModule = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const { chromium } = pwModule.chromium ? pwModule : pwModule.default;

const PORT = 4179;
const URL_ = `http://localhost:${PORT}/`;
const PIN = '480315';
let failures = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/* ---------------- server ---------------- */
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), resolve()));
});

const browserBase = await chromium.launch();

/* ---------------- fixtures (drawn in a real canvas) ---------------- */
// Paper corners in the 1200×1600 "photo" (TL, TR, BR, BL).
const CORNERS = [
  [230, 250],
  [1010, 300],
  [1065, 1390],
  [165, 1335],
];

async function makeFixtures() {
  const page = await browserBase.newPage();
  const res = await page.evaluate(async (corners) => {
    // 1) the flat document
    const doc = document.createElement('canvas');
    doc.width = 850;
    doc.height = 1100;
    const d = doc.getContext('2d');
    d.fillStyle = '#f7f5ef';
    d.fillRect(0, 0, 850, 1100);
    d.fillStyle = '#111';
    d.font = 'bold 64px Arial';
    d.fillText('INVOICE', 60, 130);
    d.font = '30px Arial';
    const lines = ['Invoice No: INV-20391', 'Date: 2026-03-14', 'Bill To: Night City Corp', 'Amount due: 2,077.00', 'Due date: 2026-04-14'];
    lines.forEach((l, i) => d.fillText(l, 60, 230 + i * 52));
    d.font = '24px Arial';
    for (let i = 0; i < 9; i++) d.fillText('Lorem ipsum dolor sit amet, consectetur adipiscing elit.', 60, 560 + i * 40);
    d.strokeStyle = '#1a2a8a';
    d.lineWidth = 3;
    d.beginPath();
    d.moveTo(520, 1000);
    d.bezierCurveTo(580, 940, 640, 1040, 760, 980);
    d.stroke();

    // 2) the "photo": dark desk + perspective-warped page via a triangle mesh
    const ph = document.createElement('canvas');
    ph.width = 1200;
    ph.height = 1600;
    const p = ph.getContext('2d');
    const g = p.createLinearGradient(0, 0, 1200, 1600);
    g.addColorStop(0, '#3a2a20');
    g.addColorStop(1, '#1d1410');
    p.fillStyle = g;
    p.fillRect(0, 0, 1200, 1600);
    for (let i = 0; i < 4000; i++) {
      p.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
      p.fillRect(Math.random() * 1200, Math.random() * 1600, 2, 2);
    }
    const bil = (u, v) => {
      const [a, b, c, e] = corners;
      const top = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      const bot = [e[0] + (c[0] - e[0]) * u, e[1] + (c[1] - e[1]) * u];
      return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
    };
    const N = 24;
    const tri = (s, dst) => {
      const [[x0, y0], [x1, y1], [x2, y2]] = s;
      const [[u0, v0], [u1, v1], [u2, v2]] = dst;
      const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
      const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den;
      const b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den;
      const c = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den;
      const dd = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
      const e = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
      const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
      p.save();
      p.beginPath();
      p.moveTo(u0, v0);
      p.lineTo(u1, v1);
      p.lineTo(u2, v2);
      p.closePath();
      p.lineWidth = 1.2;
      p.clip();
      p.setTransform(a, b, c, dd, e, f);
      p.drawImage(doc, 0, 0);
      p.restore();
    };
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const s = (x, y) => [(x / N) * 850, (y / N) * 1100];
        const q = (x, y) => bil(x / N, y / N);
        tri([s(i, j), s(i + 1, j), s(i, j + 1)], [q(i, j), q(i + 1, j), q(i, j + 1)]);
        tri([s(i + 1, j), s(i + 1, j + 1), s(i, j + 1)], [q(i + 1, j), q(i + 1, j + 1), q(i, j + 1)]);
      }
    // A soft shadow across the lower part of the page.
    const sh = p.createLinearGradient(0, 900, 0, 1500);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.35)');
    p.fillStyle = sh;
    p.fillRect(0, 900, 1200, 700);

    const photo = ph.toDataURL('image/jpeg', 0.92);

    // 3) one camera frame (960×1280, I420) for Chromium's fake webcam
    const fw = 960;
    const fh = 1280;
    const fc = document.createElement('canvas');
    fc.width = fw;
    fc.height = fh;
    const fctx = fc.getContext('2d');
    fctx.drawImage(ph, 0, 0, fw, fh);
    const px = fctx.getImageData(0, 0, fw, fh).data;
    const y = new Uint8Array(fw * fh);
    const uP = new Uint8Array((fw / 2) * (fh / 2));
    const vP = new Uint8Array((fw / 2) * (fh / 2));
    for (let j = 0; j < fh; j++)
      for (let i = 0; i < fw; i++) {
        const k = (j * fw + i) * 4;
        const r = px[k], gg = px[k + 1], b = px[k + 2];
        y[j * fw + i] = Math.max(0, Math.min(255, 0.257 * r + 0.504 * gg + 0.098 * b + 16));
        if (j % 2 === 0 && i % 2 === 0) {
          const ci = (j / 2) * (fw / 2) + i / 2;
          uP[ci] = Math.max(0, Math.min(255, -0.148 * r - 0.291 * gg + 0.439 * b + 128));
          vP[ci] = Math.max(0, Math.min(255, 0.439 * r - 0.368 * gg - 0.071 * b + 128));
        }
      }
    const frame = new Uint8Array(y.length + uP.length + vP.length);
    frame.set(y, 0);
    frame.set(uP, y.length);
    frame.set(vP, y.length + uP.length);
    let bin = '';
    for (let i = 0; i < frame.length; i += 0x8000) bin += String.fromCharCode(...frame.subarray(i, i + 0x8000));
    return { photo, frame: btoa(bin), fw, fh };
  }, CORNERS);
  await page.close();
  writeFileSync(join(out, 'fixture-photo.jpg'), Buffer.from(res.photo.split(',')[1], 'base64'));
  const frame = Buffer.from(res.frame, 'base64');
  const header = Buffer.from(`YUV4MPEG2 W${res.fw} H${res.fh} F15:1 Ip A1:1 C420jpeg\n`);
  const fh = Buffer.from('FRAME\n');
  const frames = [];
  for (let i = 0; i < 30; i++) frames.push(fh, frame);
  writeFileSync(join(out, 'fixture-camera.y4m'), Buffer.concat([header, ...frames]));
}
await makeFixtures();
await browserBase.close();

/* ---------------- the app ---------------- */
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${join(out, 'fixture-camera.y4m')}`,
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 402, height: 874 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
  permissions: ['camera'],
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const tapPin = async (pin) => {
  for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click();
};
// Hide (never remove) toasts before screenshots: React owns those nodes.
const dismissToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => (t.style.display = 'none')));

async function dbDump() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('night-city-scanner');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['meta', 'docs', 'blobs'], 'readonly');
          const all = [];
          let pending = 3;
          for (const s of ['meta', 'docs', 'blobs']) {
            tx.objectStore(s).getAll().onsuccess = (e) => {
              all.push(...e.target.result);
              if (--pending === 0) {
                const dec = new TextDecoder('latin1');
                const text = all
                  .map((r) => JSON.stringify(r, (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? dec.decode(v) : v)))
                  .join('\n');
                db.close();
                resolve({ text, count: all.length });
              }
            };
          }
        };
      }),
  );
}

try {
  /* 1. First-run passcode setup */
  await page.goto(URL_);
  await page.getByText('Secure your scanner').waitFor();
  await shot('01-setup');
  check('first run shows passcode setup', true);
  await page.getByRole('button', { name: /Create passcode/ }).click({ trial: true }).catch(() => {});
  check('create is disabled until the warning is acknowledged', await page.getByRole('button', { name: /Create passcode/ }).isDisabled());
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Create passcode/ }).click();
  await tapPin('123456');
  await page.getByRole('button', { name: 'Next' }).click();
  check('weak passcode rejected', await page.getByText(/simple sequences/).isVisible());
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Delete last digit' }).click();
  await tapPin(PIN);
  await page.getByRole('button', { name: 'Next' }).click();
  await tapPin('480316');
  await page.getByRole('button', { name: 'Save' }).click();
  check('mismatched confirmation rejected', await page.getByText(/don’t match/).isVisible());
  await tapPin(PIN);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Scan document').waitFor({ timeout: 20000 });
  await dismissToasts();
  await shot('02-home-empty');
  check('setup unlocks into the home screen', true);
  const meta = await dbDump();
  check('passcode is not stored in plaintext', !meta.text.includes(PIN));

  /* 2. Import a photo of a document: detection + flattening */
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import' }).click();
  await (await chooser).setFiles(join(out, 'fixture-photo.jpg'));
  await page.getByText('Review scan').waitFor({ timeout: 30000 });
  await page.locator('.thumb img').first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.thumb__state'), null, { timeout: 60000 });
  await dismissToasts();
  await shot('03-review-imported');
  check('imported photo becomes a processed page', (await page.locator('.page-tile').count()) === 1);

  // Corner editor: read the detected handle positions from the DOM.
  await page.locator('.page-tile__btn').first().click();
  await shot('04-page-actions');
  await page.getByRole('button', { name: /Crop & filter/ }).click();
  await page.locator('.handle').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await shot('05-corner-editor');
  const detected = await page.evaluate(() => {
    const box = document.querySelector('.corner-box');
    const w = box.clientWidth;
    const h = box.clientHeight;
    return [...document.querySelectorAll('.handle')].map((el) => [parseFloat(el.style.left) / w, parseFloat(el.style.top) / h]);
  });
  const expected = CORNERS.map(([x, y]) => [x / 1200, y / 1600]);
  const err = Math.max(...detected.map((p, i) => Math.hypot(p[0] - expected[i][0], p[1] - expected[i][1])));
  check('document corners detected within 2% of truth', err < 0.02, `max corner error ${(err * 100).toFixed(2)}%`);

  // Drag a corner, then check filter previews render.
  const handle = page.locator('.handle').first();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2 + 30, { steps: 5 });
  await shot('06-corner-drag-loupe');
  await page.mouse.up();
  const moved = await page.evaluate(() => parseFloat(document.querySelector('.handle').style.left));
  check('corner handle can be dragged', Math.abs(moved - (detected[0][0] * (await page.evaluate(() => document.querySelector('.corner-box').clientWidth)))) > 10);
  await page.getByRole('button', { name: 'Auto-detect' }).click();
  await page.getByRole('radio', { name: 'Filter' }).click();
  for (const f of ['Document Text', 'Black & White', 'Enhanced']) {
    await page.getByRole('radio', { name: f, exact: true }).click();
    await page.locator('.filter-preview img').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.filter-preview__busy'), null, { timeout: 20000 });
    await shot(`07-filter-${f.replace(/\W+/g, '-').toLowerCase()}`);
  }
  check('filter previews render', true);
  await page.getByRole('radio', { name: 'Document Text', exact: true }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByText('Review scan').waitFor();
  await page.waitForFunction(() => !document.querySelector('.thumb__state'), null, { timeout: 60000 });

  /* 3. OCR */
  await page.getByRole('button', { name: 'Recognize text' }).click();
  await page.getByText('Recognized text', { exact: true }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(300);
  await dismissToasts();
  await shot('08-ocr');
  const ocrText = await page.locator('.ocr-text').innerText();
  check('OCR reads the document, including the heading', /INVOICE/.test(ocrText) && /INV-?20391/.test(ocrText), JSON.stringify(ocrText.slice(0, 80)));
  check('OCR suggests a category from keywords', await page.getByText(/Looks like:/).isVisible());
  await page.getByRole('button', { name: 'Use' }).first().click();
  await page.getByRole('button', { name: 'Close' }).click();

  /* 4. Rename + PDF export (download fallback on desktop Chromium) */
  await page.getByRole('button', { name: /^Rename/ }).click();
  await page.getByRole('textbox', { name: 'Document name' }).fill('Arasaka Invoice');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Rename Arasaka Invoice/ }).waitFor();
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('button', { name: 'Create PDF' }).click();
  await page.getByRole('button', { name: 'Download' }).waitFor({ timeout: 30000 });
  await shot('09-export-ready');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await dl;
  const pdfPath = join(out, 'export.pdf');
  await download.saveAs(pdfPath);
  const pdfBytes = readFileSync(pdfPath);
  check('exported file name comes from the document title', download.suggestedFilename() === 'Arasaka Invoice.pdf', download.suggestedFilename());
  const pdf = await PDFDocument.load(pdfBytes);
  check('export is a real 1-page PDF', pdf.getPageCount() === 1);
  const text = await (await (await getDocument({ data: new Uint8Array(pdfBytes) }).promise).getPage(1)).getTextContent();
  const pdfText = text.items.map((i) => i.str).join(' ');
  check('PDF is searchable (OCR text layer)', /INVOICE/i.test(pdfText));
  // Every word in the PDF's text must come from OCR: nothing (watermark, footer, branding) is added.
  const ocrWords = new Set(ocrText.split(/\s+/).filter(Boolean));
  const extra = pdfText.split(/\s+/).filter((w) => w && !ocrWords.has(w));
  check('PDF contains no text beyond the OCR layer (no watermark)', extra.length === 0, extra.slice(0, 5).join(' '));

  await page.getByRole('button', { name: 'Preview' }).click();
  await page.locator('.preview__page img').first().waitFor({ timeout: 20000 });
  await shot('10-pdf-preview');
  await page.getByRole('button', { name: 'Close preview' }).click();

  // Password-protected export
  await page.getByRole('switch', { name: 'Password-protect' }).click();
  await page.getByLabel('PDF password', { exact: true }).fill('choomba-2077');
  await page.getByLabel('Confirm password').fill('choomba-2077');
  await page.getByRole('button', { name: 'Create PDF' }).click();
  await page.getByRole('button', { name: 'Download' }).waitFor({ timeout: 30000 });
  const dl2 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const enc = readFileSync(await (await dl2).path());
  let encrypted = false;
  try {
    await PDFDocument.load(enc);
  } catch (e) {
    encrypted = /encrypted/i.test(e.message);
  }
  let opens = false;
  try {
    await getDocument({ data: new Uint8Array(enc), password: 'choomba-2077' }).promise;
    opens = true;
  } catch {
    /* */
  }
  let wrongFails = false;
  try {
    await getDocument({ data: new Uint8Array(enc), password: 'nope' }).promise;
  } catch {
    wrongFails = true;
  }
  check('password-protected PDF is encrypted (AES-256 via qpdf)', encrypted && enc.includes(Buffer.from('/V 5')));
  check('encrypted PDF opens with its password only', opens && wrongFails);
  await page.getByRole('button', { name: 'Close' }).click();
  // Exporting saved the draft; go back home.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByText('Scan document').waitFor();

  /* 5. Camera: live detection + auto-capture, no duplicate captures */
  await page.getByRole('button', { name: /Scan document/ }).click();
  await page.locator('.camera__video').waitFor();
  await page.locator('.camera__quad').waitFor({ timeout: 30000 });
  await shot('11-camera-detecting');
  await page.locator('.camera__count').waitFor({ timeout: 30000 });
  check('auto-capture fires on a steady document', true);
  await page.waitForTimeout(5000);
  const count = await page.locator('.camera__count').innerText();
  check('a steady page is not captured twice', count.trim() === '1', `count=${count}`);
  await page.getByRole('radio', { name: 'Manual' }).click();
  await page.getByRole('button', { name: 'Capture page' }).click();
  await page.waitForFunction(() => document.querySelector('.camera__count')?.textContent === '2', null, { timeout: 10000 });
  check('manual capture adds a page', true);
  await page.waitForFunction(() => !document.querySelector('.camera__stack-busy'), null, { timeout: 60000 });
  await shot('12-camera-captured');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByText('Review scan').waitFor();
  await page.waitForFunction(() => !document.querySelector('.thumb__state'), null, { timeout: 60000 });
  check('multipage scan reaches review with 2 pages', (await page.locator('.page-tile').count()) === 2);

  // Delete a page with undo
  await page.locator('.page-tile__btn').nth(1).click();
  await page.getByRole('button', { name: 'Delete page' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.page-tile').length === 1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.page-tile').length === 2);
  check('deleted page can be restored with Undo', true);
  await shot('13-review-multipage');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Scan document').waitFor();

  /* 6. Library */
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('arasaka');
  check('library search by name', (await page.locator('.doc-card').count()) === 1);
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('20391');
  check('library search finds OCR text', (await page.locator('.doc-card').count()) >= 1);
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('');
  await dismissToasts();
  await shot('14-library');
  await page.getByRole('button', { name: 'Back' }).click();

  /* 7. Data at rest is encrypted */
  const dump = await dbDump();
  check('no document title or OCR text in IndexedDB plaintext', !/Arasaka|INV-20391|Night City Corp/.test(dump.text), `${dump.count} records`);

  /* 8. Reload → locked, nothing rendered before authentication */
  await page.reload();
  await page.getByText('Locked', { exact: true }).waitFor();
  const body = await page.locator('body').innerText();
  check('after reload the app is locked', true);
  check('no document names visible while locked', !/Arasaka|Scan 20/.test(body));
  check('no images rendered while locked', (await page.locator('img').count()) === 0);
  await shot('15-lock');
  await tapPin('000000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('Incorrect passcode.').waitFor();
  check('wrong passcode is rejected with a generic message', true);
  await tapPin(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('Arasaka Invoice').waitFor({ timeout: 20000 });
  check('correct passcode unlocks and data persisted across reload', true);

  /* 9. Auto-lock when the app goes to the background ("Immediately") */
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Now' }).click();
  await page.waitForTimeout(300);
  await shot('16-settings');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByText('Locked', { exact: true }).waitFor({ timeout: 5000 });
  check('backgrounding locks the app immediately', !(await page.locator('body').innerText()).includes('Arasaka'));

  /* 10. Brute-force throttling */
  for (let i = 0; i < 5; i++) {
    await tapPin('111222');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    await page.waitForTimeout(400);
  }
  await page.getByText(/Too many attempts/).waitFor({ timeout: 10000 });
  await shot('17-throttled');
  check('repeated failures trigger a progressive delay', true);
  await page.reload();
  await page.getByText(/Too many attempts/).waitFor({ timeout: 10000 });
  check('the delay survives a reload', true);

  /* 11. Forgot passcode → reset flow is guarded */
  await page.getByRole('button', { name: /Forgot passcode/ }).click();
  check('erase requires typing ERASE', await page.getByRole('button', { name: /Erase everything/ }).isDisabled());
  await shot('18-forgot');

  /* 12. Offline launch from the service-worker cache */
  await page.getByRole('button', { name: 'Keep trying' }).click();
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 });
  await ctx.setOffline(true);
  await page.reload();
  await page.getByText('Locked', { exact: true }).waitFor({ timeout: 15000 });
  check('app launches offline (service worker cache)', true);
  await ctx.setOffline(false);

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  failures++;
  results.push(`FAIL  unexpected: ${err.message.split('\n')[0]}`);
  if (consoleErrors.length) results.push(`      console: ${consoleErrors.slice(-4).join(' | ').slice(0, 1200)}`);
  await shot('zz-failure').catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

console.log(results.join('\n'));
console.log(`\n${results.length - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
