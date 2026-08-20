export type DiagnosticContext = {
  appVersion: string;
  householdId: string; // identifier only
  memberId: string;
  role: "owner" | "partner";
  locale: string;
  numberFormat: string; // #104
  baseCurrency: string;
  timezone: string;
  accountCount: number; // counts, never contents
  transactionCount: number;
  isStandalone: boolean; // installed PWA or browser tab
  isOnline: boolean;
  queuedWrites: number; // #28 offline queue depth
  userAgent: string;
  lastError?: { message: string; stack?: string; at: string } | null;
  currentRoute: string;
};

export type CollectDiagnosticsParams = {
  householdId?: string | null;
  memberId?: string | null;
  role?: "owner" | "partner" | null;
  locale?: string | null;
  numberFormat?: string | null;
  baseCurrency?: string | null;
  timezone?: string | null;
  accountCount?: number;
  transactionCount?: number;
  queuedWrites?: number;
  lastError?: { message: string; stack?: string; at: string } | null;
  currentRoute?: string;
};

export function collectDiagnosticContext(params: CollectDiagnosticsParams = {}): DiagnosticContext {
  const isBrowser = typeof window !== "undefined";
  const nav = isBrowser ? navigator : undefined;

  const isStandalone = isBrowser
    ? (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      (nav as unknown as { standalone?: boolean })?.standalone === true
    : false;

  const isOnline = isBrowser && nav ? nav.onLine : true;

  const timezone =
    params.timezone ||
    (isBrowser && typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC");

  const context: DiagnosticContext = {
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || "1.1.0",
    householdId: params.householdId || "none",
    memberId: params.memberId || "none",
    role: params.role || "owner",
    locale: params.locale || "en",
    numberFormat: params.numberFormat || "1,234.56",
    baseCurrency: params.baseCurrency || "USD",
    timezone,
    accountCount: Math.max(0, params.accountCount ?? 0),
    transactionCount: Math.max(0, params.transactionCount ?? 0),
    isStandalone,
    isOnline,
    queuedWrites: Math.max(0, params.queuedWrites ?? 0),
    userAgent: isBrowser && nav ? nav.userAgent : "SSR",
    currentRoute: params.currentRoute || (isBrowser ? window.location.pathname : "/"),
  };

  if (params.lastError) {
    context.lastError = params.lastError;
  }

  assertNoFinancialData(context as unknown as Record<string, unknown>);

  return context;
}

const FORBIDDEN_FINANCIAL_KEYS = [
  "amount",
  "balance",
  "opening_balance",
  "manual_balance",
  "credit_limit",
  "description",
  "payee",
  "notes",
  "account_name",
  "accountname",
  "transaction_name",
  "transactionname",
];

export function assertNoFinancialData(data: Record<string, unknown>): boolean {
  function checkValue(val: unknown) {
    if (!val || typeof val !== "object") return;

    if (Array.isArray(val)) {
      for (const item of val) {
        checkValue(item);
      }
      return;
    }

    for (const [key, subVal] of Object.entries(val as Record<string, unknown>)) {
      if (FORBIDDEN_FINANCIAL_KEYS.includes(key.toLowerCase())) {
        throw new Error(`Diagnostic context payload must not contain financial key: "${key}"`);
      }
      checkValue(subVal);
    }
  }

  checkValue(data);
  return true;
}
