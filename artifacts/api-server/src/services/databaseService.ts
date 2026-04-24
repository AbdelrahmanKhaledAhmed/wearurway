import pg from "pg";
import config from "../config.js";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;
let activeProvider = "Unknown";

function getPool(): InstanceType<typeof Pool> {
  if (!pool) {
    const connectionString = config.database.url;

    if (!connectionString) {
      throw new Error(
        "No database connection string found. Set the DATABASE_URL environment variable."
      );
    }

    const isSupabase = connectionString.includes("supabase");
    activeProvider = isSupabase ? "Supabase (PostgreSQL)" : "PostgreSQL";

    pool = new Pool({
      connectionString,
      ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });

    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", err.message);
    });
  }
  return pool;
}

/** Run a raw SQL query. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(sql, params);
}

/** Ensure the store_data table exists. */
export async function ensureSchema(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS store_data (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/** Health-check: verify the database is reachable. */
export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  provider: string;
  error?: string;
}> {
  try {
    await getPool().query("SELECT 1");
    return { ok: true, provider: activeProvider };
  } catch (err) {
    return { ok: false, provider: activeProvider, error: String(err) };
  }
}
