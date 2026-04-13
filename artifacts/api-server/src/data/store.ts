import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "db.json");

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

export interface MockupSide {
  image?: string;
  boundingBox?: BoundingBox;
}

export interface Mockup {
  productId: string;
  fitId: string;
  colorId: string;
  front?: MockupSide;
  back?: MockupSide;
  mockupSize?: number;
  mockupOffsetY?: number;
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
  size: Size;
  frontLayers: DesignLayer[];
  backLayers: DesignLayer[];
  createdAt: string;
}

export interface Store {
  products: Product[];
  fits: Fit[];
  colors: Color[];
  sizes: Size[];
  mockups: Record<string, Mockup>;
  sharedDesigns: Record<string, SharedDesign>;
}

const DEFAULT_STORE: Store = {
  mockups: {},
  sharedDesigns: {},
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

function loadStore(): Store {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Store>;
      return {
        ...JSON.parse(JSON.stringify(DEFAULT_STORE)),
        ...parsed,
        mockups: parsed.mockups ?? {},
        sharedDesigns: parsed.sharedDesigns ?? {},
      };
    }
  } catch {
    // fall through to default
  }
  return JSON.parse(JSON.stringify(DEFAULT_STORE));
}

function saveStore(store: Store): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}

let store = loadStore();

export function getStore(): Store {
  return store;
}

export function updateStore(updater: (s: Store) => void): void {
  updater(store);
  saveStore(store);
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
