import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

const collectSourceFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(path);
      }
      return extname(entry.name) === ".ts" || extname(entry.name) === ".tsx"
        ? [path]
        : [];
    }),
  );
  return nested.flat();
};

describe("Experience source boundary", () => {
  it("does not bind the client bundle to repository source or raw Fixture barrels", async () => {
    const sourceRoot = new URL("../src", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
    const files = await collectSourceFiles(sourceRoot);
    const sources = await Promise.all(files.map(async (file) => readFile(file, "utf8")));
    const repositoryContractSource = ["packages", "contracts", "src"].join("/");
    const rawFixtureBarrel = ["packages", "testkit", "src", "index"].join("/");
    const localSuccessFallback = ["create", "LocalFixture", "Client"].join("");

    for (const source of sources) {
      expect(source).not.toContain(repositoryContractSource);
      expect(source).not.toContain(rawFixtureBarrel);
      expect(source).not.toContain(localSuccessFallback);
    }
  });
});
