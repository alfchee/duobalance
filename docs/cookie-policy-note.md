# Cookie Policy & Banner Decisions in DuoBalance

## Why DuoBalance Does Not Have a Cookie Consent Banner

DuoBalance does **not** display a cookie consent banner. This is an intentional architectural and legal decision based on privacy-by-design principles:

1. **Strictly Necessary Cookies Only:** DuoBalance uses cookies and local storage exclusively for essential authentication sessions (via Supabase Auth) and user-selected UI preferences (such as active household ID).
2. **No Third-Party Analytics or Advertising:** DuoBalance contains no Google Analytics, Meta Pixel, ad networks, or behavioral tracking scripts.
3. **Legal Compliance:** Under international privacy regimes—including GDPR (EU), LGPD (Brazil), LFPDPPP (Mexico), Ley 787 (Nicaragua), and the ePrivacy Directive—**strictly necessary cookies required for providing a requested service do not require user consent or a banner**.
4. **User Experience:** Omitting a consent banner removes unnecessary interface friction for users while adhering strictly to privacy standards.

> **Developer Note for Future Reference:**
> If third-party analytics or advertising scripts are ever considered in the future, remember that adding them will flip this calculus, requiring a full cookie consent banner, banner maintenance, and legal updates. Keeping the product free of third-party trackers remains a core privacy differentiator.
