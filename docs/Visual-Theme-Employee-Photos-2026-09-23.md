# Visual theme and employee photos

## Interface

The supplied references informed the violet gradients, near-black dark theme, layered cards, dimensional icon surfaces, chart shading and mobile navigation. Existing application and module names are preserved. Shared styles cover the dashboard, directory, learning, helpdesk, communications, settings and other modules without duplicating individual page logic.

The header and sign-in screen offer Light, Dark and Use device setting. Selection is saved locally, synchronized between browser tabs and applied before rendering. System mode follows device changes. Motion respects reduced-motion preferences; no 3D renderer, animation library or new dependency is added. Expensive page-wide backdrop effects are avoided on phones. The unused Replit development banner is removed from the production document.

## Employee photos

- Employee Database cards and tables display employee portraits with initials as a fallback. Open a profile to preview or manage its photo. Newly created employees open directly in their profile.
- HR/admin users with existing employee edit permission may upload, replace or remove a photo. Other authorized directory readers may preview photos within their employee access scope.
- The picker accepts JPG, PNG and WebP up to 10 MB. It creates a square, 320-pixel PNG preview locally before the user saves. Source metadata is discarded during canvas encoding.
- The server validates the PNG bytes, dimensions, CRCs and bounded decompression, strips ancillary metadata, and limits saved images to 384 KB and 512 pixels per side. The existing employee photo field stores the normalized image; no migration or new storage credentials are required.
- Photos are delivered through an authenticated, scoped, no-store endpoint. Directory responses contain only the photo URL. Changes enforce optimistic record versions and produce activity entries without logging photo bytes.
- Portraits do not enroll employees in biometric recognition, change their login avatar or change any account permissions.

## Release

The user's deployment request also includes the pending unified settings, payslip/WPS exports, device configuration, communication and learning UI improvements already prepared in this task. All use existing tables and dependencies. Local import scripts, synthetic preview scripts and unrelated QA notes are excluded from publication.

TypeScript and frontend/backend production builds passed. No automated test or audit suite was run, as previously requested. Visual preview uses synthetic local records. Deployment outcome is appended after Render finishes.
