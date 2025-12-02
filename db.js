function notImplemented(name){
  throw new Error(`Function ${name} tidak tersedia di modul root db.js (gunakan modul IndexedDB di frontend).`);
}

module.exports = {
  openDB: () => notImplemented('openDB'),
  addItem: () => notImplemented('addItem'),
  listItems: () => notImplemented('listItems'),
  listInsightFeedback: () => notImplemented('listInsightFeedback'),
  saveInsightFeedback: () => notImplemented('saveInsightFeedback'),
  getInsightFeedbackByKey: () => notImplemented('getInsightFeedbackByKey')
};
