function readEnv(name: string, options?: { optional?: boolean; default?: string }): string {
  const raw = process.env[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value) return value;
  if (options?.default !== undefined) return options.default;
  if (options?.optional) return "";
  throw new Error(
    `Missing required environment variable: ${name}. Set it in your hosting provider (e.g. Railway → Variables) before starting the server.`,
  );
}

const config = {
  database: {
    url: readEnv("DATABASE_URL"),
  },

  r2: {
    accountId: readEnv("R2_ACCOUNT_ID", { optional: true }),
    accessKeyId: readEnv("R2_ACCESS_KEY_ID", { optional: true }),
    secretAccessKey: readEnv("R2_SECRET_ACCESS_KEY", { optional: true }),
    bucketName: readEnv("R2_BUCKET_NAME", { optional: true }),
    publicUrl: readEnv("R2_PUBLIC_URL", { optional: true }),
  },

  admin: {
    password: readEnv("ADMIN_PASSWORD", { optional: true, default: "admin123" }),
  },
};

export default config;
