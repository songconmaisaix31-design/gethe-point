import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

import postgres, { type Sql } from "postgres";

import { createDatabase, type Database } from "../../src/client";

const POSTGRES_IMAGE = "postgres:16-alpine";
const migrationPath = new URL(
  "../../migrations/0000_initial.sql",
  import.meta.url,
);

const safeInfrastructureError = (): Error =>
  new Error(
    "Disposable PostgreSQL verification could not start; ensure Docker Desktop is running and the pinned image is available.",
  );

const runDocker = (
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
) =>
  spawnSync("docker", args, {
    encoding: "utf8",
    env: environment,
    shell: false,
    timeout: 60_000,
    windowsHide: true,
  });

const removeExactContainer = (containerName: string): void => {
  runDocker(["rm", "--force", containerName]);
};

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const waitUntilReady = async (client: Sql): Promise<void> => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await client`select 1`;
      return;
    } catch {
      await delay(250);
    }
  }

  throw safeInfrastructureError();
};

const applyMigration = async (client: Sql): Promise<void> => {
  const migration = await readFile(migrationPath, "utf8");
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  await client.begin(async (transaction) => {
    for (const statement of statements) {
      await transaction.unsafe(statement);
    }
  });
};

export interface DisposablePostgres {
  readonly client: Sql;
  readonly database: Database;
  stop(): Promise<void>;
}

export const startDisposablePostgres = async (): Promise<DisposablePostgres> => {
  const suffix = randomBytes(8).toString("hex");
  const containerName = `we-remember-db-verify-${String(process.pid)}-${suffix}`;
  const username = `verify_${suffix}`;
  const databaseName = `verify_${suffix}`;
  const password = randomBytes(32).toString("base64url");
  const containerEnvironment = {
    ...process.env,
    POSTGRES_DB: databaseName,
    POSTGRES_PASSWORD: password,
    POSTGRES_USER: username,
  };

  const started = runDocker(
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_DB",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_USER",
      POSTGRES_IMAGE,
    ],
    containerEnvironment,
  );

  if (started.status !== 0) {
    removeExactContainer(containerName);
    throw safeInfrastructureError();
  }

  const portResult = runDocker(["port", containerName, "5432/tcp"]);
  const portMatch = /127\.0\.0\.1:(\d+)/u.exec(portResult.stdout);

  if (portResult.status !== 0 || portMatch?.[1] === undefined) {
    removeExactContainer(containerName);
    throw safeInfrastructureError();
  }

  const client = postgres({
    database: databaseName,
    host: "127.0.0.1",
    max: 1,
    onnotice: () => undefined,
    password,
    port: Number(portMatch[1]),
    user: username,
  });

  try {
    await waitUntilReady(client);
    await applyMigration(client);
  } catch {
    await client.end({ timeout: 5 });
    removeExactContainer(containerName);
    throw safeInfrastructureError();
  }

  let stopped = false;

  return {
    client,
    database: createDatabase(client),
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      await client.end({ timeout: 5 });
      removeExactContainer(containerName);
    },
  };
};
