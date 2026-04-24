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

export interface OrderFileRecord {
  orderId: string;
  folderPath: string;
  files: string[];
  customerName?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
  pendingUploads?: PendingUploadEntry[];
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
  analyticsEvents?: Record<string, number>;
}

const DEFAULT_STORE: Store = {
  mockups: {},
  sharedDesigns: {},
  orderFiles: {},
  orders: {},
  analyticsEvents: {},
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
        analyticsEvents: parsed.analyticsEvents ?? {},
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

export function updateStore(updater: (s: Store) => void): void {
  updater(store);
  saveToDB(store).catch((err) =>
    console.error("[store] Failed to persist to DB:", err)
  );
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
