import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react unmounts rendered trees between tests so state and
// timers don't leak across cases.
afterEach(() => cleanup());
