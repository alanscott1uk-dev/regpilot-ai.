// Runtime configuration readiness. Do not return secrets or raw connection strings.
export function assessBackendReadiness(env) {
 const database = typeof env.DATABASE_URL === "string" && /^postgres(ql)?:\/\//.test(env.DATABASE_URL);
 const auth = typeof env.AUTH_PROVIDER_ISSUER === "string" && env.AUTH_PROVIDER_ISSUER.startsWith("https://") &&
   typeof env.AUTH_PROVIDER_AUDIENCE === "string" && env.AUTH_PROVIDER_AUDIENCE.length > 0;
 const storage = typeof env.PRIVATE_STORAGE_BUCKET === "string" && env.PRIVATE_STORAGE_BUCKET.length > 0;
 return {
  databaseConfigured: database,
  authConfigured: auth,
  storageConfigured: storage,
  readyForCustomerData: false
 };
}
