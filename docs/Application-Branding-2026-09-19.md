# Application branding

Administrators and super administrators can use **Settings → Branding** to change the application name, short fallback name, navigation tagline, light-mode logo, dark-mode logo, favicon, browser theme color, sign-in page title and page description. Company identity used by HR business records remains separate.

The form previews both logo backgrounds and metadata before saving. Uploads, removals and text changes save together. Missing theme logos fall back to the other theme, then the short name. Images must be PNG, at most 512 KB and 2048 × 2048 pixels; favicons must be square and 16–512 pixels. Replacing images changes their URLs to refresh browser caches. Clearing a favicon restores the built-in icon.

Branding appears on sign-in, password recovery, the navigation sidebar and module browser titles. Metadata and favicon links are present in server-rendered HTML as well as client navigation. Description, Open Graph title/description/site name and theme color are configurable. The private HR application retains `noindex, nofollow`; this feature does not make employee pages searchable or change access permissions.

The existing `app_settings` table stores branding and its small public image assets durably, without a migration or an external storage dependency. Public GET endpoints expose only this branding record and its images. Writes require a current administrator session and reject cross-origin requests. PNG checks cover signature, dimensions, chunk checksums, bounded decompression and scanline lengths; ancillary metadata is stripped. Version checks and a transaction lock prevent lost updates, and audit failure rolls back the complete save. No uploaded SVG or HTML is served.

Session changes clear all private query/mutation data while preserving the public branding observer, so saved favicons and metadata update immediately after sign-in. Settings are split into Company, Branding, Calculation rules, System readiness and Password tabs. Existing per-page hardcoded title overrides were removed in favor of the central module title.

Validation:

- Full regression run: 39 files, 484 passing tests and one existing skipped test.
- Follow-up after the browser-discovered session-cache correction: 28 tests passed, including the additional cache privacy test (485 distinct passing tests across both runs).
- TypeScript check, client production build and server bundle passed. The existing large-client-chunk advisory remains.
- Disposable local browser verification: three image uploads in one save; theme switching; image decoding; metadata and favicon replacement/removal without reload after sign-in; persistence after reload; branded dark sign-in; 390-pixel mobile layout without horizontal overflow.
- Raw local HTTP HTML contains the configured title, description, favicon and no-index metadata before JavaScript runs.

No production branding or employee data was modified. Upload the actual company assets after this release is deployed.
