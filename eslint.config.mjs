import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const unsafeExecutionRules = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
};

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...unsafeExecutionRules,
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      ...unsafeExecutionRules,
    },
  },
  globalIgnores([
    ".agents/**",
    ".next/**",
    "blob-report/**",
    "coverage/**",
    "dist/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
