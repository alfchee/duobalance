const REFERRAL_STORAGE_KEY = "duobalance:referral";
const REFERRAL_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function saveReferral(storage: Storage, referral: string): void {
  try {
    storage.setItem(REFERRAL_STORAGE_KEY, referral);
  } catch {
    // Ignore storage write failures in restricted browser contexts
  }
}

export function readReferral(storage: Storage): string | null {
  try {
    const referral = storage.getItem(REFERRAL_STORAGE_KEY);
    return referral && REFERRAL_RE.test(referral) ? referral : null;
  } catch {
    return null;
  }
}

export function clearReferral(storage: Storage): void {
  try {
    storage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Ignore storage removal failures in restricted browser contexts
  }
}

export function captureReferral(search: string, storage: Storage): void {
  try {
    const referral = new URLSearchParams(search).get("ref");
    if (referral && REFERRAL_RE.test(referral)) saveReferral(storage, referral);
  } catch {
    // Ignore search parsing failures or storage errors
  }
}
