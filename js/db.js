// Banco de fotos dentro do próprio app (IndexedDB do navegador).

const DB_NAME = 'fotos-campo';
const STORE = 'photos';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Operação cancelada'));
  });
}

export const putPhoto = (rec) => run('readwrite', (s) => { s.put(rec); return rec; });
export const getPhoto = (id) => run('readonly', (s) => s.get(id));
export const deletePhotos = (ids) => run('readwrite', (s) => { ids.forEach((id) => s.delete(id)); });

export async function listPhotos() {
  const all = await run('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
