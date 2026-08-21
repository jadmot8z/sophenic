import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: [".next/**", "release/**", "dist-electron/**", "dist-desktop/**", "dist-web/**", "next-env.d.ts"] },
  // CommonJS entry points and build scripts are not ES modules: keep them out
  // of the TypeScript/ESM rule set instead of weakening it globally.
  {
    files: ["electron/main.js", "next.config.js", "postcss.config.mjs", "scripts/**/*.cjs", "scripts/**/*.mjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" }
  }
];
