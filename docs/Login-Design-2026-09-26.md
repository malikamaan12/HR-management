# Login design — 26 September 2026

Redesigned `/login` around the supplied E3 logo and dark 3D login reference. Changes are limited to the login component, its scoped CSS, translated login copy and two static assets. Existing branding settings, application naming, login requests, sessions, MFA verification, password recovery route and administrator-only account creation remain in place.

## Presentation

- Centered card with an E3 sculpture background, violet/cyan accents and a quiet entrance animation.
- Dedicated light and dark surfaces; existing light/dark/system preference control is retained.
- Mobile layout, 54px input/button heights, accessible labels and focus states, password reveal, Caps Lock hint and loading/error states.
- Authenticator/recovery entry expands on demand. It still supplements the username and password; it is not an alternative authentication method.
- English/Arabic copy and logical spacing support the existing RTL language setting.
- Uploaded branding logos take precedence. The supplied transparent E3 logo is the login fallback; CSS frames its existing artwork bounds and presents white lettering in dark mode without altering the source image.
- Background and logo total approximately 69 KB. No external image host, new package, canvas render loop or continuous background animation is required. Reduced-motion preferences disable the animation.

## Assets and generation

Supplied logo, copied unchanged:
`client/public/images/login/e3-brand.png`

Generated background, encoded as WebP without resizing:
`client/public/images/login/e3-sculpture.webp` (1659 × 948, 47,042 bytes)

The built-in image-generation tool was used, with the supplied `ChatGPT Image Sep 26, 2026, 09_06_13 AM.png` as the edit target. Generation prompt:

> Use case: precise-object-edit. Asset type: production website login background, wide 16:9 landscape. Edit this reference into a clean background artwork ONLY. Remove the entire central login card and ALL text, logos inside the card, input fields, buttons, controls, language selector, side slogans, copyright and interface. Preserve the monumental sculptural 3D E3 monogram behind it, with a continuous natural reconstruction of the parts hidden by the card. Keep exact visual spirit: dark midnight navy studio, glossy deep indigo material, thin luminous magenta-violet edges on the E and electric cyan edges on the 3, subtle reflective floor with diagonal light traces. The large E3 sculpture should span the middle horizontal band of the image with generous dark breathing room above. The center will be covered by a real HTML login card, so don't add detail there. Minimal premium enterprise brand art, no people, no other objects, no other text, no UI, no watermark. Request optimized landscape 1792x1024 if available.

## Verification and release state

TypeScript (`tsc --noEmit --incremental false`) and the Vite client production build passed. The local isolated demo preview was visually viewed at desktop 1440×900 and mobile 390×844 in dark/light modes, including Arabic and the expanded verification-code field. No sign-in request, password reset, live data change, automated test suite or audit was performed. Existing large-chunk build warnings remain.

Local preview: `http://127.0.0.1:5191/login`. Publication and deployment were authorized on 26 September 2026. This login-only release adds no database migration. The final running release is recorded in the deployment receipt outside the repository.
