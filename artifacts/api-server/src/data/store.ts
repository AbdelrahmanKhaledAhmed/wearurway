import { query, ensureSchema } from "../services/databaseService.js";

export interface Product {
  id: string;
  name: string;
  available: boolean;
  comingSoon: boolean;
  image?: string;
}

export interface Fit {
  id: string;
  name: string;
  available: boolean;
  comingSoon: boolean;
  productId: string;
}

export interface Color {
  id: string;
  name: string;
  hex: string;
  fitId: string;
}

export interface Size {
  id: string;
  name: string;
  realWidth: number;
  realHeight: number;
  fitId: string;
  available?: boolean;
  comingSoon?: boolean;
  heightMin?: number;
  heightMax?: number;
  weightMin?: number;
  weightMax?: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClipPoint {
  x: number;
  y: number;
}

export interface MockupSide {
  image?: string;
  boundingBox?: BoundingBox;
  clipPolygon?: ClipPoint[];
}

export interface Mockup {
  productId: string;
  fitId: string;
  colorId: string;
  front?: MockupSide;
  back?: MockupSide;
  mockupSize?: number;
  mockupOffsetY?: number;
  showSaveDesignButton?: boolean;
}

export interface DesignLayer {
  id: string;
  name: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  naturalWidth: number;
  naturalHeight: number;
}

export interface SharedDesign {
  id: string;
  product: Product;
  fit: Fit;
  color: Color;
  size?: Size | null;
  frontLayers: DesignLayer[];
  backLayers: DesignLayer[];
  createdAt: string;
  expiresAt: string;
  layerFilenames: string[];
}

export interface OrderSettings {
  shippingCompanyName: string;
  shippingDescription: string;
  shippingPrice: number;
  frontOnlyPrice: number;
  frontBackPrice: number;
  instaPayPhone: string;
  contactPhone?: string;
  telegramChatId?: string;
  telegramBotToken?: string;
  showExportButton?: boolean;
}

export interface PendingUploadEntry {
  id: string;
  fileName: string;
  contentType: string;
  dataBase64: string;
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
}

export interface PendingNotificationEntry {
  payload: {
    name?: string;
    phone?: string;
    address?: string;
    product?: string;
    fit?: string;
    color?: string;
    size?: { name?: string; realWidth?: number; realHeight?: number };
    paymentMethod?: "cod" | "instapay";
    productPrice?: number;
    shippingPrice?: number;
    total?: number;
    feedback?: string;
  };
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
}

export interface PendingDesignRenderEntry {
  designJob: {
    frontLayers: Array<{
      id: string;
      name?: string;
      imageUrl: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      visible: boolean;
      naturalWidth?: number;
      naturalHeight?: number;
    }>;
    backLayers: Array<{
      id: string;
      name?: string;
      imageUrl: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      visible: boolean;
      naturalWidth?: number;
      naturalHeight?: number;
    }>;
    mockupSize: number;
    frontMockupImage?: string;
    backMockupImage?: string;
  };
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
}

export interface OrderFileRecord {
  orderId: string;
  folderPath: string;
  files: string[];
  customerName?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
  pendingUploads?: PendingUploadEntry[];
  pendingDesignRender?: PendingDesignRenderEntry;
  pendingNotification?: PendingNotificationEntry;
  notificationSentAt?: string;
}

export interface OrderRecord {
  orderId: string;
  name?: string;
  phone?: string;
  address?: string;
  product?: string;
  fit?: string;
  size?: { name?: string; realWidth?: number; realHeight?: number };
  color?: string;
  paymentMethod?: string;
  productPrice?: number;
  shippingPrice?: number;
  total?: number;
  feedback?: string;
  createdAt: string;
}

export interface Store {
  products: Product[];
  fits: Fit[];
  colors: Color[];
  sizes: Size[];
  mockups: Record<string, Mockup>;
  sharedDesigns: Record<string, SharedDesign>;
  orderFiles: Record<string, OrderFileRecord>;
  orders: Record<string, OrderRecord>;
  orderSettings: OrderSettings;
  adminSessions?: string[];
}

const DEFAULT_STORE: Store = {
  mockups: {},
  sharedDesigns: {},
  orderFiles: {},
  orders: {},
  orderSettings: {
    shippingCompanyName: "Wasslaha Standard",
    shippingDescription: "Delivered in 2–3 working days",
    shippingPrice: 85,
    frontOnlyPrice: 550,
    frontBackPrice: 700,
    instaPayPhone: "01069383482",
    contactPhone: "01069383482",
  },
  products: [
    { id: "tshirt", name: "T-Shirt", available: true, comingSoon: false },
    { id: "sweatshirt", name: "Sweatshirt", available: false, comingSoon: true },
    { id: "sweatpants", name: "Sweatpants", available: false, comingSoon: true },
  ],
  fits: [
    { id: "boxy", name: "Boxy Fit", available: true, comingSoon: false, productId: "tshirt" },
    { id: "regular", name: "Regular Fit", available: true, comingSoon: false, productId: "tshirt" },
    { id: "oversize", name: "Oversize", available: false, comingSoon: true, productId: "tshirt" },
  ],
  colors: [
    { id: "black", name: "Black", hex: "#0A0A0A", fitId: "boxy" },
    { id: "white", name: "White", hex: "#F5F5F5", fitId: "boxy" },
    { id: "cream", name: "Cream", hex: "#F0E6D3", fitId: "boxy" },
    { id: "charcoal", name: "Charcoal", hex: "#36454F", fitId: "boxy" },
    { id: "reg-black", name: "Black", hex: "#0A0A0A", fitId: "regular" },
    { id: "reg-white", name: "White", hex: "#F5F5F5", fitId: "regular" },
    { id: "reg-navy", name: "Navy", hex: "#1C2B4A", fitId: "regular" },
    { id: "reg-olive", name: "Olive", hex: "#5B5B3A", fitId: "regular" },
  ],
  sizes: [
    { id: "boxy-s", name: "Small", realWidth: 48, realHeight: 66, fitId: "boxy", available: true, comingSoon: false, heightMin: 160, heightMax: 170, weightMin: 55, weightMax: 65 },
    { id: "boxy-m", name: "Medium", realWidth: 52, realHeight: 68, fitId: "boxy", available: true, comingSoon: false, heightMin: 170, heightMax: 175, weightMin: 65, weightMax: 75 },
    { id: "boxy-l", name: "Large", realWidth: 56, realHeight: 70, fitId: "boxy", available: true, comingSoon: false, heightMin: 175, heightMax: 180, weightMin: 75, weightMax: 80 },
    { id: "boxy-xl", name: "XL", realWidth: 60, realHeight: 72, fitId: "boxy", available: true, comingSoon: false, heightMin: 180, heightMax: 185, weightMin: 80, weightMax: 85 },
    { id: "reg-s", name: "Small", realWidth: 44, realHeight: 68, fitId: "regular", available: true, comingSoon: false, heightMin: 160, heightMax: 170, weightMin: 55, weightMax: 65 },
    { id: "reg-m", name: "Medium", realWidth: 48, realHeight: 70, fitId: "regular", available: true, comingSoon: false, heightMin: 170, heightMax: 175, weightMin: 65, weightMax: 75 },
    { id: "reg-l", name: "Large", realWidth: 52, realHeight: 72, fitId: "regular", available: true, comingSoon: false, heightMin: 175, heightMax: 180, weightMin: 75, weightMax: 80 },
    { id: "reg-xl", name: "XL", realWidth: 56, realHeight: 74, fitId: "regular", available: true, comingSoon: false, heightMin: 180, heightMax: 185, weightMin: 80, weightMax: 85 },
  ],
};

// ── In-memory store (cache layer) ────────────────────────────────────────────

let store: Store = JSON.parse(JSON.stringify(DEFAULT_STORE));

// ── DB persistence ───────────────────────────────────────────────────────────

async function loadFromDB(): Promise<Store> {
  try {
    const result = await query<{ value: Partial<Store> }>(
      "SELECT value FROM store_data WHERE key = 'main'"
    );
    if (result.rows.length > 0) {
      const parsed = result.rows[0].value;
      return {
        ...JSON.parse(JSON.stringify(DEFAULT_STORE)),
        ...parsed,
        mockups: parsed.mockups ?? {},
        sharedDesigns: parsed.sharedDesigns ?? {},
        orderFiles: parsed.orderFiles ?? {},
        orders: parsed.orders ?? {},
        orderSettings: {
          ...DEFAULT_STORE.orderSettings,
          ...(parsed.orderSettings ?? {}),
        },
      };
    }
  } catch (err) {
    console.error("[store] Failed to load from DB, using defaults:", err);
  }
  return JSON.parse(JSON.stringify(DEFAULT_STORE));
}

async function saveToDB(s: Store): Promise<void> {
  await query(
    `INSERT INTO store_data (key, value, updated_at)
     VALUES ('main', $1::jsonb, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(s)]
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Must be called once before handling any requests. */
export async function initStore(): Promise<void> {
  try {
    await ensureSchema();
    store = await loadFromDB();
    console.log("[store] Loaded from database");
  } catch (err) {
    console.error("[store] Could not connect to database on startup, using defaults:", err);
    store = JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

export function getStore(): Store {
  return store;
}

// ── Coalesced persistence ────────────────────────────────────────────────────
//
// Every state mutation lives in one big JSONB row, so writing it on every
// single `updateStore` call (often many per request, plus background outbox
// progress) creates severe write amplification. Instead we mark the store
// "dirty" on each update and flush at most one write per `SAVE_DEBOUNCE_MS`
// window. While a save is in flight further dirty marks queue exactly one
// follow-up save, so a burst of N updates produces 1–2 writes instead of N.

const SAVE_DEBOUNCE_MS = 250;

let dirty = false;
let saveTimer: NodeJS.Timeout | null = null;
let saveInFlight: Promise<void> | null = null;

function scheduleSave(): void {
  dirty = true;
  if (saveTimer || saveInFlight) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void runSave();
  }, SAVE_DEBOUNCE_MS);
  if (typeof saveTimer.unref === "function") saveTimer.unref();
}

async function runSave(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  const snapshot = store;
  saveInFlight = saveToDB(snapshot)
    .catch((err) => {
      // Re-mark dirty so the next tick retries.
      dirty = true;
      console.error("[store] Failed to persist to DB:", err);
    })
    .finally(() => {
      saveInFlight = null;
      // If more updates landed during the in-flight save, schedule again.
      if (dirty) scheduleSave();
    });
  await saveInFlight;
}

export function updateStore(updater: (s: Store) => void): void {
  updater(store);
  scheduleSave();
}

/**
 * Force any pending coalesced write to be persisted now and wait for it.
 * Call from SIGTERM handlers so a clean shutdown doesn't drop the last
 * batch of changes.
 */
export async function flushPendingSaves(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveInFlight) {
    try {
      await saveInFlight;
    } catch {
      // already logged inside runSave
    }
  }
  if (dirty) {
    await runSave();
  }
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
