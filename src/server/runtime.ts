import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { DemoService } from "@/server/demo-service";
import { createDemoService } from "@/server/demo-service";
import { createDemoDatabase } from "@/server/database";
import { createStepFunAgentProvider } from "@/server/agent-provider";

declare global {
  var weRememberDemoService: DemoService | undefined;
}

function createRuntimeService(): DemoService {
  const databasePath = join(process.cwd(), ".data", "demo.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  return createDemoService(
    createDemoDatabase(databasePath),
    undefined,
    createStepFunAgentProvider({
      apiKey: process.env.STEPFUN_API_KEY,
      model: process.env.STEPFUN_MODEL,
    }),
  );
}

export function getDemoService(): DemoService {
  globalThis.weRememberDemoService ??= createRuntimeService();
  return globalThis.weRememberDemoService;
}
