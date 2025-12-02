
// heatmap_worker.js
// Receive {q: [hashHex...], t: [hashHex...], maxSize}
function hamming64(a,b){
  let x = (BigInt.asUintN? BigInt.asUintN(64, a^b) : (a^b));
  // popcount for BigInt
  let c = 0n;
  while(x){ c += x & 1n; x >>= 1n; }
  return Number(c);
}
onmessage = (e)=>{
  const { q, t, maxSize=200 } = e.data||{};
  const n=q.length, m=t.length;
  if(!Array.isArray(q) || !Array.isArray(t) || n===0 || m===0){
    postMessage({ id: (typeof __reqId!=='undefined'?__reqId:null), H: [], sx:1, sy:1, path: [] });
    return;
  }
  const sx = Math.max(1, Math.floor(m/Math.min(m,maxSize)));
  const sy = Math.max(1, Math.floor(n/Math.min(n,maxSize)));
  const H = [];
  const Q = q.map(x=>BigInt('0x'+x)), T = t.map(x=>BigInt('0x'+x));
  for(let i=0;i<n;i+=sy){
    const row=[];
    for(let j=0;j<m;j+=sx){
      let sum=0, cnt=0;
      for(let ii=i;ii<Math.min(i+sy,n);ii++){
        for(let jj=j;jj<Math.min(j+sx,m);jj++){
          const ham = hamming64(Q[ii], T[jj]);
          sum += 1 - (ham/63.0);
          cnt++;
        }
      }
      row.push(sum/(cnt||1));
    }
    H.push(row);
  }
  // DTW on cost = 1 - sim
  const R = H.length, C = H[0]?.length||0;
  const cost = Array.from({length:R}, (_,i)=> Array.from({length:C},(_,j)=> 1 - H[i][j]));
  const D = Array.from({length:R}, ()=> Array(C).fill(Infinity));
  const P = Array.from({length:R}, ()=> Array(C).fill(0)); // 0=diag,1=up,2=left
  D[0][0] = cost[0][0];
  for(let i=1;i<R;i++){ D[i][0] = cost[i][0] + D[i-1][0]; P[i][0]=1; }
  if(C>0){ for(let j=1;j<C;j++){ D[0][j] = cost[0][j] + D[0][j-1]; P[0][j]=2; } }
  for(let i=1;i<R;i++){
    for(let j=1;j<C;j++){
      let a = D[i-1][j-1], b = D[i-1][j], c = D[i][j-1];
      if(a<=b && a<=c){ D[i][j] = cost[i][j] + a; P[i][j]=0; }
      else if(b<=c){ D[i][j] = cost[i][j] + b; P[i][j]=1; }
      else { D[i][j] = cost[i][j] + c; P[i][j]=2; }
    }
  }
  // Traceback
  let i=R-1, j=C-1; const path=[];
  if(R && C){
    while(i>0 || j>0){
      path.push([i,j]);
      const p = P[i][j];
      if(p===0){ i--; j--; } else if(p===1){ i--; } else { j--; }
    }
    path.push([0,0]);
    path.reverse();
  }
  postMessage(Object.assign({ id: (typeof __reqId!=='undefined'?__reqId:null) }, { H, sx, sy, path }));
};
