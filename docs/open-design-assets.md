# OpenDesign Asset and Route Inventory

## Source Provenance

The supplied prototypes are the seven self-contained HTML files in `docs/new-ui/`. Their shared visual language is labelled “Wise design system” in the source CSS. The files include no images, downloadable font files, JavaScript files, or external icon packages.

| Asset         | Source                                     | Provenance                                   | Build handling                                                                                                |
| ------------- | ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Design tokens | Inline CSS in all prototype files          | Supplied OpenDesign prototype                | Translated into `src/app/globals.css` CSS variables and Tailwind theme values.                                |
| Typography    | Google Fonts request for Inter 400/600/900 | External Google-hosted resource in prototype | Not loaded by the product: the foundation uses an offline-safe system font stack, suitable for PWA and Tauri. |
| Icons         | Inline SVG paths                           | Supplied OpenDesign prototype                | Not copied. Existing `lucide-react` icons provide equivalent tree-shakeable React components.                 |
| Images        | None                                       | Not applicable                               | No image path or optimization configuration required.                                                         |
| JavaScript    | None                                       | Not applicable                               | No script asset or runtime behavior imported.                                                                 |

## Screen Mapping

| Prototype source       | Target route or component                                                            | Responsive variant                                       | Migration status                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `auth.html`            | `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/accept-invite/[token]` | Mobile auth card; desktop container                      | Foundation only; current authentication behavior remains unchanged.                    |
| `home.html`            | `/balances`                                                                          | Mobile bottom navigation; desktop sidebar at `md`        | Foundation and shared desktop navigation integrated. Screen content remains unchanged. |
| `transactions.html`    | `/transactions`                                                                      | Mobile bottom navigation; desktop sidebar at `md`        | Foundation and shared navigation integrated.                                           |
| `new-transaction.html` | Global `TransactionEntrySheet`                                                       | Bottom sheet on mobile; centered modal on larger screens | Foundation only; existing entry flow remains unchanged.                                |
| `budget.html`          | `/budget`                                                                            | Mobile bottom navigation; desktop sidebar at `md`        | Foundation and shared navigation integrated.                                           |
| `bills.html`           | `/bills`                                                                             | Mobile bottom navigation; desktop sidebar at `md`        | Foundation and shared navigation integrated.                                           |
| `settings.html`        | `/settings`, `/settings/categories`, `/settings/rules`                               | Mobile bottom navigation; desktop sidebar at `md`        | Foundation and shared navigation integrated.                                           |

## Reusable Foundation

- `globals.css` provides the shared palette, semantic colors, radii, focus color, and elevation tokens through Tailwind’s CSS-first theme.
- Existing shadcn primitives (`Button`, `Card`, `Input`) consume the tokens and include disabled and focus-visible states.
- `AppSidebar` and `BottomNav` share the same route set. The sidebar renders at `md` and above; the bottom navigation stays mobile-only.
- The foundation has no runtime asset URLs, so it remains valid for web, PWA, and static Tauri export.

## Visual Comparison Fixtures

- Source fixtures remain in `docs/new-ui/` and are the baseline for visual comparison.
- Compare mobile at 390px and desktop at 1440px, which exercises the navigation breakpoint at 768px.
- Before individual screen migrations, validate loading, empty, error, disabled, and keyboard-focus states using the existing routes and their data states.

## Design Ambiguities

- The source `home.html` is a launcher that references filenames not present in `docs/new-ui/`; the actual available filenames are used in this inventory.
- Prototype content is a route index rather than a rendered production screen. It establishes shared styling and navigation direction, not a replacement data model or interaction specification.
