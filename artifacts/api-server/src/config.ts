function readEnv(name: string, options?: { optional?: boolean; default?: string }): string {
  const raw = process.env[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value) return value;
  if (options?.default !== undefined) return options.default;
  if (options?.optional) return "";
  throw new Error(
    `Missing required environment variable: ${name}. Set it in your hosting provider before starting the server.`,
  );
}

/**
 * Resolve the Postgres connection string.
 *
 * Priority order:
 *  1. SUPABASE_URL — if it's already a postgres(ql):// URI, use it directly.
 *     (Supabase also supports providing the full connection string as SUPABASE_URL)
 *  2. DATABASE_URL — Replit-managed fallback (points to Replit's own Postgres).
 */
function resolveDbUrl(): string {
  const supabaseUrl = (process.env["SUPABASE_URL"] ?? "").trim();
  if (supabaseUrl && (supabaseUrl.startsWith("postgresql://") || supabaseUrl.startsWith("postgres://"))) {
    return supabaseUrl;
  }

  const dbUrl = (process.env["DATABASE_URL"] ?? "").trim();
  if (dbUrl) return dbUrl;

  throw new Error(
    "No database URL found. Set SUPABASE_URL (Postgres connection string) or DATABASE_URL.",
  );
}

const config = {
  database: {
    url: resolveDbUrl(),
  },

  r2: {
    accountId:       readEnv("R2_ACCOUNT_ID",       { optional: true }),
    accessKeyId:     readEnv("R2_ACCESS_KEY_ID",     { optional: true }),
    secretAccessKey: readEnv("R2_SECRET_ACCESS_KEY", { optional: true }),
    bucketName:      readEnv("R2_BUCKET_NAME",       { optional: true }),
    publicUrl:       readEnv("R2_PUBLIC_URL",        { optional: true }),
  },

  admin: {
    password: readEnv("ADMIN_PASSWORD", { optional: true, default: "admin123" }),
  },
};

export default config;
