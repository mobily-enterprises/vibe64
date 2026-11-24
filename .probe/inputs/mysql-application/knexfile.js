import { createKnexMigrationConfigFromApp } from "@jskit-ai/database-runtime/server/knexMigrationConfig";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

export default await createKnexMigrationConfigFromApp({ client: "mysql2", environment: process.env });
