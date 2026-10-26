# NIGHT CITY SCANNER

A private, on-device document scanner for iPhone, built as a web app (PWA). It finds the edges of a page, straightens it, cleans it up, and turns it into a multipage PDF that you save to Apple's **Files** app. The design is a dark, neon, Night City look.

- **Free, with no ads, accounts, subscriptions, watermarks or page limits.**
- **Nothing is uploaded.** Scanning, enhancement, OCR and PDF creation all run on your phone.
- **Locked and encrypted.** A passcode protects the app, and every stored document is encrypted with AES-256.

> The visual style is inspired by the atmosphere of *Cyberpunk: Edgerunners*. All artwork, icons and branding are original, and nothing from the show or game is used.

---

## Contents

1. [Features](#features)
2. [How your documents are protected](#how-your-documents-are-protected)
3. [Technology](#technology)
4. [Install and run on Windows](#install-and-run-on-windows)
5. [Test on your iPhone](#test-on-your-iphone)
6. [Deploy (permanent HTTPS address)](#deploy-permanent-https-address)
7. [Add to the iPhone Home Screen](#add-to-the-iphone-home-screen)
8. [Using the app](#using-the-app)
9. [Storage, backups and avoiding data loss](#storage-backups-and-avoiding-data-loss)
10. [Offline and network use](#offline-and-network-use)
11. [Limitations (honest list)](#limitations-honest-list)
12. [Testing](#testing)
13. [Project structure](#project-structure)

---

## Features

**Scanning**
- Live camera with real-time document edge detection (OpenCV), shown as an outline.
- **Auto mode** captures when the page is steady. It never captures the same page twice: you have to move to the next page first. **Manual mode** has a big shutter button. You can switch at any time.
- Guidance messages such as "Move closer", "Hold steady", "More light needed".
- Torch, zoom and camera switching, shown **only** when your device and browser actually support them.
- **Max-resolution photo** button that opens the native iPhone Camera for full sensor resolution.
- Multipage scanning with a page counter. Each page is saved the moment it's captured, so a later failure never loses earlier pages.

**Image processing** (real computer vision, not a decorative filter)
- Corner detection, perspective correction, cropping, rotation.
- Shadow and uneven-lighting removal (background flattening), conservative sharpening.
- Presets: **Auto, Original Color, Enhanced Color, Grayscale, Document Text, Black & White**, with live previews.
- A corner editor with large touch handles, a magnifying loupe, Auto-detect, Full image, Reset and Retake.
- The original photo is always kept, so every edit re-renders from it with no repeated quality loss.

**Documents**
- Review screen: reorder by press-and-hold drag, or with Move earlier / Move later buttons. Rotate, crop, filter, duplicate, retake, or delete with **Undo**. Add more pages from the camera or from files.
- Library with search (by name, and optionally inside recognized text), sorting, folders, rename, duplicate, delete and re-export.
- Unfinished scans are saved automatically and can be resumed after a reload.
- Duplicate hints: a perceptual hash warns when a page looks like one you already saved.

**PDF and export**
- Genuine multipage PDFs: A4, Letter, or the scan's own proportions, with margins. Pages are never cropped.
- Quality settings: Maximum (no extra compression), Balanced, Smaller file.
- **Searchable PDFs**: an invisible OCR text layer, so you can search and copy text in any PDF reader.
- **Password-protected PDFs** with AES-256, using [qpdf](https://github.com/qpdf/qpdf), an established open-source PDF tool.
- In-app preview of the exact PDF you are about to export.
- Export as PDF, as individual page images, or as a ZIP. Delivery is through the **iOS share sheet** ("Save to Files"), with a download fallback.
- "Export all documents" creates a backup ZIP of PDFs.

**Import**
- JPEG, PNG, HEIC, WebP, GIF, BMP, AVIF photos, with automatic edge detection that you can turn off.
- Existing PDFs: pages are kept losslessly. You can reorder, delete or insert pages, mix them with scans, and export again. The original file is never modified.
- Files are checked by content, not by name. Unsupported, encrypted or damaged files are reported and skipped, without aborting the rest.

**OCR and document intelligence** (optional, on-device)
- Tesseract OCR (English), with progress display and a confidence score.
- From the recognized text: suggested filename, heading, document type (based on keywords, which are shown), dates and reference numbers. All of it is only suggested. You can edit or ignore it.

---

## How your documents are protected

**Encryption at rest, not just a lock screen.**

| What | How |
|---|---|
| Your passcode | Never stored. **PBKDF2-HMAC-SHA-256, 600,000 iterations** with a random 16-byte salt turns it into a key-encryption key. |
| Documents, images, thumbnails, OCR text, settings, folders | Each record is encrypted with **AES-256-GCM** using a random data key, and tied to its record id so records can't be swapped. |
| The data key | Stored only *wrapped* (encrypted) by the passcode key. Changing your passcode re-wraps this one key. |
| While locked | The data key is discarded from memory and decrypted image URLs are revoked. The document screens **do not exist** until you unlock, so there is no hidden route to them. |
| Wrong attempts | Four free tries, then waits of 30 s, 1 min, 2 min, 5 min, up to a 15-minute ceiling. Never a permanent lockout. The delay survives a reload. |
| Auto-lock | Now / 30 s / 1 min / 5 min / 15 min after leaving the app. This is based on timestamps, not timers, because iOS freezes timers in the background. Foreground inactivity locks after at least one minute. |
| App switcher | The screen is covered while the app is in the background. |

All cryptography is the browser's built-in **Web Crypto API**. There is no custom crypto.

**Face ID / passkey (optional).** A web page cannot call Face ID directly. The app can create a **passkey**: iOS asks for Face ID or your device passcode before releasing a secret (the WebAuthn *PRF* extension), and that secret unlocks your data key. This needs a recent iOS with iCloud Keychain passkeys. The option only switches on if your device actually returns the secret; if it doesn't, the app says so and keeps using your passcode. The passcode always keeps working.

**Forgotten passcode.** There is no recovery and no back door, by design. The only way back in is **Forgot passcode? → type ERASE**, which deletes everything stored in the app. Files you already exported are not affected. **Export important documents regularly.**

**Honest limits**
- A 6-digit passcode stops casual access. Someone who copies your browser's data could try all one million combinations offline in minutes to hours. **Use a long password if that matters to you.**
- The attempt delays are enforced by the app itself. They slow guessing on screen but are not tamper-proof.
- While the app is unlocked, anyone holding your phone can see your documents. A compromised device or malicious extension can read unlocked content.
- iOS may suspend the app without warning; the lock is applied when it resumes. The app-switcher snapshot may be taken before the app can cover the screen.
- Exported PDFs are ordinary files outside this protection, unless you set a PDF password at export.

---

## Technology

| Purpose | Choice | Why |
|---|---|---|
| UI | React 19 + TypeScript, Vite 7 | Fast builds, works on Windows, no Xcode |
| State | zustand | Tiny and simple |
| Computer vision | OpenCV.js 4.12 (`@techstark/opencv-js`), in Web Workers | Proven contour, perspective and threshold algorithms. ~10 MB, loaded only for scanning, cached offline |
| PDF creation | pdf-lib | Real PDF pages, page copying, low-level text operators for the OCR layer |
| PDF encryption | qpdf 12 (WebAssembly) | Established AES-256 implementation |
| PDF preview / import | pdf.js 5 (legacy build) | Mozilla's renderer, broad Safari support |
| OCR | tesseract.js 7 (LSTM, English) | On-device, self-hosted, no CDN |
| Storage | IndexedDB via `idb` | Transactional, holds binary data |
| Offline | vite-plugin-pwa (Workbox) | Precaches the app's own files |
| Icons / font | lucide-react, Chakra Petch (self-hosted, SIL OFL) | Consistent, no Google Fonts requests |

All dependencies are open source (MIT, Apache-2.0, ISC, BSD or OFL).

---

## Install and run on Windows

### 1. Prerequisites (one time)

- **Node.js 20 or newer (LTS)** from <https://nodejs.org>. Accept the defaults.
- **Git** from <https://git-scm.com> (to download the code).

Open **PowerShell** and check both are installed:

```powershell
node -v      # should print v20.x or newer
npm -v
```

### 2. Get the code and install dependencies

```powershell
git clone https://github.com/abdallahfaisalayoob/ab-exe.git
cd "ab-exe\Personal Projects\Night City Scanner"
npm install
```

`npm install` downloads the libraries into `node_modules` and then copies the OCR engine, PDF engine and fonts into `public\vendor` (that's the `postinstall` step). It takes a few minutes the first time.

### 3. Run it on your PC

```powershell
npm run dev
```

Open <http://localhost:5173> in Chrome or Edge. You can set a passcode, import photos and PDFs, and export. The camera works with a webcam because `localhost` counts as secure.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with instant reload |
| `npm run build` | Typecheck + production build into `dist\` |
| `npm run preview` | Serve the built `dist\` folder at <http://localhost:4173> |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | Code style checks (ESLint) |
| `npm run typecheck` | TypeScript checks only |
| `npm run check` | All of the above, then a build |
| `npm run test:e2e` | Browser end-to-end tests (needs Playwright, see [Testing](#testing)) |

---

## Test on your iPhone

**iPhone Safari only allows the camera on HTTPS pages** (or on `localhost`, which is only your PC). Opening `http://192.168.x.x:5173` on the phone loads the app, but the camera, passkeys and offline mode won't work there.

The easiest free way to get an HTTPS address for testing is a **Cloudflare quick tunnel**. It needs no account or configuration.

1. Install it once (PowerShell):
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
   Then close and reopen PowerShell.
2. Build and serve the app:
   ```powershell
   npm run build
   npm run preview
   ```
3. In a **second** PowerShell window:
   ```powershell
   cloudflared tunnel --url http://localhost:4173
   ```
   It prints an address like `https://random-words.trycloudflare.com`.
4. Open that address in **Safari on your iPhone**.

Things to know:
- Quick tunnels are meant for testing. The address changes every time you run the command, and it stops when you close the window.
- **Each address is a separate app as far as storage goes.** Documents saved under one tunnel address are not visible under the next one. Don't keep real documents on a temporary tunnel; use a permanent deployment (below).
- Your PC must stay on while you test this way.

---

## Deploy (permanent HTTPS address)

The app is a static website: after `npm run build`, the `dist` folder is everything. No server code and no database. Any static host with HTTPS works. Some options with free tiers at the time of writing (check each provider's current terms):

- **GitHub Pages** (free for public repositories). A workflow is included: `.github/workflows/night-city-scanner-pages.yml` at the repository root.
  1. On GitHub: repository → **Settings → Pages → Source: GitHub Actions**.
  2. **Actions → Deploy Night City Scanner → Run workflow**.
  3. The app appears at `https://<username>.github.io/<repository>/`.
- **Cloudflare Pages** or **Netlify**: create a site, then upload the `dist` folder (both offer drag-and-drop), or connect the repository with build command `npm run build` and output folder `dist` (set the project root to `Personal Projects/Night City Scanner`).

The build uses relative paths, so it works at a domain root or in a sub-folder. Keep using **one** address long-term: your stored documents belong to that address.

---

## Add to the iPhone Home Screen

1. Open the app's HTTPS address in **Safari**.
2. Tap **Share** (square with arrow) → **Add to Home Screen** → **Add**.
3. Launch it from the new icon. It opens full-screen like an app, with its own icon and launch screen.

The Home Screen version also gets better storage treatment from iOS (see below). Note that the Home Screen app and a Safari tab keep **separate** storage on iOS, so pick one and stay with it.

## Camera permissions

The first time you scan, iOS asks to allow the camera. If you denied it:
- **Settings → Apps → Safari → Camera → Ask or Allow**, or
- in Safari, tap **aA** in the address bar → **Website Settings → Camera → Allow**,

then reload the app. If the live camera still won't start, the camera screen offers **Use the iPhone Camera instead** and **Pick photos**.

---

## Using the app

1. **Scan document** → hold the phone over the page. In Auto mode the outline turns magenta while it steadies, then captures. Move to the next page and repeat.
2. Tap **Done** → review. Tap any page for crop and filter, rotate, retake, duplicate or delete. Press and hold a page, then drag, to reorder.
3. Optional: **Recognize text** for search, copy and a searchable PDF.
4. **Export** → choose settings → **Create PDF** → **Share / Save to Files** → in the iOS sheet choose **Save to Files** and pick a folder (for example iCloud Drive).

### Exporting to Apple Files

A website cannot silently write into your Files folders. The app uses the official ways:
- **Share / Save to Files** opens the iOS share sheet; choose **Save to Files**. The app only learns that the sheet completed, not where you saved, so documents show **Shared**, never "saved to Files".
- **Download**: Safari saves to **Files → Downloads** (the location is set in Settings → Apps → Safari → Downloads). Documents show **Downloaded**.

There are three states, and the app never confuses them:
- **In app only**: stored (encrypted) inside the app; no copy exists elsewhere.
- **Shared / Downloaded**: a copy was handed to iOS.
- **Backed up**: only you know this. Make sure the exported file is somewhere safe, such as iCloud Drive.

---

## Storage, backups and avoiding data loss

- Documents are stored **encrypted in the browser's IndexedDB**, on this device only. Nothing syncs.
- **Browser storage is not permanent.** iOS can clear website data when the device is low on space. For sites used in a **Safari tab**, WebKit may delete storage after about **7 days without use**. Home Screen web apps are treated better. The app asks for *persistent storage*, and Settings shows whether it was granted.
- **Clearing Safari's history and website data deletes everything in the app.**
- Saving is transactional: a document and its images are written together or not at all. The app never says "saved" before the write has succeeded. If storage is full, you get a clear message.
- Interrupted processing (a reload mid-scan) resumes automatically from the kept original photo.

**To avoid losing documents:** export them to Files (iCloud Drive), and periodically use **Settings → Export all documents as PDFs (ZIP)**. Do this before erasing app data or changing your passcode if you're unsure about it.

---

## Offline and network use

| Feature | Network needed? |
|---|---|
| Opening the app, scanning, editing, PDF export, PDF password, library | **No**, once the app has loaded online once (service worker cache) |
| OCR (text recognition) | **Once**: the first use downloads about 7 MB (engine + English model) **from the app's own address**, then it is cached |
| Passkey / Face ID setup | No (handled by iOS) |

The app makes **no requests to any third party**: no analytics, fonts, CDNs or APIs. Every file comes from the address you opened. A Content-Security-Policy in the production build enforces same-origin loading.

---

## Limitations (honest list)

- **Not a native app.** A PWA cannot use Apple's VisionKit document scanner, write to Files folders directly, run in the background, or lock exactly at the moment iOS suspends it.
- **Camera resolution.** The live camera gives video-stream frames (typically up to 4K / 12 MP on iPhone), not the 24–48 MP still pipeline. Use **Max-resolution photo** for the full sensor. Safari offers no `ImageCapture` API, and focus control is not exposed.
- **Torch and zoom** appear only if Safari reports them for your camera. Older iOS versions may not.
- **Haptics:** iOS Safari has no vibration API, so capture feedback is visual.
- **Orientation:** pages are straightened by perspective, but upside-down or sideways text is not detected automatically. Use rotate.
- **OCR** is English only, can make mistakes, and is slower on very large pages. The searchable layer uses a standard PDF font, so characters outside Latin-1 become "?" in the hidden text (the image itself is unaffected).
- **Detection** can struggle with white paper on a white desk, very low light, or heavily folded pages. You can always adjust the corners by hand.
- **Imported PDFs:** password-protected PDFs can't be imported. Filters and cropping apply only to image pages; imported PDF pages are kept as they are. Preview of some PDFs that use Asian-language fonts may show wrong glyphs, but export is unaffected because pages are copied verbatim.
- **Passkey unlock** depends on WebAuthn PRF support in your iOS and Safari version. The feature refuses to turn on where it isn't supported.
- **Storage eviction** is controlled by iOS, not by the app; see above.

Possible future improvements: automatic text orientation (Tesseract OSD), more OCR languages, page splitting for book spreads, and multi-select page actions.

---

## Testing

There are three kinds of testing, and only the first two were run while building this:

1. **Automated unit tests**, run with `npm test`: 71 tests covering crypto, the vault (setup, wrong passcode, throttling, passcode change, reset, KDF upgrade), auto-lock decisions, encrypted persistence (including damaged and missing records), document operations (create, add, delete, reorder, rotate, duplicate), filenames, geometry, auto-capture stability, PDF layout, PDF page ordering, OCR text layer, imported-PDF copying, import validation and OCR intelligence.
2. **Automated browser tests**, run with `npm run test:e2e`: the production build in **headless desktop Chromium** at the iPhone 16 Pro viewport (402×874 @3x, touch emulation), with a synthetic document photo and a fake camera. 37 checks:
   - **Setup and locking:** passcode setup and validation; the passcode isn't stored in plaintext.
   - **Scanning and editing:** import with corner detection (measured error 0.23%); corner dragging; filter previews.
   - **OCR and PDF:** OCR including the heading; searchable PDF with no added text; AES-256 PDF that opens only with its password.
   - **Camera and library:** auto-capture without duplicates; manual capture; multipage review; Undo; library search.
   - **Security:** no plaintext in IndexedDB; locked after reload with nothing rendered; wrong passcode; backgrounding lock; progressive delay surviving a reload; erase confirmation.
   - **Robustness:** offline launch; no console errors.

   It needs Playwright with Chromium: `npm i -D playwright` then `npx playwright install chromium`, or set `PLAYWRIGHT_PATH` to an existing install. Screenshots are saved to `e2e/output/`.
3. **Real iPhone testing has not been done yet.** Desktop Chromium is not iOS Safari. Please run the checklist below on your iPhone 16 Pro / Pro Max.

### Real-device checklist (iPhone Safari)

Use a deployed HTTPS address or a Cloudflare tunnel.

- [ ] First launch: setup screen; create a 6-digit passcode; confirm it; you reach Home.
- [ ] Camera permission prompt appears; denying shows clear instructions; allowing shows a live preview.
- [ ] The live outline follows a real page on a desk; the guidance text changes (closer, steady, light).
- [ ] Auto mode captures once per page and doesn't re-capture the same page; Manual shutter works.
- [ ] Torch and zoom buttons appear (if supported) and work.
- [ ] **Max-resolution photo** opens the iPhone Camera; after taking a photo you return without being locked.
- [ ] Scan 10+ pages in a row; the counter is correct; nothing freezes.
- [ ] Corner editor: handles are easy to grab, the loupe helps, and Apply re-renders the page.
- [ ] Each filter looks right on a real receipt, a letter and a colorful page; signatures and faint text survive.
- [ ] Reorder by press-and-hold drag; normal scrolling still works.
- [ ] Recognize text works (first time online), and the text is reasonable.
- [ ] Export PDF → **Share / Save to Files** → saving to iCloud Drive works; the file opens in Files with the right pages and order.
- [ ] A password-protected PDF asks for its password in Files.
- [ ] Export page images (share several at once) and the ZIP download.
- [ ] Add to Home Screen: icon, launch screen, full-screen standalone, safe areas (no content under the notch or home bar).
- [ ] Swipe to another app and back with Auto-lock = **Now** → locked. With 1 min: back within 1 min → still unlocked; after → locked.
- [ ] The app-switcher card does not show a document.
- [ ] Reload mid-scan → after unlocking, the unfinished scan is listed and resumes.
- [ ] Airplane mode → the Home Screen app opens, scans and exports PDFs.
- [ ] Face ID / passkey setup (Settings) either works or clearly says it's unsupported.
- [ ] A large document (30+ pages) exports without the page reloading.
- [ ] Settings shows a storage estimate; persistent storage status is reported.

---

## Project structure

```
src/
  App.tsx, main.tsx, pwa.ts      App shell, routing by state (no document data in URLs)
  types/models.ts                Documents, pages, export settings, settings
  state/                         zustand store, actions (lock lifecycle, serialized writes), import/OCR flows
  lib/
    security/                    crypto.ts (KDF, AES-GCM), vault.ts, autoLock.ts, bruteForce.ts, passkey.ts, session.ts
    storage/                     db.ts (IndexedDB schema), repo.ts (encrypted, transactional), blobUrls.ts, errors.ts
    document/                    model.ts (pure page operations), filename.ts, ids.ts
    vision/                      cv.worker.ts (OpenCV detection + processing), cvClient.ts, geometry.ts, autoCapture.ts
    imaging/                     pipeline.ts (capture → page), hash.ts (duplicate hints)
    camera/                      camera.ts (getUserMedia, torch, zoom, frame capture)
    pdf/                         generate.ts, layout.ts, textLayer.ts (OCR layer), encrypt.ts (qpdf), pdfjs.ts
    ocr/                         ocr.ts (Tesseract), intelligence.ts (dates, ids, category, title)
    import/                      validate.ts (magic bytes), importFiles.ts
    export/                      share.ts (Web Share, download, ZIP)
  ui/                            kit.tsx (components), lock/, screens/, overlays
  styles/                        tokens.css (design tokens), base, components, screens
scripts/                         copy-vendor.mjs (self-hosted engines), make-icons.mjs
e2e/run.mjs                      Browser end-to-end tests
public/icons, public/splash      Original app icon and iOS launch images
```
