const REFERRAL_STORAGE_KEY = "duobalance:referral";
const REFERRAL_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function saveReferral(storage: Storage, referral: string): void {
  storage.setItem(REFERRAL_STORAGE_KEY, referral);
}

export function readReferral(storage: Storage): string | null {
  const referral = storage.getItem(REFERRAL_STORAGE_KEY);
  return referral && REFERRAL_RE.test(referral) ? referral : null;
}

export function clearReferral(storage: Storage): void {
  storage.removeItem(REFERRAL_STORAGE_KEY);
}

export function captureReferral(search: string, storage: Storage): void {
  const referral = new URLSearchParams(search).get("ref");
  if (referral && REFERRAL_RE.test(referral)) saveReferral(storage, referral);
}
