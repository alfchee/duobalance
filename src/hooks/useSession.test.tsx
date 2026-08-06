import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";

vi.mock("@/components/session-provider", () => ({ useSessionContext: vi.fn() }));

import { useSessionContext } from "@/components/session-provider";
import { useSession } from "./useSession";

const sessionMock = vi.mocked(useSessionContext);

function sessionWithUser(id: string): Session {
  return { user: { id } } as Session;
}

describe("useSession", () => {
  it("exposes the session and its user", () => {
    sessionMock.mockReturnValue({
      session: sessionWithUser("u1"),
      loading: false,
      configured: true,
    });
    const { result } = renderHook(() => useSession());

    expect(result.current.session?.user.id).toBe("u1");
    expect(result.current.user?.id).toBe("u1");
    expect(result.current.loading).toBe(false);
    expect(result.current.configured).toBe(true);
  });

  it("yields a null user when there is no session", () => {
    sessionMock.mockReturnValue({ session: null, loading: false, configured: true });
    const { result } = renderHook(() => useSession());

    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it("passes through the loading flag", () => {
    sessionMock.mockReturnValue({ session: null, loading: true, configured: true });
    const { result } = renderHook(() => useSession());

    expect(result.current.loading).toBe(true);
  });
});
