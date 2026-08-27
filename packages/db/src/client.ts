import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export const createDatabase = (client: Sql): Database =>
  drizzle(client, { schema });

type TransactionCallback = Parameters<Database["transaction"]>[0];

export type DatabaseTransaction = Parameters<TransactionCallback>[0];
