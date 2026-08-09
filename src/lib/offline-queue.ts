import type { TransactionInsert } from "@/lib/transactions";

export type QueuedTransactionWrite = {
  id: string;
  householdId: string;
  ownerUserId: string;
  payload: OfflineTransactionInsert;
  createdAt: string;
  attempts: number;
  lastError: string | null;
};

export type OfflineTransactionInsert = TransactionInsert & { id: string };

export type QueueScope = {
  householdId: string;
  ownerUserId: string;
};

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
    let settled = false;
    let result: T;
    const fail = (error: DOMException | null) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error);
    };
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      result = request.result;
    };
    transaction.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
      database.close();
    };
    transaction.onerror = () => {
      fail(transaction.error);
    };
    transaction.onabort = () => {
      fail(transaction.error);
    };
  });
}

export async function getQueuedTransactionWrites({
  householdId,
  ownerUserId,
}: QueueScope): Promise<QueuedTransactionWrite[]> {
  const writes = await withStore<QueuedTransactionWriteRecord[]>("readonly", (store) =>
    store.getAll(),
  );
  return writes
    .filter((write) => write.householdId === householdId && write.ownerUserId === ownerUserId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function queueTransactionWrite(payload: OfflineTransactionInsert, scope: QueueScope) {
  const write: QueuedTransactionWrite = {
    id: payload.id,
    ...scope,
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
