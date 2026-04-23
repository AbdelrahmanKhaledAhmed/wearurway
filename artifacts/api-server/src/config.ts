const config = {
  database: {
    url: process.env.DATABASE_URL ?? "",
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucketName: process.env.R2_BUCKET_NAME ?? "",
    publicUrl: process.env.R2_PUBLIC_URL ?? "",
  },

  admin: {
    password: process.env.ADMIN_PASSWORD ?? "",
  },
};

export default config;
