import { test, expect } from '@playwright/test';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DOWNLOAD_TIMEOUT = 20000;

async function injectMockAnalysis(page) {
  await page.evaluate(() => {
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
    window.__heatmapInfo = { lenQ: 20, lenT: 20, H: [[0.5, 0.6]], path: [[0, 0]] };

    ['timeline', 'heatmap'].forEach((id) => {
      const c = document.getElementById(id);
      if (!c) return;
      c.width = c.width || 600;
      c.height = c.height || 120;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(0, c.height / 2, c.width, c.height / 2);
    });
  });
}

async function waitForDownload(page, trigger, ext) {
  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT });
  await trigger();
  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  expect(suggested).toMatch(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'));
  const tmpPath = path.join(process.cwd(), 'MediaFinder_frontend_fixed_racecache', 'tests', `tmp_${suggested}`);
  await download.saveAs(tmpPath);
  return tmpPath;
}

test.describe('MediaFinder E2E smoke', () => {
  test('hero loads and mock analysis exports PDF/PNG/JSON', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await expect(page.getByText('MediaFinder').first()).toBeVisible();

    await page.locator('nav .tab-btn[data-tab="#tab-analisis"]').click();
    await injectMockAnalysis(page);

    const pdfPath = await waitForDownload(page, () => page.locator('#exportPdf').click(), '.pdf');
    expect(pdfPath).toBeTruthy();

    const pngPath = await waitForDownload(page, () => page.locator('#exportPng').click(), '.png');
    expect(pngPath).toBeTruthy();

    const jsonPath = await waitForDownload(page, () => page.locator('#exportSummaryJson').click(), '.json');
    expect(jsonPath).toBeTruthy();

    await page.locator('#copyInsightSummary').click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Ringkasan insight MediaFinder');
  });
});
