// Penyimpanan lokal berbasis IndexedDB untuk data personel, perjalanan dinas, dan draft.
// Semua data hanya ada di browser pengguna (tidak ada server).
//
// Store:
//   employees : keyPath "id"  -> objek personel (camelCase, sama seperti format API lama)
//   trips     : keyPath "id"  -> objek perjalanan dinas
//   drafts    : keyPath "id"  -> objek draft SPPD lengkap

const DB_NAME = "sppd-ultg-parepare";
const DB_VERSION = 1;

export const STORES = ["employees", "trips", "drafts"];

let dbPromise = null;
let memory = null; // cadangan di memori bila IndexedDB tidak tersedia (mis. pengujian Node)

function hasIndexedDB() {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB tidak dapat dibuka."));
    request.onblocked = () =>
      reject(new Error("IndexedDB terblokir. Tutup tab lain yang memakai aplikasi ini."));
  });

  return dbPromise;
}

function memoryStore(name) {
  if (!memory) memory = { employees: new Map(), trips: new Map(), drafts: new Map() };
  return memory[name];
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(name, mode, work) {
  const db = await openDb();
  const transaction = db.transaction(name, mode);
  const store = transaction.objectStore(name);
  const result = await work(store);

  await new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaksi dibatalkan."));
  });

  return result;
}

export async function getAll(name) {
  if (!hasIndexedDB()) return [...memoryStore(name).values()].map((v) => structuredClone(v));
  return withStore(name, "readonly", (store) => requestToPromise(store.getAll()));
}

export async function getOne(name, id) {
  if (id === undefined || id === null || id === "") return null;

  if (!hasIndexedDB()) {
    const value = memoryStore(name).get(String(id));
    return value ? structuredClone(value) : null;
  }

  const value = await withStore(name, "readonly", (store) => requestToPromise(store.get(String(id))));
  return value || null;
}

export async function putOne(name, value) {
  if (!hasIndexedDB()) {
    memoryStore(name).set(String(value.id), structuredClone(value));
    return value;
  }

  await withStore(name, "readwrite", (store) => requestToPromise(store.put(value)));
  return value;
}

export async function putMany(name, values) {
  if (!hasIndexedDB()) {
    values.forEach((value) => memoryStore(name).set(String(value.id), structuredClone(value)));
    return;
  }

  await withStore(name, "readwrite", async (store) => {
    await Promise.all(values.map((value) => requestToPromise(store.put(value))));
  });
}

export async function deleteOne(name, id) {
  if (!hasIndexedDB()) return memoryStore(name).delete(String(id));
  await withStore(name, "readwrite", (store) => requestToPromise(store.delete(String(id))));
  return true;
}

export async function clearStore(name) {
  if (!hasIndexedDB()) return memoryStore(name).clear();
  await withStore(name, "readwrite", (store) => requestToPromise(store.clear()));
}

// Ganti seluruh isi beberapa store dalam satu transaksi (dipakai impor mode "ganti semua").
export async function replaceAll(data) {
  if (!hasIndexedDB()) {
    for (const name of STORES) {
      memoryStore(name).clear();
      (data[name] || []).forEach((value) => memoryStore(name).set(String(value.id), structuredClone(value)));
    }
    return;
  }

  const db = await openDb();
  const transaction = db.transaction(STORES, "readwrite");

  for (const name of STORES) {
    const store = transaction.objectStore(name);
    store.clear();
    (data[name] || []).forEach((value) => store.put(value));
  }

  await new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaksi dibatalkan."));
  });
}

// ---- Pintasan per store, dipakai modul lain ----

export const listEmployees = () => getAll("employees");
export const listTrips = () => getAll("trips");
export const listDrafts = () => getAll("drafts");
