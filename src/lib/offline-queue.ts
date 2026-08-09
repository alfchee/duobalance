import type { TransactionInsert } from "@/lib/transactions";

export type QueuedTransactionWrite = {
  id: string;
  payload: OfflineTransactionInsert;
  createdAt: string;
  attempts: number;
  lastError: string | null;
};

export type OfflineTransactionInsert = TransactionInsert & { id: string };

type QueuedTransactionWriteRecord = Omit<QueuedTransactionWrite, "payload"> & {
  payload: OfflineTransactionInsert;
};

const DATABASE_NAME = "duobalance";
const STORE_NAME = "queued-transaction-writes";
const DATABASE_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function getQueuedTransactionWrites(): Promise<QueuedTransactionWrite[]> {
  const writes = await withStore<QueuedTransactionWriteRecord[]>("readonly", (store) =>
    store.getAll(),
  );
  return writes.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function queueTransactionWrite(payload: OfflineTransactionInsert) {
  const write: QueuedTransactionWrite = {
    id: payload.id,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  return withStore("readwrite", (store) => store.put(write));
}

export function removeQueuedTransactionWrite(id: string) {
  return withStore("readwrite", (store) => store.delete(id));
}

export function updateQueuedTransactionWrite(write: QueuedTransactionWrite) {
  return withStore("readwrite", (store) => store.put(write));
}
