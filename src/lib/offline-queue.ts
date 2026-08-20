import type { TransactionInsert } from "@/lib/transactions";
import type { DiagnosticContext } from "@/lib/diagnostics";
import { apiFetch } from "@/lib/api-fetch";

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

export type FeedbackPayload = {
  category: "problem_report" | "satisfaction_prompt" | "general";
  message: string;
  diagnostics: DiagnosticContext;
};

export type QueuedFeedbackReport = {
  id: string;
  householdId: string;
  ownerUserId: string;
  payload: FeedbackPayload;
  createdAt: string;
  attempts: number;
  lastError: string | null;
};

type QueuedTransactionWriteRecord = Omit<QueuedTransactionWrite, "payload"> & {
  payload: OfflineTransactionInsert;
};

const DATABASE_NAME = "duobalance";
const STORE_NAME = "queued-transaction-writes";
const FEEDBACK_STORE_NAME = "queued-feedback-reports";
const DATABASE_VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(FEEDBACK_STORE_NAME)) {
        database.createObjectStore(FEEDBACK_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
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
  const writes = await withStore<QueuedTransactionWriteRecord[]>(STORE_NAME, "readonly", (store) =>
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
  return withStore(STORE_NAME, "readwrite", (store) => store.put(write));
}

export function removeQueuedTransactionWrite(id: string) {
  return withStore(STORE_NAME, "readwrite", (store) => store.delete(id));
}

export function updateQueuedTransactionWrite(write: QueuedTransactionWrite) {
  return withStore(STORE_NAME, "readwrite", (store) => store.put(write));
}

export async function getQueuedFeedbackReports({
  householdId,
  ownerUserId,
}: QueueScope): Promise<QueuedFeedbackReport[]> {
  const reports = await withStore<QueuedFeedbackReport[]>(
    FEEDBACK_STORE_NAME,
    "readonly",
    (store) => store.getAll(),
  );
  return reports
    .filter((report) => report.householdId === householdId && report.ownerUserId === ownerUserId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function queueFeedbackReport(id: string, payload: FeedbackPayload, scope: QueueScope) {
  const report: QueuedFeedbackReport = {
    id,
    ...scope,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  return withStore(FEEDBACK_STORE_NAME, "readwrite", (store) => store.put(report));
}

export function removeQueuedFeedbackReport(id: string) {
  return withStore(FEEDBACK_STORE_NAME, "readwrite", (store) => store.delete(id));
}

export function updateQueuedFeedbackReport(report: QueuedFeedbackReport) {
  return withStore(FEEDBACK_STORE_NAME, "readwrite", (store) => store.put(report));
}

export async function flushQueuedFeedbackReports(scope: QueueScope): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) return;
  const reports = await getQueuedFeedbackReports(scope);
  for (const report of reports) {
    try {
      await apiFetch("/api/feedback", {
        method: "POST",
        body: JSON.stringify(report.payload),
      });
      await removeQueuedFeedbackReport(report.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "flush failed";
      await updateQueuedFeedbackReport({
        ...report,
        attempts: report.attempts + 1,
        lastError: msg,
      });
    }
  }
}
