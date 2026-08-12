# UI Validation Matrix

Issue #81 uses Playwright's Chromium, Firefox, and WebKit projects for automated browser-engine coverage. WebKit is a Safari-equivalent environment; an actual Safari/iOS check remains required before release.

## Automated Coverage

| Area                         | States                                                                               | Viewports                   | Engines                   | Evidence                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ | --------------------------- | ------------------------- | -------------------------------------------------------- |
| Authentication               | Login, signup, forgot password, reset password                                       | Desktop                     | Chromium, Firefox, WebKit | `e2e/ui-validation.spec.ts`                              |
| Authentication accessibility | Semantic structure, keyboard navigation, visible focus, automated accessibility scan | Desktop                     | Chromium, Firefox, WebKit | `e2e/ui-validation.spec.ts` tagged `@a11y`               |
| Protected screens            | Balances, transactions, budget, bills, settings, categories, rules anonymous guard   | Desktop                     | Chromium, Firefox, WebKit | `e2e/ui-validation.spec.ts`                              |
| Visual reference             | Login                                                                                | 390×844, 768×1024, 1440×900 | Chromium, Firefox, WebKit | `e2e/ui-validation.spec.ts` tagged `@visual` screenshots |

## Release Validation

| Area                          | States                                                                   | Viewports                   | Environment             | Required evidence                                                              |
| ----------------------------- | ------------------------------------------------------------------------ | --------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Dashboard and navigation      | Loaded, loading, error, empty, mobile bottom navigation, desktop sidebar | 390×844, 768×1024, 1440×900 | Chrome, Firefox, Safari | Authenticated household fixture, recorded result, linked deviation or approval |
| History and transaction entry | Loaded, loading, error, empty, transaction sheet open and closed         | 390×844, 768×1024, 1440×900 | Chrome, Firefox, Safari | Keyboard, focus-return, dialog labels, scroll containment, touch target review |
| Budget and bills              | Loaded, loading, error, empty, dialogs and sheets                        | 390×844, 768×1024, 1440×900 | Chrome, Firefox, Safari | Screenshot comparison with `docs/new-ui/` and recorded result                  |
| Settings                      | Loaded, loading, error, empty, forms and confirmations                   | 390×844, 768×1024, 1440×900 | Chrome, Firefox, Safari | Keyboard, semantics, labels, contrast, screen-reader announcement review       |
| PWA                           | Installed and standalone navigation                                      | 390×844                     | Chrome and Safari       | Safe-area, navigation, asset, and focus review                                 |
| Tauri                         | Static export in desktop webview                                         | 1440×900                    | Tauri                   | `BUILD_TARGET=tauri npm run build` and shell smoke result                      |

Run `npm run test:ui-validation` for the automated matrix. Run `npm run test:visual` to produce review screenshots under `test-results/ui-validation/`. Record release findings in the linked issue; close #81 only after every release-validation row is resolved or explicitly accepted.
