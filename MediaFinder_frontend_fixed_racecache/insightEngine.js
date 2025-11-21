const InsightEngine = (() => {
  function scoreConfidence(score) {
    if (score >= 0.85) return { level: 'ekstrim', severity: 'critical' };
    if (score >= 0.7) return { level: 'tinggi', severity: 'high' };
    if (score >= 0.5) return { level: 'sedang', severity: 'medium' };
    return { level: 'rendah', severity: 'low' };
  }
  function gapDescriptor(gap) {
    if (gap >= 0.25) return 'sangat aman';
    if (gap >= 0.15) return 'aman';
    if (gap >= 0.08) return 'perlu perhatian';
    return 'hampir seri';
  }
  const processors = [];
  function registerProcessor(fn){
    if(typeof fn === 'function'){ processors.push(fn); }
  }
  function generate(context = {}) {
    const snapshot = context.snapshot || (typeof window !== 'undefined' ? window.collectInsightSnapshot?.() : null);
    if (!snapshot) return [];
    const insights = [];
    processors.forEach((fn)=>{
      try{
        const res = fn(snapshot) || [];
        if(Array.isArray(res)){
          res.forEach(item => item && insights.push(item));
        }else if(res){
          insights.push(res);
        }
      }catch(e){
        if(typeof console !== 'undefined' && console.warn){
          console.warn('[InsightEngine] processor error', e);
        }
      }
    });
    return insights;
  }
  registerProcessor((snapshot)=>{
    if(!snapshot.timeline?.available){
      return snapshot.timeline?.reason ? [{
        type:'timeline',
        severity:'info',
        title:'Belum ada analisis timeline',
        summary:snapshot.timeline.reason
      }] : [];
    }
    const fused = snapshot.timeline;
    const conf = scoreConfidence(fused.metrics.globalScore || 0);
    return [{
      type:'timeline',
      key:`timeline:${(fused.metrics.globalScore||0).toFixed(3)}:${(fused.peaks?.[0]?.start||0)}`,
      title:`Skor global ${(fused.metrics.globalScore||0).toFixed(3)} (${conf.level})`,
      severity:conf.severity,
      summary:`Durasi ${fused.metrics.length}s dengan skor puncak ${(fused.metrics.maxScore||0).toFixed(3)}.`,
      supporting:{ peaks:fused.peaks }
    }];
  });
  registerProcessor((snapshot)=>{
    const list = [];
    if(snapshot.timeline?.peaks?.length >= 2){
      const sorted = [...snapshot.timeline.peaks].sort((a,b)=> (b.score||0)-(a.score||0));
      const gap = (sorted[0].score || 0) - (sorted[1].score || 0);
      list.push({
        type:'gap',
        key:`gap:${gap.toFixed(3)}`,
        severity: gap >= 0.15 ? 'success' : (gap >= 0.08 ? 'medium' : 'warning'),
        title:`Kesenjangan skor antar kandidat: ${(gap*100).toFixed(1)}% (${gapDescriptor(gap)})`,
        summary:'Selisih antara puncak pertama dan kedua menunjukkan keyakinan sistem.',
        supporting:{ topScore: sorted[0], secondScore: sorted[1], gap }
      });
    }
    return list;
  });
  registerProcessor((snapshot)=>{
    if(!snapshot.heatmap?.available){
      return [];
    }
    const hm = snapshot.heatmap;
    let severity = 'medium';
    if (hm.matrix.avgSim >= 0.8) severity = 'high';
    if (hm.matrix.avgSim <= 0.4) severity = 'low';
    return [{
      type:'heatmap',
      key:`heatmap:${hm.matrix.rows}x${hm.matrix.cols}:${(hm.matrix.avgSim||0).toFixed(3)}`,
      severity,
      title:`Intensitas heatmap rata-rata ${(hm.matrix.avgSim||0).toFixed(3)}`,
      summary:`Resolusi matriks ${hm.matrix.rows}×${hm.matrix.cols}, jalur DTW ${hm.dtw.length} langkah.`,
      supporting:hm
    }];
  });
  registerProcessor((snapshot)=>{
    if(snapshot.robustness?.available){
      const rb = snapshot.robustness;
      const stability = ((rb.best.score - rb.worst.score) <= 0.1) ? 'stabil' : 'sensitif';
      return [{
        type:'robustness',
        key:`robustness:${rb.best.label}:${rb.worst.label}`,
        severity: stability === 'stabil' ? 'success' : 'warning',
        title:`Robustness batch ${stability}`,
        summary:`Terbaik ${rb.best.label} (${rb.best.score.toFixed(3)}), terburuk ${rb.worst.label} (${rb.worst.score.toFixed(3)}).`,
        supporting:rb
      }];
    }
    if(snapshot.robustness?.reason){
      return [{
        type:'robustness',
        severity:'info',
        title:'Robustness belum dijalankan',
        summary:snapshot.robustness.reason
      }];
    }
    return [];
  });
  registerProcessor((snapshot)=>{
    if(snapshot.evaluation?.available){
      const ev = snapshot.evaluation.summary;
      return [{
        type:'evaluation',
        key:`evaluation:${(ev.precision||0).toFixed(2)}:${(ev.recall||0).toFixed(2)}`,
        severity: ev.precision >= 0.8 ? 'success' : (ev.precision >= 0.6 ? 'medium' : 'warning'),
        title:`Precision ${(ev.precision*100).toFixed(1)}% · Recall ${(ev.recall*100).toFixed(1)}%`,
        summary:`F1 ${(ev.f1*100).toFixed(1)}% dari ${snapshot.evaluation.sampleSize} query.`,
        supporting:ev
      }];
    }
    if(snapshot.evaluation?.reason){
      return [{
        type:'evaluation',
        severity:'info',
        title:'Evaluasi sistem belum dijalankan',
        summary:snapshot.evaluation.reason
      }];
    }
    return [];
  });
  registerProcessor((snapshot)=>{
    const cand = snapshot.candidates;
    if(!cand){
      return [];
    }
    if(!cand.available){
      return cand.reason ? [{
        type:'recommendation',
        severity:'info',
        title:'Belum ada rekomendasi kandidat',
        summary:cand.reason
      }] : [];
    }
    const recs = cand.recommendations || [];
    if(!recs.length){
      return [];
    }
    const best = recs[0];
    const severity = best.score >= 0.85 ? 'high' : best.score >= 0.7 ? 'medium' : 'info';
    return [{
      type:'recommendation',
      key:`recommendation:${best.id || best.name}:${best.score.toFixed(3)}`,
      severity,
      title:`Rekomendasi utama: ${best.name || 'Kandidat serupa'}`,
      summary:`Skor ${best.score.toFixed(3)}; ${cand.highConfidence?.length || 0} kandidat berada di rentang mirip.`,
      supporting:{
        recommendations: recs,
        stats: cand.stats,
        highConfidence: cand.highConfidence
      }
    }];
  });
  registerProcessor((snapshot)=>{
    const shots = snapshot.shots;
    if(!shots){
      return [];
    }
    if(!shots.available){
      return shots.reason ? [{
        type:'evidence',
        severity:'info',
        title:'Belum ada snapshot bukti',
        summary: shots.reason
      }] : [];
    }
    const severity = shots.count >= 4 ? 'success' : shots.count >= 1 ? 'medium' : 'info';
    const withTarget = shots.latest?.withTarget ? 'dengan target' : 'tanpa target';
    return [{
      type:'evidence',
      key:`evidence:${shots.count}`,
      severity,
      title:`${shots.count} snapshot bukti siap dipakai`,
      summary:`Snapshot terakhir di t=${(shots.latest?.t ?? 0).toFixed(2)}s (${withTarget}).`,
      supporting: shots
    }];
  });
  registerProcessor((snapshot)=>{
    const cand = snapshot.candidates;
    if(!cand?.available) return [];
    const recs = cand.recommendations || [];
    if(recs.length < 2) return [];
    const first = recs[0], second = recs[1];
    const gap = Math.abs((first?.score || 0) - (second?.score || 0));
    if(first.score >= 0.65 && second.score >= 0.65 && gap <= 0.035){
      return [{
        type:'plagiarism',
        key:`plagiarism:${first.id || first.name}:${second.id || second.name}`,
        severity: gap <= 0.02 ? 'critical' : 'warning',
        title:`Kemungkinan plagiarisme antara ${first.name} dan ${second.name}`,
        summary:`Skor nyaris identik (${first.score.toFixed(3)} vs ${second.score.toFixed(3)}). Tinjau bukti visual & timeline.`,
        supporting:{
          pair:[first, second],
          gap,
          peaks: snapshot.timeline?.peaks || null
        }
      }];
    }
    return [];
  });
  return { generate, registerProcessor };
})();

if (typeof window !== 'undefined') {
  window.InsightEngine = InsightEngine;
}

export default InsightEngine;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = InsightEngine;
}
