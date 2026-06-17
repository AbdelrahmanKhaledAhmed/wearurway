# WEARURWAY

A custom apparel design-and-order platform — customers pick a product, customize it with layered designs, and submit orders. Admins manage products, mockups, pricing, and view orders.

## Run & Operate

| Command | Description |
|---|---|
| `pnpm --filter @workspace/wearurway run dev` | Frontend dev server (port 5000) |
| `PORT=8080 pnpm --filter @workspace/api-server run dev` | API server (port 8080) |
| `pnpm --filter @workspace/api-server run build` | Build API server (esbuild → dist/) |

Required env vars:
- `DATABASE_URL` — Replit-managed PostgreSQL (set automatically)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` — Replit AI integrations (optional; enables AI background removal)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` — Cloudflare R2 storage (optional; falls back to local disk)
- `ADMIN_PASSWORD` — defaults to `admin123` if not set
- `UPLOADS_DIR`, `SIZE_CHARTS_DIR`, `FRONTEND_DIR` — optional path overrides

## Stack

- **Frontend:** React + Vite + Tailwind CSS + Radix UI, port 5000
- **Backend:** Express 5 (ESM) + pino logging, port 8080 in dev
- **Database:** PostgreSQL via raw `pg` pool (not Drizzle ORM for app data); schema auto-created via `ensureSchema()`
- **Storage:** AWS S3-compatible (Cloudflare R2) or local disk fallback
- **Build:** esbuild bundles API server to `artifacts/api-server/dist/`
- **Monorepo:** pnpm workspaces (`artifacts/*`, `lib/*`)
- **Node:** ≥20

## Where things live

```
artifacts/api-server/    Express API server
artifacts/wearurway/     Main customer/admin frontend
artifacts/mockup-sandbox/ Mockup preview tool
lib/api-spec/            OpenAPI spec (openapi.yaml)
lib/api-zod/             Zod types generated from spec
lib/api-client-react/    React API client (generated)
lib/db/                  Drizzle config + placeholder schema
lib/integrations-openai-ai-server/  OpenAI client wrapper
```

Key files: `artifacts/api-server/src/config.ts` (env), `artifacts/api-server/src/data/store.ts` (in-memory+DB store), `artifacts/api-server/src/services/databaseService.ts` (pg pool + schema), `artifacts/api-server/src/lib/paths.ts` (file paths).

## Architecture decisions

- **Single JSONB row store:** All app state (products, orders, mockups, etc.) lives in one `store_data` table row. Writes are debounced/coalesced to avoid write amplification.
- **In-memory cache:** The JSONB store is loaded into memory on startup; all reads are in-process, writes go async to DB.
- **SSL handling:** DB pool skips SSL for local/Replit connections (detects `helium`/`localhost` hostnames), uses `rejectUnauthorized: false` for external DBs.
- **Frontend static serving:** In production, the API server serves the built wearurway frontend from `FRONTEND_DIR`. In dev, Vite proxies `/api` to port 8080.
- **OpenAI integration:** Uses Replit AI integrations (`AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY`); AI features gracefully degrade (503) when not configured.

## Product

- Product customization: pick product → fit → color → size
- Design editor: add/position/resize graphic layers on front/back of garment
- AI-assisted background removal on uploaded images
- Order submission with InstaPay / cash-on-delivery
- Admin panel: manage products, mockups, pricing, view/export orders
- Shared design links (expire after 24h)
- Order notifications via Telegram bot (optional)

## User preferences

_Populate as you build_

## Gotchas

- The API server must be built before starting (`run dev` does build + start automatically)
- `pnpm install` must be run before first use (packages not pre-installed)
- R2 storage is optional; if not configured, files are stored locally in `uploads/`
- Admin password defaults to `admin123` — set `ADMIN_PASSWORD` env var before going to production

## Pointers

- Workflows skill: `.local/skills/workflows/SKILL.md`
- Database skill: `.local/skills/database/SKILL.md`
- Environment secrets: `.local/skills/environment-secrets/SKILL.md`
