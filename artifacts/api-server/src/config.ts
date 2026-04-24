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
    accountId: readEnv("R2_ACCOUNT_ID"),
    accessKeyId: readEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: readEnv("R2_SECRET_ACCESS_KEY"),
    bucketName: readEnv("R2_BUCKET_NAME"),
    publicUrl: readEnv("R2_PUBLIC_URL", { optional: true }),
  },

  admin: {
    password: readEnv("ADMIN_PASSWORD"),
  },
};

export default config;
