"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useHousehold } from "@/hooks/useHousehold";
import { useSession } from "@/hooks/useSession";
import {
  flushQueuedFeedbackReports,
  getQueuedTransactionWrites,
  queueTransactionWrite,
  removeQueuedTransactionWrite,
  updateQueuedTransactionWrite,
  type OfflineTransactionInsert,
  type QueuedTransactionWrite,
} from "@/lib/offline-queue";
import { createSupabaseBrowser } from "@/lib/supabase/client";

type ConnectionState = "connecting" | "online" | "offline";

type OfflineQueueContextValue = {
  connectionState: ConnectionState;
  queueTransaction: (payload: OfflineTransactionInsert) => Promise<void>;
  queuedWrites: QueuedTransactionWrite[];
  discardWrite: (id: string) => Promise<void>;
  retryWrite: (id: string) => Promise<void>;
};

const OfflineQueueContext = createContext<OfflineQueueContextValue | null>(null);
const MAX_ATTEMPTS = 5;

function isDuplicateError(error: { code?: string } | null) {
  return error?.code === "23505";
}

export function RealtimeStatus({ children }: { children: ReactNode }) {
  const { householdId, memberId } = useHousehold();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const t = useTranslations("connectivity");
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [queuedWrites, setQueuedWrites] = useState<QueuedTransactionWrite[]>([]);
  const [partnerUpdated, setPartnerUpdated] = useState(false);
  const realtimeSubscribed = useRef(false);

  const refreshQueue = useCallback(async () => {
    if (typeof window === "undefined" || !householdId || !user) return;
    setQueuedWrites(await getQueuedTransactionWrites({ householdId, ownerUserId: user.id }));
  }, [householdId, user]);

  const flushQueue = useCallback(async () => {
    const supabase = createSupabaseBrowser();
    if (!supabase || !householdId || !user || !navigator.onLine) return;
    const writes = await getQueuedTransactionWrites({ householdId, ownerUserId: user.id });
    for (const write of writes) {
      if (write.attempts >= MAX_ATTEMPTS) continue;
      const { error } = await supabase.from("transactions").insert(write.payload);
      if (!error || isDuplicateError(error)) {
        await removeQueuedTransactionWrite(write.id);
        continue;
      }
      await updateQueuedTransactionWrite({
        ...write,
        attempts: write.attempts + 1,
        lastError: error.message,
      });
    }
    await flushQueuedFeedbackReports({ householdId, ownerUserId: user.id });
    await refreshQueue();
    void queryClient.invalidateQueries({ queryKey: ["transactions", householdId] });
    void queryClient.invalidateQueries({ queryKey: ["accounts", householdId] });
  }, [householdId, queryClient, refreshQueue, user]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    if (!householdId) return;
    const supabase = createSupabaseBrowser();
    if (!supabase) return;
    let disposed = false;
    const invalidateTransactions = () => {
      void queryClient.invalidateQueries({ queryKey: ["transactions", householdId] });
      void queryClient.invalidateQueries({ queryKey: ["accounts", householdId] });
      void queryClient.invalidateQueries({ queryKey: ["reports", householdId] });
    };
    const channel = supabase
      .channel(`household:${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transactions",
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          invalidateTransactions();
          const enteredBy = (payload.new as { entered_by?: string }).entered_by;
          if (enteredBy && enteredBy !== memberId) setPartnerUpdated(true);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "accounts",
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["accounts", householdId] });
          void queryClient.invalidateQueries({ queryKey: ["transactions", householdId] });
        },
      )
      .subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          realtimeSubscribed.current = true;
          setConnectionState(navigator.onLine ? "online" : "offline");
          void flushQueue();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeSubscribed.current = false;
          setConnectionState("offline");
        }
      });

    const handleOnline = () => void heartbeat();
    const handleOffline = () => setConnectionState("offline");
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && navigator.onLine) handleOnline();
    };
    const heartbeat = async () => {
      if (!navigator.onLine) return handleOffline();
      const { error } = await supabase
        .from("households")
        .select("id", { head: true })
        .eq("id", householdId);
      if (disposed || error) return handleOffline();
      if (realtimeSubscribed.current) setConnectionState("online");
      void flushQueue();
      invalidateTransactions();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    void heartbeat();
    const heartbeatInterval = window.setInterval(() => void heartbeat(), 30_000);

    return () => {
      disposed = true;
      realtimeSubscribed.current = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(heartbeatInterval);
      void supabase.removeChannel(channel);
    };
  }, [flushQueue, householdId, memberId, queryClient]);

  useEffect(() => {
    if (!partnerUpdated) return;
    const timeout = window.setTimeout(() => setPartnerUpdated(false), 4_000);
    return () => window.clearTimeout(timeout);
  }, [partnerUpdated]);

  const queueTransaction = useCallback(
    async (payload: OfflineTransactionInsert) => {
      if (!householdId || !user) throw new Error("no active household or user");
      await queueTransactionWrite(payload, { householdId, ownerUserId: user.id });
      await refreshQueue();
    },
    [householdId, refreshQueue, user],
  );
  const discardWrite = useCallback(
    async (id: string) => {
      await removeQueuedTransactionWrite(id);
      await refreshQueue();
    },
    [refreshQueue],
  );
  const retryWrite = useCallback(
    async (id: string) => {
      const write = queuedWrites.find((item) => item.id === id);
      if (!write) return;
      await updateQueuedTransactionWrite({ ...write, attempts: 0, lastError: null });
      await refreshQueue();
      await flushQueue();
    },
    [flushQueue, queuedWrites, refreshQueue],
  );
  const value = useMemo(
    () => ({ connectionState, queueTransaction, queuedWrites, discardWrite, retryWrite }),
    [connectionState, discardWrite, queueTransaction, queuedWrites, retryWrite],
  );
  const failedWrites = queuedWrites.filter((write) => write.attempts >= MAX_ATTEMPTS);

  return (
    <OfflineQueueContext.Provider value={value}>
      {connectionState === "offline" ? (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950"
        >
          {t("offline")}
        </div>
      ) : null}
      {queuedWrites.length > 0 ? (
        <div className="fixed bottom-20 right-4 z-50 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
          {t("pending", { count: queuedWrites.length })}
        </div>
      ) : null}
      {partnerUpdated ? (
        <div
          role="status"
          className="fixed bottom-20 left-4 z-50 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg"
        >
          {t("partnerUpdated")}
        </div>
      ) : null}
      {failedWrites.map((write) => (
        <div
          key={write.id}
          role="alert"
          className="fixed inset-x-4 bottom-32 z-50 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground shadow-lg"
        >
          <span>{t("failed")}</span>
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => void retryWrite(write.id)}
          >
            {t("retry")}
          </button>
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => void discardWrite(write.id)}
          >
            {t("discard")}
          </button>
        </div>
      ))}
      {children}
    </OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue(): OfflineQueueContextValue {
  const context = useContext(OfflineQueueContext);
  if (!context) {
    return {
      connectionState: typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline",
      queueTransaction: async () => {
        throw new Error("useOfflineQueue must be used within RealtimeStatus");
      },
      queuedWrites: [],
      discardWrite: async () => {},
      retryWrite: async () => {},
    };
  }
  return context;
}
