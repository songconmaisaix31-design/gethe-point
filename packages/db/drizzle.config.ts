import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./packages/db/migrations",
  schema: "./packages/db/src/schema.ts",
});
