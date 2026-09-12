# E3 HR Management

HR and event workforce management built with React, TypeScript, Express and PostgreSQL. Includes employee records, attendance, leave, payroll drafts, event staffing, private R2 documents and Resend password reset support.

**Status:** core repairs verified locally; staging integrations and advanced workflow acceptance checks remain. Do not use this snapshot as evidence of production or regulatory readiness.

- [Setup and deployment preparation](SETUP.md)
- [Implemented features and remaining checks](IMPLEMENTATION-STATUS.md)
- [Next-generation HR roadmap](docs/NEXT-GENERATION-HR-PLAN.md)

## Development

Use Node.js 24 and pnpm 11.19.0. Install with `pnpm install --frozen-lockfile`, configure `.env` using `.env.example`, and follow SETUP.md for a new PostgreSQL database and explicit administrator setup.

```sh
pnpm dev
pnpm check
pnpm test
pnpm build
```

`pnpm start` serves the production frontend and API from one Node process. Cloud configuration is supplied through environment variables. The Render template is for staging preparation and does not provision a database automatically.

The initial GitHub release is a clean source snapshot. Historical local development screenshots and the previous local Git history are intentionally excluded from publication; local history remains preserved separately.
