/*
 * Hikma BizTrack — Offline Database
 * IndexedDB storage foundation.
 */

const HIKMA_DB_NAME = "hikma-biztrack-offline";
const HIKMA_DB_VERSION = 1;

const HIKMA_STORES = [
  "settings",
  "products",
  "sales",
  "customers",
  "purchases",
  "suppliers",
  "employees",
  "expenses",
  "users",
  "syncQueue"
];

let hikmaDBPromise = null;

function openHikmaDB() {
  if (hikmaDBPromise) return hikmaDBPromise;

  hikmaDBPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not supported by this browser."));
      return;
    }

    const request = indexedDB.open(HIKMA_DB_NAME, HIKMA_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      for (const storeName of HIKMA_STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          if (storeName === "syncQueue") {
            const store = db.createObjectStore(storeName, {
              keyPath: "id",
              autoIncrement: true
            });

            store.createIndex("status", "status", { unique: false });
            store.createIndex("createdAt", "createdAt", { unique: false });
          } else {
            db.createObjectStore(storeName, {
              keyPath: "id"
            });
          }
        }
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      hikmaDBPromise = null;
      reject(request.error || new Error("Could not open offline database."));
    };
  });

  return hikmaDBPromise;
}

async function hikmaDBPut(storeName, value) {
  const db = await openHikmaDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);

    const request = store.put(value);

    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

async function hikmaDBGet(storeName, id) {
  const db = await openHikmaDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function hikmaDBGetAll(storeName) {
  const db = await openHikmaDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function hikmaDBDelete(storeName, id) {
  const db = await openHikmaDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).delete(id);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function hikmaDBClear(storeName) {
  const db = await openHikmaDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).clear();

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function hikmaDBReplaceStore(storeName, items) {
  const db = await openHikmaDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);

    store.clear();

    for (const item of items || []) {
      if (item && item.id !== undefined) {
        store.put(item);
      }
    }

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted."));
  });
}

async function hikmaQueueOperation(operation) {
  return hikmaDBPut("syncQueue", {
    ...operation,
    status: "pending",
    createdAt: new Date().toISOString(),
    attempts: 0
  });
}

async function hikmaGetPendingOperations() {
  const all = await hikmaDBGetAll("syncQueue");
  return all
    .filter(item => item.status === "pending")
    .sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt))
    );
}

async function hikmaMarkOperationDone(id) {
  const item = await hikmaDBGet("syncQueue", id);
  if (!item) return;

  item.status = "done";
  item.completedAt = new Date().toISOString();

  await hikmaDBPut("syncQueue", item);
}

async function hikmaMarkOperationFailed(id, error) {
  const item = await hikmaDBGet("syncQueue", id);
  if (!item) return;

  item.status = "pending";
  item.attempts = Number(item.attempts || 0) + 1;
  item.lastError = String(error || "Unknown error");
  item.lastAttemptAt = new Date().toISOString();

  await hikmaDBPut("syncQueue", item);
}
