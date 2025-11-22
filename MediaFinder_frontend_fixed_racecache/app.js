

// --- injected: request-ID-safe heatmap worker helper ---
let __hmReqLast = null;
function heatmapRequest(worker, payload, onResult){
  const reqId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  payload = Object.assign({}, payload, { id: reqId });
  const handle = (ev) => {
    const d = ev.data || ev;
    if (!d || d.id !== reqId) return;
    worker.removeEventListener('message', handle);
    if (typeof onResult === 'function') onResult(d);
  };
  worker.addEventListener('message', handle);
  worker.postMessage(payload);
  __hmReqLast = reqId;
  return reqId;
}

// ---- Theme & Toast ----
function showToast(message, opts={}){
  const stack = document.getElementById('notifyStack');
  if(!stack) return;
  const card = document.createElement('div');
  card.className = `notify-card ${opts.type||'info'}`;
  card.setAttribute('role','status');
  const body = document.createElement('div');
  body.className = 'notify-body';
  if(opts.title){
    const titleEl = document.createElement('strong');
    titleEl.textContent = opts.title;
    body.appendChild(titleEl);
  }
  const text = document.createElement('p');
  text.textContent = message;
  body.appendChild(text);
  if(opts.action && opts.action.label){
    const btn = document.createElement('button');
    btn.className = 'notify-action';
    btn.textContent = opts.action.label;
    btn.addEventListener('click', ()=>{
      try{ opts.action.handler?.(); }catch(_){}
      dismiss();
    });
    body.appendChild(btn);
  }
  card.appendChild(body);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'notify-close';
  closeBtn.setAttribute('aria-label','Tutup notifikasi');
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', ()=> dismiss());
  card.appendChild(closeBtn);
  stack.appendChild(card);
  requestAnimationFrame(()=> card.classList.add('show'));
  const duration = opts.duration ?? 4200;
  let timer = setTimeout(()=> dismiss(), duration);
  card.addEventListener('mouseenter', ()=>{ clearTimeout(timer); });
  card.addEventListener('mouseleave', ()=>{
    timer = setTimeout(()=> dismiss(), 1800);
  });
  function dismiss(){
    card.classList.remove('show');
    setTimeout(()=> card.remove(), 250);
  }
}

window.__lastQueryFile = window.__lastQueryFile || null;
window.collectInsightSnapshot = window.collectInsightSnapshot || (()=>({}));
window.InsightEngine = window.InsightEngine || null;
window.__insightLast = window.__insightLast || [];
window.__insightFeedbackCache = window.__insightFeedbackCache || [];
window.__insightLast = window.__insightLast || [];
window.__lastSearchResults = window.__lastSearchResults || [];
window.__timelineHighlights = window.__timelineHighlights || [];
window.__wizardSkip = window.__wizardSkip || false;


// ---- Secure Store helper (API Key encryption) ----
const SecureStore = {
  MASTER_KEY: 'mf_secure_key_v1',
  CACHE_KEY: 'mf_api_plain_cache',
  isSupported: !!(window.crypto?.subtle),
  async ensureKey(){
    if(!this.isSupported) return null;
    if(this._cryptoKey) return this._cryptoKey;
    let hex = sessionStorage.getItem(this.MASTER_KEY);
    if(!hex){
      const raw = crypto.getRandomValues(new Uint8Array(32));
      hex = bytesToHex(raw);
      sessionStorage.setItem(this.MASTER_KEY, hex);
    }
    const keyBytes = hexToBytes(hex);
    this._cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt','decrypt']);
    return this._cryptoKey;
  },
  async encrypt(plain){
    if(!plain) return null;
    if(!this.isSupported){
      return { legacy: btoa(plain) };
    }
    const key = await this.ensureKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plain);
    const buf = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, data);
    return {
      iv: bytesToBase64(iv),
      data: arrayBufferToBase64(buf)
    };
  },
  async decrypt(payload){
    if(!payload) return '';
    if(payload.legacy){
      try{ return atob(payload.legacy); }catch(_){ return ''; }
    }
    if(!this.isSupported) return '';
    const key = await this.ensureKey();
    const iv = base64ToBytes(payload.iv);
    const data = base64ToBytes(payload.data);
    const buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(buf);
  },
  cachePlain(text){
    if(text){
      sessionStorage.setItem(this.CACHE_KEY, btoa(text));
    }else{
      sessionStorage.removeItem(this.CACHE_KEY);
    }
  },
  getCachedPlain(){
    const raw = sessionStorage.getItem(this.CACHE_KEY);
    if(!raw) return '';
    try{ return atob(raw); }catch(_){ return ''; }
  }
};

