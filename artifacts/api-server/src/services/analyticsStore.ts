import { query } from "./databaseService.js";
import { getStore } from "../data/store.js";

/**
 * Analytics counters used to live inside the single big `store_data` JSONB
 * row, so every funnel event (8+ per checkout per visitor) rewrote the
 * entire store. They now live in their own tiny table where each event is
 * a single one-row upsert: O(1) write cost regardless of how much other
 * data the app stores.
 */

async function ensureAnalyticsSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      name  TEXT PRIMARY KEY,
      count BIGINT NOT NULL DEFAULT 0
    )
  `);
}

/**
 * One-time migration: copy any existing counters from the JSONB store into
 * the new table without losing or double-counting them. Uses GREATEST so
 * re-running this is idempotent and safe even if some events were already
 * recorded directly into the new table.
 */
async function migrateFromJsonb(): Promise<void> {
  const legacy = getStore().analyticsEvents ?? {};
  const entries = Object.entries(legacy);
  if (entries.length === 0) return;
  for (const [name, value] of entries) {
    const count = Number(value);
    if (!Number.isFinite(count) || count <= 0) continue;
    await query(
      `INSERT INTO analytics_events (name, count)
       VALUES ($1, $2)
       ON CONFLICT (name)
       DO UPDATE SET count = GREATEST(analytics_events.count, EXCLUDED.count)`,
      [name, count],
    );
  }
}

export async function initAnalytics(): Promise<void> {
  try {
    await ensureAnalyticsSchema();
    await migrateFromJsonb();
  } catch (err) {
    console.error("[analytics] Could not initialize analytics table:", err);
  }
}

/** Single-row upsert. No JSONB rewrite, no full-store save. */
export async function incrementAnalyticsEvent(name: string): Promise<void> {
  await query(
    `INSERT INTO analytics_events (name, count)
     VALUES ($1, 1)
     ON CONFLICT (name)
     DO UPDATE SET count = analytics_events.count + 1`,
    [name],
  );
}

export async function getAnalyticsEvents(): Promise<Record<string, number>> {
  const result = await query<{ name: string; count: string }>(
    `SELECT name, count FROM analytics_events`,
  );
  const events: Record<string, number> = {};
  for (const row of result.rows) {
    events[row.name] = Number(row.count);
  }
  return events;
}

export async function resetAnalyticsEvents(): Promise<void> {
  await query(`UPDATE analytics_events SET count = 0`);
}
