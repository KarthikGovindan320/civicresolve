import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Server code stays in small, flat functions that are easy to test.
  {
    files: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
    rules: {
      complexity: ["error", 12],
      "max-depth": ["error", 3],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 4],
    },
  },
  // Components may be long because of markup, but their branching is capped.
  {
    files: ["**/*.tsx"],
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 4],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
  ]),
]);

export default eslintConfig;
