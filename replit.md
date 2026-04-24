# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL (wearurway uses a `store_data` JSONB table; `pg` directly without Drizzle)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle via build.mjs)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- Replit artifact workflows run the API on port 8080 and Vite frontend on port 3000

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
- Mockups admin includes a per-mockup Designer Display setting to show or hide the Save Design button on the designer page.
- Design editor supports cursor-centered mouse-wheel zoom on selected image layers, free layer dragging, and an edit-image modal with deep cursor-centered zoom, Move/pan tool, precise circular brush erase, and automatic transparent-edge trimming on image load, brush erase, and fill removal so layer bounds shrink to visible pixels.
- Image quality enhancement now runs when Add to Design is clicked in the image editor, using print-scale high-quality smoothing and sharpening to create the layer's final image buffer before it is placed on the mockup.
- Mockup layer resizing is ratio-locked to each layer's natural image dimensions across wheel zoom, pinch zoom, render, export, and live dimension labels.
- Live print dimensions for selected layers are scaled from the portion visibly clipped inside the print box while preserving the selected image's fixed natural aspect ratio in the cm label.
- Export Design composites the already-processed layer images with uniform X/Y scaling so exported PNGs preserve the same aspect ratio shown on the mockup.
- Export Design outputs high-resolution PNG files using print-DPI canvas scaling while keeping filename dimensions aligned with the live selected-layer size shown on the mockup.
- Tools includes Share Design, which generates a ready-to-share PNG combining the full front and back mockups side-by-side with all visible design layers applied.

### Backend (artifacts/api-server)

- Express 5 API — fully migrated to persistent storage (no more db.json)
- **Store**: PostgreSQL `store_data` table with a single JSONB row (`key='main'`); in-memory cache with async upsert via `store.ts`
- **File storage**: Replit Object Storage (GCS-backed) via `lib/objectStorage.ts` (`uploadBuffer`, `deleteObject`, `objectExists`, `streamObject`)
  - Mockup images: `uploads/mockups/`
  - Shared layer uploads: `uploads/shared-layers/`
  - Size chart images: `size-charts/`
  - Order export files / payment proofs: `orders/<orderId>/`
- Admin password: set via `ADMIN_PASSWORD` env var (default: `admin123`)
- API is served under `/api`; frontend calls remain same-origin through the Vite proxy in development and shared host routing in Replit.
- Admin session tokens are generated with Node crypto and stored in process memory.
- AI image-assist routes load the OpenAI integration lazily per request so the API server can start without AI credentials; if the integration is not configured, those endpoints return 503 instead of crashing startup.

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
- `POST /api/uploads` — upload image file (multipart/form-data, field: "file") → stored in Object Storage, returns { url, filename }
- `GET /api/uploads/mockups/:filename` — stream mockup image from Object Storage
- `GET /api/uploads/shared-layers/:filename` — stream shared layer from Object Storage
- `GET /api/size-charts/:filename` — stream size chart from Object Storage
- `POST /api/admin/login` — admin login (returns Bearer token)
- `POST /api/admin/logout` — admin logout
- `GET /api/admin/me` — check admin session
- `POST /api/create-order` — create order, save docs to Object Storage, send Telegram notification
- `POST /api/orders/:orderId/documents` — upload additional export files to Object Storage
- `POST /api/orders/:orderId/complete` — trigger Telegram order summary message
- `GET /api/admin/order-files` — list all orders with their stored file metadata (admin)
- `DELETE /api/admin/order-files/:orderId` — delete order files from Object Storage + remove record (admin)

### Assets

- Logo: `artifacts/wearurway/public/logo.png` (1024x1024) — if absent, a styled text wordmark is shown
- Size images: `artifacts/wearurway/public/size-images/` — naming format: `Boxy-Fit-Small.png`, `Regular-Fit-Medium.png`, etc.

### Text Tool & Custom Fonts

- **Font files**: `artifacts/wearurway/public/fonts/` — drop `.woff2` files here
- **Font config**: `artifacts/wearurway/src/config/fonts.ts` — single file to add/remove/rename fonts in the UI
- To add a font: copy `.woff2` to `public/fonts/` and add an entry to `CUSTOM_FONTS` in `fonts.ts`
- Text layers are rendered to PNG via Canvas API and added as standard DesignLayers
- Supports: font selection, text color, outline (color + thickness), arc/curve (-300° to +300°)

### Admin Panel

- URL: `/admin`
- Default password: `admin123`
- Auth: Bearer token stored in `localStorage` as `wearurway_admin_token`
- Features:
  - **Products tab**: Add/edit/delete products, toggle available/coming-soon, upload product image
  - **Fits tab**: Add/edit/delete fits (linked to a product), toggle available/coming-soon, grouped by product
  - **Colors tab**: Add/delete colors per fit with hex color picker; fit filter tabs
  - **Sizes tab**: Add/edit/delete sizes per fit with width/height/image; fit filter tabs
  - **Mockups tab**: Automatically generates required mockup image filenames from product, fit, color, and side using `product_fit_color_front.png` / `product_fit_color_back.png` format; images served from Object Storage
  - **Settings tab**: Admin can edit shipping company, shipping description, shipping price, front-only price, front+back price, InstaPay phone, Telegram chat ID, and Telegram bot token
  - **Order Files tab**: List and delete order file records (files stored in Object Storage under `orders/<orderId>/`)
- Size availability, coming-soon state, and height/weight ranges are included in the API schema so admin controls persist and storefront size cards remain selectable when available.
- `POST /api/create-order` returns the `WW-xxxxx` order ID immediately, then asynchronously saves order documents (payment proof, export PNGs) to Object Storage under `orders/<orderId>/` and sends a Telegram summary message.
- Image uploads: click "Upload" in any image field → stored in Object Storage, URL auto-filled


### Phone Validation (Egyptian)

- Checkout phone field strips non-digits as user types and limits to 11 chars
- Validates against `/^01[0125]\d{8}$/` (must be 11 digits, starting with 010/011/012/015)
- Cleaned phone (digits-only) is sent to the API

### Analytics (Light Funnel Tracking)

- Backend: `analyticsEvents: Record<string, number>` on the store; persists in Postgres
- Endpoints:
  - `POST /api/analytics/event` — public, body `{name}`, increments counter (only allows 8 known event names)
  - `GET /api/admin/analytics` — admin-only, returns counters
  - `POST /api/admin/analytics/reset` — admin-only, zeroes all counters
- Client helper: `artifacts/wearurway/src/lib/analytics.ts` exports `trackEvent(name)`
  - Uses `sessionStorage` to dedupe per session (refreshes do not double-count)
  - Uses `navigator.sendBeacon` when available so navigation doesn't block analytics
- Tracked steps (the funnel): `view_landing`, `view_products`, `view_fits`, `view_colors`, `view_sizes`, `view_designer`, `view_checkout`, `complete_order`
- Admin "analytics" tab shows the funnel with bars, % of step 1, and per-step drop-off, plus a Reset button
