import postgres, { type Sql } from "postgres";

import {
  createDatabase,
  type Database,
} from "../../../../packages/db/src/index";

interface MvpCoreDatabaseState {
  readonly client: Sql;
  readonly database: Database;
}

let localState: MvpCoreDatabaseState | undefined;

const createLocalState = (): MvpCoreDatabaseState => {
  const connectionUrl = process.env["MVP_CORE_DATABASE_URL"];

  if (connectionUrl === undefined || connectionUrl.trim().length === 0) {
    throw new Error("The Local Fixture database is unavailable.");
  }

  const client = postgres(connectionUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 2,
    onnotice: () => undefined,
    prepare: false,
  });

  return Object.freeze({ client, database: createDatabase(client) });
};

/** Lazily connects at request time so builds never require local credentials. */
export const getMvpCoreDatabase = (): Database => {
  localState ??= createLocalState();
  return localState.database;
};
