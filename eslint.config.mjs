// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import globals from "globals";

export default defineConfig([
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "__mocks__/**",
      "**/__mocks__/**",
      "index.ts",
      "jest.config.ts",
      "test/**",
      "**/tests/**",
      "**/*.test.ts",
      "test-utils/**",
      "**/test-utils/**",
      "*.cjs",
      "*.js",
      "scripts/**"
    ]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        sourceType: "module"
      },
      globals: {
        ...globals.browser,
        DomElementInfo: "readonly",
        SvgElementInfo: "readonly",
        activeDocument: "readonly",
        activeWindow: "readonly",
        ajax: "readonly",
        ajaxPromise: "readonly",
        createDiv: "readonly",
        createEl: "readonly",
        createFragment: "readonly",
        createSpan: "readonly",
        createSvg: "readonly",
        fish: "readonly",
        fishAll: "readonly",
        isBoolean: "readonly",
        nextFrame: "readonly",
        process: "readonly",
        ready: "readonly",
        sleep: "readonly"
      }
    },
    // Custom rule overrides
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-function": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-misused-promises": ["error", { "checksVoidReturn": { "attributes": false, "properties": false, "returns": false, "variables": false } }],
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: [
            ...DEFAULT_BRANDS,
            "DevTools",
            "GitHub",
            "Google",
            "Google Keep",
            "KeepSidian",
            "KIM",
            "Microsoft",
            "OAuth",
            "Obsidian"
          ]
        }
      ]
    },
  },
  {
    files: ["src/integrations/google/**/*.ts"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        __filename: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-implied-eval": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
      "import/no-nodejs-modules": "off",
      "no-console": "off",
      "obsidianmd/no-forbidden-elements": "off"
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly"
      }
    }
  },
]);
