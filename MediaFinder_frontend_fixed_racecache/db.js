const DB_NAME = 'mediafinder-db-v06';
const DB_VERSION = 5;
const STORE_ITEMS = 'items';
const STORE_PHASH = 'phash';

let db;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains(STORE_ITEMS)){
        const s = d.createObjectStore(STORE_ITEMS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('by_name','name',{unique:false});
      }
      if(!d.objectStoreNames.contains(STORE_PHASH)){
        const s2 = d.createObjectStore(STORE_PHASH, { keyPath: ['itemId','t'] });
        s2.createIndex('by_item','itemId',{unique:false});
      }
      if(!d.objectStoreNames.contains('chroma')){
        const s3 = d.createObjectStore('chroma', { keyPath: ['itemId','t'] });
        s3.createIndex('by_item','itemId',{unique:false});
      }
      if(!d.objectStoreNames.contains('files')){
        const s4 = d.createObjectStore('files', { keyPath: 'itemId' });
      }
      if(!d.objectStoreNames.contains('backend_items')){
        const s5 = d.createObjectStore('backend_items', { keyPath: 'id' });
        s5.createIndex('by_page','page',{unique:false});
      }
      if(!d.objectStoreNames.contains('insight_feedback')){
        const s6 = d.createObjectStore('insight_feedback', { keyPath: 'id', autoIncrement: true });
        s6.createIndex('by_key','insightKey',{unique:false});
      }
    };
    req.onsuccess = ()=>{ db = req.result; resolve(db); };
    req.onerror = ()=>reject(req.error);
  });
}

async function saveInsightFeedback(entry){
  const database = db || await openDB();
  const tx = database.transaction('insight_feedback','readwrite');
  return new Promise((resolve,reject)=>{
    const req = tx.objectStore('insight_feedback').put(entry);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

async function listInsightFeedback(){
  const database = db || await openDB();
  const tx = database.transaction('insight_feedback','readonly');
  return new Promise((resolve,reject)=>{
    const req = tx.objectStore('insight_feedback').getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  });
}

async function getInsightFeedbackByKey(key){
  const database = db || await openDB();
  const tx = database.transaction('insight_feedback','readonly');
  return new Promise((resolve,reject)=>{
    const idx = tx.objectStore('insight_feedback').index('by_key');
    const req = idx.getAll(key);
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  });
}

async function addItem(meta, hashes){
  const tx = db.transaction([STORE_ITEMS, STORE_PHASH], 'readwrite');
  const id = await new Promise((resolve,reject)=>{
    const req = tx.objectStore(STORE_ITEMS).add(meta);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
  const ph = tx.objectStore(STORE_PHASH);
  for(const h of hashes){
    ph.add({ itemId:id, t:h.t, hash:h.hash });
  }
  return new Promise((resolve,reject)=>{
    tx.oncomplete = ()=>resolve(id);
    tx.onerror = ()=>reject(tx.error);
  });
}

function listItems(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_ITEMS, 'readonly');
    const req = tx.objectStore(STORE_ITEMS).getAll();
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

function getItem(id){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_ITEMS, 'readonly');
    const req = tx.objectStore(STORE_ITEMS).get(id);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

function listHashes(itemId){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_PHASH, 'readonly');
    const idx = tx.objectStore(STORE_PHASH).index('by_item');
    const req = idx.getAll(IDBKeyRange.only(itemId));
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

window.DB = {
  openDB,
  addItem,
  listItems,
  getItem,
  listHashes,
  saveInsightFeedback,
  listInsightFeedback,
  getInsightFeedbackByKey
};


function addChroma(itemId, chromaSegs){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('chroma','readwrite');
    const st = tx.objectStore('chroma');
    for (const seg of chromaSegs) {
      // Baris ini memastikan data yang masuk valid sebelum disimpan
      const t = (seg && typeof seg.t === 'number') ? (seg.t|0) : 0;
      const chroma = (seg && seg.chroma) ? seg.chroma : seg;
      st.put({ itemId, t, chroma }); // .put lebih aman daripada .add
    }
    tx.oncomplete = ()=> resolve(true);
    tx.onerror    = ()=> reject(tx.error);
  });
}

function listChroma(itemId){
  return new Promise((resolve,reject)=>{
    const tx  = db.transaction('chroma','readonly');
    const idx = tx.objectStore('chroma').index('by_item');
    const req = idx.getAll(IDBKeyRange.only(itemId));
    req.onsuccess = ()=> resolve(req.result || []); // Mengembalikan array kosong jika tidak ada hasil
    req.onerror   = ()=> reject(req.error);
  });
}

async function countChroma(itemId){
  const arr = await listChroma(itemId);
  return arr.length;
}

// Pastikan baris export ini ada dan tidak berubah
window.DB.addChroma   = addChroma;
window.DB.listChroma  = listChroma;
window.DB.countChroma = countChroma;


function addFileBlob(itemId, file){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('files','readwrite');
    tx.objectStore('files').put({ itemId, name:file.name, type:file.type, size:file.size, blob:file });
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
  });
}
function getFileBlob(itemId){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('files','readonly');
    const req = tx.objectStore('files').get(itemId);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
window.DB.addFileBlob = addFileBlob;
window.DB.getFileBlob = getFileBlob;
window.DB.saveInsightFeedback = saveInsightFeedback;
window.DB.listInsightFeedback = listInsightFeedback;
window.DB.getInsightFeedbackByKey = getInsightFeedbackByKey;

function saveBackendSnapshot(items, page, metadata={}){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('backend_items','readwrite');
    const store = tx.objectStore('backend_items');
    items.forEach((it)=>{
      store.put(Object.assign({ page, syncedAt: Date.now() }, it));
    });
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
  });
}

function listBackendSnapshot(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('backend_items','readonly');
    const req = tx.objectStore('backend_items').getAll();
    req.onsuccess = ()=> resolve(req.result||[]);
    req.onerror = ()=> reject(req.error);
  });
}

function clearBackendSnapshot(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('backend_items','readwrite');
    tx.objectStore('backend_items').clear();
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
  });
}

window.DB.saveBackendSnapshot = saveBackendSnapshot;
window.DB.listBackendSnapshot = listBackendSnapshot;
window.DB.clearBackendSnapshot = clearBackendSnapshot;