function bytesToBase64(bytes){
  let binary = '';
  const len = bytes.byteLength;
  for(let i=0;i<len;i++){ binary += String.fromCharCode(bytes[i]); }
  return btoa(binary);
}
function arrayBufferToBase64(buf){
  return bytesToBase64(new Uint8Array(buf));
}
function base64ToBytes(str){
  const binary = atob(str);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for(let i=0;i<len;i++){ bytes[i] = binary.charCodeAt(i); }
  return bytes;
}
function bytesToHex(bytes){
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function hexToBytes(hex){
  const out = new Uint8Array(hex.length/2);
  for(let i=0;i<out.length;i++){
    out[i] = parseInt(hex.substr(i*2,2),16);
  }
  return out;
}
function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for(let i = 0; i < rawData.length; ++i){
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ---- Insight Data Registry (Scope definition) ----
const InsightSources = {
  timeline: {
    label: 'Fused Timeline & Skor Global',
    description: 'Data hasil analisis terakhir (query vs target) termasuk skor global dan puncak kemiripan.',
    collect(){
      const analysis = window.__lastAnalysis;
      if(!analysis || !Array.isArray(analysis.fused) || !lastQueryData || !lastTargetData){
        return { available:false, reason:'Belum ada analisis yang selesai.' };
      }
      const fused = analysis.fused;
      const globalScore = fused.reduce((a,b)=>a+b,0) / Math.max(1, fused.length);
      const maxScore = Math.max(...fused);
      const peaks = (window.__topPeaks || []).slice(0,5).map(p=>({
        score: Number(p.score||0),
        start: p.start,
        end: p.end
      }));
      return {
        available:true,
        metrics:{ globalScore, maxScore, length:fused.length },
        context:{
          query: { duration:lastQueryData.duration, name:lastQueryData.name||'Query' },
          target: { duration:lastTargetData.target?.duration, name:lastTargetData.target?.name||'Target' }
        },
        peaks
      };
    }
  },
  candidates: {
    label: 'Kandidat Serupa',
    description: 'Daftar kandidat hasil pencarian terbaru untuk rekomendasi otomatis.',
    collect(){
      const list = Array.isArray(window.__lastSearchResults) ? window.__lastSearchResults : [];
      if(!list.length){
        return {
          available:false,
          reason: window.__lastQueryFile ? 'Belum ada kandidat yang dianalisis untuk kueri terakhir.' : 'Belum menjalankan pencarian.'
        };
      }
      const sorted = [...list].sort((a,b)=> (Number(b.score)||0) - (Number(a.score)||0));
      const mapped = sorted.slice(0,5).map((row, idx)=>({
        rank: idx+1,
        id: row.item?.id,
        itemId: row.item?.id,
        name: row.item?.name || `Item ${row.item?.id ?? idx+1}`,
        source: row.item?.source || row.source || 'local',
        score: Number(row.score)||0
      }));
      const sum = sorted.reduce((acc, row)=> acc + (Number(row.score)||0), 0);
      const avgScore = sum / sorted.length;
      const maxScore = mapped[0]?.score || 0;
      const minScore = sorted[sorted.length-1]?.score || 0;
      const gapTop = mapped[1]?.score !== undefined ? Math.abs(maxScore - mapped[1].score) : null;
      const highConfidence = mapped.filter(row=> row.score >= 0.65);
      return {
        available:true,
        total: list.length,
        recommendations: mapped,
        stats: { avgScore, maxScore, minScore, gapTop },
        highConfidence,
        updatedAt: list[0]?.createdAt || Date.now()
      };
    }
  },
  heatmap: {
    label: 'Heatmap & DTW Path',
    description: 'Matriks kemiripan dan rute DTW yang digunakan untuk insight temporal.',
    collect(){
      const info = window.__heatmapInfo;
      if(!info || !info.H){
        return { available:false, reason:'Heatmap belum dibuat.' };
      }
      const rows = info.H.length;
      const cols = info.H[0]?.length || 0;
      let sum = 0, count = 0;
      info.H.forEach(row=>{
        row.forEach(v=>{ sum+=v; count++; });
      });
      const avg = count ? sum / count : 0;
      return {
        available:true,
        matrix:{ rows, cols, avgSim: avg },
        dtw:{
          length: info.path?.length || 0
        }
      };
    }
  },
  shots: {
    label: 'Snapshot Bukti',
    description: 'Cuplikan video/foto yang sudah diambil sebagai bukti visual.',
    collect(){
      const shots = window.__shots || [];
      if(!shots.length){
        return { available:false, reason:'Belum ada snapshot.' };
      }
      const latest = shots[shots.length-1];
      return {
        available:true,
        count: shots.length,
        latest: { t: latest.t, withTarget: !!latest.target }
      };
    }
  },
  robustness: {
    label: 'Robustness Batch',
    description: 'Hasil variasi ffmpeg.wasm untuk menguji ketahanan pencarian.',
    collect(){
      const results = window.__rbResults || [];
      if(!results.length){
        return { available:false, reason:'Belum ada pengujian robustness.' };
      }
      const sorted = [...results].sort((a,b)=> b.score - a.score);
      const best = sorted[0];
      const worst = sorted[sorted.length-1];
      return {
        available:true,
        count: results.length,
        best: { label: best.label, score: best.score, sizeMB: best.size/1024/1024 },
        worst: { label: worst.label, score: worst.score },
        lastHistory: window.__rbHistory?.[0] || null
      };
    }
  },
  evaluation: {
    label: 'Evaluasi Sistem',
    description: 'Ringkasan precision/recall/f1 dari modul evaluasi internal.',
    collect(){
      const ev = window.__evResults;
      if(!ev || !ev.summary){
        return { available:false, reason:'Belum menjalankan evaluasi.' };
      }
      return {
        available:true,
        summary: ev.summary,
        sampleSize: ev.results?.length || 0
      };
    }
  }
};

function collectInsightSnapshot(){
  const snapshot = {};
  Object.entries(InsightSources).forEach(([key, src])=>{
    const base = { label: src.label, description: src.description };
    try{
      const data = src.collect?.() || { available:false, reason:'collect() tidak mengembalikan data' };
      snapshot[key] = Object.assign(base, data);
    }catch(e){
      snapshot[key] = Object.assign(base, { available:false, error: e?.message||String(e) });
    }
  });
  return snapshot;
}

window.collectInsightSnapshot = collectInsightSnapshot;
if(!window.InsightEngine && typeof InsightEngine !== 'undefined'){
  window.InsightEngine = InsightEngine;
}

async function refreshInsightFeedbackCache(){
  if(!window.DB?.listInsightFeedback) return;
  try{
    window.__insightFeedbackCache = await DB.listInsightFeedback();
  }catch(e){
    console.warn('feedback cache load fail', e);
  }
}
function getInsightFeedbackStatus(key){
  if(!key) return null;
  const rows = (window.__insightFeedbackCache||[]).filter(r=>r.insightKey===key);
  if(!rows.length) return null;
  rows.sort((a,b)=> (b.timestamp||0)-(a.timestamp||0));
  return rows[0];
}
function applyInsightFeedbackState(card, status){
  if(!card) return;
  const statusEl = card.querySelector('.insight-feedback-status');
  const btnPos = card.querySelector('button[data-value="positive"]');
  const btnNeg = card.querySelector('button[data-value="negative"]');
  if(statusEl){
    if(status){
      statusEl.textContent = status.value==='positive' ? 'Ditandai akurat' : 'Ditandai tidak akurat';
    }else{
      statusEl.textContent = 'Belum ada feedback';
    }
  }
  if(btnPos){
    btnPos.classList.toggle('active', status?.value === 'positive');
  }
  if(btnNeg){
    btnNeg.classList.toggle('active', status?.value === 'negative');
  }
}
async function handleInsightFeedback(insight, value, card){
  if(!insight || !value || !window.DB?.saveInsightFeedback){
    alert('Feedback belum tersedia.');
    return;
  }
  const key = insight.key || `${insight.type||'insight'}:${insight.title||''}`;
  const entry = {
    insightKey: key,
    type: insight.type || '',
    title: insight.title || '',
    value,
    timestamp: Date.now()
  };
  try{
    await DB.saveInsightFeedback(entry);
    await refreshInsightFeedbackCache();
    const status = getInsightFeedbackStatus(key);
    applyInsightFeedbackState(card, status);
    const msg = document.getElementById('insightFeedbackMsg');
    if(msg){
      msg.textContent = `Terakhir menilai: ${value==='positive' ? 'Akurat' : 'Tidak akurat'} (${new Date(entry.timestamp).toLocaleTimeString()})`;
    }
    showToast(value==='positive' ? 'Insight ditandai akurat.' : 'Insight ditandai tidak akurat.', { type: value==='positive' ? 'success':'warning' });
  }catch(e){
    console.error(e);
    alert('Gagal menyimpan feedback: '+(e?.message||e));
  }
}



// ---- Settings & Persistence ----
// Extend Settings defaults for backend

const DEFAULT_BACKEND_URL = (()=> {
  try{
    if(typeof window !== 'undefined' && window.location && /^https?:/i.test(window.location.protocol)){
      return window.location.origin;
    }
  }catch(_){}
  return 'http://localhost:8088';
})();

// Simple backend client
async function apiFetch(path, opt={}){
  const s = Settings.load();
  if(!s.useBackend) throw new Error('Backend disabled');
  const base = (s.backendUrl||'').trim();
  if(!base){ throw new Error('Backend URL belum disetel di menu Pengaturan.'); }
  const url = base.replace(/\/+$/,'') + path;
  opt.headers = Object.assign({}, opt.headers||{}, {'Content-Type':'application/json'});
  if(s.apiKey){ opt.headers['X-API-Key'] = s.apiKey; }
  const res = await fetch(url, opt);
  if(!res.ok){
    let body = '';
    try{ body = await res.text(); }catch(_){}
    const msg = body ? `API ${res.status} - ${body}` : `API ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

const Settings = {
  _cache: null,
  load(){
    if(this._cache){
      return Object.assign({}, this._cache);
    }
    let data = {};
    try{ data = JSON.parse(localStorage.getItem('mf_settings')||'{}'); }catch(_){ data = {}; }
    data = Object.assign(this.defaults(), data);
    if(!data.apiKey && data.apiKeyEnc){
      const cached = SecureStore.getCachedPlain();
      if(cached){ data.apiKey = cached; }
    }
    this._cache = Object.assign({}, data);
    return Object.assign({}, this._cache);
  },
  save(obj){
    if(!obj || typeof obj !== 'object') return;
    const payload = Object.assign({}, obj);
    if(!payload.apiKeyEnc && this._cache?.apiKeyEnc){
      payload.apiKeyEnc = this._cache.apiKeyEnc;
    }
    delete payload.apiKey;
    try{ localStorage.setItem('mf_settings', JSON.stringify(payload)); }catch(e){ console.warn('Settings save failed', e); }
    this._cache = Object.assign({}, payload, { apiKey: obj.apiKey||'' });
  },
  defaults(){
    return {
      fps:1,
      seg:1,
      wv:0.5,
      wa:0.5,
      hmThr:0.2,
      localOnly:false,
      themeMode:'system',
      useBackend:false,
      backendUrl:'',
      apiKey:'',
      apiKeyEnc:null,
      vapidKey:'',
      pushEnabled:false
    };
  }
};

async function applySettingsToUI(){
  const s = Object.assign(Settings.defaults(), Settings.load());
  if(!s.apiKey && s.apiKeyEnc){
    try{
      const decoded = await SecureStore.decrypt(s.apiKeyEnc);
      s.apiKey = decoded || '';
      SecureStore.cachePlain(s.apiKey);
      Settings._cache = Object.assign({}, Settings._cache||{}, s);
    }catch(e){
      console.warn('Decrypt API key gagal', e);
    }
  }
  const byId = id => document.getElementById(id);
  if(byId('st_fps')) byId('st_fps').value = s.fps;
  if(byId('st_seg')) byId('st_seg').value = s.seg;
  if(byId('st_wv')) byId('st_wv').value = s.wv;
  if(byId('st_wa')) byId('st_wa').value = s.wa;
  if(byId('st_hmThr')) byId('st_hmThr').value = s.hmThr;
  if(byId('st_localOnly')) byId('st_localOnly').checked = !!s.localOnly;
  if(byId('st_themeMode')) byId('st_themeMode').value = s.themeMode || 'system';
  if(byId('st_useBackend')) byId('st_useBackend').checked = !!s.useBackend;
  if(byId('st_backendUrl')) byId('st_backendUrl').value = s.backendUrl || '';
  if(byId('st_apiKey')) byId('st_apiKey').value = s.apiKey || '';
  if(byId('st_vapid')) byId('st_vapid').value = s.vapidKey || '';
  // push to main controls if exist
  if(document.getElementById('fps')) document.getElementById('fps').value = s.fps;
  if(document.getElementById('segSec')) document.getElementById('segSec').value = s.seg;
  if(document.getElementById('wv')) document.getElementById('wv').value = s.wv;
  if(document.getElementById('wa')) document.getElementById('wa').value = s.wa;
  updateApiKeyState(s.apiKey||'', !!s.apiKeyEnc);
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    updatePushState('unsupported');
  }else{
    updatePushState(s.pushEnabled ? 'aktif' : 'off');
  }
  const pushEnable = document.getElementById('push_enable');
  const pushDisable = document.getElementById('push_disable');
  const allowPush = !!s.useBackend && !!(s.backendUrl);
  if(pushEnable) pushEnable.disabled = !allowPush;
  if(pushDisable) pushDisable.disabled = !allowPush;
  updateBackendBanner();
}

function updateApiKeyState(value, encrypted=false, opts={}){
  const status = document.getElementById('api_state');
  if(!status) return;
  if(opts.pending){
    status.textContent = 'Menyimpan...';
    return;
  }
  if(!value){
    status.textContent = 'Belum ada API key';
    return;
  }
  if(opts.dirty){
    status.textContent = 'Belum disimpan';
    return;
  }
  if(encrypted){
    status.textContent = SecureStore.isSupported ? 'Tersimpan terenkripsi (AES-GCM)' : 'Disimpan tanpa enkripsi (browser lama)';
  }else{
    status.textContent = 'Tersimpan sementara';
  }
}

function updatePushState(state){
  const label = document.getElementById('push_state');
  const enableBtn = document.getElementById('push_enable');
  const disableBtn = document.getElementById('push_disable');
  if(!label) return;
  let msg = '';
  switch(state){
    case 'aktif':
      msg = 'Aktif  notifikasi akan muncul saat dataset backend diperbarui.';
      if(enableBtn) enableBtn.disabled = true;
      if(disableBtn) disableBtn.disabled = false;
      break;
    case 'pending':
      msg = 'Memproses...';
      if(enableBtn) enableBtn.disabled = true;
      if(disableBtn) disableBtn.disabled = true;
      break;
    case 'unsupported':
      msg = 'Browser tidak mendukung notifikasi push.';
      if(enableBtn) enableBtn.disabled = true;
      if(disableBtn) disableBtn.disabled = true;
      break;
    default:
      msg = 'Belum diaktifkan';
      if(enableBtn) enableBtn.disabled = false;
      if(disableBtn) disableBtn.disabled = true;
      break;
  }
  label.textContent = msg;
}

function generateApiKey(){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = (window.crypto?.getRandomValues) ? crypto.getRandomValues(new Uint8Array(24)) : Array.from({length:24},()=> Math.floor(Math.random()*alphabet.length));
  let out = 'MF-';
  for(let i=0;i<arr.length;i++){
    const idx = arr[i] % alphabet.length;
    out += alphabet[idx];
    if((i+1)%4===0 && i< arr.length-1) out += '-';
  }
  return out;
}

document.getElementById('api_generate')?.addEventListener('click', ()=>{
  const el = document.getElementById('st_apiKey');
  if(!el) return;
  const key = generateApiKey();
  el.value = key;
  updateApiKeyState(key, false, { dirty:true });
});
document.getElementById('api_regen')?.addEventListener('click', ()=>{
  const el = document.getElementById('st_apiKey');
  if(!el) return;
  if(el.value && !confirm('Regenerasi akan mengganti API key saat ini. Lanjutkan?')) return;
  const key = generateApiKey();
  el.value = key;
  updateApiKeyState(key, false, { dirty:true });
});
document.getElementById('api_copy')?.addEventListener('click', async ()=>{
  const el = document.getElementById('st_apiKey');
  if(!el || !el.value){ alert('Belum ada API key yang bisa disalin.'); return; }
  try{
    await navigator.clipboard.writeText(el.value);
    showToast?.('API key disalin');
  }catch(_){
    el.select();
    document.execCommand?.('copy');
    showToast?.('API key disalin (fallback)');
  }
});
document.getElementById('st_apiKey')?.addEventListener('input', (e)=>{
  updateApiKeyState(e.target.value || '', false, { dirty:true });
});

async function enableBackendPush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    updatePushState('unsupported');
    alert('Browser tidak mendukung push notification.');
    return;
  }
  if(typeof Notification === 'undefined'){
    updatePushState('unsupported');
    alert('API Notification tidak tersedia di browser ini.');
    return;
  }
  const s = Settings.load();
  if(!s.useBackend){
    updatePushState('off');
    showToast?.('Push notifikasi memerlukan backend. Mode lokal tetap berjalan tanpa notifikasi.', { type:'info' });
    return;
  }
  if(!s.backendUrl){
    alert('Isi Backend Base URL terlebih dahulu.');
    return;
  }
  const vapid = document.getElementById('st_vapid')?.value?.trim() || s.vapidKey || '';
  if(!vapid){
    alert('Masukkan VAPID Public Key dari backend.');
    return;
  }
  const perm = await Notification.requestPermission();
  if(perm !== 'granted'){
    alert('Izin notifikasi ditolak.');
    updatePushState('off');
    return;
  }
  try{
    updatePushState('pending');
    const reg = await navigator.serviceWorker.ready;
    const key = urlBase64ToUint8Array(vapid);
    const existing = await reg.pushManager.getSubscription();
    if(existing){ await existing.unsubscribe(); }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:key });
    try{
      await apiFetch('/api/notify/subscribe', {
        method:'POST',
        body: JSON.stringify({ subscription: sub, topics:['dataset-updates'] })
      });
    }catch(e){
      console.warn('Gagal mendaftarkan subscription ke backend', e);
    }
    const current = Settings.load();
    current.vapidKey = vapid;
    current.pushEnabled = true;
    Settings.save(current);
    updatePushState('aktif');
    showToast('Notifikasi dataset diaktifkan', {
      title:'Backend Update',
      type:'success',
      action:{ label:'Buka Korpus', handler: ()=>{
        activateTab('#tab-corpus');
      }}
    });
  }catch(e){
    console.error(e);
    alert('Gagal mengaktifkan push: '+(e?.message||e));
    updatePushState('off');
  }
}

async function disableBackendPush(){
  if(!('serviceWorker' in navigator)){
    updatePushState('unsupported');
    return;
  }
  updatePushState('pending');
  const canNotifyBackend = Settings.load().useBackend;
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(sub){
      if(canNotifyBackend){
        try{
          await apiFetch('/api/notify/unsubscribe', {
            method:'POST',
            body: JSON.stringify({ endpoint: sub.endpoint })
          });
        }catch(e){
          console.warn('Backend unsubscribe gagal', e);
        }
      }
      await sub.unsubscribe();
    }
  }catch(e){
    console.warn('disable push', e);
  }
  const current = Settings.load();
  current.pushEnabled = false;
  Settings.save(current);
  updatePushState('off');
  showToast('Notifikasi dataset dimatikan', { type:'warn' });
}

document.getElementById('st_save')?.addEventListener('click', async () => {
  const prev = Settings.load();
  const s = {
    // Pengaturan Umum
    fps: Number(document.getElementById('st_fps').value) || 1,
    seg: Number(document.getElementById('st_seg').value) || 1,
    wv: Number(document.getElementById('st_wv').value) || 0.5,
    wa: Number(document.getElementById('st_wa').value) || 0.5,
    hmThr: Number(document.getElementById('st_hmThr').value) || 0.2,
    localOnly: !!document.getElementById('st_localOnly').checked,
    themeMode: document.getElementById('st_themeMode')?.value || 'system',
    
    // Pengaturan Backend
    useBackend: !!document.getElementById('st_useBackend')?.checked,
    backendUrl: document.getElementById('st_backendUrl')?.value || '',
    apiKey: document.getElementById('st_apiKey')?.value || '',
    vapidKey: document.getElementById('st_vapid')?.value || prev.vapidKey || '',
    pushEnabled: prev.pushEnabled || false
  };
  updateApiKeyState(s.apiKey, false, { pending:true });
  if(s.apiKey){
    try{
      const enc = await SecureStore.encrypt(s.apiKey);
      s.apiKeyEnc = enc;
      SecureStore.cachePlain(s.apiKey);
    }catch(e){
      console.warn('Encrypt API key gagal', e);
      s.apiKeyEnc = null;
    }
  }else{
    s.apiKeyEnc = null;
    SecureStore.cachePlain('');
  }
  Settings.save(s);
  setThemePreference(s.themeMode || 'system', { persist:false });
  updateApiKeyState(s.apiKey, !!s.apiKeyEnc);
  updatePushState(s.pushEnabled ? 'aktif' : 'off');
  updateBackendBanner();
  refreshBackendStatus();
  showToast?.('Pengaturan disimpan');
});

document.getElementById('st_reset')?.addEventListener('click', ()=>{
  SecureStore.cachePlain('');
  const def = Settings.defaults();
  Settings.save(def);
  applySettingsToUI();
  setThemePreference('system', { persist:false });
  updateApiKeyState('', false);
  updatePushState('off');
  refreshBackendStatus();
  showToast?.('Pengaturan dikembalikan');
});

// Call on boot
applySettingsToUI();
refreshInsightFeedbackCache();
renderInsightPanel();

const themeMedia = window.matchMedia('(prefers-color-scheme: light)');
let themePreference = (Settings.load().themeMode) || localStorage.getItem('mf_theme_mode') || 'system';
function resolveTheme(mode){
  if(mode === 'light' || mode === 'dark') return mode;
  return themeMedia.matches ? 'light' : 'dark';
}
function applyTheme(mode){
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle('light', resolved === 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta){
    meta.setAttribute('content', resolved === 'light' ? '#f8fafc' : '#0b1020');
  }
  themePreference = mode;
}
function setThemePreference(mode, opts={}){
  const pref = mode || 'system';
  applyTheme(pref);
  if(opts.persist === false) return;
  const current = Object.assign(Settings.defaults(), Settings.load(), { themeMode: pref });
  Settings.save(current);
  localStorage.setItem('mf_theme_mode', pref);
}
applyTheme(themePreference);
themeMedia.addEventListener('change', ()=>{
  if(themePreference === 'system'){
    applyTheme('system');
  }
});
document.getElementById('st_themeMode')?.addEventListener('change', (e)=>{
  setThemePreference(e.target.value || 'system');
});
const themeModes = ['system','light','dark'];
document.getElementById('themeToggle')?.addEventListener('click', ()=>{
  const current = themePreference || 'system';
  const idx = themeModes.indexOf(current);
  const next = themeModes[(idx+1) % themeModes.length];
  setThemePreference(next);
  const select = document.getElementById('st_themeMode');
  if(select) select.value = next;
  const label = next === 'system' ? 'Ikuti Sistem' : (next === 'light' ? 'Terang' : 'Gelap');
  showToast?.(`Tema: ${label}`);
});

// ---- Status indikator (backend & cache) ----
function setStatusDot(el, status, tooltip){
  if(!el) return;
  el.classList.remove('ok','warn','error','off');
  if(status==='ok') el.classList.add('ok');
  else if(status==='warn') el.classList.add('warn');
  else if(status==='error') el.classList.add('error');
  else el.classList.add('off');
  if(tooltip) el.title = tooltip;
}

async function refreshCacheStatus(){
  const el = document.getElementById('cacheIndicator');
  try{
    if(!('caches' in window)){ setStatusDot(el, 'warn', 'Cache tidak didukung'); return; }
    const keys = await caches.keys();
    const count = keys.filter(k=>k.startsWith('mfw-')).length;
    setStatusDot(el, 'ok', `Cache PWA aktif (${count} entri)`);
  }catch(_){
    setStatusDot(el, 'warn', 'Tidak bisa membaca cache');
  }
}

async function refreshBackendStatus(){
  const el = document.getElementById('backendIndicator');
  const s = Settings.load();
  if(!s.useBackend){
    setStatusDot(el, 'off', 'Mode lokal (backend nonaktif)');
    return;
  }
  if(!s.backendUrl){
    setStatusDot(el, 'warn', 'Backend belum diatur');
    return;
  }
  try{
    const data = await apiFetch('/api/health', { method:'GET' });
    setStatusDot(el, "ok", "Backend OK - cache " + (data.cache_ttl||"-"));
    // sembunyikan banner jika backend sudah sehat
    updateBackendBanner();
  }catch(err){
    setStatusDot(el, 'error', 'Backend tidak bisa dijangkau');
    console.warn('Backend health fail', err);
  }
}
refreshCacheStatus();
setTimeout(refreshBackendStatus, 200);

// ---- Banner backend / mode lokal ----
function updateBackendBanner(){
  const banner = document.getElementById('backendBanner');
  if(!banner) return;
  const title = document.getElementById('backendBannerTitle');
  const msg = document.getElementById('backendBannerMsg');
  const s = Settings.load();
  const missingBackend = s.useBackend && (!s.backendUrl || !s.apiKey);
  if(missingBackend){
    banner.hidden = false;
    if(title) title.textContent = 'Backend belum dikonfigurasi';
    if(msg) msg.textContent = 'Isi Backend URL dan API key di Pengaturan, atau aktifkan Mode Lokal.';
    return;
  }
  if(!s.useBackend){
    banner.hidden = true;
    return;
  }
  banner.hidden = true;
}
updateBackendBanner();

document.getElementById('bannerToSettings')?.addEventListener('click', ()=>{
  activateTab('#tab-settings');
});
document.getElementById('bannerGoLocal')?.addEventListener('click', ()=>{
  const cur = Settings.load();
  cur.useBackend = false;
  Settings.save(cur);
  applySettingsToUI();
  refreshBackendStatus();
  showToast?.('Mode Lokal diaktifkan. Impor indeks secara lokal.', { type:'info' });
});

const I18N = { /* placeholder */ };
const I18N_TARGETS = {}; 

const heroState = {
  totalItems: 0,
  totalHashes: 0,
  mode: 'Mode Lokal',
  lastAction: 'Menunggu aktivitas pengguna',
  cta: 'Impor video atau buka indeks lokal untuk mulai'
};

// Debug panel untuk melihat log event (opsional)
window.__dumpEvents = async (limit=50)=>{
  try{
    const ev = await DB.listEvents(limit);
    console.table(ev.slice(-limit));
    return ev;
  }catch(e){
    console.warn('Gagal baca event log', e);
    return [];
  }
};
function updateHeroStats(partial = {}){
  Object.assign(heroState, partial);
  const fmt = (val) => typeof val === 'number' ? val.toLocaleString('id-ID') : val;
  const mapping = {
    statItems: fmt(heroState.totalItems),
    statHashes: fmt(heroState.totalHashes),
    statMode: heroState.mode,
    statLastAction: heroState.lastAction,
    statCTA: heroState.cta
  };
  Object.entries(mapping).forEach(([id, value])=>{
    const el = document.getElementById(id);
    if(el && value != null){ el.textContent = value; }
  });
}
updateHeroStats({ mode: Settings.load().useBackend ? 'Mode Backend' : 'Mode Lokal' });

const onboardSteps = [
  { id:'intro', title:'Sekilas MediaFinder', body:'Impor video referensi, jalankan pencarian, lalu analisis detailnya dari tab Analisis.' },
  { id:'heatmap', title:'Heatmap Kemiripan', body:'Panel heatmap menunjukan intensitas pHash antara kueri dan target. Klik sel untuk lompat ke detik tertentu.' },
  { id:'dtw', title:'Dynamic Time Warping', body:'DTW membantu melihat alur kemiripan walaupun durasi berbeda. Jalankan untuk mendapatkan jalur terbaik.' },
  { id:'robustness', title:'Lab Robustness', body:'Eksperimen kondisi seperti resolusi dan kualitas menggunakan ffmpeg.wasm untuk melihat seberapa robust fingerprint Anda.' }
];
const onboardModal = document.getElementById('onboardModal');
const onboardTitle = document.getElementById('onboardTitle');
const onboardStepsList = onboardModal?.querySelector('.onboard-steps');
const onboardPrev = document.getElementById('onboardPrev');
const onboardNext = document.getElementById('onboardNext');
const onboardDone = document.getElementById('onboardDone');
const onboardClose = document.querySelector('.onboard-close');
const onboardRemember = document.getElementById('onboardDontShow');
let onboardIndex = 0;
let lastFocusedOnboard = null;
const focusSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function renderOnboard(){
  if(!onboardModal) return;
  const step = onboardSteps[onboardIndex] || onboardSteps[0];
  if(onboardTitle) onboardTitle.textContent = step.title;
  if(onboardStepsList){
    onboardStepsList.innerHTML = `<li><h3>${step.title}</h3><p>${step.body}</p></li>`;
  }
  if(onboardPrev){
    onboardPrev.disabled = onboardIndex === 0;
  }
  if(onboardNext){
    onboardNext.hidden = onboardIndex >= onboardSteps.length - 1;
  }
  if(onboardDone){
    onboardDone.hidden = onboardIndex < onboardSteps.length - 1;
  }
}
function trapOnboardFocus(e){
  if(e.key !== 'Tab') return;
  const focusable = Array.from(onboardModal.querySelectorAll(focusSelectors)).filter(el=>!el.disabled && el.offsetParent !== null);
  if(!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if(e.shiftKey){
    if(document.activeElement === first){
      last.focus();
      e.preventDefault();
    }
  }else{
    if(document.activeElement === last){
      first.focus();
      e.preventDefault();
    }
  }
}
function openOnboard(stepId){
  if(!onboardModal) return;
  const idx = onboardSteps.findIndex(s=>s.id===stepId);
  onboardIndex = idx >=0 ? idx : 0;
  renderOnboard();
  onboardRemember.checked = false;
  onboardModal.classList.add('open');
  onboardModal.setAttribute('aria-hidden','false');
  lastFocusedOnboard = document.activeElement;
  onboardModal.addEventListener('keydown', trapOnboardFocus);
  setTimeout(()=>{
    (onboardModal.querySelector(focusSelectors))?.focus();
  }, 50);
}
function closeOnboard(savePreference){
  if(!onboardModal) return;
  onboardModal.classList.remove('open');
  onboardModal.setAttribute('aria-hidden','true');
  onboardModal.removeEventListener('keydown', trapOnboardFocus);
  if(savePreference){
    localStorage.setItem('mf_onboard_done', 'yes');
  }
  if(lastFocusedOnboard?.focus){
    lastFocusedOnboard.focus();
  }
}
onboardPrev?.addEventListener('click', ()=>{
  if(onboardIndex > 0){
    onboardIndex--;
    renderOnboard();
  }
});
onboardNext?.addEventListener('click', ()=>{
  if(onboardIndex < onboardSteps.length - 1){
    onboardIndex++;
    renderOnboard();
  }
});
onboardDone?.addEventListener('click', ()=>{
  const remember = onboardRemember?.checked;
  closeOnboard(remember);
});
onboardClose?.addEventListener('click', ()=>{
  closeOnboard(onboardRemember?.checked);
});
document.getElementById('openOnboardGuide')?.addEventListener('click', ()=>{
  openOnboard('intro');
});
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape' && onboardModal?.classList.contains('open')){
    closeOnboard(onboardRemember?.checked);
  }
});
document.querySelectorAll('[data-onboard]')?.forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    const id = e.currentTarget.getAttribute('data-onboard');
    openOnboard(id || 'intro');
  });
});
if(onboardModal && localStorage.getItem('mf_onboard_done') !== 'yes'){
  setTimeout(()=> openOnboard('intro'), 800);
}

// Guard: local-only for external libs
function isLocalOnly(){ return !!Settings.load().localOnly; }

// Reset button
document.getElementById('resetBtn').addEventListener('click', async ()=>{
  if(!confirm('Semua data lokal (IndexedDB, cache, SW) akan dihapus. Lanjutkan?')) return;
  try{ indexedDB.deleteDatabase('mediafinder-db'); }catch(e){}
  try{ indexedDB.deleteDatabase('mediafinder-db-v02'); }catch(e){}
  try{ indexedDB.deleteDatabase('mediafinder-db-v03reset'); }catch(e){}
  try{ indexedDB.deleteDatabase('mediafinder-db-v04'); }catch(e){}
  try{ const keys = await caches.keys(); await Promise.all(keys.filter(k=>k.startsWith('mfw-')).map(k=>caches.delete(k))); }catch(e){}
  if('serviceWorker' in navigator){
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r=>r.unregister()));
  }
  location.reload();
});

// ---------- DB Init ----------
(async function init(){
  await DB.openDB();
  log('Siap. Silakan impor video.');
  refreshTable();
})();

// ---------- Utils: DCT & pHash ----------
const DCTN = 32;
const COS = new Array(DCTN).fill(0).map(()=> new Float64Array(DCTN));
for(let u=0; u<DCTN; u++){
  for(let x=0; x<DCTN; x++){
    COS[u][x] = Math.cos((Math.PI*(2*x+1)*u)/(2*DCTN));
  }
}
function alpha(u){ return u===0 ? Math.SQRT1_2 : 1.0; }
function dct2_separable(gray){
  const tmp = new Float64Array(DCTN*DCTN);
  for(let y=0; y<DCTN; y++){
    for(let u=0; u<DCTN; u++){
      let sum=0;
      for(let x=0; x<DCTN; x++){ sum += gray[y*DCTN + x] * COS[u][x]; }
      tmp[y*DCTN + u] = alpha(u) * sum;
    }
  }
  const out = new Float64Array(DCTN*DCTN);
  for(let v=0; v<DCTN; v++){
    for(let u=0; u<DCTN; u++){
      let sum=0;
      for(let y=0; y<DCTN; y++){ sum += tmp[y*DCTN + u] * COS[v][y]; }
      out[u*DCTN + v] = 0.25 * alpha(v) * sum;
    }
  }
  return out;
}
function toGrayscale(px){
  const gray = new Float32Array(DCTN*DCTN);
  for(let i=0, j=0;i<px.length;i+=4, j++){
    gray[j] = 0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2];
  }
  return gray;
}
function pHashFromImageData(imgData) {
  const gray = toGrayscale(imgData.data);
  const coeff = dct2_separable(gray);
  const lf = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) { // PERBAIKAN: vv<8 menjadi v<8
      lf.push(coeff[u * DCTN + v]);
    }
  }
  const median = lf.slice(1).sort((a, b) => a - b)[Math.floor(lf.length / 2)];
  let bits = 0n, idx = 0;
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      if (u === 0 && v === 0) { idx++; continue; }
      const bit = lf[idx] > median ? 1n : 0n;
      bits = (bits << 1n) | bit;
      idx++;
    }
  }
  // PASTIKAN HASH SELALU DISIMPAN SEBAGAI HEKSADESIMAL
  return bits.toString(16);
}

function hamming64(a, b){
  let x = a ^ b; let c = 0;
  while(x){ x &= (x-1n); c++; }
  return c;
}

// ---------- Audio Chroma ----------
function nextPow2(n){ let p=1; while(p<n) p<<=1; return p; }
function hann(N, n){ return 0.5*(1 - Math.cos(2*Math.PI*n/(N-1))); }
function fft(real, imag){
  const n = real.length, levels = Math.log2(n)|0;
  if(1<<levels !== n) throw new Error('FFT size must be power of 2');
  for(let i=0,j=0;i<n;i++){
    if(i<j){ const tr=real[i]; real[i]=real[j]; real[j]=tr; const ti=imag[i]; imag[i]=imag[j]; imag[j]=ti; }
    let m=n>>1; while(j>=m){ j-=m; m>>=1; } j+=m;
  }
  for(let size=2; size<=n; size<<=1){
    const half=size>>1, step=Math.PI*2/size;
    for(let i=0;i<n;i+=size){
      for(let j=0;j<half;j++){
        const k=j*step, wr=Math.cos(k), wi=-Math.sin(k);
        const ar=real[i+j+half], ai=imag[i+j+half];
        const tr=wr*ar - wi*ai, ti=wr*ai + wi*ar;
        real[i+j+half]=real[i+j]-tr; imag[i+j+half]=imag[i+j]-ti;
        real[i+j]+=tr; imag[i+j]+=ti;
      }
    }
  }
}
async function extractAudioChromaFromFile(file, segSec=1){
  const ab = await file.arrayBuffer();
  const ac = new (window.AudioContext||window.webkitAudioContext)();
  let buf;
  try{ buf = await ac.decodeAudioData(ab.slice(0)); }
  catch(e){ try{ ac.close(); }catch(_){ } return { sampleRate:0, segSec, chromaSegs:[] }; }
  const sr = buf.sampleRate, data = buf.getChannelData(0), L = data.length;
  const Nwin = nextPow2(Math.max(1024, Math.floor(sr*segSec))), step = Nwin;
  const chromaSegs = [];
  for(let start=0; start+Nwin<=L; start+=step){
    const re=new Float64Array(Nwin), im=new Float64Array(Nwin);
    for(let n=0;n<Nwin;n++){ const w=hann(Nwin,n); re[n]=(data[start+n]||0)*w; }
    fft(re,im);
    const chroma = new Float64Array(12);
    for(let k=1;k<Nwin/2;k++){
      const mag=Math.hypot(re[k],im[k]), f=k*sr/Nwin;
      if(f<50||f>5000) continue;
      const m=69+12*Math.log2(f/440), pc=((Math.round(m)%12)+12)%12;
      chroma[pc]+=mag;
    }
    let norm=0; for(let i=0;i<12;i++) norm+=chroma[i]*chroma[i];
    norm=Math.sqrt(norm)||1; for(let i=0;i<12;i++) chroma[i]/=norm;
    chromaSegs.push({ t: Math.floor((start+Nwin/2)/sr), chroma: Array.from(chroma) });
    if(chromaSegs.length%4===0) await new Promise(r=>setTimeout(r,0));
  }
  try{ ac.close(); }catch(_){}
  return { sampleRate: sr, segSec, chromaSegs };
}
function cosine(a,b){ let dot=0,na=0,nb=0; for(let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; } return dot/((Math.sqrt(na)||1)*(Math.sqrt(nb)||1)); }
function computeAudioSimilarityPerSecond(qSegs, tSegs, segSec, duration){
  const L=Math.max(1,duration), arr=new Array(L).fill(0);
  const map=(segs)=>{ const m=new Map(); for(const s of segs){ const sec=Math.floor(s.t); if(!m.has(sec)) m.set(sec,[]); m.get(sec).push(s.chroma);} return m; };
  const mq=map(qSegs), mt=map(tSegs);
  for(let s=0;s<L;s++){
    const qv=mq.get(s), tv=mt.get(s);
    if(!qv||!tv){ arr[s]=0; continue; }
    let best=0; for(const a of qv){ for(const b of tv){ best=Math.max(best,cosine(a,b)); } } arr[s]=best;
  }
  return arr;
}

// ---------- Heatmap ----------
function computeVisualSimMatrix(qHashes,tHashes,maxSize=200){
  const n=qHashes.length,m=tHashes.length, sx=Math.max(1,Math.floor(m/Math.min(m,maxSize))), sy=Math.max(1,Math.floor(n/Math.min(n,maxSize)));
  const hhq = qHashes.map(h => BigInt('0x' + h.hash)), hht = tHashes.map(h => BigInt('0x' + h.hash)), H = [];
  for(let i=0;i<n;i+=sy){
    const row=[];
    for(let j=0;j<m;j+=sx){
      let sum=0,cnt=0;
      for(let ii=i;ii<Math.min(i+sy,n);ii++){
        for(let jj=j;jj<Math.min(j+sx,m);jj++){
          const ham=hamming64(hhq[ii],hht[jj]);
          sum+=1-(Number(ham)/63.0); cnt++;
        }
      }
      row.push(sum/(cnt||1));
    }
    H.push(row);
  }
  return H;
}
function drawHeatmap(canvas,matrix){
  const ctx=canvas.getContext('2d'); const h=matrix.length, w=matrix[0]?.length||0;
  if(!h||!w){ ctx.clearRect(0,0,canvas.width,canvas.height); return; }
  const img=ctx.createImageData(w,h); let p=0;
  for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ const v=matrix[y][x];
    const r=v<0.5?255:Math.round(255*(1-(v-0.5)/0.5));
    const g=v>0.5?255:Math.round(255*(v/0.5));
    img.data[p++]=r; img.data[p++]=g; img.data[p++]=0; img.data[p++]=255;
  } }
  const off=document.createElement('canvas'); off.width=w; off.height=h; off.getContext('2d').putImageData(img,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingEnabled=false; ctx.drawImage(off,0,0,canvas.width,canvas.height);
}

// ---------- Extraction (pHash) ----------
function grayHist16(imgData){
  const px = imgData.data; const H = new Float64Array(16);
  for(let i=0;i<px.length;i+=4){
    const g = (0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2]) / 255;
    const bin = Math.min(15, Math.max(0, Math.floor(g*16)));
    H[bin] += 1;
  }
  const n = px.length/4 || 1; for(let i=0;i<16;i++) H[i] /= n;
  return H;
}
function l1(a,b){ let s=0; for(let i=0;i<a.length;i++) s += Math.abs((a[i]||0)-(b[i]||0)); return s; }


async function awaitSeek(video, targetTime, timeoutMs=1500){
  return new Promise((resolve,reject)=>{
    let done=false;
    const onSeeked = ()=>{ if(done) return; done=true; cleanup(); resolve(); };
    const onTime = ()=>{ if(Math.abs(video.currentTime - targetTime) < 0.05){ onSeeked(); } };
    const to = setTimeout(()=>{ if(done) return; done=true; cleanup(); resolve(); }, timeoutMs);
    function cleanup(){ video.removeEventListener('seeked', onSeeked); video.removeEventListener('timeupdate', onTime); clearTimeout(to); }
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('timeupdate', onTime);
    // kick
    video.currentTime = Math.min(targetTime, Math.max(0, video.duration||targetTime));
  });
}

const fileInput = document.getElementById('fileInput');
const progress = document.getElementById('progress');
const logEl = document.getElementById('log');
function log(msg){ logEl.textContent += msg + "\\n"; logEl.scrollTop = logEl.scrollHeight; }
function clearLog(){ logEl.textContent=""; }

async function extractVideoPHashes(file, fps=1, opts={}){
  // Try RVFC-based capture; fallback to seek-based.
  return new Promise(async (resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    try{
      video.src = url;
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      await new Promise(res => {
        const onMeta = ()=>{ cleanup(); res(); };
        const to = setTimeout(()=>{ cleanup(); res(); }, 2000);
        function cleanup(){ video.removeEventListener('loadedmetadata', onMeta); clearTimeout(to); }
        if(video.readyState >= 1){ onMeta(); } else { video.addEventListener('loadedmetadata', onMeta); }
      });

      const duration = Math.max(0, Math.floor(video.duration||0));
      const maxFrames = 180;
      const step = Math.max(1/fps, (duration||maxFrames)/maxFrames);
      const c = document.createElement('canvas');
      c.width = DCTN; c.height = DCTN;
      let ctx = c.getContext('2d', { willReadFrequently: true });
      if(!ctx) ctx = c.getContext('2d');

      const hashes = [];
      let lastHist = null;
      const mode = (opts.mode||'hybrid');
      const histThr = Math.max(0, Math.min(1, Number(opts.histThr||0.12)));
      const minInterval = Math.max(0.1, Number(opts.minInterval||0.5));
      let nextCapture = 0;

      async function useSeekFallback(){
        try {
          for(let t=0; t<=(duration||0); t+= step){
            await awaitSeek(video, Math.min(t, video.duration||t));
            ctx.drawImage(video, 0, 0, DCTN, DCTN);
            const img = ctx.getImageData(0,0,DCTN,DCTN);
            const acceptPeriodic = (t >= nextCapture);
            const acceptDelta = (()=>{ if(mode!=='hybrid') return false; const H = grayHist16(img); const diff = lastHist? l1(H,lastHist): 1; if(diff>=histThr){ lastHist = H; return true; } if(acceptPeriodic && !lastHist) lastHist = H; return false; })();
            if(acceptPeriodic || acceptDelta){
              const h = pHashFromImageData(img);
              hashes.push({ t: Math.floor(t), hash: h.toString(16) });
              nextCapture = Math.max(nextCapture + step, t + minInterval);
              if(hashes.length >= maxFrames) {/* ok */}
            }
            if(hashes.length % 12 === 0) await new Promise(r=>setTimeout(r,0));
          }
          URL.revokeObjectURL(url);
          resolve({ duration, hashes });
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      }

      if (typeof video.requestVideoFrameCallback === 'function'){
        let nextCapture = 0;
        let resolved = false; // <-- will fix
        try{
          await video.play().catch(()=>{});
          const onFrame = (now, meta)=>{
            try{
              const t = meta.mediaTime || video.currentTime || 0;
              if (t >= nextCapture && hashes.length < maxFrames){
                ctx.drawImage(video, 0, 0, DCTN, DCTN);
                const img = ctx.getImageData(0,0,DCTN,DCTN);
                const acceptPeriodic = (t >= nextCapture);
                const acceptDelta = (()=>{ if(mode!=='hybrid') return false; const H = grayHist16(img); const diff = lastHist? l1(H,lastHist): 1; if(diff>=histThr){ lastHist = H; return true; } if(acceptPeriodic && !lastHist) lastHist = H; return false; })();
                if(acceptPeriodic || acceptDelta){
                  const h = pHashFromImageData(img);
                  hashes.push({ t: Math.floor(t), hash: h.toString(16) });
                  nextCapture = Math.max(nextCapture + step, t + minInterval);
                }
              }
              const nearEnd = (duration && t >= duration - 0.05);
              if(!nearEnd && hashes.length < maxFrames){
                video.requestVideoFrameCallback(onFrame);
              }else{
                video.pause();
                URL.revokeObjectURL(url);
                resolved = true;
                resolve({ duration, hashes });
              }
            }catch(e){
              console.warn('RVFC frame error, fallback to seek:', e);
              video.pause();
              if(!resolved){ resolved=true; useSeekFallback(); }
            }
          };
          video.requestVideoFrameCallback(onFrame);
        }catch(e){
          console.warn('RVFC setup failed, fallback to seek:', e);
          if(!resolved){ useSeekFallback(); }
        }
      } else {
        await useSeekFallback();
      }
    }catch(err){
      URL.revokeObjectURL(url);
      reject(err);
    }
  });
}

async function extractVideoPHashesTransformed(file, fps = 1, transformOpts = {}) {
  const { down = 1, blur = 0, bright = 100, speed = 1 } = transformOpts;
  
  return new Promise(async (resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    try {
      video.src = url;
      video.preload = 'auto';
      video.muted = true;
      video.playbackRate = speed; // Atur kecepatan pemutaran

      await new Promise(res => {
        video.onloadedmetadata = () => res();
        setTimeout(res, 2000);
      });

      const duration = Math.max(0, Math.floor(video.duration || 0)) / speed;
      const maxFrames = 180;
      const step = Math.max(1 / fps, (duration || maxFrames) / maxFrames);

      const canvas = document.createElement('canvas');
      const w = 32 / down, h = 32 / down;
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      
      // Terapkan filter transformasi
      ctx.filter = `blur(${blur}px) brightness(${bright}%)`;

      const hashes = [];
      for (let t = 0; t <= duration; t += step) {
        await awaitSeek(video, Math.min(t * speed, video.duration || t * speed));
        
        // Gambar ke canvas dengan downscaling dan filter
        ctx.drawImage(video, 0, 0, w, h);
        if (down > 1) {
            // Jika di-downscale, gambar lagi ke ukuran 32x32 untuk hashing
            ctx.drawImage(canvas, 0, 0, w, h, 0, 0, 32, 32);
        }

        const img = ctx.getImageData(0, 0, 32, 32);
        const p_hash = pHashFromImageData(img);
        hashes.push({ t: Math.floor(t), hash: p_hash.toString() });
        
        if (hashes.length >= maxFrames) break;
        if (hashes.length % 10 === 0) await new Promise(r => setTimeout(r, 0));
      }
      
      URL.revokeObjectURL(url);
      resolve({ duration, hashes });

    } catch (err) {
      URL.revokeObjectURL(url);
      reject(err);
    }
  });
}


fileInput.addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files || []);
  if(!files.length) return;
  DB.logEvent?.({ type:'index:start', count: files.length }).catch(()=>{});
  clearLog();
  const bar = document.getElementById('indexProgress');
  const fill = document.getElementById('indexProgressFill');
  const label = document.getElementById('indexProgressLabel');
  const meta = document.getElementById('indexProgressMeta');
  if(bar){ bar.hidden = false; }
  if(progress){ progress.style.display='block'; progress.value = 0; }
  const tStart = Date.now();
  let lastEta = '';
  let done = 0;
  let backendFailed = false;
  for(const f of files.slice(0,10)){
    log(`Mengindeks: ${f.name}`);
    try{
      const s = Settings.load();
      updateHeroStats({
        lastAction: `Mengindeks ${f.name}`,
        cta: s.useBackend ? 'Fingerprint dikirim ke backend' : 'Fingerprint disimpan di IndexedDB'
      });
      const kfMode = (document.getElementById('kfMode')?.value)||'hybrid';
      const histThr = Number(document.getElementById('histThrIdx')?.value)||0.12;
      const minI = Number(document.getElementById('minIntervalIdx')?.value)||0.5;
      const { duration, hashes } = await extractVideoPHashes(f, 1, { mode:kfMode, histThr, minInterval:minI });
      const elapsed = (Date.now() - tStart)/1000;
      const avgPerFile = elapsed / Math.max(1, done+1);
      const remaining = Math.max(0, (files.length - (done+1)) * avgPerFile);
      if(label){ label.textContent = `Mengindeks ${f.name}`; }
      if(meta){ meta.textContent = `Durasi ${duration}s - ETA ${remaining.toFixed(1)} dtk`; lastEta = meta.textContent; }
      const useAudio = !!document.getElementById('useAudio')?.checked;
      let chromaSegs = [];
      if(useAudio){
        try{
          const segSec = getSeg();
          const a = await extractAudioChromaFromFile(f, segSec);
          chromaSegs = a.chromaSegs||[];
        }catch(err){
          console.warn('audio chroma fail:', err);
          chromaSegs = [];
        }
      }
      let id;
      let storedRemote = false;
      if(s.useBackend){
        try{
          const payload = { item:{ name: f.name, duration, fps:1 }, hashes: hashes.map(h=>({t:h.t, hash:String(h.hash)})) };
          if(chromaSegs.length){
            payload.chroma = chromaSegs.map(seg=> Array.from(seg.chroma||[]));
          }
          const resp = await apiFetch('/api/index/json', { method:'POST', body: JSON.stringify(payload)});
          id = resp.id;
          storedRemote = true;
        }catch(err){
          console.warn('backend index failed, fallback local', err);
          showToast?.(`Backend gagal menyimpan ${f.name}: ${err?.message||err}. Disimpan lokal.`, { type:'warning', duration: 4000 });
          id = await DB.addItem({ name: f.name, duration }, hashes);
          backendFailed = true;
        }
      }else{
        id = await DB.addItem({ name: f.name, duration }, hashes);
      }
      if(!storedRemote){
        try{
          const save = document.getElementById('saveOriginal')?.checked;
          if(save && f.size <= 120*1024*1024){ await DB.addFileBlob(id, f); }
        }catch(err){
          console.warn('save file fail', err);
        }
        if(chromaSegs.length){
          try{
            await DB.addChroma(id, chromaSegs);
          }catch(err){
            console.warn('audio chroma store fail:', err);
          }
        }
      }
      log(`Selesai ${f.name} - durasi ${duration}s, ${hashes.length} hash`);
      DB.logEvent?.({ type:'index:success', name:f.name, duration, hashes: hashes.length }).catch(()=>{});
    }catch(err){
      log(`Gagal ${f.name}: ${err?.message||err}`);
      DB.logEvent?.({ type:'index:error', name:f.name, message: err?.message||String(err) }).catch(()=>{});
      backendFailed = backendFailed || Settings.load().useBackend;
    }
    done++;
    const pct = Math.round(done/files.length*100);
    if(fill){ fill.style.width = `${pct}%`; }
    if(label){ label.textContent = `Berhasil ${done}/${files.length}`; }
    if(meta && lastEta){ meta.textContent = lastEta; }
    if(progress){ progress.value = pct; }
  }
  if(bar){ bar.hidden = true; }
  if(progress){ progress.style.display='none'; }
  refreshTable({ preferLocal: backendFailed });
  if(backendFailed){
    showToast?.('Backend gagal menyimpan. Item disimpan lokal dan ditampilkan.', { type:'warning' });
  }
  log('Selesai mengindeks semua berkas.');
  const summarySettings = Settings.load();
  updateHeroStats({
    lastAction: `Selesai mengindeks ${done}/${files.length} berkas`,
    cta: summarySettings.useBackend ? 'Fingerprint terbaru telah dikirim ke backend' : 'Fingerprint tersimpan di perangkat ini'
  });
});
async function refreshTable(opts={}){
  const tbody = document.querySelector('#mediaTable tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  const settings = Settings.load();
  const preferLocal = !!opts.preferLocal;
  if(settings.useBackend && !preferLocal){
    try{
      const data = await apiFetch('/api/items?page=1&page_size=50', { method:'GET' });
      const items = data.items||[];
      let totalHashes = 0;
      if(items.length === 0){
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="5">Belum ada item di backend.</td>';
        tbody.appendChild(tr);
      }else{
        items.forEach(it=>{
          const hashCount = (typeof it.hash_count === 'number') ? it.hash_count : (it.hashes||0);
          const chromaCount = (typeof it.chroma_count === 'number') ? it.chroma_count : (it.chroma||0);
          totalHashes += hashCount;
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${it.name}</td><td>${it.duration}</td><td>${hashCount}</td><td>${chromaCount}</td>
      <td><button class="secondary" data-view="${it.id}" data-source="backend">Lihat</button></td>`;
          tbody.appendChild(tr);
        });
        tbody.querySelectorAll('button[data-view]').forEach(btn=>{
          btn.addEventListener('click', async (ev)=>{
            const id = Number(ev.currentTarget.getAttribute('data-view'));
            try{
              lastTargetData = await fetchBackendItemDetail(id);
              showToast?.('Target dimuat dari backend: '+(lastTargetData.target?.name||id));
              document.querySelector('nav .tab-btn[data-tab="#tab-analisis"]')?.click();
              drawTimeline(lastQueryData, lastTargetData);
              await loadTargetPreview(id, 'backend');
            }catch(err){
              alert('Gagal memuat item backend: '+(err?.message||err));
            }
          });
        });
      }
      updateHeroStats({
        totalItems: items.length,
        totalHashes,
        mode: 'Mode Backend',
        lastAction: items.length ? `Sinkron backend (${items.length} item)` : 'Belum ada indeks di backend',
        cta: items.length ? 'Gunakan tab Pencarian untuk mulai' : 'Unggah indeks melalui tab Indeks'
      });
    }catch(err){
      console.error(err);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5">Gagal memuat data backend: ${err?.message||err}</td>`;
      tbody.appendChild(tr);
      updateHeroStats({
        mode: 'Mode Backend',
        lastAction: 'Gagal memuat data backend',
        cta: 'Periksa koneksi backend melalui tombol Health'
      });
    }
    return;
  }
  const items = await DB.listItems();
  let totalHashes = 0;
  if(items.length === 0){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5">Belum ada item di indeks lokal. Impor video di atas untuk memulai.</td>';
    tbody.appendChild(tr);
    // tidak memunculkan wizard penuh agar UI tidak terblok; gunakan toast
    showToast?.('Indeks kosong. Impor video di tab Indeks untuk memulai.', { type:'info' });
  }
  for(const it of items){
    const hashes = await DB.listHashes(it.id);
    totalHashes += hashes.length;
    let chromaCount = 0;
    try{ chromaCount = await DB.countChroma(it.id); }catch(_){}
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${it.name}</td><td>${it.duration}</td><td>${hashes.length}</td><td>${chromaCount}</td>
      <td><button class="secondary" data-view="${it.id}" data-source="local">Lihat</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('button[data-view]').forEach(btn=>{
    btn.addEventListener('click', async (ev)=>{
      const id = Number(ev.currentTarget.getAttribute('data-view'));
      const item = await DB.getItem(id);
      const hashes = await DB.listHashes(id);
      let chroma = [];
      try{ chroma = await DB.listChroma(id); }catch(_){}
      lastTargetData = { target: item, hashes, _chroma: chroma.map(x=>({t:x.t, chroma:x.chroma})) };
      document.querySelector('nav .tab-btn[data-tab="#tab-analisis"]')?.click();
      drawTimeline(lastQueryData, lastTargetData);
      await loadTargetPreview(id, 'local');
    });
  });
  updateHeroStats({
    totalItems: items.length,
    totalHashes,
    mode: 'Mode Lokal',
    lastAction: items.length ? `Indeks lokal siap (${items.length} item)` : 'Belum ada media yang diindeks',
    cta: items.length ? 'Gunakan tab Pencarian untuk menjalankan kueri' : 'Tambahkan video melalui tombol Impor'
  });
}


