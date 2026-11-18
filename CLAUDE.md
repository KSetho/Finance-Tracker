<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
specs/002-finance-tracking-core/plan.md
(Earlier increment: specs/001-owner-auth-foundation/plan.md)
Standing requirement: mobile phones are the primary device; build and verify UI mobile-first.

App runtime (post-rewrite): Next.js App Router in `frontend/` (UI + `/api/v1` Route Handlers),
Drizzle + Neon Postgres. Deploy Vercel with Root Directory = `frontend`.
Local: `cd frontend && npm run dev` (needs `frontend/.env.local`; see `.env.local.example`).
<!-- SPECKIT END -->
