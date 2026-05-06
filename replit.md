# WearUrWay

Premium streetwear customization platform — multi-step product configurator (Landing → Products → Fits → Colors → Sizes), interactive design editor, and protected admin panel.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 8080)
- `pnpm --filter @workspace/wearurway run dev` — Vite frontend (port 5000)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks & Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

Required env secrets:
- `DATABASE_URL` — Replit-managed PostgreSQL (auto-provisioned)
- `ADMIN_PASSWORD` — admin panel password (default: `admin123`)

Optional env secrets:
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` — Cloudflare R2 for file storage
- `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI for AI image assist (returns 503 if unset)

## Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS v4, Wouter, Framer Motion, Radix UI, TanStack Query
- **Backend**: Node.js 20, Express 5, Pino logging, Sharp (image processing), Multer (file uploads)
- **Database**: PostgreSQL via `pg` — single `store_data` table with a JSONB column (`key='main'`); in-memory cache with debounced async upsert
- **File Storage**: Cloudflare R2 (S3-compatible) via AWS SDK — optional, returns 503 if not configured
- **Build**: esbuild (ESM bundle) for API, Vite for frontend
- **Codegen**: Orval from OpenAPI spec → Zod schemas + React Query hooks

## Where things live

```
artifacts/wearurway/     — React frontend
artifacts/api-server/    — Express API backend
lib/api-spec/            — OpenAPI spec (source of truth for API contract)
lib/api-zod/             — generated Zod schemas
lib/api-client-react/    — generated React Query hooks
lib/integrations-openai-ai-server/  — OpenAI client (lazy-loaded)
artifacts/api-server/src/data/store.ts  — in-memory store + DB persistence
artifacts/api-server/src/services/storageService.ts  — R2 storage service
artifacts/wearurway/src/config/fonts.ts  — custom font config
```

## Architecture decisions

- Single JSONB row in PostgreSQL (`key='main'`) for all app state — simple, no migrations, coalesced debounced writes (250ms) to reduce write amplification
- Cloudflare R2 for persistent file storage (mockups, order exports, shared layers); all optional — app degrades gracefully without it
- Admin auth is custom Bearer token (crypto.randomBytes) stored in process memory + DB; no external auth service
- OpenAI integration loaded lazily per-request so server starts without AI credentials
- Client-side order durability via IndexedDB + service worker — success shown immediately, uploads/Telegram happen in background with exponential backoff

## Product

- Multi-step customization flow: product → fit → color → size → design editor → checkout
- Interactive design editor: layer drag/resize, text tool with custom fonts, image editor with AI-assisted selection
- Export Design generates high-res PNG; Share Design creates side-by-side front/back mockup
- Mobile responsive with soft-suggestion popup for desktop-recommended features
- Admin panel at `/admin`: manage products, fits, colors, sizes, mockups, settings, orders

## User preferences

_Populate as you build_

## Gotchas

- Vite dev proxy forwards `/api` → `http://localhost:8080` — API must be on port 8080
- `pnpm install` must be run before any build steps (node_modules were absent on first import)
- `SUPABASE_URL` takes priority over `DATABASE_URL` if it's a postgres:// URI — on Replit, `DATABASE_URL` is used
- Order outbox retries uploads + Telegram forever with exponential backoff; state persists in the JSONB store row
- Sharp and esbuild are in `onlyBuiltDependencies` — must be built from source on install

## Pointers

- Skills: `react-vite`, `database`, `environment-secrets`, `workflows`, `package-management`
