// Playwright E2E smoke: Indeks -> Pencarian -> Analisis export flow (mocked data)
// Jalankan dengan:
//   npx playwright test tests/e2e.basic.spec.js --project=chromium --headed --timeout=60000
// Pastikan BASE_URL mengarah ke server lokal (default http://localhost:3000)

const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DOWNLOAD_TIMEOUT = 20000;

async function injectMockAnalysis(page) {
  await page.evaluate(() => {
    // Fake analysis data
    window.__lastAnalysis = {
      fused: Array.from({ length: 20 }, (_, i) => 0.5 + 0.02 * i),
      wv: 0.5,
      wa: 0.3
    };
    window.lastQueryData = {
      name: 'query_mock.mp4',
      duration: 60,
      hashes: Array.from({ length: 20 }, (_, i) => ({ t: i, hash: (1000 + i).toString(16) })),
      _chromaSegs: []
    };
    window.lastTargetData = {
      target: { name: 'target_mock.mp4', duration: 60 },
      hashes: Array.from({ length: 20 }, (_, i) => ({ t: i, hash: (2000 + i).toString(16) })),
      _chroma: []
    };
    window.__lastSearchResults = [
      { item: { id: 1, name: 'target_mock', source: 'local' }, score: 0.82 }
    ];
    // Minimal heatmap info
    window.__heatmapInfo = { lenQ: 20, lenT: 20, H: [[0.5, 0.6]], path: [[0, 0]] };
    // Render something on canvases so export has pixels
    ['timeline', 'heatmap'].forEach(id => {
      const c = document.getElementById(id);
      if (c) {
        c.width = c.width || 600;
        c.height = c.height || 120;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#4f46e5';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#16a34a';
        ctx.fillRect(0, c.height / 2, c.width, c.height / 2);
      }
    });
  });
}

async function waitForDownload(page, trigger, ext = '.pdf') {
  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT });
  await trigger();
  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  if (!suggested.endsWith(ext)) {
    throw new Error(`Download filename mismatch: expected ${ext}, got ${suggested}`);
  }
  // Save to temp to ensure completion
  const tmpPath = path.join(process.cwd(), 'tests', 'tmp_' + suggested);
  await download.saveAs(tmpPath);
  return tmpPath;
}

describe('MediaFinder E2E smoke', () => {
  let browser;
  let context;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 720 }
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = await context.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  test('Hero loads and mock analysis exports PDF/PNG/JSON', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=MediaFinder');

    // Pastikan tab Analisis tersedia
    await page.click('nav .tab-btn[data-tab="#tab-analisis"]');

    // Sisipkan data mock agar ekspor bisa berjalan
    await injectMockAnalysis(page);

    // Export PDF
    const pdfPath = await waitForDownload(page, async () => {
      await page.click('#exportPdf');
    }, '.pdf');
    expect(pdfPath).toBeTruthy();

    // Share PNG
    const pngPath = await waitForDownload(page, async () => {
      await page.click('#exportPng');
    }, '.png');
    expect(pngPath).toBeTruthy();

    // Share JSON ringkas
    const jsonPath = await waitForDownload(page, async () => {
      await page.click('#exportSummaryJson');
    }, '.json');
    expect(jsonPath).toBeTruthy();

    // Copy insight summary
    await page.click('#copyInsightSummary');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Ringkasan insight MediaFinder');
  }, 45000);
});
