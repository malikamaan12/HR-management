# Devices and attendance connections

Implemented locally on 23 September 2026. Not deployed.

## One settings page

HR Rules & Settings → Time & pay → Devices & attendance connections (`/settings/devices`). Tabs contain the setup preset library, device directory, geofencing controls and connection guide. `/settings/locations` redirects to this page’s geofencing tab. Existing HR/team-lead attendance location workflows retain their access rules.

## Ten reusable presets

Manufacturer setup families:
- ZKTeco Attendance PUSH SDK — https://www.zkteco.com/en/PUSHSDK
- Hikvision ISAPI — https://tpp.hikvision.com/download/
- Suprema BioStar 2 local API — https://support.supremainc.com/en/support/solutions/articles/24000047041
- Anviz CrossChex Cloud API — https://community.anviz.com/t/how-to-use-api-to-get-the-records-from-the-crosschex-cloud/726

Generic profiles: fingerprint terminal, face scanner, RFID/card reader, QR/barcode scanner, tablet/kiosk, and attendance-file export. A custom device can also be registered.

Presets populate the manufacturer, device category, planned connection method and integration interface where documented. Actual models, serials, endpoints, ports, sites, credentials and employees are not invented. Manufacturer documentation was consulted on 23 September 2026. Presets do not assert compatibility with every model and are not installed sync adapters.

## Saved configuration

Administrators can create and edit device profiles, assign existing work sites, record network/API references and timezone, map machine user IDs to active employees, pause setup, archive/restore profiles, and inspect revision history. Up to 200 profiles and 500 employee mappings per device. Duplicate non-archived serial/asset IDs and duplicate device/employee mappings are rejected. Employee identity mapping is independent per device.

The existing GPS geofencing editor is embedded with real location boundaries, radius, dates, individual/site assignments, GPS accuracy/freshness thresholds and supervisor approval rules. Its existing APIs and readiness checks remain authoritative.

## Access, persistence and scope

All device configuration endpoints under `/api/settings/devices` require administrator or super administrator access. Changes require a reason and optimistic version; registry changes are serialized for uniqueness. Metadata uses the existing app_settings table, with the latest 30 full revisions per profile and an activity log for every change. Listing excludes revision snapshots from its database projection. No new database migration or dependency is required.

Only credential references are entered. Passwords, API tokens, fingerprint templates and face images have no dedicated storage fields. Network addresses are saved as configuration references; the server makes no outgoing device requests. No new machine authentication endpoint or unauthenticated callback is exposed.

Hardware is undecided. No live vendor connector, hardware heartbeat, device-file importer or attendance ingestion has been implemented or represented as operational. Readiness means setup fields are complete, never that a device is online. No attendance or payroll is created by saving a profile. Existing geofencing enforcement is unchanged until an administrator explicitly saves its rules.

## Validation

Production frontend/backend builds and TypeScript compilation passed. A clearly labelled local demo device profile and staff mapping were saved and loaded; revision history, the old geofencing redirect, and mobile editor layout were inspected. Automated tests and audit suites are not run, following the user’s preference. Preview uses synthetic local data only; no live device or attendance configuration is changed.
