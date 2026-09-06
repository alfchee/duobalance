import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// PoC config for #154: minimal Worker + assets binding.
// Incremental cache / R2 and bindings will be configured in follow-up issues.
// Local dev: use `npm run preview` (wrangler dev + workerd) to exercise the
// Worker. `next dev` does not provide Cloudflare bindings without
// `initOpenNextCloudflareForDev` — intentionally deferred for this PoC.
export default defineCloudflareConfig({});
