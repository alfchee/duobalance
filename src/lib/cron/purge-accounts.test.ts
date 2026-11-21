import { describe, expect, it, vi } from "vitest";
import { runPurgeAccounts, PurgeAccountsCapError } from "./purge-accounts";

function makeClient(opts: {
  due?: Array<{ id: string }>;
  selectError?: Error | null;
  rpc?: (id: string) => { data: unknown; error: { message: string } | null };
  sweepError?: Error | null;
}) {
  const calls = { rpcIds: [] as string[], sweeps: 0 };
  const rpc = vi.fn((fn: string, args: { p_request: string }) => {
    if (fn !== "purge_account_deletion") throw new Error(`unexpected rpc ${fn}`);
    calls.rpcIds.push(args.p_request);
    const out = opts.rpc?.(args.p_request) ?? {
      data: { user_id: `user-for-${args.p_request}`, households: ["hh-a"] },
      error: null,
    };
    return Promise.resolve(out);
  });
  function query(table: string) {
    if (table === "account_deletion_requests") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            lt: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({
                data: opts.selectError ? null : (opts.due ?? []),
                error: opts.selectError ?? null,
              }),
            })),
          })),
        })),
      };
    }
    if (table === "data_export_links") {
      return {
        delete: vi.fn(() => ({
          lt: vi.fn().mockResolvedValue({ error: opts.sweepError ?? null, count: 3 }),
        })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  }
  // Count sweeps via the delete chain.
  const wrappedFrom = vi.fn((table: string) => {
    const q = query(table);
    if (table === "data_export_links") calls.sweeps += 1;
    return q;
  });
  return { from: wrappedFrom, rpc, calls } as unknown as {
    from: ReturnType<typeof vi.fn>;
    rpc: ReturnType<typeof vi.fn>;
    calls: typeof calls;
  };
}

describe("runPurgeAccounts", () => {
  it("returns zero when nothing is past grace (still sweeps expired links)", async () => {
    const client = makeClient({ due: [] });

    await expect(runPurgeAccounts(client as never)).resolves.toEqual({
      purgedCount: 0,
      users: [],
      expiredLinksDeleted: 3,
    });
    expect(client.calls.rpcIds).toHaveLength(0);
    expect(client.calls.sweeps).toBe(1);
  });

  it("purges each due request through the atomic RPC", async () => {
    const client = makeClient({ due: [{ id: "req-1" }, { id: "req-2" }] });

    const result = await runPurgeAccounts(client as never);

    expect(result).toEqual({
      purgedCount: 2,
      users: [
        { user_id: "user-for-req-1", households: ["hh-a"] },
        { user_id: "user-for-req-2", households: ["hh-a"] },
      ],
      expiredLinksDeleted: 3,
    });
    expect(client.calls.rpcIds).toEqual(["req-1", "req-2"]);
  });

  it("surfaces an RPC failure without marking purged", async () => {
    const client = makeClient({
      due: [{ id: "req-1" }],
      rpc: () => ({ data: null, error: { message: "grace period has not elapsed" } }),
    });

    await expect(runPurgeAccounts(client as never)).rejects.toThrow(/purge failed/);
  });

  it("still returns the purge result when the link sweep fails", async () => {
    const client = makeClient({
      due: [{ id: "req-1" }],
      sweepError: new Error("db hiccup"),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runPurgeAccounts(client as never);

    expect(result.purgedCount).toBe(1);
    expect(result.expiredLinksDeleted).toBe(0);
    expect(spy).toHaveBeenCalledWith(
      "purge-accounts: expired-link sweep failed",
      expect.anything(),
    );
    spy.mockRestore();
  });

  it("refuses to run past the sanity cap", async () => {
    const due = Array.from({ length: 51 }, (_, i) => ({ id: `req-${i}` }));
    const client = makeClient({ due });

    await expect(runPurgeAccounts(client as never)).rejects.toBeInstanceOf(PurgeAccountsCapError);
  });

  it("surfaces lookup failures", async () => {
    const client = makeClient({ selectError: new Error("db down") });

    await expect(runPurgeAccounts(client as never)).rejects.toThrow(/lookup failed/);
  });
});
