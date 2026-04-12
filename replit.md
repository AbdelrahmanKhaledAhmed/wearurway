# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (not used by wearurway — JSON file store used instead)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## wearurway Project

### Overview

A premium streetwear customization website with a multi-step product configurator and a protected admin panel.

### Frontend (artifacts/wearurway)

- React + Vite + Tailwind CSS
- Dark streetwear aesthetic (near-black background, off-white text)
- `framer-motion` for transitions
- Wouter for routing
- Customization flow: Landing → Products → Fits → Colors → Sizes
- Admin flow: /admin (login) → /admin/dashboard
- Design editor supports cursor-centered mouse-wheel zoom on selected image layers, free layer dragging, and an edit-image modal with deep cursor-centered zoom, Move/pan tool, precise circular brush erase, automatic transparent-edge trimming, and a manual Trim Empty Space action that shrinks layer bounds to visible pixels.

### Backend (artifacts/api-server)

- Express 5 API, data stored in `artifacts/api-server/src/data/db.json`
- No database — JSON file store for simplicity
- Admin password: set via `ADMIN_PASSWORD` env var (default: `admin123`)

### Routes

- `GET /api/products` — list products
- `POST /api/products` — create product (admin)
- `PATCH /api/products/:id` — update product (admin)
- `DELETE /api/products/:id` — delete product + cascade (admin)
- `GET /api/fits` — list fits
- `POST /api/fits` — create fit (admin)
- `PATCH /api/fits/:id` — update fit (admin)
- `DELETE /api/fits/:id` — delete fit + cascade (admin)
- `GET /api/fits/:fitId/colors` — list colors for a fit
- `POST /api/fits/:fitId/colors` — add a color (admin)
- `DELETE /api/fits/:fitId/colors/:colorId` — remove a color (admin)
- `GET /api/fits/:fitId/sizes` — list sizes for a fit
- `POST /api/fits/:fitId/sizes` — add a size (admin)
- `PATCH /api/fits/:fitId/sizes/:sizeId` — update a size (admin)
- `DELETE /api/fits/:fitId/sizes/:sizeId` — delete a size (admin)
- `POST /api/uploads` — upload image file (multipart/form-data, field: "file") → returns { url, filename }
- `GET /api/uploads/:filename` — serve uploaded image
- `POST /api/admin/login` — admin login (returns Bearer token)
- `POST /api/admin/logout` — admin logout
- `GET /api/admin/me` — check admin session

### Assets

- Logo: `artifacts/wearurway/public/logo.png` (1024x1024) — if absent, a styled text wordmark is shown
- Size images: `artifacts/wearurway/public/size-images/` — naming format: `Boxy-Fit-Small.png`, `Regular-Fit-Medium.png`, etc.

### Admin Panel

- URL: `/admin`
- Default password: `admin123`
- Auth: Bearer token stored in `localStorage` as `wearurway_admin_token`
- Features:
  - **Products tab**: Add/edit/delete products, toggle available/coming-soon, upload product image
  - **Fits tab**: Add/edit/delete fits (linked to a product), toggle available/coming-soon, grouped by product
  - **Colors tab**: Add/delete colors per fit with hex color picker; fit filter tabs
  - **Sizes tab**: Add/edit/delete sizes per fit with width/height/image; fit filter tabs
  - **Image uploads**: Click "Upload" button in any image field → `POST /api/uploads` → image stored on disk and URL auto-filled
