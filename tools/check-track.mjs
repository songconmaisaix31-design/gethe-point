import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const checks = {
  foundation: {
    required: [
      "package.json",
      "tsconfig.json",
      "eslint.config.mjs",
      "vitest.config.ts",
      "packages/config",
      "tools",
    ],
    lint: ["eslint.config.mjs", "vitest.config.ts", "packages/config", "tools"],
    test: ["packages/config"],
  },
  contracts: {
    required: ["packages/contracts"],
    lint: ["packages/contracts"],
    test: ["packages/contracts"],
  },
  data: {
    required: ["packages/db"],
    lint: ["packages/db"],
    test: ["packages/db"],
  },
  experience: {
    required: ["apps/web"],
    lint: ["apps/web"],
    test: ["apps/web"],
  },
  conversation: {
    required: ["modules/conversation", "modules/ai-witness", "modules/boundary"],
    lint: ["modules/conversation", "modules/ai-witness", "modules/boundary"],
    test: ["modules/conversation", "modules/ai-witness", "modules/boundary"],
  },
  responsibility: {
    required: ["modules/responsibility", "modules/ai-domain"],
    lint: ["modules/responsibility", "modules/ai-domain"],
    test: ["modules/responsibility", "modules/ai-domain"],
  },
  handover: {
    required: ["modules/handover", "modules/ai-handover"],
    lint: ["modules/handover", "modules/ai-handover"],
    test: ["modules/handover", "modules/ai-handover"],
  },
  care: {
    required: ["modules/care"],
    lint: ["modules/care"],
    test: ["modules/care"],
  },
  privacy: {
    required: ["modules/privacy"],
    lint: ["modules/privacy"],
    test: ["modules/privacy"],
  },
  "qa-core": {
    required: ["packages/testkit", "fixtures"],
    lint: ["packages/testkit", "fixtures"],
    test: ["packages/testkit", "fixtures"],
  },
  qa: {
    required: ["packages/testkit", "fixtures", "tests/e2e"],
    lint: ["packages/testkit", "fixtures", "tests/e2e"],
    test: ["packages/testkit", "fixtures"],
  },
};

const requestedCheck = process.argv[2];
const check = requestedCheck === undefined ? undefined : checks[requestedCheck];

if (check === undefined) {
  console.error(`Unknown track check: ${requestedCheck ?? "<missing>"}`);
  process.exit(2);
}

const missingPaths = check.required.filter((path) => !existsSync(path));

if (missingPaths.length > 0) {
  console.error(`Missing required track paths: ${missingPaths.join(", ")}`);
  process.exit(2);
}

const run = (label, entrypoint, args) => {
  console.log(`\n[${requestedCheck}] ${label}`);
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    stdio: "inherit",
    shell: false,
  });

  if (result.error !== undefined) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run("typecheck", "node_modules/typescript/bin/tsc", [
  "--project",
  "tsconfig.json",
  "--noEmit",
]);
run("lint", "node_modules/eslint/bin/eslint.js", [
  "--max-warnings",
  "0",
  "--no-error-on-unmatched-pattern",
  ...check.lint,
]);
run("tests", "node_modules/vitest/vitest.mjs", [
  "run",
  "--exclude",
  "packages/db/tests/disposable/**",
  ...check.test,
]);
