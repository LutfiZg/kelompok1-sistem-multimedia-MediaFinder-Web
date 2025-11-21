// fuse_worker.js

function parse64(h){
  if (typeof h === 'bigint') return h;
  const s = String(h);
  return BigInt(s.startsWith('0x') ? s : ('0x' + s));
}

function hamming64(a, b){
  let x = (a ^ b);
  let c = 0n;
  while (x){ c += (x & 1n); x >>= 1n; }
  return Number(c);
}

function dot12(a, b){
  let dot=0, na=0, nb=0;
  for (let i=0;i<12;i++){
    const x = a?.[i] ?? 0, y = b?.[i] ?? 0;
    dot += x*y; na += x*x; nb += y*y;
  }
  const cos = dot / (1e-9 + Math.sqrt(na*nb));
  const sim = (cos + 1) * 0.5;                // map [-1..1] -> [0..1]
  return Math.min(1, Math.max(0, sim));       // clamp
}

onmessage = (e)=>{
  const { qHashes=[], tHashes=[], qChroma=[], tChroma=[], wv=0.5, wa=0.5 } = e.data || {};

  // 1) Visual timeline (utama)
  const Q = qHashes.map(parse64), T = tHashes.map(parse64);
  const n = Math.min(Q.length, T.length);
  const vis = new Array(n);
  for (let i=0;i<n;i++){
    const ham = hamming64(Q[i], T[i]);        // 0..64
    const s = 1 - (ham / 63.0);               // pipeline-mu buang DC → 63; tetap clamp
    vis[i] = Math.min(1, Math.max(0, s));
  }

  // 2) Audio (bisa kosong/lebih pendek)
  const m = Math.min(qChroma.length, tChroma.length, n);
  const aud = new Array(m);
  for (let i=0;i<m;i++) aud[i] = dot12(qChroma[i], tChroma[i]);

  // 3) Normalisasi bobot (aman bila user isi bebas)
  const wv0 = Math.max(0, Number(wv));
  const wa0 = Math.max(0, Number(wa));
  const wsum = (wv0 + wa0) > 0 ? (wv0 + wa0) : 1;

  // 4) Fusi: selalu sepanjang 'vis'; jika audio tak ada, pakai 'vis' apa adanya
  const fused = new Array(n);
  for (let i=0;i<n;i++){
    const a = (i < aud.length) ? aud[i] : null;
    fused[i] = (a == null || wa0 === 0) ? vis[i] : ((wv0*vis[i] + wa0*a) / wsum);
  }

  postMessage({ vis, aud, fused });
};
