const assert = require('assert');
const InsightEngineModule = require('../insightEngine.js');
const InsightEngine = InsightEngineModule.generate ? InsightEngineModule : InsightEngineModule.default;

function makeSnapshot({ score=0.82, peaks=[{score:0.9,start:10,end:14},{score:0.8,start:60,end:65}] }) {
  return {
    timeline: {
      available: true,
      metrics:{ globalScore: score, maxScore: Math.max(...peaks.map(p=>p.score)), length: 120 },
      peaks
    },
    heatmap:{
      available:true,
      matrix:{ rows:30, cols:40, avgSim:0.62 },
      dtw:{ length: 180 }
    },
    robustness:{
      available:true,
      best:{ label:'orig-23', score:0.81, size: 12*1024*1024 },
      worst:{ label:'640x360-35', score:0.59 },
      count:4
    },
    evaluation:{
      available:true,
      summary:{ precision:0.78, recall:0.74, f1:0.76 },
      sampleSize:40
    }
  };
}

function testTimelineSeverity() {
  const snapshot = makeSnapshot({ score:0.92 });
  const [first] = InsightEngine.generate({ snapshot });
  assert(first.severity === 'critical' || first.severity === 'high', 'Timeline severity should be high/critical');
}

function testGapInsight() {
  const snapshot = makeSnapshot({ peaks:[{score:0.85,start:10,end:12},{score:0.7,start:20,end:22}] });
  const insights = InsightEngine.generate({ snapshot });
  const gap = insights.find(i => i.type === 'gap');
  assert(gap, 'Gap insight should exist');
  assert(gap.summary.includes('Selisih'), 'Gap insight summary should mention selisih');
}

function scenarioHeatmapShortVsLong() {
  const shortCtx = InsightEngine.generate({
    snapshot: {
      ...makeSnapshot({ score:0.6 }),
      heatmap:{ available:true, matrix:{ rows:10, cols:15, avgSim:0.4 }, dtw:{ length:40 } }
    }
  });
  const longCtx = InsightEngine.generate({
    snapshot: {
      ...makeSnapshot({ score:0.6 }),
      heatmap:{ available:true, matrix:{ rows:60, cols:80, avgSim:0.85 }, dtw:{ length:300 } }
    }
  });
  console.log('[Scenario] Heatmap pendek -> severity', shortCtx.find(i=>i.type==='heatmap')?.severity);
  console.log('[Scenario] Heatmap panjang -> severity', longCtx.find(i=>i.type==='heatmap')?.severity);
}

function scenarioRobustnessSpread() {
  const calmSnapshot = {
    ...makeSnapshot({ score:0.7 }),
    robustness:{
      available:true,
      best:{ label:'orig-23', score:0.76, size:10*1024*1024 },
      worst:{ label:'orig-28', score:0.72 }
    }
  };
  const sensitiveSnapshot = {
    ...makeSnapshot({ score:0.7 }),
    robustness:{
      available:true,
      best:{ label:'orig-23', score:0.83, size:10*1024*1024 },
      worst:{ label:'480p-35', score:0.45 }
    }
  };
  console.log('[Scenario] Robustness stabil ->', InsightEngine.generate({ snapshot:calmSnapshot }).find(i=>i.type==='robustness')?.summary);
  console.log('[Scenario] Robustness sensitif ->', InsightEngine.generate({ snapshot:sensitiveSnapshot }).find(i=>i.type==='robustness')?.summary);
}

function run() {
  testTimelineSeverity();
  testGapInsight();
  scenarioHeatmapShortVsLong();
  scenarioRobustnessSpread();
  console.log('InsightEngine tests passed.');
}

run();
