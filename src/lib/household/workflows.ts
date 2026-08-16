import { getAuthErrorKey } from "@/lib/supabase/auth-errors";

export const ACTIVE_HOUSEHOLD_STORAGE_KEY = "duobalance:activeHouseholdId";

const INVITE_RPC_ERROR_KEYS: Record<string, string> = {
  "invite expired": "expired",
  "invite already accepted": "alreadyAccepted",
  "invite email does not match authenticated user": "emailMismatch",
  "invite not found": "invalidToken",
};

const HOUSEHOLD_RPC_ERROR_KEYS: Record<string, string> = {
  "owners cannot leave a household with remaining members; transfer ownership first":
    "ownerTransferRequired",
  "only active owners can delete a household": "notOwner",
  "only active owners can transfer ownership": "notOwner",
  "only active owners can remove members": "notOwner",
  "not an active member of this household": "notMember",
  "target member not found or not active in this household": "targetNotFound",
  "owners cannot remove themselves; use transfer_ownership or leave_household":
    "selfRemovalForbidden",
  "unresolved owned accounts": "unresolvedAccounts",
  "household must retain at least one active owner": "ownerTransferRequired",
};

export type HouseholdErrorResult = { ok: false; errorKey: string };
export type HouseholdSuccessResult<T> = { ok: true; value: T };
export type HouseholdResult<T> = HouseholdErrorResult | HouseholdSuccessResult<T>;

export type CreateHouseholdPort = (input: {
  p_name: string;
  p_country: string;
  p_base_currency: string;
  p_display_name: string;
}) => Promise<{ error: unknown }>;

export type AcceptInvitePort = (input: {
  p_token: string;
}) => PromiseLike<{ data: string | null; error: unknown }>;

export type DeleteHouseholdPort = (input: { p_household: string }) => Promise<{ error: unknown }>;

export type LeaveHouseholdPort = (input: { p_household: string }) => Promise<{ error: unknown }>;

export type TransferOwnershipPort = (input: {
  p_household: string;
  p_new_owner: string;
  p_demote_self?: boolean;
}) => Promise<{ error: unknown }>;

export type RemoveMemberPort = (input: {
  household_id: string;
  member_id: string;
  account_disposition: Record<string, "transfer" | "joint">;
}) => Promise<{ error?: unknown }>;

export function readActiveHouseholdId(storage: Storage): string | null {
  return storage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY);
}

export function saveActiveHouseholdId(storage: Storage, householdId: string): void {
  storage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, householdId);
}

export function clearActiveHouseholdId(storage: Storage): void {
  storage.removeItem(ACTIVE_HOUSEHOLD_STORAGE_KEY);
}

export function getInviteErrorKey(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return INVITE_RPC_ERROR_KEYS[error.message] ?? getAuthErrorKey(error);
  }
  return "generic";
}

export function getHouseholdActionErrorKey(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return HOUSEHOLD_RPC_ERROR_KEYS[error.message] ?? getAuthErrorKey(error);
  }
  return "generic";
}

export async function createHousehold(
  port: CreateHouseholdPort | null,
  input: { name: string; country: string; baseCurrency: string; displayName: string },
): Promise<HouseholdResult<undefined>> {
  if (!port) return { ok: false, errorKey: "generic" };
  const { error } = await port({
    p_name: input.name.trim(),
    p_country: input.country,
    p_base_currency: input.baseCurrency,
    p_display_name: input.displayName.trim(),
  });
  return error ? { ok: false, errorKey: "generic" } : { ok: true, value: undefined };
}

export async function acceptInvite(
  port: AcceptInvitePort | null,
  token: string,
): Promise<HouseholdResult<{ householdId: string | null }>> {
  if (!port) return { ok: false, errorKey: "generic" };
  const { data, error } = await port({ p_token: token.trim() });
  if (error) return { ok: false, errorKey: getInviteErrorKey(error) };
  return { ok: true, value: { householdId: data } };
}

export async function deleteHousehold(
  port: DeleteHouseholdPort | null,
  householdId: string,
): Promise<HouseholdResult<undefined>> {
  if (!port) return { ok: false, errorKey: "generic" };
  const { error } = await port({ p_household: householdId });
  if (error) return { ok: false, errorKey: getHouseholdActionErrorKey(error) };
  return { ok: true, value: undefined };
}

export async function leaveHousehold(
  port: LeaveHouseholdPort | null,
  householdId: string,
): Promise<HouseholdResult<undefined>> {
  if (!port) return { ok: false, errorKey: "generic" };
  const { error } = await port({ p_household: householdId });
  if (error) return { ok: false, errorKey: getHouseholdActionErrorKey(error) };
  return { ok: true, value: undefined };
}

export async function transferOwnership(
  port: TransferOwnershipPort | null,
  householdId: string,
  newOwnerMemberId: string,
  demoteSelf = false,
): Promise<HouseholdResult<undefined>> {
  if (!port) return { ok: false, errorKey: "generic" };
  const { error } = await port({
    p_household: householdId,
    p_new_owner: newOwnerMemberId,
    p_demote_self: demoteSelf,
  });
  if (error) return { ok: false, errorKey: getHouseholdActionErrorKey(error) };
  return { ok: true, value: undefined };
}

export async function removeMemberWorkflow(
  port: RemoveMemberPort | null,
  householdId: string,
  memberId: string,
  accountDisposition: Record<string, "transfer" | "joint"> = {},
): Promise<HouseholdResult<undefined>> {
  if (!port) return { ok: false, errorKey: "generic" };
  const { error } = await port({
    household_id: householdId,
    member_id: memberId,
    account_disposition: accountDisposition,
  });
  if (error) return { ok: false, errorKey: getHouseholdActionErrorKey(error) };
  return { ok: true, value: undefined };
}
