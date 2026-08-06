import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react unmounts rendered trees between tests so state and
// timers don't leak across cases. Clearing mocks keeps call-count assertions
// (e.g. "not called when disabled") scoped to each test.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