function downloadBlob(data, filename, mime){
  const blob = new Blob([data], {type:mime});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}


function getFps(){ return Number(document.getElementById('fps')?.value) || Settings.load().fps || 1; }
function getSeg(){ return Number(document.getElementById('segSec')?.value) || Settings.load().seg || 1; }
function getWV(){ return Number(document.getElementById('wv')?.value) || Settings.load().wv || 0.5; }
function getWA(){ return Number(document.getElementById('wa')?.value) || Settings.load().wa || 0.5; }

// ---------- Search ----------
const queryInput = document.getElementById('queryInput');
const searchBtn = document.getElementById('searchBtn');
const resultBody = document.querySelector('#resultTable tbody');
const logSearch = document.getElementById('logSearch');
let lastQueryData = null;
let lastTargetData = null;
function slog(msg){ logSearch.textContent += msg + "\\n"; logSearch.scrollTop = logSearch.scrollHeight; }
// Placeholder untuk fungsi menggambar grafik.
function plotLine(canvas, data, color = '#4f46e5') {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const series = Array.isArray(data) ? data : [];
  const pts = series.map((v, idx) => {
    if (typeof v === 'number') return { x: idx, y: v };
    if (v && typeof v === 'object') {
      const y = typeof v.y === 'number' ? v.y :
        typeof v.score === 'number' ? v.score :
        typeof v.value === 'number' ? v.value :
        typeof v.val === 'number' ? v.val : Number(v) || 0;
      const x = typeof v.x === 'number' ? v.x :
        typeof v.t === 'number' ? v.t : idx;
      return { x, y, label: v.label || v.name || null };
    }
    return { x: idx, y: Number(v) || 0 };
  });

  const W = canvas.width;
  const H = canvas.height;
  const pad = 24;
  ctx.clearRect(0, 0, W, H);

  if (!pts.length) {
    ctx.fillStyle = '#777';
    ctx.textAlign = 'center';
    ctx.font = '12px sans-serif';
    ctx.fillText('Tidak ada data untuk digambar', W / 2, H / 2);
    if (canvas.__plotHandlers) {
      canvas.removeEventListener('mousemove', canvas.__plotHandlers.move);
      canvas.removeEventListener('mouseleave', canvas.__plotHandlers.leave);
      if (canvas.__plotHandlers.tooltip?.remove) canvas.__plotHandlers.tooltip.remove();
      delete canvas.__plotHandlers;
    }
    return;
  }

  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  const spanX = (maxX - minX) || 1;
  const spanY = (maxY - minY) || 1;

  const toCanvas = (p) => ({
    x: pad + ((p.x - minX) / spanX) * (W - 2 * pad),
    y: H - pad - ((p.y - minY) / spanY) * (H - 2 * pad)
  });

  const render = (highlightIdx = -1) => {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, H - pad);
    ctx.lineTo(W - pad, H - pad);
    ctx.stroke();

    // area fill
    const gradient = ctx.createLinearGradient(0, pad, 0, H - pad);
    gradient.addColorStop(0, color + '55');
    gradient.addColorStop(1, color + '05');
    ctx.beginPath();
    pts.forEach((p, idx) => {
      const c = toCanvas(p);
      if (idx === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.lineTo(pad + (W - 2 * pad), H - pad);
    ctx.lineTo(pad, H - pad);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, idx) => {
      const c = toCanvas(p);
      if (idx === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();

    ctx.fillStyle = color;
    if (highlightIdx >= 0) {
      const hp = toCanvas(pts[highlightIdx]);
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  render();

  const tooltip = document.createElement('div');
  tooltip.style.position = 'fixed';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.background = 'rgba(15,23,42,0.9)';
  tooltip.style.color = '#fff';
  tooltip.style.padding = '4px 8px';
  tooltip.style.borderRadius = '6px';
  tooltip.style.fontSize = '12px';
  tooltip.style.zIndex = 9999;
  tooltip.style.transition = 'opacity 0.15s';
  tooltip.style.opacity = '0';
  document.body.appendChild(tooltip);

  const getNearest = (clientX) => {
    const rect = canvas.getBoundingClientRect();
    const relX = Math.max(pad, Math.min(rect.width - pad, clientX - rect.left));
    const targetX = minX + ((relX - pad) / (rect.width - 2 * pad)) * spanX;
    let bestIdx = 0;
    let bestDist = Infinity;
    pts.forEach((p, idx) => {
      const dist = Math.abs(p.x - targetX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    return bestIdx;
  };

  const move = (ev) => {
    const rect = canvas.getBoundingClientRect();
    if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) {
      leave();
      return;
    }
    const idx = getNearest(ev.clientX);
    const pt = pts[idx];
    render(idx);
    tooltip.textContent = `t=${pt.x.toFixed(2)} � skor=${pt.y.toFixed(3)}`;
    if (pt.label) tooltip.textContent += ` � ${pt.label}`;
    tooltip.style.left = `${ev.clientX + 12}px`;
    tooltip.style.top = `${ev.clientY + 12}px`;
    tooltip.style.opacity = '1';
  };

  const leave = () => {
    render(-1);
    tooltip.style.opacity = '0';
  };

  if (canvas.__plotHandlers) {
    canvas.removeEventListener('mousemove', canvas.__plotHandlers.move);
    canvas.removeEventListener('mouseleave', canvas.__plotHandlers.leave);
    canvas.__plotHandlers.tooltip?.remove();
  }

  canvas.__plotHandlers = { move, leave, tooltip };
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseleave', leave);
}
function sclr(){ logSearch.textContent=""; }

// Di dalam file app.js, ganti blok logika pencarian
searchBtn.addEventListener('click', async () => {
  // === BLOK TAMBAHAN UNTUK MEMPERBAIKI VARIABEL ===
  const f = document.getElementById('queryInput')?.files?.[0];
  if (!f) { slog('Silakan unggah file kueri terlebih dahulu.'); return; }
  DB.logEvent?.({ type:'search:start', name:f.name }).catch(()=>{});
  window.__lastQueryFile = f;
  const fps = getFps();
  const segSec = getSeg();
  const kfMode = document.getElementById('kfModeQ')?.value || 'hybrid';
  const histThr = Number(document.getElementById('histThr')?.value) || 0.12;
  const minInterval = Number(document.getElementById('minInterval')?.value) || 0.5;
  const threshold = Number(document.getElementById('threshold')?.value) || 0;
  const bar = document.getElementById('searchProgress');
  const fill = document.getElementById('searchProgressFill');
  const label = document.getElementById('searchProgressLabel');
  if(bar){ bar.hidden = false; if(fill) fill.style.width = '10%'; if(label) label.textContent = 'Menyiapkan kueri...'; }
  sclr();
  slog(`Mengekstrak fitur dari: ${f.name}`);
  // === AKHIR BLOK TAMBAHAN ===

  const q = await extractVideoPHashes(f, fps, { mode:kfMode, histThr, minInterval });
  if(fill) fill.style.width = '40%';
  if(label) label.textContent = 'Ekstraksi audio (opsional)...';

  try {
    const useAudio = document.getElementById('useAudio')?.checked;
    if (useAudio) {
      const a = await extractAudioChromaFromFile(f, segSec);
      q._chromaSegs = a.chromaSegs ?? [];
    } else {
      q._chromaSegs = [];
    }
    q._segSec = segSec;
  } catch (e) {
    // opsional: log agar tidak �kosong�
    console.error(e);
    slog(`Gagal ekstrak audio: ${e.message}`);
    q._chromaSegs = [];
    q._segSec = segSec;
  }

  lastQueryData = q;
  slog(`Durasi ${q.duration}s; ${q.hashes.length} hash;`);

  const settings = Settings.load();
  if (settings.useBackend) {
    // --- MODE BACKEND ---
    slog('Mencari menggunakan backend...');
    if(fill) fill.style.width = '65%';
    if(label) label.textContent = 'Mengirim kueri ke backend...';
    try {
      const payload = {
        hashes: q.hashes.map(h => h.hash),
        duration: q.duration,
        k: 10,
        max_hamming: 14,
        wv: getWV(),
        wa: getWA(),
        use_audio: document.getElementById('useAudio')?.checked,
        q_chroma: (q._chromaSegs || []).map(seg => seg.chroma)
      };

      const response = await apiFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if(fill) fill.style.width = '90%';
      if(label) label.textContent = 'Menggabungkan kandidat...';

      const formattedResults = (response.results || []).map(res => ({
        item: { id: res.id, name: res.name, source: 'backend' },
        score: res.score,
        backend: true
      }));

      renderResults(formattedResults);
      slog(`Backend menemukan ${formattedResults.length} kandidat.`);
      DB.logEvent?.({ type:'search:backend', results: formattedResults.length, threshold }).catch(()=>{});
      updateHeroStats({
        lastAction: `Pencarian backend: ${formattedResults.length} kandidat`,
        cta: formattedResults.length ? 'Klik Analisis untuk melihat detail per segmen' : 'Coba ubah parameter atau indeks lain'
      });
    } catch (e) {
      slog(`ERROR: Gagal mencari via backend: ${e.message}`);
      console.error(e);
      updateHeroStats({
        lastAction: 'Pencarian backend gagal',
        cta: 'Periksa log atau tab health backend'
      });
      DB.logEvent?.({ type:'search:backend_error', message: e?.message||String(e) }).catch(()=>{});
      if(bar){ bar.hidden = true; }
      return;
    }

  } else {
    // --- MODE LOKAL (CLIENT-SIDE) ---
    const existing = await DB.listItems();
    if(existing.length === 0){
      slog('Indeks lokal kosong. Impor video di tab Indeks lebih dulu.');
      document.querySelector('nav .tab-btn[data-tab="#tab-indeks"]')?.click();
      showToast?.('Indeks lokal kosong. Impor video di tab Indeks lebih dulu.', { type:'info' });
      if(bar){ bar.hidden = true; }
      DB.logEvent?.({ type:'search:no_index' }).catch(()=>{});
      return;
    }
    slog('Mencari secara lokal di browser...');
    if(fill) fill.style.width = '65%';
    if(label) label.textContent = 'Menghitung kandidat lokal...';
    const items = await DB.listItems();
    const scores = [];
    const wv = getWV();
    const wa = getWA();

    for (const it of items) {
      const hashes = await DB.listHashes(it.id);
      const chromaT = await DB.listChroma(it.id).catch(() => []);

      const workerResult = await computeFusedTimelineWorker(
        { hashes: q.hashes, _chromaSegs: q._chromaSegs },
        { hashes, _chroma: chromaT.map(x => ({ t: x.t, chroma: x.chroma })) },
        wv, wa
      );

      const fused = (workerResult.fused?.length ? workerResult.fused : workerResult.vis);
      const score = fused.reduce((a,b)=>a+b, 0) / (fused.length || 1);
      scores.push({ item: Object.assign({ source:'local' }, it), score, hashes, fused });
    }

    scores.sort((a, b) => b.score - a.score);
    const top = scores.slice(0, 10);
    renderResults(top);
    slog(`Pencarian lokal selesai. ${top.length} kandidat teratas ditampilkan.`);
    DB.logEvent?.({ type:'search:local', results: top.length, total: scores.length, threshold }).catch(()=>{});
    updateHeroStats({
      lastAction: `Pencarian lokal: ${Math.min(10, scores.length)} kandidat teratas`,
      cta: scores.length ? 'Pilih salah satu hasil lalu buka tab Analisis' : 'Impor korpus terlebih dahulu'
    });
  }
  if(bar){ bar.hidden = true; }
  if(fill) fill.style.width = '100%';
  if(label) label.textContent = 'Selesai';
});


async function fetchBackendItemDetail(id){
  const data = await apiFetch('/api/item?id='+id+'&include=hashes,chroma', { method:'GET' });
  const hashes = (data.hashes||[]).map(h=>({ t:h.t, hash:h.hash }));
  const chroma = (data.chroma||[]).map((c,t)=>({ t, chroma:c }));
  return { target: data.item, hashes, _chroma: chroma };
}

function renderResults(list){
  resultBody.innerHTML='';
  const safeList = Array.isArray(list) ? list : [];
  const normalized = safeList.map(row=>{
    const item = row?.item || {};
    const source = item.source || row?.source || (row?.backend ? 'backend':'local');
    return {
      item: {
        id: item.id,
        name: item.name,
        source,
        duration: item.duration
      },
      score: Number(row?.score)||0,
      source,
      createdAt: Date.now()
    };
  });
  window.__lastSearchResults = normalized;
  if(safeList.length === 0){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="3">Belum ada hasil. Unggah kueri lalu klik "Cari Mirip".</td>`;
    resultBody.appendChild(tr);
    return;
  }
  safeList.forEach(row => {
    const source = row.item?.source || (row.backend ? 'backend' : 'local');
    const itemName = row.item?.name || `Item ${row.item?.id ?? ''}`;
    const itemId = row.item?.id ?? '';
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = itemName;
    const tdScore = document.createElement('td');
    tdScore.textContent = Number(row.score||0).toFixed(3);
    const tdAction = document.createElement('td');
    const btn = document.createElement('button');
    btn.dataset.analyze = itemId;
    btn.textContent = 'Analisis';
    btn.setAttribute('data-source', source);
    tdAction.appendChild(btn);
    tr.appendChild(tdName);
    tr.appendChild(tdScore);
    tr.appendChild(tdAction);
    resultBody.appendChild(tr);
  });
  resultBody.querySelectorAll('button[data-analyze]').forEach(btn=>{
    btn.addEventListener('click', async (ev)=>{
      const id = Number(ev.currentTarget.getAttribute('data-analyze'));
      const src = ev.currentTarget.getAttribute('data-source') || 'local';
      let targetPayload;
      if(src === 'backend'){
        try{
          targetPayload = await fetchBackendItemDetail(id);
        }catch(err){
          alert('Gagal mengambil detail backend: '+(err?.message||err));
          return;
        }
      }else{
        const item = await DB.getItem(id);
        const hashes = await DB.listHashes(id);
        let chroma = [];
        try{ chroma = await DB.listChroma(id); }catch(_){}
        targetPayload = { target: item, hashes, _chroma: chroma.map(x=>({t:x.t, chroma:x.chroma})) };
      }
      lastTargetData = targetPayload;
      document.querySelector('nav .tab-btn[data-tab="#tab-analisis"]')?.click();
      drawTimeline(lastQueryData, lastTargetData);
      await loadTargetPreview(id, src);
      const qFile = queryInput.files?.[0];
      if(qFile){ const url = URL.createObjectURL(qFile);
        playerQ.src = url; playerQ.load();
      }
    });
  });
}


function computeVisualSimMatrix_v2(qHashes, tHashes, maxSize=240) {
    const n = qHashes.length, m = tHashes.length;
    const sx = Math.max(1, Math.floor(m / Math.min(m, maxSize)));
    const sy = Math.max(1, Math.floor(n / Math.min(n, maxSize)));
    const H = [];
    const Q = qHashes.map(x => BigInt('0x' + x.hash));
    const T = tHashes.map(x => BigInt('0x' + x.hash));

    for (let i = 0; i < n; i += sy) {
        const row = [];
        for (let j = 0; j < m; j += sx) {
            let sum = 0, cnt = 0;
            for (let ii = i; ii < Math.min(i + sy, n); ii++) {
                for (let jj = j; jj < Math.min(j + sx, m); jj++) {
                    const ham = hamming64(Q[ii], T[jj]);
                    sum += 1 - (ham / 63.0);
                    cnt++;
                }
            }
            row.push(sum / (cnt || 1));
        }
        H.push(row);
    }
    
    // Logika DTW dari worker
    const R = H.length, C = H[0]?.length || 0;
    const cost = Array.from({ length: R }, (_, i) => Array.from({ length: C }, (_, j) => 1 - H[i][j]));
    const D = Array.from({ length: R }, () => Array(C).fill(Infinity));
    const P = Array.from({ length: R }, () => Array(C).fill(0));
    D[0][0] = cost[0][0];
    for (let i = 1; i < R; i++) { D[i][0] = cost[i][0] + D[i - 1][0]; P[i][0] = 1; }
    if (C > 0) { for (let j = 1; j < C; j++) { D[0][j] = cost[0][j] + D[0][j - 1]; P[0][j] = 2; } }
    for (let i = 1; i < R; i++) {
        for (let j = 1; j < C; j++) {
            let a = D[i - 1][j - 1], b = D[i - 1][j], c = D[i][j - 1];
            if (a <= b && a <= c) { D[i][j] = cost[i][j] + a; P[i][j] = 0; }
            else if (b <= c) { D[i][j] = cost[i][j] + b; P[i][j] = 1; }
            else { D[i][j] = cost[i][j] + c; P[i][j] = 2; }
        }
    }
    let i = R - 1, j = C - 1; const path = [];
    if (R && C) {
        while (i > 0 || j > 0) {
            path.push([i, j]);
            const p = P[i][j];
            if (p === 0) { i--; j--; } else if (p === 1) { i--; } else { j--; }
        }
        path.push([0, 0]);
        path.reverse();
    }
    
    return { H, sx, sy, path };
}

// ---------- Analysis ----------
const playerQ = document.getElementById('playerQuery');
const playerT = document.getElementById('playerTarget');
const canvas = document.getElementById('timeline');
const ctx = canvas.getContext('2d');

function setVideoBlobSource(videoEl, blob){
  if(!videoEl) return;
  if(videoEl.dataset?.objectUrl){
    URL.revokeObjectURL(videoEl.dataset.objectUrl);
    delete videoEl.dataset.objectUrl;
  }
  if(blob){
    const url = URL.createObjectURL(blob);
    videoEl.src = url;
    videoEl.load();
    videoEl.dataset.objectUrl = url;
  }else{
    videoEl.removeAttribute('src');
    videoEl.load();
  }
}

async function loadTargetPreview(itemId, source){
  const hint = document.getElementById('playerTargetHint');
  if(source === 'backend'){
    setVideoBlobSource(playerT, null);
    if(hint) hint.textContent = 'Preview target tidak tersedia pada mode backend.';
    return;
  }
  try{
    const rec = await DB.getFileBlob(itemId);
    if(rec?.blob){
      setVideoBlobSource(playerT, rec.blob);
      if(hint) hint.textContent = rec.name ? `Preview: ${rec.name}` : 'Preview target siap diputar.';
      return;
    }
  }catch(err){
    console.warn('Gagal memuat blob target:', err);
  }
  setVideoBlobSource(playerT, null);
  if(hint) hint.textContent = 'Preview target belum disimpan saat impor.';
}

async function drawTimeline(q, t){
  const canvas = document.getElementById('timeline');           // pastikan ada
  const ctx = canvas.getContext('2d');
  const heat = document.getElementById('heatmap');

  if (!q || !t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (heat) { heat.getContext('2d').clearRect(0, 0, heat.width, heat.height); }
    return;
  }

  const len = Math.min(q.hashes.length, t.hashes.length);
  const vis = new Array(len).fill(0);
  for (let i = 0; i < len; i++) {
    const a = BigInt('0x' + q.hashes[i].hash);
    const b = BigInt('0x' + t.hashes[i].hash);
    const h = hamming64(a, b);
    vis[i] = 1 - (Number(h) / 64.0); // ? perbaikan: 64, bukan 63
  }

  const wv = getWV();
  const wa = getWA();
  const workerResult = await computeFusedTimelineWorker(q, t, wv, wa);
  const fused = workerResult.fused;

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const barW = Math.max(1, Math.floor(W / Math.max(1, len)));
  for (let i = 0; i < len; i++) {
    const s = fused[i];
    const x = i * barW, y = H - Math.round(s * H);
    ctx.fillStyle = s > 0.85 ? '#2e7d32' : s > 0.7 ? '#f9a825' : '#c62828';
    ctx.fillRect(x, y, barW, H - y);
  }

  if (heat) {
    let HM;
    try {
      if (!window.__hmWorker) { window.__hmWorker = new Worker('heatmap_worker.js'); }

      // kirim hex yang pasti
      const qh = q.hashes.map(h => BigInt('0x' + h.hash).toString(16));
      const th = t.hashes.map(h => BigInt('0x' + h.hash).toString(16));

      HM = await new Promise((resolve, reject) => {
        const w = window.__hmWorker;
        const onMsg = (ev) => { w.removeEventListener('message', onMsg); resolve(ev.data); };
        w.addEventListener('message', onMsg);
        w.postMessage({ q: qh, t: th, maxSize: 240 });

        // opsional: bersihkan timeout saat resolve
        const to = setTimeout(() => reject(new Error('heatmap worker timeout')), 30000);
        w.addEventListener('message', () => clearTimeout(to), { once: true });
      });
    } catch (e) {
      console.warn('worker HM failed, fallback', e);
      HM = computeVisualSimMatrix_v2(q.hashes, t.hashes); // harus return {H,sx,sy,path}
    }

    window.__heatmapInfo = { sx: HM.sx, sy: HM.sy, H: HM.H, lenQ: q.hashes.length, lenT: t.hashes.length, path: HM.path || null };
    drawHeatmap(heat, HM.H);
    if (document.getElementById('showDTW')?.checked) { drawDTWOverlay(heat, window.__heatmapInfo); }

    // klik heatmap untuk lompat
    heat.onclick = (ev) => {
      const info = window.__heatmapInfo; if (!info) return;
      const rect = heat.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      const cols = info.H[0]?.length || 0, rows = info.H.length || 0;
      if (!cols || !rows) return;
      const j = Math.min(cols - 1, Math.floor(x * cols));
      const i = Math.min(rows - 1, Math.floor(y * rows));
      const tQ = Math.floor(i * info.sy);
      const tT = Math.floor(j * info.sx);
      try { playerQ.currentTime = tQ; playerQ.play(); } catch (_) { }
      try { playerT.currentTime = tT; playerT.play(); } catch (_) { }
      if (typeof showToast === 'function') showToast(`Jump ke Q=${tQ}s, T=${tT}s`);
    };
  } // ? cukup satu penutup untuk if(heat)

  canvas.onclick = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const rel = (ev.clientX - rect.left) / rect.width;
    const tSec = Math.floor(rel * len);
    playerQ.currentTime = tSec; playerQ.play();
  };

  window.__lastAnalysis = { fused, wv, wa };
  window.__lastFused = fused;
  window.__lastVis = vis; // precompute for alignment
  drawHighlightOverlay();
}
function formatDuration(seconds, opts={}){
  const fallback = opts.fallback ?? '-';
  if(!Number.isFinite(seconds)) return fallback;
  const sec = Math.max(0, seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const base = h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${m}:${String(s).padStart(2,'0')}`;
  if(opts.compact) return base;
  return `${base}${opts.withUnit === false ? '' : ' dtk'}`;
}

function firstFiniteNumber(...values){
  for(const value of values){
    const num = Number(value);
    if(Number.isFinite(num)){ return num; }
  }
  return undefined;
}
function normalizeMetric(value, digits=3){
  const num = Number(value);
  if(!Number.isFinite(num)) return undefined;
  if(typeof digits === 'number'){
    const factor = Math.pow(10, digits);
    return Math.round(num * factor) / factor;
  }
  return num;
}
function summarizeInsightSupporting(supporting){
  if(!supporting) return null;
  const safe = {};
  const peakList = Array.isArray(supporting.peaks) ? supporting.peaks.slice(0,5) : null;
  if(peakList?.length){
    const peaks = peakList.map(p=>{
      const start = firstFiniteNumber(p.start, p.t, p.time, p.index);
      const duration = Number.isFinite(p.duration) ? Number(p.duration) : undefined;
      const end = firstFiniteNumber(p.end, p.stop, Number.isFinite(start) && Number.isFinite(duration) ? start + duration : undefined);
      const entry = {};
      if(Number.isFinite(start)) entry.start = normalizeMetric(start,3);
      if(Number.isFinite(end)) entry.end = normalizeMetric(end,3);
      const score = normalizeMetric(p.score ?? p.s ?? p.value,3);
      if(score !== undefined) entry.score = score;
      return entry;
    }).filter(obj => Object.keys(obj).length);
    if(peaks.length){ safe.peaks = peaks; }
  }
  if(typeof supporting.gap === 'number'){ safe.scoreGap = normalizeMetric(supporting.gap,4); }
  if(supporting.topScore){
    const start = firstFiniteNumber(supporting.topScore.start, supporting.topScore.t, supporting.topScore.time);
    safe.topScore = {
      label: supporting.topScore.label || supporting.topScore.name || undefined,
      start: Number.isFinite(start) ? normalizeMetric(start,3) : undefined,
      score: normalizeMetric(supporting.topScore.score,3)
    };
  }
  if(supporting.secondScore){
    const start = firstFiniteNumber(supporting.secondScore.start, supporting.secondScore.t);
    safe.secondScore = {
      label: supporting.secondScore.label || supporting.secondScore.name || undefined,
      start: Number.isFinite(start) ? normalizeMetric(start,3) : undefined,
      score: normalizeMetric(supporting.secondScore.score,3)
    };
  }
  if(supporting.matrix){
    safe.matrix = {
      rows: supporting.matrix.rows,
      cols: supporting.matrix.cols,
      avgSim: normalizeMetric(supporting.matrix.avgSim,3)
    };
  }
  if(supporting.dtw){
    safe.dtw = {
      length: supporting.dtw.length ?? supporting.dtw.path?.length ?? undefined
    };
  }
  if(supporting.best){
    safe.best = {
      label: supporting.best.label,
      score: normalizeMetric(supporting.best.score,3)
    };
  }
  if(supporting.worst){
    safe.worst = {
      label: supporting.worst.label,
      score: normalizeMetric(supporting.worst.score,3)
    };
  }
  if(typeof supporting.count === 'number'){ safe.count = supporting.count; }
  if(typeof supporting.latest === 'object' && supporting.latest){
    const tp = firstFiniteNumber(supporting.latest.t, supporting.latest.start);
    safe.latest = {
      t: Number.isFinite(tp) ? normalizeMetric(tp,3) : undefined,
      withTarget: supporting.latest.withTarget
    };
  }
  if(typeof supporting.summary === 'string'){ safe.note = supporting.summary; }
  return Object.keys(safe).length ? safe : null;
}
function describeInsightDetail(ins, supporting){
  const details = [];
  if(supporting?.peaks?.length){
    const tokens = supporting.peaks
      .map(pk => typeof pk.start === 'number' ? `t=${pk.start}s${pk.score!==undefined?` (score ${pk.score})`:''}` : null)
      .filter(Boolean);
    if(tokens.length){
      details.push(`Segmen utama: ${tokens.join(', ')}`);
    }
  }
  if(typeof supporting?.scoreGap === 'number'){
    details.push(`Gap skor ${supporting.scoreGap}`);
  }
  if(supporting?.matrix?.avgSim !== undefined){
    details.push(`Rata heatmap ${supporting.matrix.avgSim}`);
  }
  if(supporting?.best?.score !== undefined){
    details.push(`Best ${supporting.best.label||'var'}=${supporting.best.score}`);
  }
  if(supporting?.worst?.score !== undefined){
    details.push(`Worst ${supporting.worst.label||'var'}=${supporting.worst.score}`);
  }
  if(supporting?.dtw?.length){
    details.push(`DTW ${supporting.dtw.length} langkah`);
  }
  if(supporting?.note){
    details.push(supporting.note);
  }
  if(!details.length && ins?.summary){
    details.push(ins.summary);
  }
  return details.join(' | ');
}
function buildInsightExportPayload(sourceList){
  const raw = Array.isArray(sourceList) ? sourceList : (window.__insightLast || []);
  return raw.map(ins=>{
    if(!ins) return null;
    const supporting = summarizeInsightSupporting(ins.supporting);
    const entry = {
      type: ins.type || '',
      severity: ins.severity || 'info',
      title: ins.title || '',
      summary: ins.summary || '',
      detail: describeInsightDetail(ins, supporting) || (ins.summary || '')
    };
    if(supporting){ entry.supporting = supporting; }
    if(ins.recommendation){ entry.recommendation = ins.recommendation; }
    if(ins.key){ entry.key = ins.key; }
    return entry;
  }).filter(Boolean);
}


document.getElementById('exportJson')?.addEventListener('click', ()=>{
  const A = window.__lastAnalysis;
  if(!A || !lastQueryData || !lastTargetData){ alert('Analisis belum tersedia.'); return; }
  const insightsData = buildInsightExportPayload();
  const out = {
    query: { duration: lastQueryData.duration },
    target: { name: lastTargetData.target?.name, duration: lastTargetData.target?.duration },
    globalScore: (A.fused.reduce((a,b)=>a+b,0)/(A.fused.length||1)),
    weights: { wv:A.wv, wa:A.wa },
    generatedAt: new Date().toISOString(),
    timeline: A.fused.map((s,i)=>({t:i, score:s})),
    insights: insightsData
  };
  const blob = new Blob([JSON.stringify(out,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mediafinder_result.json'; a.click();
});
document.getElementById('exportCsv')?.addEventListener('click', ()=>{
  const A = window.__lastAnalysis;
  if(!A){ alert('Analisis belum tersedia.'); return; }
  let csv = 't,score\n';
  for(let i=0;i<A.fused.length;i++){ csv += `${i},${A.fused[i].toFixed(4)}\n`; }
  const insights = buildInsightExportPayload();
  const esc = (val)=>{
    if(val===undefined || val===null) return '';
    const s = String(val);
    const needsQuote = s.includes('\n') || /[",]/.test(s);
    return needsQuote ? '"' + s.replace(/"/g,'""') + '"' : s;
  };
  if(insights.length){
    csv += '\ninsight_type,severity,title,summary,detail\n';
    insights.forEach(ins=>{
      csv += `${esc(ins.type||'')},${esc(ins.severity||'')},${esc(ins.title||'')},${esc(ins.summary||'')},${esc(ins.detail||'')}\n`;
    });
  }
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mediafinder_report.csv'; a.click();
});

// Share ringkas: PNG snapshot tab Analisis
document.getElementById('exportPng')?.addEventListener('click', async ()=>{
  try{
    const section = document.querySelector('#tab-analisis');
    if(!section){ alert('Tab Analisis belum dibuka.'); return; }
    activateTab('#tab-analisis');
    const { default: html2canvas } = await import('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.esm.js');
    const canvas = await html2canvas(section, { scale: 1, useCORS:true, backgroundColor:'#0b1220' });
    canvas.toBlob((blob)=>{
      if(!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mediafinder_summary.png';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 1200);
    }, 'image/png', 0.92);
  }catch(e){
    console.error(e);
    alert('Gagal membuat PNG: '+(e?.message||e));
  }
});

// Share ringkas: JSON minimal

// Default tab
activateTab('#tab-indeks', { scroll:false });


function slidingAlignment(fusedQ, fusedT, maxShift=15, winSec=30){
  const N = fusedQ.length, M = fusedT.length;
  const range = [];
  for(let d=-maxShift; d<=maxShift; d++) range.push(d);
  const scores = [];
  let best = {shift:0, score:-1};
  for(const d of range){
    let s=0,c=0;
    for(let t=0;t<Math.min(N,M);t++){
      const j = t + d;
      if(j<0 || j>=M) continue;
      s += Math.min(1, Math.max(0, (fusedQ[t] + fusedT[j]) / 2 )); // simple overlap score
      c++;
    }
    const m = c? s/c : 0;
    scores.push(m);
    if(m>best.score){ best = {shift:d, score:m}; }
  }
  return {range, scores, best};
}


// --- Alignment UI ---
document.getElementById('runAlign')?.addEventListener('click', ()=>{
  if(!window.__lastAnalysis || !lastQueryData || !lastTargetData){ alert('Lakukan pencarian & analisis dahulu.'); return; }
  const fusedQ = window.__lastAnalysis.fused;
  // Build fusedT from last target vs itself (identity), approximate by vis of target vs target (1s). For alignment we need both sequences; we approximate: use vis derived earlier.
  const visT = window.__lastVis || fusedQ.map(()=>0.5); // fallback
  const maxShift = Number(document.getElementById('maxShift').value)||15;
  const winSec = Number(document.getElementById('winSec').value)||30;
  const res = slidingAlignment(fusedQ, visT, maxShift, winSec);
  plotLine(document.getElementById('alignPlot'), res.scores);
  const info = `Shift terbaik: ${res.best.shift} dtk, skor rata2: ${res.best.score.toFixed(3)}`;
  document.getElementById('alignInfo').textContent = info;
});

// --- Robustness re-extraction ---

document.getElementById('reextractQuery')?.addEventListener('click', async () => {
  // TAMBAHKAN BLOK INI
  const f = document.getElementById('queryInput')?.files?.[0];
  if (!f) {
    alert('Unggah berkas kueri terlebih dahulu di tab Pencarian.');
    return;
  }
  window.__lastQueryFile = f;
  const fps = getFps();
  // AKHIR BLOK TAMBAHAN

  // Ambil parameter transformasi dari UI
  const down = Number(document.getElementById('rbDown').value) || 1;
  const blur = Number(document.getElementById('rbBlur').value) || 0;
  const bright = Number(document.getElementById('rbBright').value) || 100;
  const speed = Number(document.getElementById('rbSpeed').value) || 1;
  
  slog(`(Simulasi) Re-ekstrak kueri dengan transformasi...`);
  try {
    // Panggil fungsi transformasi yang benar
    const q = await extractVideoPHashesTransformed(f, fps, { down, blur, bright, speed });
    
    lastQueryData = {
      ...q,
      _chromaSegs: lastQueryData?._chromaSegs || [],
      _segSec: lastQueryData?._segSec || 1
    };
    slog(`Kueri baru (simulasi) siap: ${q.hashes.length} hash.`);
    showToast('Kueri simulasi berhasil diekstrak ulang.');
  } catch (e) {
    slog('Gagal re-ekstrak kueri: ' + e.message);
    console.error(e);
  }
});


document.getElementById('backupBtn')?.addEventListener('click', async ()=>{
  const items = await DB.listItems();
  const out = [];
  for(const it of items){
    const hashes = await DB.listHashes(it.id);
    let chroma=[]; try{ chroma = await DB.listChroma(it.id); }catch(_){}
    out.push({ meta: it, hashes, chroma });
  }
  downloadBlob(JSON.stringify({version:'v06', items: out}, null, 2), 'mediafinder_index_backup.json', 'application/json');
});
document.getElementById('restoreInput')?.addEventListener('change', async (e)=>{
  try{
    const f = e.target.files?.[0]; if(!f) return;
    const txt = await f.text(); const obj = JSON.parse(txt);
    if(!obj.items) throw new Error('Format tidak dikenali');
    slog('Memulihkan index ...');
    for(const rec of obj.items){
      const id = await DB.addItem(rec.meta, rec.hashes);
      if(rec.chroma && rec.chroma.length){ await DB.addChroma(id, rec.chroma); }
    }
    slog('Selesai memulihkan index.');
    refreshTable();
  }catch(err){ alert('Gagal memulihkan: '+(err?.message||err)); }
});


function dtwBand(a,b,w=10){
  const n=a.length, m=b.length;
  const W = Math.max(w, Math.abs(n-m));
  const INF = 1e9;
  const D = Array.from({length:n+1}, ()=> new Float64Array(m+1).fill(INF));
  D[0][0]=0;
  for(let i=1;i<=n;i++){
    const jStart = Math.max(1, i-W);
    const jEnd   = Math.min(m, i+W);
    for(let j=jStart;j<=jEnd;j++){
      const cost = 1 - Math.min(1, Math.max(0, (a[i-1]+b[j-1])/2 ));
      const d = cost + Math.min(D[i-1][j], D[i][j-1], D[i-1][j-1]);
      D[i][j] = d;
    }
  }
  // backtrack
  let i=n, j=m; const path=[];
  while(i>0 && j>0){
    path.push([i-1,j-1]);
    const d = D[i][j] - (1 - Math.min(1, Math.max(0, (a[i-1]+b[j-1])/2 )));
    if(D[i-1][j-1] <= D[i-1][j] && D[i-1][j-1] <= D[i][j-1]){ i--; j--; }
    else if(D[i-1][j] < D[i][j-1]){ i--; }
    else { j--; }
  }
  path.reverse();
  const normCost = D[n][m]/path.length;
  return {cost: D[n][m], normCost, path};
}
document.getElementById('runDTW')?.addEventListener('click', ()=>{
  if(!window.__lastAnalysis){ alert('Lakukan analisis dahulu.'); return; }
  const a = window.__lastAnalysis.fused;
  const b = window.__lastVis || a; // fallback
  const w = Number(document.getElementById('dtwBand').value)||10;
  const res = dtwBand(a,b,w);
  const sim = 1 - Math.min(1, Math.max(0, res.normCost)); // approx sim
  document.getElementById('dtwInfo').textContent = `DTW-Lite: path=${res.path.length}, skor�${sim.toFixed(3)}`;
  // plot mapping i->j
  const map = new Array(res.path.length).fill(0).map((_,k)=>res.path[k][1]-res.path[k][0]);
  plotLine(document.getElementById('dtwPlot'), map, '#2e7d32');
});


document.getElementById('exportPdf')?.addEventListener('click', async ()=>{
  try{
    if(isLocalOnly()){ alert('Mode Local-only aktif. Export PDF dinonaktifkan.'); return; }
    const js = window.jspdf ? window.jspdf : (await loadJsPDF().catch(()=>null));
    const { jsPDF } = js || window.jspdf || {};
    if(!jsPDF){ alert('jsPDF belum termuat (butuh internet).'); return; }
    const doc = new jsPDF({unit:'pt', format:'a4'});
    doc.setLineHeightFactor(1.3);
    const PAD = 48;
    const LINE = 18;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const contentWidth = pageW - PAD * 2;
    let y = PAD;
    const limitY = pageH - PAD - 24;
    const palette = {
      text: [16,24,39],
      muted: [76,85,104],
      accent: [79,70,229],
      panel: [249,250,251],
      border: [226,232,240],
      tableHead: [15,23,42],
      bg: [243,244,246]
    };
    const ensureSpace = (need=LINE)=>{
      if(y + need <= limitY) return;
      doc.addPage();
      y = PAD;
    };
    const drawHeroHeader = (title, subtitle)=>{
      ensureSpace(70);
      doc.setFillColor(...palette.bg);
      doc.roundedRect(PAD-4, y-16, contentWidth+8, 52, 10, 10, 'F');
      doc.setFontSize(16); doc.setTextColor(...palette.text);
      doc.text(title, PAD+8, y+4);
      doc.setFontSize(10); doc.setTextColor(...palette.muted);
      doc.text(subtitle, PAD+8, y+LINE);
      y += 52;
    };
    const drawSection = (title, subtitle)=>{
      ensureSpace(LINE * 2.6);
      doc.setFontSize(12.5);
      doc.setTextColor(...palette.text);
      doc.text(title, PAD, y);
      if(subtitle){
        doc.setFontSize(9.5);
        doc.setTextColor(...palette.muted);
        doc.text(doc.splitTextToSize(subtitle, contentWidth), PAD, y + LINE*0.6);
        y += LINE * 0.5;
      }
      y += LINE * 0.6;
      doc.setDrawColor(...palette.accent);
      doc.setLineWidth(1);
      doc.line(PAD, y, PAD + Math.min(180, contentWidth), y);
      y += LINE * 0.8;
      doc.setLineWidth(0.2);
    };
    const drawCardGrid = (items, columns=2)=>{
      if(!items || !items.length) return;
      const gap = 18;
      const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
      const rows = [];
      for(let i=0;i<items.length;i+=columns){
        rows.push(items.slice(i, i+columns));
      }
      rows.forEach(row=>{
        const metrics = row.map(item=>{
          const name = (item.label || '').toUpperCase();
          const nameLines = doc.splitTextToSize(name, cardWidth - 24);
          const valLines = doc.splitTextToSize(String(item.value ?? '-'), cardWidth - 24);
          const metaLines = item.meta ? doc.splitTextToSize(String(item.meta), cardWidth - 24) : [];
          const nameHeight = nameLines.length * 11;
          const valHeight = valLines.length * 12;
          const metaHeight = metaLines.length ? metaLines.length * 10 + 4 : 0;
          const height = 24 + nameHeight + valHeight + metaHeight;
          return { nameLines, valLines, metaLines, height, nameHeight, valHeight, metaHeight };
        });
        const rowHeight = Math.max(78, ...metrics.map(m=> m.height));
        ensureSpace(rowHeight + 14);
        row.forEach((item, idx)=>{
          const metric = metrics[idx];
          const x = PAD + idx * (cardWidth + gap);
          doc.setFillColor(...palette.panel);
          doc.setDrawColor(...palette.border);
          doc.roundedRect(x, y-12, cardWidth, rowHeight, 10, 10, 'F');
          let textY = y + 6;
          doc.setFontSize(9);
          doc.setTextColor(...palette.muted);
          doc.text(metric.nameLines, x+12, textY);
          textY += metric.nameHeight + 8;
          doc.setFontSize(12);
          doc.setTextColor(...palette.text);
          doc.text(metric.valLines, x+12, textY);
          textY += metric.valHeight + 6;
          if(metric.metaLines.length){
            doc.setFontSize(9);
            doc.setTextColor(...palette.muted);
            doc.text(metric.metaLines, x+12, textY);
          }
        });
        y += rowHeight + 12;
      });
    };
    const drawTable = (columns, rows)=>{
      if(!rows || !rows.length) return;
      const widths = columns.map(col=> col.width || Math.floor(contentWidth / columns.length));
      const headerHeight = 20;
      ensureSpace(headerHeight + 10);
      doc.setFillColor(...palette.tableHead);
      doc.setTextColor(255,255,255);
      doc.roundedRect(PAD, y-14, contentWidth, headerHeight+6, 6, 6, 'F');
      doc.setFont(undefined,'bold'); doc.setFontSize(10);
      let x = PAD + 10;
      columns.forEach((col, idx)=>{
        doc.text(col.title, x, y);
        x += widths[idx];
      });
      y += headerHeight;
      doc.setFont(undefined,'normal'); doc.setFontSize(9.5);
      rows.forEach((row, ridx)=>{
        const lines = row.map((cell, idx)=>{
          const txt = cell === undefined || cell === null ? '' : String(cell);
          return doc.splitTextToSize(txt, widths[idx]-12);
        });
        const rowH = Math.max(24, ...lines.map(arr => arr.length * 11)) + 6;
        ensureSpace(rowH + 6);
        const fill = ridx % 2 === 0 ? 255 : 244;
        doc.setFillColor(fill,fill,fill);
        doc.setDrawColor(...palette.border);
        doc.rect(PAD, y-12, contentWidth, rowH, 'F');
        let colX = PAD + 10;
        const baseY = y + 4;
        lines.forEach((txt, idx)=>{
          doc.setTextColor(...palette.text);
          doc.text(txt, colX, baseY);
          colX += widths[idx];
        });
        y += rowH;
      });
      y += 10;
    };
    const addCanvasImage = (canvas)=>{
      if(!canvas) return;
      const maxWidth = contentWidth;
      const height = canvas.height * (maxWidth / canvas.width);
      ensureSpace(height + LINE);
      try{
        const data = canvas.toDataURL('image/png');
        doc.addImage(data, 'PNG', PAD, y, maxWidth, height);
        y += height + 10;
      }catch(_){}
    };
    const addBulletList = (lines)=>{
      if(!lines || !lines.length) return;
      doc.setFontSize(10);
      doc.setTextColor(...palette.muted);
      lines.forEach(text=>{
        const body = doc.splitTextToSize(text, contentWidth - 24);
        const blockH = body.length * 12;
        ensureSpace(blockH + 6);
        body.forEach((line, idx)=>{
          const prefix = idx===0 ? '�' : ' ';
          doc.text(`${prefix} ${line}`, PAD, y + idx * 12);
        });
        y += blockH + 6;
      });
      y += 4;
    };
    const A = window.__lastAnalysis;
    const fused = Array.isArray(A?.fused) ? A.fused : [];
    const segSec = lastQueryData?._segSec || 1;
    const sum = fused.reduce((acc,val)=> acc + val, 0);
    const globalScore = fused.length ? sum / fused.length : 0;
    const minScore = fused.length ? Math.min(...fused) : 0;
    const maxScore = fused.length ? Math.max(...fused) : 0;
    const variance = fused.length ? fused.reduce((acc,val)=> acc + Math.pow(val - globalScore, 2), 0) / fused.length : 0;
    const stdDev = Math.sqrt(Math.max(variance, 0));
    const infoHM = window.__heatmapInfo;
    const heatResolution = infoHM?.H ? `${infoHM.H.length} x ${infoHM.H[0]?.length || 0}` : '-';
    const dtwPathLen = infoHM?.path?.length || 0;
    const qName = window.__lastQueryFile?.name || lastQueryData?.name || 'Query lokal';
    const targetName = lastTargetData?.target?.name || 'Belum dipilih';
    const settings = Settings.load();
    const qHashes = lastQueryData?.hashes?.length || 0;
    const tHashes = lastTargetData?.hashes?.length || lastTargetData?.hashCount || 0;
    const shots = window.__shots || [];
    const highCandidates = (window.__lastSearchResults || []).filter(r=> Number(r.score) >= 0.7).length;
    const title = document.title || 'MediaFinder � Laporan Analisis';
    drawHeroHeader(title, `Dibuat: ${new Date().toLocaleString()}`);
    drawSection('Ringkasan Eksekutif', 'Detail input kueri dan target yang dianalisis.');
    drawCardGrid([
      { label:'File kueri', value: qName, meta:`Durasi ${formatDuration(lastQueryData?.duration)}` },
      { label:'Target', value: targetName, meta:`Durasi ${formatDuration(lastTargetData?.target?.duration)}` },
      { label:'Hash kueri', value: qHashes || '-', meta:'Fingerprint visual kueri' },
      { label:'Hash target', value: tHashes || '-', meta:'Fingerprint dalam korpus' },
      { label:'Mode analisis', value: settings.useBackend ? 'Backend' : 'Lokal', meta:`wv/wa ${A?.wv ?? '-'} / ${A?.wa ?? '-'}` },
      { label:'Snapshot bukti', value: shots.length ? `${shots.length} cuplikan` : 'Belum ada', meta:'Gunakan tab Snapshot' }
    ], 2);
    drawSection('Statistik Timeline', 'MetriK global yang merangkum tingkat kecocokan.');
    drawCardGrid([
      { label:'Skor global', value: fused.length ? globalScore.toFixed(3) : '-', meta:'Rata-rata kemiripan keseluruhan' },
      { label:'Skor maksimum', value: fused.length ? maxScore.toFixed(3) : '-', meta:'Segmen tertinggi' },
      { label:'Skor minimum', value: fused.length ? minScore.toFixed(3) : '-', meta:'Segmen terendah' },
      { label:'Std dev timeline', value: fused.length ? stdDev.toFixed(4) : '-', meta:'Stabilitas skor' },
      { label:'Panjang timeline', value: fused.length ? `${fused.length} sampel (~${(segSec*fused.length).toFixed(1)} dtk)` : '-', meta:'Resolusi 1 sampel/seg' },
      { label:'Resolusi heatmap', value: heatResolution, meta:`DTW ${dtwPathLen || 0} langkah` },
      { label:'Kandidat skor >=0.7', value: highCandidates || 0, meta:'Jumlah kandidat prioritas' }
    ], 3);
    drawSection('Timeline Kemiripan');
    addCanvasImage(document.getElementById('timeline'));
    drawSection('Heatmap Kueri vs Target');
    addCanvasImage(document.getElementById('heatmap'));
    drawSection('Plot Alignment / DTW');
    addCanvasImage(document.getElementById('alignPlot'));
    const peaks = (window.__topPeaks && window.__topPeaks.length) ? window.__topPeaks :
      (typeof topNPeaks === 'function' ? topNPeaks(fused, 5, 3) : []);
    drawSection('Top Segmen Mirip', 'Daftar segmen prioritas untuk inspeksi manual.');
    if(peaks.length){
      const peakRows = peaks.slice(0,10).map((p,i)=>{
        const center = Number(p.t ?? p.start ?? 0) * segSec;
        return [
          i+1,
          formatDuration(center, { compact:true, withUnit:false }),
          Number.isFinite(Number(p.s ?? p.score)) ? Number(p.s ?? p.score).toFixed(3) : '-',
          p.label || `Segmen prioritas #${i+1}`
        ];
      });
      drawTable([
        { title:'No', width:40 },
        { title:'Detik', width:90 },
        { title:'Skor', width:90 },
        { title:'Catatan', width: contentWidth - 220 }
      ], peakRows);
    }else{
      doc.setFontSize(9); doc.setTextColor(107,114,128);
      doc.text('Belum ada perhitungan Top-N. Jalankan fitur "Top Segmen Mirip" pada tab Analisis untuk menampilkan daftar ini.', PAD, y);
      y += LINE;
    }
    if(shots.length){
      drawSection('Snapshot Bukti', 'Cuplikan visual yang siap dijadikan bukti.');
      const shotRows = shots.slice(0,6).map((s, i)=>{
        const timeLabel = formatDuration(Number(s.t ?? s.start ?? 0), { compact:true, withUnit:false });
        return [
          i+1,
          timeLabel || '-',
          Number.isFinite(Number(s.score)) ? Number(s.score).toFixed(2) : '-',
          s.target ? 'Query & Target' : 'Query saja'
        ];
      });
      drawTable([
        { title:'No', width:40 },
        { title:'Timestamp', width:120 },
        { title:'Skor', width:90 },
        { title:'Tipe', width: contentWidth - 250 }
      ], shotRows);
      doc.setFontSize(9); doc.setTextColor(107,114,128);
      doc.text('Gambar snapshot tersedia pada aplikasi dan dapat diunduh terpisah (menu Snapshot).', PAD, y);
      y += LINE;
    }
    const notes = [];
    if(fused.length){
      if(globalScore >= 0.8){
        notes.push('Skor global di atas 0.80 menunjukkan kecocokan yang sangat kuat antara kueri dan target.');
      }else if(globalScore <= 0.4){
        notes.push('Skor global di bawah 0.40 � kemungkinan kecocokan rendah, verifikasi ulang kandidat lain.');
      }
      if(stdDev <= 0.05){
        notes.push('Variasi skor timeline rendah; pola kemiripan relatif stabil di sepanjang durasi.');
      }else if(stdDev >= 0.15){
        notes.push('Variasi skor tinggi; fokuskan analisis pada highlight untuk mendeteksi bagian kritis.');
      }
    }
    if(peaks.length >= 2){
      const best = peaks[0];
      const second = peaks[1];
      const gap = Math.abs((best?.s ?? best?.score ?? 0) - (second?.s ?? second?.score ?? 0));
      notes.push(`Selisih skor Top-1 vs Top-2 sebesar ${(gap*100).toFixed(1)}%.`);
    }
    if(!shots.length){
      notes.push('Belum ada snapshot bukti. Gunakan tombol "Snapshot" untuk merekam bukti visual.');
    }
    if(highCandidates >= 3){
      notes.push(`Ada ${highCandidates} kandidat dengan skor >= 0.70. Pertimbangkan evaluasi tambahan atau filter metadata.`);
    }
    if(notes.length){
      drawSection('Catatan Analisis', 'Insight manual yang perlu diperhatikan.');
      addBulletList(notes);
    }
    const insights = buildInsightExportPayload();
    if(insights.length){
      drawSection('Insight Otomatis', 'Insight dari mesin analitik (diurutkan berdasarkan prioritas).');
      const rows = insights.map((ins, idx)=>[
        idx+1,
        (ins.severity||'info').toUpperCase(),
        ins.title || '-',
        ins.detail || ins.summary || ''
      ]);
      drawTable([
        { title:'No', width:40 },
        { title:'Severity', width:90 },
        { title:'Judul', width:180 },
        { title:'Ringkasan', width: contentWidth - 310 }
      ], rows);
    }
    const totalPages = doc.getNumberOfPages();
    for(let p=1; p<=totalPages; p++){
      doc.setPage(p);
      doc.setFontSize(9);
      doc.setTextColor(120,130,150);
      doc.text(`Hal ${p} / ${totalPages}`, doc.internal.pageSize.getWidth() - PAD - 40, doc.internal.pageSize.getHeight() - 18);
    }
    doc.save('mediafinder_report.pdf');
  }catch(e){
    alert('Gagal export PDF: '+(e?.message||e));
  }
});


function topNPeaks(arr, N=5, minSep=3){
  const peaks = [];
  for(let i=1;i<arr.length-1;i++){
    if(arr[i]>=arr[i-1] && arr[i]>=arr[i+1]) peaks.push({t:i, s:arr[i]});
  }
  peaks.sort((a,b)=> b.s-a.s);
  const chosen=[];
  for(const p of peaks){
    if(chosen.every(q=> Math.abs(q.t - p.t) >= minSep )){
      chosen.push(p);
      if(chosen.length>=N) break;
    }
  }
  return chosen.sort((a,b)=> a.t-b.t);
}

function setTimelineHighlights(list){
  window.__timelineHighlights = Array.isArray(list) ? list : [];
  renderHighlightList();
  drawHighlightOverlay();
}

function renderHighlightList(){
  const el = document.getElementById('highlightList');
  if(!el) return;
  const list = window.__timelineHighlights || [];
  if(!list.length){
    el.innerHTML = '<li class="hint">Belum ada highlight. Gunakan Auto Highlight atau tandai manual.</li>';
    drawHighlightOverlay();
    return;
  }
  el.innerHTML = '';
  list.forEach((hl, idx)=>{
    const li = document.createElement('li');
    li.className = 'highlight-item';
    const title = document.createElement('div');
    title.className = 'hl-meta';
    const label = document.createElement('strong');
    label.textContent = hl.label || `Highlight ${idx+1}`;
    const span = document.createElement('span');
    span.textContent = `${formatDuration(hl.startSec,{compact:true,withUnit:false})} � ${formatDuration(hl.endSec,{compact:true,withUnit:false})}`;
    title.appendChild(label);
    title.appendChild(span);
    const actions = document.createElement('div');
    actions.className = 'hl-actions';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = `score ${Number(hl.score||0).toFixed(3)}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Lompat';
    btn.addEventListener('click', ()=> jumpToTime(hl.startSec));
    actions.appendChild(badge);
    actions.appendChild(btn);
    li.appendChild(title);
    li.appendChild(actions);
    el.appendChild(li);
  });
  drawHighlightOverlay();
}

function drawHighlightOverlay(){
  const overlay = document.getElementById('timelineOverlay');
  if(!overlay) return;
  overlay.querySelectorAll('.hl-block').forEach(el=> el.remove());
  const list = window.__timelineHighlights || [];
  const totalSamples = window.__lastAnalysis?.fused?.length || lastQueryData?.hashes?.length || 0;
  if(!totalSamples || !list.length) return;
  list.forEach((hl, idx)=>{
    const block = document.createElement('div');
    block.className = 'hl-block';
    const startIdx = Math.max(0, Number(hl.startIdx)||0);
    const endIdx = Math.max(startIdx+1, Number(hl.endIdx)||startIdx+1);
    const startPct = (startIdx / totalSamples) * 100;
    const widthPct = Math.max(1.5, ((endIdx - startIdx) / totalSamples) * 100);
    block.style.left = `${startPct}%`;
    block.style.width = `${widthPct}%`;
    block.title = `${hl.label || `Highlight ${idx+1}`} (${formatDuration(hl.startSec,{compact:true,withUnit:false})} � ${formatDuration(hl.endSec,{compact:true,withUnit:false})})`;
    block.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      jumpToTime(hl.startSec);
    });
    overlay.appendChild(block);
  });
}

function jumpToTime(sec){
  if(!Number.isFinite(sec)) return;
  try{
    playerQ.currentTime = Math.max(0, sec);
    playerQ.play().catch(()=>{});
  }catch(_){}
}

function autoHighlightTimeline(){
  if(!window.__lastAnalysis || !Array.isArray(window.__lastAnalysis.fused)){
    alert('Lakukan analisis dahulu.');
    return;
  }
  const fused = window.__lastAnalysis.fused;
  const N = Number(document.getElementById('topN')?.value)||5;
  const sep = Number(document.getElementById('minSep')?.value)||3;
  const segSec = lastQueryData?._segSec || 1;
  const peaks = topNPeaks(fused, N, sep);
  if(!peaks.length){
    alert('Highlight otomatis tidak menemukan kandidat.');
    return;
  }
  const spread = Math.max(2, Math.round(sep/2));
  const highlights = peaks.map((p, idx)=>{
    const center = Number(p.t ?? p.start ?? 0);
    const startIdx = Math.max(0, Math.round(center - spread));
    const endIdx = Math.min(fused.length, Math.round(center + spread));
    return {
      id: `auto-${Date.now()}-${idx}`,
      label: `Segmen prioritas #${idx+1}`,
      startIdx,
      endIdx,
      startSec: startIdx * segSec,
      endSec: endIdx * segSec,
      score: Number(p.s ?? p.score ?? 0),
      type:'auto'
    };
  });
  window.__topPeaks = peaks;
  setTimelineHighlights(highlights);
  showToast?.('Highlight otomatis diperbarui.', { type:'success' });
}

function exportHighlights(){
  const list = window.__timelineHighlights || [];
  if(!list.length){
    alert('Belum ada highlight untuk diekspor.');
    return;
  }
  const csvLines = ['label,start_sec,end_sec,duration_sec,score'];
  list.forEach(hl=>{
    const start = Number(hl.startSec)||0;
    const end = Number(hl.endSec)||start;
    const duration = Math.max(0, end - start);
    const score = Number(hl.score||0);
    const label = (hl.label || '').replace(/"/g,'""');
    csvLines.push(`"${label}",${start.toFixed(3)},${end.toFixed(3)},${duration.toFixed(3)},${score.toFixed(3)}`);
  });
  downloadBlob(csvLines.join('\n'), 'mediafinder_highlights.csv', 'text/csv');
}

document.getElementById('highlightAuto')?.addEventListener('click', autoHighlightTimeline);
document.getElementById('highlightClear')?.addEventListener('click', ()=> setTimelineHighlights([]));
document.getElementById('highlightExport')?.addEventListener('click', exportHighlights);
renderHighlightList();

function renderTopTable(list){
  const tb = document.querySelector('#topTable tbody'); if(!tb) return;
  tb.innerHTML='';
  list.forEach((p,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${p.t}</td><td>${p.s.toFixed(3)}</td>
      <td><button data-jump="${p.t}">Jump</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('button[data-jump]').forEach(btn=>{
    btn.addEventListener('click', (ev)=>{
      const t = Number(ev.currentTarget.getAttribute('data-jump'));
      playerQ.currentTime = t;
      playerQ.play();
    });
  });
}

document.getElementById('calcTop')?.addEventListener('click', ()=>{
  if(!window.__lastAnalysis){ alert('Analisis belum ada.'); return; }
  const N = Number(document.getElementById('topN').value)||5;
  const sep = Number(document.getElementById('minSep').value)||3;
  const peaks = topNPeaks(window.__lastAnalysis.fused||[], N, sep);
  window.__topPeaks = peaks;
  renderTopTable(peaks);
  showToast(`Top-N dihitung (${peaks.length} segmen).`);
});


async function captureFrame(video, t){
  const wasPaused = video.paused;
  try{
    if(Math.abs(video.currentTime - t) > 0.2){
      await awaitSeek(video, t, 1200);
    }
    const c = document.createElement('canvas');
    const W = 320, H = Math.round((video.videoHeight||180) * (320/(video.videoWidth||320)));
    c.width = 320; c.height = H>0?H:180;
    const g = c.getContext('2d'); g.drawImage(video, 0,0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }finally{
    if(!wasPaused){ video.play().catch(()=>{}); }
  }
}

document.getElementById('grabShots')?.addEventListener('click', async ()=>{
  try{
    const peaks = window.__topPeaks || [];
    if(peaks.length===0){ alert('Hitung Top-N dulu.'); return; }
    const grid = document.getElementById('shotsGrid'); grid.innerHTML='';
    const shots = [];
    for(const p of peaks){
      const qImg = await captureFrame(playerQ, p.t);
      let tImg = null;
      try{ tImg = await captureFrame(playerT, p.t); }catch(_){}
      const card = document.createElement('div'); card.className='shot-card';
      card.innerHTML = `<header><span class="badge">t=${p.t}s</span><span class="badge">score=${p.s.toFixed(3)}</span></header>
        <img src="${qImg}" alt="query @${p.t}s"><header><span class="badge">query</span>${tImg?'<span class="badge">target</span>':''}</header>
        ${tImg?'<img src="'+tImg+'" alt="target @'+p.t+'s">':''}`;
      grid.appendChild(card);
      shots.push({t:p.t, score:p.s, query:qImg, target:tImg});
      await new Promise(r=>setTimeout(r,0));
    }
    window.__shots = shots;
    showToast('Snapshot selesai.');
  }catch(e){ alert('Gagal snapshot: '+(e?.message||e)); }
});

document.getElementById('downloadShots')?.addEventListener('click', async ()=>{
  const shots = window.__shots || [];
  if(shots.length===0){ alert('Belum ada snapshot.'); return; }
  try{
    const JSZipLib = window.JSZip || await loadJSZip().catch(()=>null);
    if(JSZipLib){
      const zip = new JSZipLib();
      shots.forEach((s,i)=>{
        const q = s.query.split(',')[1]; zip.file(`shot_${i+1}_t${s.t}_query.jpg`, q, {base64:true});
        if(s.target){ const t = s.target.split(',')[1]; zip.file(`shot_${i+1}_t${s.t}_target.jpg`, t, {base64:true}); }
      });
      const blob = await zip.generateAsync({type:'blob'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mediafinder_shots.zip'; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
      return;
    }
  }catch(_){}
  // fallback: download one by one
  shots.forEach((s,i)=>{
    const a = document.createElement('a'); a.href = s.query; a.download = `shot_${i+1}_t${s.t}_query.jpg`; a.click();
    if(s.target){ const b = document.createElement('a'); b.href = s.target; b.download = `shot_${i+1}_t${s.t}_target.jpg`; b.click(); }
  });
});


// ---- Robustness (ffmpeg.wasm) ----
const RB_SCHED_KEY = 'mf_rb_schedule_v1';
const RB_HISTORY_KEY = 'mf_rb_history_v1';
const RB_HISTORY_LIMIT = 150;
let __ff = null;
let __rbSchedulerRunning = false;
window.__rbResults = window.__rbResults || [];
window.__rbSeries = window.__rbSeries || {};
window.__rbSchedule = window.__rbSchedule || [];
window.__rbHistory = window.__rbHistory || [];
async function loadFF(){ 
  if(__ff) return __ff;
  if(isLocalOnly()){ alert('Mode Local-only aktif. Robustness (ffmpeg) dinonaktifkan.'); throw new Error('local-only'); }
  if(!window.FFmpeg || !window.FFmpeg.createFFmpeg){
    await new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/ffmpeg.min.js';
      s.onload = ()=> resolve();
      s.onerror = ()=> reject(new Error('ffmpeg.wasm tidak tersedia. Pastikan koneksi internet.'));
      document.head.appendChild(s);
    });
  }
  if(!window.FFmpeg || !window.FFmpeg.createFFmpeg){ throw new Error('ffmpeg.wasm tidak tersedia.'); }
  const corePath = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/ffmpeg-core.js';
  __ff = window.FFmpeg.createFFmpeg({ log: true, corePath });
  slog('Memuat ffmpeg.wasm ... (~25�30MB)'); await __ff.load(); slog('ffmpeg.wasm siap.');
  return __ff;
}
function rbLog(msg){ const el = document.getElementById('rbLog'); if(!el) return; el.textContent += (msg+'\\n'); el.scrollTop = el.scrollHeight; }

async function makeVariantFromQuery(opts){
  // opts: {start, dur, res, crf}
  let file = document.getElementById('queryInput')?.files?.[0] || window.__lastQueryFile;
  if(!file) throw new Error('Unggah kueri terlebih dahulu.');
  window.__lastQueryFile = file;
  const ff = await loadFF();
  ff.FS('writeFile', 'in.mp4', await window.FFmpeg.fetchFile(file));
  const args = [];
  const start = Math.max(0, Number(opts.start)||0);
  const dur = Math.max(1, Number(opts.dur)||5);
  if(start>0){ args.push('-ss', String(start)); }
  if(dur>0){ args.push('-t', String(dur)); }
  args.push('-i','in.mp4');
  if(opts.res && opts.res!=='orig'){
    const [w,h] = opts.res.split('x'); args.push('-vf', `scale=${w}:${h}`);
  }
  // Try libx264 CRF, fallback to mpeg4 qscale
  let out = 'out.mp4';
  try{
    args.push('-c:v','libx264','-preset','veryfast','-crf', String(opts.crf||28), '-pix_fmt','yuv420p','-an', out);
    rbLog('ffmpeg '+args.join(' '));
    await ff.run(...args);
  }catch(e){
    rbLog('libx264 tidak tersedia, fallback ke mpeg4 qscale ...');
    const qmap = { '23':'3', '28':'5', '35':'7' };
    const q = qmap[String(opts.crf||28)] || '5';
    out = 'out_mpeg4.mp4';
    const args2 = [];
    if(start>0){ args2.push('-ss', String(start)); }
    if(dur>0){ args2.push('-t', String(dur)); }
    args2.push('-i','in.mp4');
    if(opts.res && opts.res!=='orig'){
      const [w,h] = opts.res.split('x'); args2.push('-vf', `scale=${w}:${h}`);
    }
    args2.push('-c:v','mpeg4','-qscale:v', q, '-an', out);
    rbLog('ffmpeg '+args2.join(' '));
    await ff.run(...args2);
  }
  const data = ff.FS('readFile', out);
  // clean FS
  try{ ff.FS('unlink','in.mp4'); }catch(_){}
  try{ ff.FS('unlink', out); }catch(_){}
  return new Blob([data.buffer], { type:'video/mp4' });
}


function drawGroupedBars(canvas, series){
  // series: { [res]: { crf: score, ... }, ... }
  const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  const resolutions = Object.keys(series);
  if(resolutions.length===0){ return; }
  const crfs = Array.from(new Set(resolutions.flatMap(r=>Object.keys(series[r]||{})))).sort();
  const values = [];
  resolutions.forEach(r=> crfs.forEach(c=> values.push(series[r]?.[c] ?? 0)));
  const vmax = Math.max(0.001, ...values);
  const pad = 32;
  const groupW = (W - 2*pad) / Math.max(1,resolutions.length);
  const barW = Math.max(6, (groupW - 10) / Math.max(1,crfs.length));
  // axes
  ctx.strokeStyle='#ddd'; ctx.beginPath(); ctx.moveTo(pad,H-pad); ctx.lineTo(W-pad,H-pad); ctx.moveTo(pad,pad); ctx.lineTo(pad,H-pad); ctx.stroke();
  // legend
  const legendY = pad-10; let lx = pad;
  crfs.forEach((c,i)=>{ ctx.fillStyle = `hsl(${(i*65)%360} 70% 50%)`; ctx.fillRect(lx, legendY-10, 10, 10); ctx.fillStyle='#aaa'; ctx.fillText('CRF '+c, lx+14, legendY); lx += 70; });
  // bars
  resolutions.forEach((r,gi)=>{
    const gx = pad + gi*groupW + 5;
    crfs.forEach((c,bi)=>{
      const v = series[r]?.[c] ?? 0;
      const h = (H-2*pad) * (v/vmax);
      const x = gx + bi*barW; const y = H - pad - h;
      ctx.fillStyle = `hsl(${(bi*65)%360} 70% 50%)`;
      ctx.fillRect(x, y, barW-2, h);
      if(h>12){ ctx.fillStyle='#111'; ctx.fillText((v.toFixed? v.toFixed(2): v), x+2, y-4); }
    });
    // x label
    ctx.fillStyle='#888'; ctx.save(); ctx.translate(gx + groupW*0.35, H-pad+14); ctx.rotate(-Math.PI/6); ctx.fillText(r, 0, 0); ctx.restore();
  });
}

function drawBars(canvas, labels, values){
  const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  const max = Math.max(0.001, Math.max(...values));
  const pad = 24; const n = values.length;
  const bw = (W - 2*pad) / Math.max(1, n);
  ctx.strokeStyle='#ddd'; ctx.beginPath(); ctx.moveTo(pad,H-pad); ctx.lineTo(W-pad,H-pad); ctx.moveTo(pad,pad); ctx.lineTo(pad,H-pad); ctx.stroke();
  for(let i=0;i<n;i++){
    const v = values[i];
    const h = (H-2*pad) * (v/max);
    const x = pad + i*bw + 4, y = H - pad - h;
    ctx.fillStyle = '#4f46e5'; ctx.fillRect(x, y, bw-8, h);
    ctx.fillStyle = '#111'; ctx.fillText((v.toFixed? v.toFixed(2): v), x+2, y-4);
    ctx.save(); ctx.translate(x+4, H-pad+12); ctx.rotate(-Math.PI/4); ctx.fillStyle='#444'; ctx.fillText(labels[i], 0, 0); ctx.restore();
  }
}

function computeGlobalScoreFromFused(fused){ const s = fused.reduce((a,b)=>a+b,0); return s/Math.max(1,fused.length); }

// === GANTI FUNGSI LAMA DENGAN INI ===
async function testVariantAgainstTarget(variantBlob) {
  // Ekstrak pHash dari varian video
  const fps = getFps();
  const qv = await extractVideoPHashes(new File([variantBlob], 'variant.mp4', { type: 'video/mp4' }), fps, {});
  
  const t = lastTargetData;
  if (!t || !t.hashes || !t._chroma) {
    throw new Error('Data target tidak lengkap. Jalankan Analisis pada salah satu kandidat terlebih dahulu.');
  }

  // Varian tidak punya audio, jadi _chromaSegs-nya kosong.
  const q_sim = { hashes: qv.hashes, _chromaSegs: [] };
  
  const wv = getWV();
  const wa = getWA();

  // Gunakan worker yang sama dengan pencarian utama untuk konsistensi
  const workerResult = await computeFusedTimelineWorker(q_sim, t, wv, wa);
  
  const fused = workerResult.fused;
  const score = computeGlobalScoreFromFused(fused);

  return { qv, fused, score };
}
// === AKHIR PENGGANTIAN FUNGSI ===

document.getElementById('rbGenTest')?.addEventListener('click', async ()=>{
  try{
    rbLog('--- Robustness run ---');
    if(!lastTargetData){ alert('Analisis target belum dipilih. Buka Analisis pada salah satu kandidat.'); return; }
    const start = Number(document.getElementById('rbStart').value)||0;
    const dur   = Number(document.getElementById('rbDur').value)||10;
    const res   = document.getElementById('rbRes').value;
    const crf   = document.getElementById('rbCRF').value;
    const label = `${res}-CRF${crf}`;
    rbLog(`Membuat varian: ${label} (start=${start}, dur=${dur})`);
    const entry = await runRobustnessVariant({ start, dur, res, crf, label });
    rbLog(`Ukuran varian: ${(entry.size/1024/1024).toFixed(2)} MB`);
    rbLog(`Skor global: ${entry.score.toFixed(3)}`);
    showToast?.('Robustness: 1 varian selesai');
  }catch(e){
    console.error(e); rbLog('ERROR: '+(e?.message||e)); alert('Robustness gagal: '+(e?.message||e));
  }
});

document.getElementById('rbExportCsv')?.addEventListener('click', ()=>{
  const rows = (window.__rbResults||[]).map(r=>`${r.label},${r.size},${r.score}`);
  const csv = ['label,size_bytes,score', ...rows].join('\\n');
  downloadBlob(csv, 'robustness_results.csv', 'text/csv');
});

function timeSeriesVisualSim(qHashes, tHashes){
  const n = Math.min(qHashes.length, tHashes.length);
  // PASTIKAN HASH SELALU DI-PARSE SEBAGAI HEKSADESIMAL
  const Hq = qHashes.map(h => BigInt('0x' + h.hash));
  const Ht = tHashes.map(h => BigInt('0x' + h.hash));
  const out = new Array(n).fill(0);
  for(let i=0; i<n; i++){
    const ham = hamming64(Hq[i], Ht[i]);
    out[i] = 1 - Number(ham) / 63.0;
  }
  return out;
}

function timeSeriesAudioSim(qChroma, tChroma, segSec){
  const n = Math.min(qChroma.length, tChroma.length);
  const out = new Array(n).fill(0);
  for(let i=0;i<n;i++){
    const qa = qChroma[i]?.chroma||qChroma[i]; const ta = tChroma[i]?.chroma||tChroma[i];
    let dot=0, nq=0, nt=0;
    for(let k=0;k<12;k++){ const x=qa[k]||0, y=ta[k]||0; dot+=x*y; nq+=x*x; nt+=y*y; }
    const cos = dot / Math.max(1e-9, Math.sqrt(nq*nt));
    out[i] = Math.max(0, Math.min(1, (cos+1)/2)); // normalize to [0,1]
  }
  return out;
}

function pushRobustnessResult(entry){
  window.__rbResults = window.__rbResults || [];
  window.__rbSeries = window.__rbSeries || {};
  window.__rbResults.push(entry);
  window.__rbSeries[entry.res] = window.__rbSeries[entry.res] || {};
  window.__rbSeries[entry.res][entry.crf] = entry.score;
  drawGroupedBars(document.getElementById('rbChart'), window.__rbSeries);
  const tbody = document.querySelector('#rbTable tbody');
  if(tbody){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${entry.label}</td><td>${(entry.size/1024/1024).toFixed(2)} MB</td><td>${entry.score.toFixed(3)}</td>`;
    tbody.appendChild(tr);
  }
}

async function runRobustnessVariant({ res, crf, start, dur, label, version, campaign }){
  const blob = await makeVariantFromQuery({ start, dur, res, crf });
  const resTest = await testVariantAgainstTarget(blob);
  const entry = {
    label: label || `${res}-CRF${crf}`,
    size: blob.size,
    score: resTest.score,
    res,
    crf,
    version: version || null,
    campaign: campaign || null,
    timestamp: Date.now()
  };
  pushRobustnessResult(entry);
  return entry;
}


document.getElementById('rbRunBatch')?.addEventListener('click', async ()=>{
  const btns = ['rbRunBatch','rbGenTest'];
  const toggleBtn = (disable)=>{
    btns.forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      el.disabled = disable;
      if(disable){
        if(!el.dataset._oldText){ el.dataset._oldText = el.textContent; }
        el.textContent = (el.dataset._oldText||el.textContent)+' [?]';
      }else if(el.dataset._oldText){
        el.textContent = el.dataset._oldText;
        delete el.dataset._oldText;
      }
    });
  };
  try{
    if(!lastTargetData){ alert('Analisis target belum dipilih. Buka Analisis pada salah satu kandidat.'); return; }
    const start = Number(document.getElementById('rbStart').value)||0;
    const dur = Number(document.getElementById('rbDur').value)||10;
    const resSel = Array.from(document.querySelectorAll('.rbResOpt:checked')).map(x=>x.value);
    const crfSel = Array.from(document.querySelectorAll('.rbCrfOpt:checked')).map(x=>x.value);
    if(resSel.length===0 || crfSel.length===0){ alert('Pilih minimal satu resolusi dan satu CRF.'); return; }
    toggleBtn(true);
    await loadFF();
    for(const res of resSel){
      for(const crf of crfSel){
        const label = `${res}-CRF${crf}`;
        rbLog(`Batch: ${label}`);
        await runRobustnessVariant({ start, dur, res, crf, label });
        await new Promise(r=>setTimeout(r,0));
      }
    }
    showToast?.('Batch robustness selesai.');
  }catch(e){
    console.error(e); alert('Batch gagal: '+(e?.message||e));
  }finally{
    toggleBtn(false);
  }
});

function safeLoadRbArray(key){
  try{
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  }catch(e){
    console.warn('RB scheduler state corrupt for', key, e);
    return [];
  }
}
function persistRbArray(key, val){
  try{
    localStorage.setItem(key, JSON.stringify(val||[]));
  }catch(e){
    console.warn('RB scheduler persist failed for', key, e);
  }
}
function makeRbId(prefix='rbjob'){
  if(globalThis.crypto?.randomUUID){
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}
function formatSchedulerRange(job){
  const start = Math.max(0, Number(job.start)||0);
  const dur = Math.max(0, Number(job.dur)||0);
  const end = start + dur;
  return `${start}s - ${end}s`;
}
function renderRbScheduleTable(){
  const tbody = document.querySelector('#rbSchedTable tbody');
  if(!tbody) return;
  const rows = window.__rbSchedule || [];
  tbody.innerHTML = '';
  if(rows.length===0){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="hint">Belum ada jadwal.</td>';
    tbody.appendChild(tr);
  }else{
    rows.forEach(job=>{
      const tr = document.createElement('tr');
      const sub = job.campaign ? `<div class="hint">${job.campaign}</div>` : '';
      tr.innerHTML = `<td><strong>${job.version||'-'}</strong>${sub}</td><td>${job.res} / CRF${job.crf}</td><td>${formatSchedulerRange(job)}</td><td><button class="ghost tiny" data-sched-remove="${job.id}">Hapus</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('button[data-sched-remove]')?.forEach(btn=>{
      btn.addEventListener('click', (ev)=>{
        const id = ev.currentTarget.getAttribute('data-sched-remove');
        window.__rbSchedule = (window.__rbSchedule||[]).filter(job=>job.id!==id);
        persistRbArray(RB_SCHED_KEY, window.__rbSchedule);
        renderRbScheduleTable();
        showToast?.('Jadwal dihapus');
      });
    });
  }
  const runBtn = document.getElementById('rbSchedRun');
  if(runBtn && !__rbSchedulerRunning){
    runBtn.disabled = rows.length===0;
  }
}
function renderRbHistoryTable(){
  const tbody = document.querySelector('#rbHistoryTable tbody');
  if(!tbody) return;
  const rows = window.__rbHistory || [];
  tbody.innerHTML = '';
  if(rows.length===0){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="hint">Belum ada riwayat.</td>';
    tbody.appendChild(tr);
    return;
  }
  rows.slice(0, RB_HISTORY_LIMIT).forEach(row=>{
    const tr = document.createElement('tr');
    const time = new Date(row.timestamp||Date.now()).toLocaleString('id-ID');
    tr.innerHTML = `<td>${time}</td><td>${row.version||'-'}</td><td>${row.label}</td><td>${(row.score||0).toFixed(3)}</td>`;
    tbody.appendChild(tr);
  });
}
function recordRbHistory(job, entry){
  window.__rbHistory = window.__rbHistory || [];
  window.__rbHistory.unshift({
    id: makeRbId('rbhist'),
    timestamp: entry.timestamp || Date.now(),
    campaign: job?.campaign || entry.campaign || '',
    version: job?.version || entry.version || '',
    label: entry.label,
    res: entry.res,
    crf: entry.crf,
    score: entry.score,
    size: entry.size
  });
  if(window.__rbHistory.length > RB_HISTORY_LIMIT){
    window.__rbHistory.length = RB_HISTORY_LIMIT;
  }
  persistRbArray(RB_HISTORY_KEY, window.__rbHistory);
  renderRbHistoryTable();
}
function initRbSchedulerUI(){
  window.__rbSchedule = safeLoadRbArray(RB_SCHED_KEY);
  window.__rbHistory = safeLoadRbArray(RB_HISTORY_KEY);
  renderRbScheduleTable();
  renderRbHistoryTable();
  document.getElementById('rbSchedAdd')?.addEventListener('click', ()=>{
    const resStr = document.getElementById('rbSchedRes')?.value || '';
    const crfStr = document.getElementById('rbSchedCrf')?.value || '';
    const resList = resStr.split(',').map(s=>s.trim()).filter(Boolean);
    const crfList = crfStr.split(',').map(s=>s.trim()).filter(Boolean);
    if(resList.length===0 || crfList.length===0){
      alert('Masukkan minimal satu resolusi dan satu CRF.');
      return;
    }
    const start = Math.max(0, Number(document.getElementById('rbSchedStart')?.value)||0);
    const dur = Math.max(1, Number(document.getElementById('rbSchedDur')?.value)||5);
    const campaign = (document.getElementById('rbSchedName')?.value||'').trim();
    const version = (document.getElementById('rbSchedVersion')?.value||'').trim();
    const createdAt = Date.now();
    const jobs = [];
    resList.forEach(res=>{
      crfList.forEach(crf=>{
        jobs.push({ id: makeRbId(), campaign, version, res, crf, start, dur, createdAt });
      });
    });
    if(!jobs.length){ alert('Tidak ada kombinasi yang valid.'); return; }
    window.__rbSchedule = (window.__rbSchedule||[]).concat(jobs);
    persistRbArray(RB_SCHED_KEY, window.__rbSchedule);
    renderRbScheduleTable();
    showToast?.(`Scheduler: ${jobs.length} job ditambahkan`);
  });
  document.getElementById('rbSchedClear')?.addEventListener('click', ()=>{
    if(!(window.__rbSchedule||[]).length){
      alert('Scheduler sudah kosong.');
      return;
    }
    if(!confirm('Kosongkan seluruh jadwal batch?')) return;
    window.__rbSchedule = [];
    persistRbArray(RB_SCHED_KEY, window.__rbSchedule);
    renderRbScheduleTable();
    showToast?.('Scheduler dibersihkan');
  });
  document.getElementById('rbSchedExport')?.addEventListener('click', ()=>{
    const rows = window.__rbHistory || [];
    if(rows.length===0){
      alert('Belum ada riwayat batch.');
      return;
    }
    const esc = (val)=>{
      const str = String(val ?? '');
      if(/[",\n]/.test(str)){
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const header = 'timestamp,campaign,version,label,res,crf,score,size_bytes';
    const body = rows.map(r=>[
      esc(new Date(r.timestamp||Date.now()).toISOString()),
      esc(r.campaign||''),
      esc(r.version||''),
      esc(r.label||''),
      esc(r.res||''),
      esc(r.crf||''),
      esc((Number(r.score||0)).toFixed(4)),
      esc(r.size||0)
    ].join(','));
    downloadBlob([header, ...body].join('\n'), 'robustness_history.csv', 'text/csv');
  });
  document.getElementById('rbSchedRun')?.addEventListener('click', async ()=>{
    if(__rbSchedulerRunning){
      alert('Scheduler sedang berjalan.');
      return;
    }
    const jobs = [...(window.__rbSchedule||[])];
    if(jobs.length===0){
      alert('Tidak ada jadwal untuk dijalankan.');
      return;
    }
    if(!lastTargetData){
      alert('Analisis target belum dipilih. Jalankan analisis salah satu kandidat dahulu.');
      return;
    }
    __rbSchedulerRunning = true;
    const runBtn = document.getElementById('rbSchedRun');
    if(runBtn){
      runBtn.disabled = true;
      runBtn.dataset._oldText = runBtn.textContent;
      runBtn.textContent = 'Menjalankan...';
    }
    rbLog(`Scheduler: ${jobs.length} job dimulai`);
    try{
      await loadFF();
      for(const job of jobs){
        const baseLabel = `${job.res}-CRF${job.crf}`;
        rbLog(`[Scheduler] ${job.version||'versi?'} - ${baseLabel}`);
        const entry = await runRobustnessVariant({
          start: job.start,
          dur: job.dur,
          res: job.res,
          crf: job.crf,
          label: job.version ? `${baseLabel} (${job.version})` : baseLabel,
          version: job.version,
          campaign: job.campaign
        });
        recordRbHistory(job, entry);
        await new Promise(r=>setTimeout(r,0));
      }
      showToast?.(`Scheduler selesai (${jobs.length} job)`);
    }catch(e){
      console.error(e);
      alert('Scheduler gagal: '+(e?.message||e));
    }finally{
      __rbSchedulerRunning = false;
      const runBtn2 = document.getElementById('rbSchedRun');
      if(runBtn2){
        runBtn2.disabled = !(window.__rbSchedule||[]).length;
        if(runBtn2.dataset._oldText){
          runBtn2.textContent = runBtn2.dataset._oldText;
          delete runBtn2.dataset._oldText;
        }else{
          runBtn2.textContent = 'Jalankan Scheduler';
        }
      }
      renderRbScheduleTable();
    }
  });
}
initRbSchedulerUI();


// === GANTI DENGAN BLOK INI ===
document.getElementById('rbExportPdf')?.addEventListener('click', async () => {
    try {
        if (isLocalOnly && isLocalOnly()) {
            alert('Mode Local-only aktif: Export PDF membutuhkan jsPDF dari CDN.');
            return;
        }
        if (!window.jspdf) await loadJsPDF();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const pad = 40, line = 18;
        let y = pad;

        doc.setFontSize(14); doc.text('MediaFinder � Laporan Robustness', pad, y); y += line;
        doc.setFontSize(10); doc.text('Dibuat: ' + new Date().toLocaleString(), pad, y); y += line * 1.5;

        const robustnessPanel = document.getElementById('rbChart')?.closest('.panel');
        if (!robustnessPanel) {
            alert('Panel Robustness tidak ditemukan.');
            return;
        }

        // Tambahkan Chart
        const chartCanvas = robustnessPanel.querySelector('#rbChart');
        if (chartCanvas) {
            doc.setFontSize(12); doc.text('Grafik Skor Global', pad, y); y += line;
            const data = chartCanvas.toDataURL('image/png', 0.95);
            const w = 515, h = (chartCanvas.height / chartCanvas.width) * w;
            if (y + h > 800) { doc.addPage(); y = pad; }
            doc.addImage(data, 'PNG', pad, y, w, h);
            y += h + line;
        }

        // Tambahkan Tabel
        const table = robustnessPanel.querySelector('#rbTable');
        if (table && (window.__rbResults || []).length > 0) {
             if (y > 700) { doc.addPage(); y = pad; }
            doc.setFontSize(12); doc.text('Tabel Hasil Uji', pad, y); y += line;
            doc.autoTable({
                html: '#rbTable',
                startY: y,
                theme: 'grid',
                headStyles: { fillColor: [15, 23, 42] }
            });
        }

        doc.save('mediafinder_robustness_report.pdf');
        showToast?.('Robustness PDF diunduh');
    } catch (e) {
        console.error(e);
        alert('Export PDF gagal: ' + (e?.message || e));
    }
});


// ---- Install Prompt & SW Update ----
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  if(btn){
    btn.style.display='inline-flex';
    btn.disabled = false;
    btn.setAttribute('aria-hidden', 'false');
  }
  updateHeroStats({ lastAction:'PWA siap dipasang', cta:'Klik tombol Install untuk Add to Home Screen' });
});

// SW update flow: show toast on new version available
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    showToast?.('Aplikasi diperbarui. Muat ulang jika perlu.');
  });
  navigator.serviceWorker.getRegistration().then(reg=>{
    if(!reg) return;
    reg.addEventListener('updatefound', ()=>{
      const newSW = reg.installing;
      newSW?.addEventListener('statechange', ()=>{
        if(newSW.state==='installed' && navigator.serviceWorker.controller){
          showToast?.('Update tersedia  reload untuk versi terbaru.');
        }
      });
    });
  });
  navigator.serviceWorker.addEventListener('message', (event)=>{
    if(event.data?.type === 'backend-update'){
      const payload = event.data.payload || {};
      showToast(payload.body || 'Dataset baru tersedia.', {
        title: payload.title || 'Update Dataset Backend',
        type: 'success',
        action:{
          label:'Muat Korpus',
          handler: ()=>{
            activateTab('#tab-corpus');
            document.getElementById('cp_load')?.click();
          }
        }
      });
    }
  });
}

// ---- Extra Tabs hookup (Settings/Help) ----
function scrollToSection(el){
  if(!el) return;
  const header = document.querySelector('header');
  const offset = (header?.offsetHeight || 0) + 12;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function activateTab(targetSelector, opts={}){
  if(!targetSelector) return;
  const targetTab = document.querySelector(targetSelector);
  if(!targetTab) return;
  document.querySelectorAll('main .tab').forEach(tab => {
    tab.style.display = 'none';
    tab.classList.remove('active');
  });
  document.querySelectorAll('nav .tab-btn').forEach(b => {
    b.classList.remove('active');
  });
  targetTab.style.display = 'block';
  targetTab.classList.add('active');
  const navBtn = document.querySelector(`nav .tab-btn[data-tab="${targetSelector}"]`);
  navBtn?.classList.add('active');
  if(opts.scroll !== false){
    setTimeout(()=> scrollToSection(targetTab), 40);
  }
}

document.querySelectorAll('nav .tab-btn[data-tab]')?.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const targetSelector = e.currentTarget.getAttribute('data-tab');
    activateTab(targetSelector);
  });
});

const SIMPLE_BREAKPOINT = '(max-width: 900px)';
const FORCE_FULL_KEY = 'mf_force_full_mobile';
function refreshMobileToggleUI(){
  const btn = document.getElementById('toggleMobileMode');
  if(!btn) return;
  const mobile = window.matchMedia(SIMPLE_BREAKPOINT).matches;
  const forceFull = localStorage.getItem(FORCE_FULL_KEY) === '1';
  if(!mobile){
    btn.hidden = true;
    btn.setAttribute('aria-pressed','false');
    return;
  }
  btn.hidden = false;
  btn.textContent = forceFull ? 'Mode Ringkas' : 'Mode Lengkap';
  btn.title = forceFull ? 'Kembali ke tampilan ringkas' : 'Tampilkan fitur lengkap di layar kecil';
  btn.setAttribute('aria-pressed', forceFull ? 'true' : 'false');
}
function enforceSimpleMode(){
  const mq = window.matchMedia(SIMPLE_BREAKPOINT);
  const mobile = mq.matches;
  const forceFull = localStorage.getItem(FORCE_FULL_KEY) === '1';
  const useSimple = mobile && !forceFull;
  document.body.classList.toggle('mobile-simple', useSimple);
  refreshMobileToggleUI();
  if(useSimple){
    const active = document.querySelector('nav .tab-btn.active');
    if(active?.dataset.advanced){
      document.querySelector('nav .tab-btn[data-tab="#tab-indeks"]')?.click();
    }
  }
}
enforceSimpleMode();
window.matchMedia(SIMPLE_BREAKPOINT).addEventListener('change', enforceSimpleMode);
document.getElementById('toggleMobileMode')?.addEventListener('click', ()=>{
  const forceFull = localStorage.getItem(FORCE_FULL_KEY) === '1';
  localStorage.setItem(FORCE_FULL_KEY, forceFull ? '0' : '1');
  enforceSimpleMode();
  showToast?.(forceFull ? 'Mode ringkas diaktifkan.' : 'Mode lengkap diaktifkan untuk layar kecil.', { type:'info' });
});

document.querySelectorAll('[data-tab-target]')?.forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    const targetSelector = e.currentTarget.getAttribute('data-tab-target');
    if(!targetSelector) return;
    activateTab(targetSelector);
  });
});

// ---- Wizard onboarding (3 langkah) ----
const wizardSteps = [
  { title:'Impor video referensi', desc:'Tambahkan 1�3 video dulu di tab Indeks. Pilih file lalu klik Impor.', highlight:null },
  { title:'Unggah kueri & klik "Cari Mirip"', desc:'Buka tab Pencarian, unggah 1 video kueri, lalu tekan tombol Cari Mirip.', highlight:'.wizard-highlight-search' },
  { title:'Lihat hasil di Analisis', desc:'Pilih salah satu kandidat, lalu buka tab Analisis untuk timeline & heatmap.', highlight:'.wizard-highlight-analisis' }
];
let wizardIndex = 0;
function showWizard(idx=0){
  if(window.__wizardSkip) return;
  wizardIndex = Math.max(0, Math.min(idx, wizardSteps.length-1));
  const modal = document.getElementById('wizardOverlay');
  if(!modal) return;
  modal.setAttribute('aria-hidden','false');
  renderWizard();
  positionHighlights();
}
function hideWizard(remember=false){
  const modal = document.getElementById('wizardOverlay');
  modal?.setAttribute('aria-hidden','true');
  document.querySelectorAll('.wizard-highlight').forEach(el=> el.classList.remove('wizard-highlight-show'));
  if(remember){
    window.__wizardSkip = true;
    localStorage.setItem('mf_wizard_skip','1');
  }
}
function renderWizard(){
  const step = wizardSteps[wizardIndex];
  const stepEl = document.getElementById('wizardStep');
  const titleEl = document.getElementById('wizardTitle');
  const descEl = document.getElementById('wizardDesc');
  if(stepEl) stepEl.textContent = `Langkah ${wizardIndex+1}/${wizardSteps.length}`;
  if(titleEl) titleEl.textContent = step.title;
  if(descEl) descEl.textContent = step.desc;
  const prevBtn = document.getElementById('wizardPrev');
  if(prevBtn) prevBtn.disabled = (wizardIndex === 0);
  const nextBtn = document.getElementById('wizardNext');
  if(nextBtn) nextBtn.textContent = wizardIndex === wizardSteps.length-1 ? 'Selesai' : 'Selanjutnya';
  document.querySelectorAll('.wizard-highlight').forEach(el=> el.classList.remove('wizard-highlight-show'));
  if(step.highlight){
    const el = document.querySelector(step.highlight);
    if(el) el.classList.add('wizard-highlight-show');
  }
}
function positionHighlights(){
  const searchBtn = document.getElementById('searchBtn');
  const analisisTab = document.querySelector('nav .tab-btn[data-tab="#tab-analisis"]');
  const searchHighlight = document.querySelector('.wizard-highlight-search');
  const analisisHighlight = document.querySelector('.wizard-highlight-analisis');
  const offset = document.querySelector('header')?.getBoundingClientRect().height || 0;
  if(searchBtn && searchHighlight){
    const rect = searchBtn.getBoundingClientRect();
    searchHighlight.style.top = `${rect.top + window.scrollY - offset - 8}px`;
    searchHighlight.style.left = `${rect.left + window.scrollX - 8}px`;
    searchHighlight.style.width = `${rect.width + 16}px`;
    searchHighlight.style.height = `${rect.height + 16}px`;
  }
  if(analisisTab && analisisHighlight){
    const rect = analisisTab.getBoundingClientRect();
    analisisHighlight.style.top = `${rect.top + window.scrollY - offset - 8}px`;
    analisisHighlight.style.left = `${rect.left + window.scrollX - 8}px`;
    analisisHighlight.style.width = `${rect.width + 16}px`;
    analisisHighlight.style.height = `${rect.height + 16}px`;
  }
}
window.addEventListener('resize', positionHighlights);
document.getElementById('wizardPrev')?.addEventListener('click', ()=>{
  if(wizardIndex>0){ wizardIndex--; renderWizard(); positionHighlights(); }
});
document.getElementById('wizardNext')?.addEventListener('click', ()=>{
  if(wizardIndex < wizardSteps.length-1){ wizardIndex++; renderWizard(); positionHighlights(); }
  else { hideWizard(document.getElementById('wizardDontShow')?.checked); }
});
document.getElementById('wizardClose')?.addEventListener('click', ()=>{
  hideWizard(document.getElementById('wizardDontShow')?.checked);
});

// Tampilkan wizard saat indeks kosong atau hasil pencarian kosong
function maybeShowWizard(){ 
  if(localStorage.getItem('mf_wizard_skip')==='1'){ window.__wizardSkip=true; return; }
}
maybeShowWizard();

// ---- Lazy load Lab Robustness UI ----
document.getElementById('rbActivate')?.addEventListener('click', ()=>{
  const panel = document.getElementById('rbPanel');
  const activator = document.getElementById('rbActivator');
  if(panel){ panel.style.display='block'; }
  if(activator){ activator.style.display='none'; }
  scrollToSection(panel);
});

// ---- Evaluation (Sprint D) ----
async function ev_listCorpus(){
  const items = await DB.listItems();
  return items; // entire index as corpus (small scale assumption)
}
function ev_log(s){ const el = document.getElementById('ev_log'); if(!el) return; el.textContent += s + '\n'; el.scrollTop = el.scrollHeight; }

async function ev_makeQueries(qPerItem=2, dur=8, strategy='grid'){
  const corpus = await ev_listCorpus();
  if(corpus.length===0) throw new Error('Tidak ada item diindeks.');
  const queries = [];
  for(const it of corpus){
    const hashes = await DB.listHashes(it.id);
    const T = Math.max(1, Math.floor(it.duration||hashes.length||60));
    const slots = []; 
    if(strategy==='random'){
      for(let i=0;i<qPerItem;i++){ slots.push(Math.floor(Math.random() * Math.max(1,T-dur))); }
    }else{ // grid
      const step = Math.max(1, Math.floor((T-dur) / Math.max(1,qPerItem)));
      for(let i=0;i<qPerItem;i++){ slots.push(Math.min(i*step, Math.max(0,T-dur))); }
    }
    for(const start of slots){
      queries.push({ gtId: it.id, start, dur });
    }
  }
  return { corpus, queries };
}

async function ev_generateQueryBlob(gtId, start, dur){
  // Try: if original file exists in 'files' store, cut clip using ffmpeg.wasm. If not, synthesize by sampling frames (approx by taking contiguous hashes -> rebuild video is too heavy -> we fallback to start markers only).
  try{
    if(isLocalOnly()){ throw new Error('local-only'); }
    const rec = await DB.getFileBlob(gtId);
    if(rec && window.FFmpeg){
      const ff = await loadFF();
      ff.FS('writeFile', 'in.mp4', await window.FFmpeg.fetchFile(rec.blob));
      const args = ['-ss', String(start), '-t', String(dur), '-i','in.mp4','-c:v','libx264','-preset','veryfast','-crf','23','-an','out.mp4'];
      try{ await ff.run(...args); }catch(e){ await ff.run('-ss', String(start), '-t', String(dur), '-i','in.mp4','-c:v','mpeg4','-qscale:v','3','-an','out.mp4'); }
      const data = ff.FS('readFile','out.mp4'); try{ ff.FS('unlink','in.mp4'); ff.FS('unlink','out.mp4'); }catch(_){}
      return new Blob([data.buffer], {type:'video/mp4'});
    }
  }catch(e){ /* ignore & fallback */ }
  // Fallback: pseudo-query (no real media), we will simulate by slicing the hash series later (no blob). Return null blob; we'll handle it.
  return null;
}

function ev_estimateStorageRow(it, hashesCount, chromaCount, fileRec){
  return {
    name: it.name,
    pHash: hashesCount,
    chroma: chromaCount,
    sizeMB: fileRec? (fileRec.size/1024/1024): 0
  };
}

function ev_updateStorageTable(rows){
  const tb = document.querySelector('#ev_storage tbody'); if(!tb) return;
  tb.innerHTML = '';
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.name}</td><td>${r.pHash}</td><td>${r.chroma}</td><td>${r.sizeMB.toFixed(2)}</td>`;
    tb.appendChild(tr);
  });
}

function ev_updateSummary(sum){
  const tb = document.querySelector('#ev_summary tbody'); if(!tb) return;
  tb.innerHTML='';
  const add = (k,v)=>{ const tr = document.createElement('tr'); tr.innerHTML = `<td>${k}</td><td>${v}</td>`; tb.appendChild(tr); };
  add('#Query', sum.n);
  add('Precision@k', sum.precision.toFixed(3));
  add('Recall@k', sum.recall.toFixed(3));
  add('F1@k', sum.f1.toFixed(3));
  add('t_extract avg (ms)', sum.tExtractAvg.toFixed(1));
  add('t_search avg (ms)', sum.tSearchAvg.toFixed(1));
  if(typeof sum.auc === 'number' && !Number.isNaN(sum.auc)){
    add('ROC AUC', sum.auc.toFixed(3));
  }
}

function ev_appendRow(i, row){
  const tb = document.querySelector('#ev_table tbody'); if(!tb) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${i+1}</td><td>${row.gtName}</td><td>${row.start}</td><td>${row.dur}</td>
    <td>${row.top1?.name||'-'}</td><td>${row.hitAtK? 'Ya' : 'Tidak'}</td>
    <td>${row.top1?.score?.toFixed(3)||'-'}</td><td>${row.tExtract}</td><td>${row.tSearch}</td>`;
  tb.appendChild(tr);
}

function ev_computeRoc(pool){
  if(!pool || pool.length===0){
    return { points: [], auc: 0, positives:0, negatives:0 };
  }
  let positives = 0;
  pool.forEach(s=>{ if(s.label) positives++; });
  const negatives = Math.max(0, pool.length - positives);
  const sorted = [...pool].sort((a,b)=> (b.score||0) - (a.score||0));
  const pts = [{ fpr:0, tpr:0 }];
  let tp = 0, fp = 0;
  const posDiv = Math.max(1, positives);
  const negDiv = Math.max(1, negatives);
  sorted.forEach(sample=>{
    if(sample.label){ tp++; }else{ fp++; }
    pts.push({ fpr: fp/negDiv, tpr: tp/posDiv });
  });
  pts.push({ fpr:1, tpr:1 });
  let auc = 0;
  for(let i=1;i<pts.length;i++){
    const a = pts[i-1], b = pts[i];
    auc += (b.fpr - a.fpr) * (a.tpr + b.tpr) / 2;
  }
  return { points: pts, auc: Math.max(0, Math.min(1, auc)), positives, negatives };
}

function ev_renderRoc(points){
  const canvas = document.getElementById('ev_roc');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || canvas.width;
  if(canvas.width !== width){ canvas.width = width; }
  const height = canvas.height;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const pad = 32;
  ctx.strokeStyle = 'rgba(148,163,184,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, height-pad);
  ctx.lineTo(canvas.width-pad, height-pad);
  ctx.moveTo(pad, height-pad);
  ctx.lineTo(pad, pad);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(148,163,184,0.3)';
  ctx.beginPath();
  ctx.moveTo(pad, height-pad);
  ctx.lineTo(canvas.width-pad, pad);
  ctx.stroke();
  if(!points || points.length===0){
    ctx.fillStyle = 'rgba(148,163,184,0.8)';
    ctx.font = '12px Plus Jakarta Sans, sans-serif';
    ctx.fillText('Belum ada data ROC', pad+8, pad+16);
    return;
  }
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#16a34a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((pt, idx)=>{
    const x = pad + (canvas.width - 2*pad) * Math.min(1, Math.max(0, pt.fpr));
    const y = (height - pad) - (height - 2*pad) * Math.min(1, Math.max(0, pt.tpr));
    if(idx===0){ ctx.moveTo(x,y); }else{ ctx.lineTo(x,y); }
  });
  ctx.stroke();
}

function ev_computeConfusion(pool, threshold=0.5){
  const cm = { tp:0, fp:0, tn:0, fn:0 };
  if(!pool || pool.length===0){ return Object.assign(cm, { precision:0, recall:0, accuracy:0, f1:0 }); }
  pool.forEach(sample=>{
    const score = Number(sample.score) || 0;
    const pred = score >= threshold;
    if(sample.label){
      if(pred) cm.tp++; else cm.fn++;
    }else{
      if(pred) cm.fp++; else cm.tn++;
    }
  });
  const precision = (cm.tp + cm.fp)>0 ? cm.tp / (cm.tp + cm.fp) : 0;
  const recall = (cm.tp + cm.fn)>0 ? cm.tp / (cm.tp + cm.fn) : 0;
  const accuracy = (cm.tp + cm.tn) / Math.max(1, (cm.tp+cm.fp+cm.tn+cm.fn));
  const f1 = (precision + recall)>0 ? 2*precision*recall/(precision+recall) : 0;
  return Object.assign(cm, { precision, recall, accuracy, f1 });
}

function ev_renderConfusion(cm){
  const map = {
    tp: 'ev_cm_tp',
    fp: 'ev_cm_fp',
    fn: 'ev_cm_fn',
    tn: 'ev_cm_tn'
  };
  Object.entries(map).forEach(([key, id])=>{
    const el = document.getElementById(id);
    if(el) el.textContent = Number(cm?.[key]||0).toString();
  });
  const stats = document.getElementById('ev_confusion_stats');
  if(stats){
    if(!cm || (cm.tp+cm.fp+cm.fn+cm.tn)===0){
      stats.textContent = 'Precision/Recall akan muncul setelah evaluasi.';
    }else{
      stats.textContent = `Precision ${(cm.precision*100).toFixed(1)}%  Recall ${(cm.recall*100).toFixed(1)}%  F1 ${(cm.f1*100).toFixed(1)}%  Akurasi ${(cm.accuracy*100).toFixed(1)}%`;
    }
  }
}


async function ev_run(){
  try{
    const k = Number(document.getElementById('ev_k').value)||5;
    ev_log('Mempersiapkan korpus & dataset ...');
    const corpus = await DB.listItems();
    const storeRows = [];
    for(const it of corpus){
      const hashes = await DB.listHashes(it.id);
      let chroma=[]; try{ chroma = await DB.listChroma(it.id); }catch(_){}
      let frec=null; try{ frec = await DB.getFileBlob(it.id); }catch(_){}
      storeRows.push(ev_estimateStorageRow(it, hashes.length, chroma.length, frec));
    }
    ev_updateStorageTable(storeRows);

    const qpi = Number(document.getElementById('ev_qpi').value)||2;
    const dur = Number(document.getElementById('ev_dur').value)||8;
    const stg = document.getElementById('ev_strategy').value||'grid';
    const plan = await ev_makeQueries(qpi, dur, stg);
    ev_log(`Dataset: ${plan.queries.length} query dari ${plan.corpus.length} item.`);

    // Run
    const results = [];
    const rocPool = [];
    const fps = getFps();
    const wv = getWV(), wa = getWA();
    for(let i=0;i<plan.queries.length;i++){
      const q = plan.queries[i];
      const it = plan.corpus.find(x=>x.id===q.gtId);
      const t0 = performance.now();
      // make query blob if possible
      const blob = await ev_generateQueryBlob(q.gtId, q.start, q.dur);
      let qv;
      if(blob){
        qv = await extractVideoPHashes(new File([blob],'eval_query.mp4',{type:'video/mp4'}), fps, {mode:'hybrid', histThr:0.12, minInterval:0.5});
      }else{
        // fallback: slice hashes from GT as pseudo-query
        const GT = await DB.listHashes(q.gtId);
        const end = Math.min(GT.length, q.start + q.dur);
        qv = { duration: q.dur, hashes: GT.slice(q.start, end) };
      }
      const t1 = performance.now();

      // search across corpus
      const scs = [];
      for(const cand of plan.corpus){
        const candH = await DB.listHashes(cand.id);
        // build visual per-second sim over min length
        const n = Math.min(qv.hashes.length, candH.length);
        let s=0;
        for(let j=0;j<n;j++){
          const ham = hamming64(BigInt('0x' + qv.hashes[j].hash), BigInt('0x' + candH[j].hash));
          s += 1 - Number(ham)/63.0;
        }
        const visScore = s/Math.max(1,n);
        let fused = visScore;
        // (optional audio fusion could be added similarly; for evaluasi kecil cukup visual)
        scs.push({ id:cand.id, name:cand.name, score: fused });
        const isPositive = cand.id === q.gtId;
        rocPool.push({ score: fused, label: isPositive ? 1 : 0 });
      }
      scs.sort((a,b)=> b.score - a.score);
      const t2 = performance.now();

      const top1 = scs[0];
      const hitAtK = scs.slice(0,k).some(x=> x.id===q.gtId);
      const row = {
        gtName: it.name, start:q.start, dur:q.dur, top1, hitAtK,
        tExtract: Math.round(t1-t0), tSearch: Math.round(t2-t1)
      };
      results.push(row);
      ev_appendRow(i, row);
      if((i+1)%5===0) await new Promise(r=>setTimeout(r,0));
    }

    // Summary
    const n = results.length;
    const tp = results.filter(r=>r.hitAtK).length;
    const precision = tp / (n * 1); // 1 relevant per query assumption
    const recall = tp / n;
    const f1 = (precision+recall)>0? 2*precision*recall/(precision+recall) : 0;
    const tExtractAvg = results.reduce((a,b)=>a+b.tExtract,0)/Math.max(1,n);
    const tSearchAvg = results.reduce((a,b)=>a+b.tSearch,0)/Math.max(1,n);
    const roc = ev_computeRoc(rocPool);
    const thrInput = document.getElementById('ev_thresh');
    const threshold = Number(thrInput?.value) || 0.5;
    const confusion = ev_computeConfusion(rocPool, threshold);
    ev_renderRoc(roc.points);
    ev_renderConfusion(confusion);
    const aucEl = document.getElementById('ev_auc');
    if(aucEl){ aucEl.textContent = (roc.points.length>0 ? roc.auc.toFixed(3) : '-'); }
    ev_updateSummary({ n, precision, recall, f1, tExtractAvg, tSearchAvg, auc: roc.auc||0 });

    // Save to global for export
    window.__evResults = {
      results,
      summary: { n, precision, recall, f1, tExtractAvg, tSearchAvg, auc: roc.auc||0 },
      roc: { pool: rocPool, points: roc.points, auc: roc.auc||0 },
      confusion
    };
    ev_log('Evaluasi selesai.');
    showToast?.('Evaluasi selesai');
  }catch(e){
    console.error(e); alert('Evaluasi gagal: '+(e?.message||e));
  }
}

document.getElementById('ev_build')?.addEventListener('click', async ()=>{
  try{
    const qpi = Number(document.getElementById('ev_qpi').value)||2;
    const dur = Number(document.getElementById('ev_dur').value)||8;
    const stg = document.getElementById('ev_strategy').value||'grid';
    const plan = await ev_makeQueries(qpi, dur, stg);
    document.querySelector('#ev_table tbody').innerHTML='';
    document.querySelector('#ev_summary tbody').innerHTML='';
    ev_log(`Dataset siap: ${plan.queries.length} query dari ${plan.corpus.length} item.`);
  }catch(e){ alert(e?.message||e); }
});

document.getElementById('ev_run')?.addEventListener('click', ev_run);

const evThreshInput = document.getElementById('ev_thresh');
if(evThreshInput){
  const updateThresholdLabel = ()=>{
    const lbl = document.getElementById('ev_thresh_val');
    if(lbl) lbl.textContent = (Number(evThreshInput.value)||0).toFixed(2);
  };
  updateThresholdLabel();
  evThreshInput.addEventListener('input', ()=>{
    updateThresholdLabel();
    const pool = window.__evResults?.roc?.pool;
    if(pool?.length){
      const conf = ev_computeConfusion(pool, Number(evThreshInput.value)||0);
      ev_renderConfusion(conf);
      if(window.__evResults){ window.__evResults.confusion = conf; }
    }
  });
}

// Exports
document.getElementById('ev_export_csv')?.addEventListener('click', ()=>{
  const R = window.__evResults; 
  if (!R) { alert('Belum ada hasil.'); return; }

  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = R.results.map((r,i)=>[
    i+1, r.gtName, r.start, r.dur,
    r.top1?.name ?? '', r.hitAtK, r.top1?.score ?? '',
    r.tExtract, r.tSearch
  ].map(esc).join(','));

  const head = 'no,gt,start,dur,top1,hitAtK,score1,t_extract_ms,t_search_ms';

  const summary = [
    'summary','','','','','',
    `precision@k=${R.summary.precision.toFixed(3)};` +
    `recall@k=${R.summary.recall.toFixed(3)};` +
    `f1@k=${R.summary.f1.toFixed(3)};` +
    `t_extract_avg_ms=${R.summary.tExtractAvg.toFixed(1)};` +
    `t_search_avg_ms=${R.summary.tSearchAvg.toFixed(1)}`
  ].map(esc).join(',');

  // gunakan CRLF agar ramah Excel
  const csv = [head, ...rows, summary].join('\r\n');

  // kalau fungsi downloadBlob menerima string:
  downloadBlob(csv, 'evaluation_results.csv', 'text/csv');
  // (opsional) tambahkan BOM untuk Excel: downloadBlob('\uFEFF' + csv, ...)
});

document.getElementById('ev_export_json')?.addEventListener('click', ()=>{
  const R = window.__evResults; if(!R){ alert('Belum ada hasil.'); return; }
  downloadBlob(JSON.stringify(R,null,2), 'evaluation_results.json', 'application/json');
});

// A11y: keyboard activate on heatmap canvas (space/enter center jump)
(function(){
  const heat = document.getElementById('heatmap');
  if(!heat) return;
  heat.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' || e.key===' '){
      const info = window.__heatmapInfo; if(!info) return;
      const tQ = Math.floor((info.lenQ||0)/2), tT = Math.floor((info.lenT||0)/2);
      try{ playerQ.currentTime=tQ; playerQ.play(); }catch(_){}
      try{ playerT.currentTime=tT; playerT.play(); }catch(_){}
      showToast?.(`Jump ke tengah: Q=${tQ}s, T=${tT}s`);
    }
  });
})();




// ---- DTW gradient coloring ----
function colorForCost(c){ // c in [0..1], 0=good(sim=1) -> green; 1=bad -> red
  const h = (120 * (1 - c)); // 120=green, 0=red
  return `hsl(${h} 80% 50%)`;
}
function drawDTWOverlay(canvas, info){
  if(!info?.path || !info.H || !info.H.length) return;
  const ctx = canvas.getContext('2d');
  const rows = info.H.length, cols = info.H[0].length;
  const rect = { x:0, y:0, w: canvas.width, h: canvas.height };
  ctx.save();
  ctx.lineWidth = 2; ctx.globalAlpha = 0.95;
  const gradientOn = !!document.getElementById('dtwGradient')?.checked;
  // Precompute local cost = 1 - sim
  for(let k=1;k<info.path.length;k++){
    const [i0,j0] = info.path[k-1]; const [i1,j1] = info.path[k];
    const sim = info.H[i1]?.[j1] ?? 0.0;
    const cost = Math.max(0, Math.min(1, 1 - sim));
    ctx.strokeStyle = gradientOn ? colorForCost(cost) : '#00ff88';
    ctx.beginPath();
    const x0 = (j0+0.5)*(rect.w/cols), y0=(i0+0.5)*(rect.h/rows);
    const x1 = (j1+0.5)*(rect.w/cols), y1=(i1+0.5)*(rect.h/rows);
    ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
  }
  ctx.restore();
}

// ---- DTW overlay on heatmap ----


document.getElementById('showDTW')?.addEventListener('change', ()=>{
  const info = window.__heatmapInfo; const heat = document.getElementById('heatmap'); if(!heat || !info) return;
  drawHeatmap(heat, info.H);
  if(document.getElementById('showDTW').checked){ drawDTWOverlay(heat, info); }
});
document.getElementById('recomputeHM')?.addEventListener('click', async ()=>{
  // trigger recompute by re-running analysis on current q/t context
  try{
    // re-execute the same block: we assume lastQueryData and lastTargetData available
    const q = lastQueryData, t = lastTargetData;
    if(!q || !t) { alert('Tidak ada konteks. Jalankan Analisis lebih dulu.'); return; }
    let HM;
    try{
      if(!window.__hmWorker){ window.__hmWorker = new Worker('heatmap_worker.js'); }
      const qh = q.hashes.map(h=>String(h.hash)); const th = t.hashes.map(h=>String(h.hash));
      HM = await new Promise((resolve, reject)=>{
        const w = window.__hmWorker; const onMsg = (ev)=>{ w.removeEventListener('message', onMsg); resolve(ev.data); };
        w.addEventListener('message', onMsg); w.postMessage({ q: qh, t: th, maxSize: 240 });
        setTimeout(()=>{ reject(new Error('heatmap worker timeout')); }, 30000);
      });
    }catch(e){ console.warn('worker HM failed, fallback', e); HM = computeVisualSimMatrix_v2(q.hashes, t.hashes); }
    const heat = document.getElementById('heatmap');
    window.__heatmapInfo = { sx:HM.sx, sy:HM.sy, H:HM.H, lenQ:q.hashes.length, lenT:t.hashes.length, path:HM.path||null };
    drawHeatmap(heat, HM.H);
    if(document.getElementById('showDTW')?.checked){ drawDTWOverlay(heat, window.__heatmapInfo); }
    showToast?.('Heatmap dihitung ulang');
  }catch(e){ alert('Gagal hitung ulang: '+(e?.message||e)); }
});



// ---- Korpus tab (backend required) ----
function setCorpusLoading(isLoading, message){
  const table = document.getElementById('cp_table');
  const tbody = document.querySelector('#cp_table tbody');
  if(!table || !tbody) return;
  table.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  if(isLoading){
    tbody.innerHTML = `<tr class="loading-row"><td colspan="6"><span class="loading-spinner" aria-hidden="true"></span>${message || 'Memuat data korpus...'}</td></tr>`;
  }
}
async function loadCorpus(){
  const s = Settings.load();
  if(!s.useBackend){
    const info = document.getElementById('cp_info');
    if(info) info.textContent = 'Mode lokal aktif. Aktifkan backend di Pengaturan untuk memuat korpus server.';
    const tb = document.querySelector('#cp_table tbody');
    if(tb){
      tb.innerHTML = '<tr class="loading-row"><td colspan="6">Korpus backend hanya tersedia saat backend aktif.</td></tr>';
    }
    return;
  }
  const page = Number(document.getElementById('cp_page').value)||1;
  const size = Number(document.getElementById('cp_size').value)||10;
  const url = `/api/items?page=${page}&page_size=${size}`;
  const tb = document.querySelector('#cp_table tbody');
  const info = document.getElementById('cp_info');
  if(info) info.textContent = 'Memuat korpus...';
  setCorpusLoading(true);
  const data = await apiFetch(url, { method:'GET' });
  tb.innerHTML='';
  setCorpusLoading(false);
  (data.items||[]).forEach((it,idx)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${(page-1)*size+idx+1}</td><td>${it.name}</td><td>${it.duration}s</td><td>${it.bucket}</td><td>${it.created_at||it.created||''}</td>
      <td><button data-loadid="${it.id}" aria-label="Analisis ${it.name}">Analisis</button></td>`;
    tb.appendChild(tr);
  });
  if(info) info.textContent = `Total ${data.total||0} item  Page ${data.page||page}`;
  tb.querySelectorAll('button[data-loadid]')?.forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.currentTarget.getAttribute('data-loadid');
      lastTargetData = await fetchBackendItemDetail(id);
      showToast?.('Target dimuat dari backend: '+(lastTargetData.target?.name||id));
      document.querySelector('nav .tab-btn[data-tab="#tab-analisis"]')?.click();
      await loadTargetPreview(Number(id), 'backend');
    });
  });
}
document.getElementById('cp_load')?.addEventListener('click', ()=>{
  loadCorpus().catch(e=>{
    console.error(e);
    const tb = document.querySelector('#cp_table tbody');
    if(tb){
      tb.innerHTML = `<tr class="loading-row"><td colspan="6">Gagal memuat korpus: ${e?.message||e}</td></tr>`;
    }
    const table = document.getElementById('cp_table');
    if(table) table.setAttribute('aria-busy','false');
    const info = document.getElementById('cp_info');
    if(info) info.textContent = 'Gagal memuat korpus.';
  });
});
// ---- Fused timeline worker integration ----
async function computeFusedTimelineWorker(q, t, wv, wa){
  try{
    if(!window.__fuseWorker){ window.__fuseWorker = new Worker('fuse_worker.js'); }
    const qh = q.hashes.map(h=>String(h.hash));
    const th = t.hashes.map(h=>String(h.hash));
    const qc = (q._chromaSegs||q._chroma||[]).map(x=> x.chroma || x);
    const tc = (t._chromaSegs||t._chroma||[]).map(x=> x.chroma || x);
    const payload = { qHashes: qh, tHashes: th, qChroma: qc, tChroma: tc, wv, wa };
    const res = await new Promise((resolve, reject)=>{
      const w = window.__fuseWorker;
      const onMsg = (ev)=>{ w.removeEventListener('message', onMsg); resolve(ev.data); };
      w.addEventListener('message', onMsg);
      w.postMessage(payload);
      setTimeout(()=> reject(new Error('fuse worker timeout')), 20000);
    });
    return res; // {vis,aud,fused}
  }catch(e){
    console.warn('fuse worker failed, fallback to main-thread', e);
    const vis = timeSeriesVisualSim(q.hashes, t.hashes);
    let fused = vis, aud = [];
    if((q._chromaSegs?.length||q._chroma?.length||0)>0 && (t._chroma?.length||t._chromaSegs?.length||0)>0){
      const segSec = q._segSec || 1;
      aud = timeSeriesAudioSim(q._chromaSegs||q._chroma, t._chroma||t._chromaSegs||[], segSec);
      const L = Math.min(vis.length, aud.length);
      fused = new Array(L).fill(0).map((_,i)=> wv*vis[i] + wa*aud[i]);
    }
    return { vis, aud, fused };
  }
}



// ---- Presentasi+ UX ----
document.getElementById('fsToggle')?.addEventListener('click', ()=>{
  const el = document.documentElement;
  if(!document.fullscreenElement){ el.requestFullscreen?.(); } else { document.exitFullscreen?.(); }
});



// ---- Backend Health checker ----
document.getElementById('btnHealth')?.addEventListener('click', async ()=>{
  const s = Settings.load();
  if(!s.useBackend){
    document.getElementById('healthInfo').textContent = 'Mode lokal: backend dimatikan';
    setStatusDot(document.getElementById('backendIndicator'), 'off', 'Mode lokal (backend nonaktif)');
    showToast?.('Mode lokal aktif, tidak perlu cek backend.', { type:'info' });
    return;
  }
  try{
    const data = await apiFetch('/api/health', {method:'GET'});
    const txt = `OK � cache=${data.cache_ttl||'-'}`;
    document.getElementById('healthInfo').textContent = txt;
    setStatusDot(document.getElementById('backendIndicator'), 'ok', txt);
    showToast?.('Backend sehat');
  }catch(e){
    document.getElementById('healthInfo').textContent = 'Tidak dapat menghubungi backend';
    setStatusDot(document.getElementById('backendIndicator'), 'error', 'Backend tidak dapat dihubungi');
    alert('Gagal health: '+(e?.message||e));
  }
});




document.getElementById('adminExport')?.addEventListener('click', async (ev)=>{
  ev.preventDefault();
  try{
    const s = Settings.load();
    if(!s.useBackend){
      alert('Ekspor korpus backend hanya tersedia jika backend aktif.');
      return;
    }
    const base = (s.backendUrl||'').trim();
    if(!base) throw new Error('Isi Backend Base URL sebelum mengekspor korpus.');
    const url = base.replace(/\/+$/,'') + '/api/export/json';
    const headers = {};
    if(s.apiKey) headers['X-API-Key'] = s.apiKey;
    const res = await fetch(url, { headers });
    if(!res.ok) throw new Error('HTTP '+res.status);
    const content = await res.text();
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const filename = `mediafinder_corpus_${stamp}.jsonl`;
    downloadBlob(content, filename, 'application/json');
    showToast?.('Corpus backend berhasil diunduh');
  }catch(err){
    console.error(err);
    alert('Export corpus gagal: '+(err?.message||err));
  }
});

// ---- Query file watcher (remember last query file for chroma) ----
document.addEventListener('change', (e)=>{
  const el = e.target;
  if(el && el.type === 'file'){
    const f = el.files?.[0];
    if(!f) return;
    // Heuristic: mark as potential "query" if input id/name contains 'q' or 'query'
    const tag = ((el.id||'') + ' ' + (el.name||'')).toLowerCase();
    if(tag.includes('q') || tag.includes('query')){
      window.__lastQueryFile = f;
    }
  }
});



// ---- Ensure query chroma available ----
async function extractChromaFromFile(file, segSec){
  // Minimal chroma: decode audio & compute 12-bin cosine-friendly feature per second
  return new Promise((resolve, reject)=>{
    try{
      const AC = new (window.AudioContext || window.webkitAudioContext)();
      const fr = new FileReader();
      fr.onload = async ()=>{
        try {
          const buf = await AC.decodeAudioData(fr.result);
          const ch = buf.numberOfChannels>0 ? buf.getChannelData(0) : new Float32Array();
          const fs = buf.sampleRate||44100;
          const step = Math.max(1, Math.floor(fs * (segSec||1)));
          const N = Math.floor(ch.length / step);
          const out = [];
          for(let i=0;i<N;i++){
            const start = i*step;
            const end = Math.min(ch.length, start+step);
            // crude 12-bin chroma via DFT on 12 target bins (placeholder but consistent)
            const v = new Array(12).fill(0);
            const len = end-start;
            for(let k=0;k<12;k++){
              let re=0, im=0;
              const f = 55 * Math.pow(2, k/12); // rough mapping
              const w = 2*Math.PI*f/fs;
              for(let n=0;n<len;n+=64){ // subsample for performance
                const x = ch[start+n]||0;
                re += x * Math.cos(w*n);
                im += x * Math.sin(w*n);
              }
              v[k] = Math.sqrt(re*re + im*im);
            }
            // normalize
            let norm=1e-9; for(let k=0;k<12;k++){ norm+=v[k]*v[k]; } norm = Math.sqrt(norm);
            for(let k=0;k<12;k++){ v[k] = v[k]/norm; }
            out.push(v);
          }
          AC.close();
          resolve(out);
        }catch(err){ reject(err); }
      };
      fr.onerror = ()=> reject(fr.error||new Error('read error'));
      fr.readAsArrayBuffer(file);
    }catch(e){ reject(e); }
  });
}

async function ensureQueryChromaAvailable(q){
  const has = (q && ((q._chromaSegs && q._chromaSegs.length) || (q._chroma && q._chroma.length)));
  if(has) return q;
  const f = q?._file || window.__lastQueryFile;
  if(!f){ return q; }
  try{
    const segSec = 1;
    const segs = await extractChromaFromFile(f, segSec);
    q._chromaSegs = segs.map((c,i)=>({t:i, chroma:c}));
    q._segSec = segSec;
    return q;
  }catch(e){
    console.warn('ensureQueryChromaAvailable failed', e);
    return q;
  }
}



// ---- Robustness: Export PDF ----
async function loadJsPDF(){
  if(window.jspdf || window.jsPDF) return window.jspdf || window.jsPDF;
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    s.onload = ()=> resolve(window.jspdf || window.jsPDF || window.jspdf);
    s.onerror = ()=> reject(new Error('Gagal memuat jsPDF'));
    document.head.appendChild(s);
  });
}
async function loadJSZip(){
  if(window.JSZip) return window.JSZip;
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = ()=> resolve(window.JSZip);
    s.onerror = ()=> reject(new Error('Gagal memuat JSZip'));
    document.head.appendChild(s);
  });
}

async function exportRobustnessPDF(){
  try{
    if(isLocalOnly && isLocalOnly()){ alert('Mode Local-only aktif: Export PDF membutuhkan jsPDF dari CDN. Matikan Local-only di Pengaturan.'); return; }
    const js = await loadJsPDF();
    const { jsPDF } = js || window.jspdf || {};
    const doc = new jsPDF({ unit:'pt', format:'a4' });
    const pad = 24, line = 18;
    let y = pad;
    doc.setFontSize(14); doc.text('MediaFinder � Laporan Robustness', pad, y); y+= line;
    doc.setFontSize(10); const dts = new Date().toLocaleString(); doc.text('Dibuat: '+dts, pad, y); y+= line*1.5;

    // Capture canvases/tables inside robustness tab
    const candIds = ['#tab-robust', '#tab-robustness'];
    let sec = null;
    for(const sel of candIds){
      const el = document.querySelector(sel);
      if(el){ sec = el; break; }
    }
    if(!sec){ alert('Bagian Robustness tidak ditemukan. Buka tab Robustness dulu.'); return; }

    // Add canvases
    const cvs = sec.querySelectorAll('canvas');
    for(const c of cvs){
      const data = c.toDataURL('image/png', 0.92);
      const w = 540, h = (c.height/c.width)*w;
      if(y+h > 800){ doc.addPage(); y = pad; }
      doc.addImage(data, 'PNG', pad, y, w, h);
      y += h + line;
    }
    // Add tables as text (simple)
    const tbls = sec.querySelectorAll('table');
    for(const t of tbls){
      const rows = t.querySelectorAll('tr');
      if(y + line* (rows.length+2) > 800){ doc.addPage(); y = pad; }
      const cells = rows[0]?.querySelectorAll('th,td') || [];
      const head = Array.from(cells).map(x=> x.textContent.trim()).join(' | ');
      doc.setFont(undefined,'bold'); doc.text(head, pad, y); y+= line;
      doc.setFont(undefined,'normal');
      for(let i=1;i<rows.length;i++){
        const cs = rows[i].querySelectorAll('th,td');
        const txt = Array.from(cs).map(x=> x.textContent.trim()).join(' | ');
        doc.text(txt, pad, y); y+= line;
      }
      y+= line*0.5;
    }

    doc.save('robustness_report.pdf');
    showToast?.('Robustness PDF diunduh');
  }catch(e){
    alert('Export PDF gagal: '+(e?.message||e));
  }
}

document.getElementById('installBtn')?.addEventListener('click', async ()=>{
  if(!deferredPrompt){ alert('Install tidak tersedia saat ini.'); return; }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if(outcome==='accepted'){
    showToast?.('Aplikasi diinstall');
    updateHeroStats({ lastAction:'PWA berhasil dipasang', cta:'Akses dari homescreen untuk pengalaman penuh' });
  } else {
    showToast?.('Instalasi dibatalkan');
  }
  deferredPrompt = null;
  const btn = document.getElementById('installBtn'); if(btn) btn.style.display='none';
});



function renderInsightPanel(options={}){
  const container = document.getElementById('insightList');
  if(!container){ return; }
  const msg = document.getElementById('insightFeedbackMsg');
  if(msg && !msg.textContent){
    msg.textContent = 'Beri penilaian akurat/tidak akurat untuk melatih insight.';
  }
  container.innerHTML = '';
  let insights = [];
  try{
    insights = window.InsightEngine?.generate({ snapshot: collectInsightSnapshot() }) || [];
  }catch(e){
    console.warn('generate insights gagal', e);
  }
  window.__insightLast = insights;
  updateInsightOverlays(insights);
  if((window.__INSIGHT_DEBUG || localStorage.getItem('mf_insight_debug')==='1') && insights.length){
    console.groupCollapsed('[InsightEngine] Current insights');
    console.table(insights.map(ins=>({
      type: ins.type,
      severity: ins.severity,
      title: ins.title,
      key: ins.key || `${ins.type}:${ins.title}`
    })));
    console.groupEnd();
  }
  if(!insights.length){
    container.innerHTML = '<p class="hint">Belum ada insight. Jalankan analisis atau evaluasi.</p>';
    return;
  }
  let highlighted = null;
  insights.forEach(ins=>{
    const card = document.createElement('div');
    card.className = 'insight-card';
    const severity = ins.severity || 'info';
    const key = ins.key || `${ins.type||'insight'}:${ins.title||''}`;
    card.dataset.insightKey = key;
    card.innerHTML = `
      <div class="insight-meta">
        <span class="badge-insight ${severity}">${severity.toUpperCase()}</span>
        <span class="hint">${ins.type || 'insight'}</span>
      </div>
      <h4>${ins.title || 'Insight'}</h4>
      <p>${ins.summary || ''}</p>
    `;
    const statusEl = document.createElement('small');
    statusEl.className = 'insight-feedback-status';
    card.appendChild(statusEl);
    const actions = document.createElement('div');
    actions.className = 'insight-actions';
    const btnPos = document.createElement('button');
    btnPos.type = 'button';
    btnPos.dataset.value = 'positive';
    btnPos.textContent = 'Akurat';
    const btnNeg = document.createElement('button');
    btnNeg.type = 'button';
    btnNeg.dataset.value = 'negative';
    btnNeg.textContent = 'Tidak Akurat';
    actions.appendChild(btnPos);
    actions.appendChild(btnNeg);
    card.appendChild(actions);
    container.appendChild(card);
    const status = getInsightFeedbackStatus(key);
    applyInsightFeedbackState(card, status);
    btnPos.addEventListener('click', ()=> handleInsightFeedback(Object.assign({}, ins, { key }), 'positive', card));
    btnNeg.addEventListener('click', ()=> handleInsightFeedback(Object.assign({}, ins, { key }), 'negative', card));
    if(!highlighted && (severity==='critical' || severity==='warning' || severity==='high')){
      highlighted = ins;
      card.classList.add('pulse');
      setTimeout(()=> card.classList.remove('pulse'), 2000);
    }
  });
  if(options.toast && highlighted){
    showToast(`Insight penting: ${highlighted.title}`, {
      title: highlighted.severity==='critical' ? 'Anomali berat' : 'Insight penting',
      type: highlighted.severity==='critical' ? 'danger' : 'warning',
      action: {
        label: 'Lihat di Analisis',
        handler: ()=>{
          document.querySelector('nav .tab-btn[data-tab="#tab-analisis"]')?.click();
          const panel = document.querySelector('#panelInsights');
          if(panel){ setTimeout(()=> scrollToSection(panel), 80); }
        }
      }
    });
  }
}
function extractInsightSegments(insights){
  const sanitized = buildInsightExportPayload(insights);
  const segments = [];
  const pushSeg = (start, end, meta)=>{
    const anchor = Number(start);
    if(!Number.isFinite(anchor)) return;
    const finish = Number(end);
    segments.push({
      start: anchor,
      end: Number.isFinite(finish) ? finish : anchor,
      severity: meta?.severity || 'info',
      title: meta?.title || 'Insight',
      detail: meta?.detail || meta?.summary || ''
    });
  };
  sanitized.forEach(meta=>{
    if(meta?.supporting?.peaks?.length){
      meta.supporting.peaks.forEach(pk=>{
        pushSeg(pk.start, pk.end ?? pk.start, meta);
      });
    }else if(meta?.supporting?.topScore){
      pushSeg(meta.supporting.topScore.start, meta.supporting.topScore.end ?? meta.supporting.topScore.start, meta);
    }
  });
  if(!segments.length){
    (window.__topPeaks||[]).forEach(p=>{
      const t = firstFiniteNumber(p.start, p.t, p.time);
      if(Number.isFinite(t)){
        segments.push({
          start: Number(t),
          end: Number(t),
          severity: 'info',
          title: 'Segmen unggulan',
          detail: `score=${Number(p.s ?? p.score ?? 0).toFixed(3)}`
        });
      }
    });
  }
  return segments;
}
function updateInsightOverlays(insights){
  const overlay = document.getElementById('timelineOverlay');
  const heatOverlay = document.getElementById('heatmapOverlay');
  if(overlay){ overlay.querySelectorAll('.insight-marker').forEach(el=> el.remove()); }
  if(heatOverlay){ heatOverlay.querySelectorAll('.insight-pin').forEach(el=> el.remove()); }
  const segments = extractInsightSegments(insights);
  if(!segments.length) return;
  const totalLen = window.__lastAnalysis?.fused?.length || lastQueryData?.hashes?.length || 0;
  if(overlay && totalLen > 0){
    segments.forEach(seg=>{
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'insight-marker';
      marker.dataset.severity = seg.severity || 'info';
      const pos = Math.min(99.5, Math.max(0, (seg.start / totalLen) * 100));
      marker.style.left = `${pos}%`;
      marker.style.transform = 'translate(-50%, 0)';
      marker.title = seg.title;
      marker.setAttribute('aria-label', `${seg.title} @ ${Math.round(seg.start)}s`);
      marker.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        ev.preventDefault();
        const t = seg.start;
        if(Number.isFinite(t)){
          try{
            playerQ.currentTime = t;
            playerQ.pause();
            playerQ.play().catch(()=>{});
          }catch(_){}
        }
        if(typeof showToast === 'function'){
          showToast(seg.detail || seg.title, {
            title: seg.title,
            type: seg.severity==='critical' ? 'danger' : (seg.severity==='warning' || seg.severity==='high' ? 'warning' : 'info'),
            duration: 3200
          });
        }
      });
      overlay.appendChild(marker);
    });
  }
  if(heatOverlay){
    const hm = window.__heatmapInfo;
    const base = hm?.lenQ || totalLen;
    if(base > 0){
      segments.forEach(seg=>{
        const pin = document.createElement('span');
        pin.className = 'insight-pin';
        pin.dataset.severity = seg.severity || 'info';
        const pos = Math.min(99.5, Math.max(0, (seg.start / base) * 100));
        pin.style.left = `${pos}%`;
        pin.title = seg.title;
        heatOverlay.appendChild(pin);
      });
    }
  }
}


document.getElementById('refreshInsights')?.addEventListener('click', ()=>{
  renderInsightPanel({ toast:false });
});
document.getElementById('push_enable')?.addEventListener('click', ()=> enableBackendPush());
document.getElementById('push_disable')?.addEventListener('click', ()=> disableBackendPush());











