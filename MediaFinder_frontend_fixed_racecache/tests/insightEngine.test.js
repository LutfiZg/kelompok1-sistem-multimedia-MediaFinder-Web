import test from 'node:test';
import assert from 'node:assert/strict';
import InsightEngine from '../insightEngine.js';

function makeSnapshot({ score = 0.82, peaks = [{ score: 0.9, start: 10, end: 14 }, { score: 0.8, start: 60, end: 65 }] } = {}) {
  return {
    timeline: {
      available: true,
      metrics: { globalScore: score, maxScore: Math.max(...peaks.map((p) => p.score)), length: 120 },
      peaks
    },
    heatmap: {
      available: true,
      matrix: { rows: 30, cols: 40, avgSim: 0.62 },
      dtw: { length: 180 }
    },
    robustness: {
      available: true,
      best: { label: 'orig-23', score: 0.81, size: 12 * 1024 * 1024 },
      worst: { label: '640x360-35', score: 0.59 },
      count: 4
    },
    evaluation: {
      available: true,
      summary: { precision: 0.78, recall: 0.74, f1: 0.76 },
      sampleSize: 40
    }
  };
}

test('timeline severity reflects high confidence', () => {
  const snapshot = makeSnapshot({ score: 0.92 });
  const [first] = InsightEngine.generate({ snapshot });
  assert.ok(['critical', 'high'].includes(first.severity));
});

test('gap insight is generated for multiple peaks', () => {
  const snapshot = makeSnapshot({ peaks: [{ score: 0.85, start: 10, end: 12 }, { score: 0.7, start: 20, end: 22 }] });
  const insights = InsightEngine.generate({ snapshot });
  const gap = insights.find((i) => i.type === 'gap');
  assert.ok(gap);
  assert.match(gap.summary, /Selisih/);
});

test('heatmap severity distinguishes weak and strong similarity', () => {
  const weak = InsightEngine.generate({
    snapshot: {
      ...makeSnapshot({ score: 0.6 }),
      heatmap: { available: true, matrix: { rows: 10, cols: 15, avgSim: 0.4 }, dtw: { length: 40 } }
    }
  });
  const strong = InsightEngine.generate({
    snapshot: {
      ...makeSnapshot({ score: 0.6 }),
      heatmap: { available: true, matrix: { rows: 60, cols: 80, avgSim: 0.85 }, dtw: { length: 300 } }
    }
  });
  assert.equal(weak.find((i) => i.type === 'heatmap')?.severity, 'low');
  assert.equal(strong.find((i) => i.type === 'heatmap')?.severity, 'high');
});

test('robustness insight distinguishes stable and sensitive batches', () => {
  const stable = InsightEngine.generate({
    snapshot: {
      ...makeSnapshot({ score: 0.7 }),
      robustness: {
        available: true,
        best: { label: 'orig-23', score: 0.76, size: 10 * 1024 * 1024 },
        worst: { label: 'orig-28', score: 0.72 }
      }
    }
  });
  const sensitive = InsightEngine.generate({
    snapshot: {
      ...makeSnapshot({ score: 0.7 }),
      robustness: {
        available: true,
        best: { label: 'orig-23', score: 0.83, size: 10 * 1024 * 1024 },
        worst: { label: '480p-35', score: 0.45 }
      }
    }
  });
  assert.equal(stable.find((i) => i.type === 'robustness')?.severity, 'success');
  assert.equal(sensitive.find((i) => i.type === 'robustness')?.severity, 'warning');
});

test('generate tolerates missing snapshot', () => {
  assert.deepEqual(InsightEngine.generate({ snapshot: null }), []);
});
