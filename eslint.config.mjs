import path from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const obsidianFlatConfigs = [...obsidianmd.configs.recommended];

export default [
	{
		ignores: ["**/node_modules/", "**/main.js", "**/dist/"],
	},
	js.configs.recommended,
	...obsidianFlatConfigs,
	{
		files: ["**/*.ts"],
		plugins: {
			"@typescript-eslint": typescriptEslint,
			obsidianmd,
		},
		languageOptions: {
			globals: {
				...globals.node,
			},
			parser: tsParser,
			ecmaVersion: 5,
			sourceType: "module",
			parserOptions: {
				project: [path.resolve(__dirname, "tsconfig.json")],
				tsconfigRootDir: __dirname,
			},
		},
		rules: {
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					args: "none",
				},
			],
			// Disallow importing runtime values from type-only packages.
			// Allows: `import type {...} from '@types/...';`
			// Disallows: `import {...} from '@types/...';`
			// Use the TS-aware variant so we can allow type-only imports through restrictions
			"no-restricted-imports": "off",
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "axios",
							message: "Use the built-in `requestUrl` function instead of `axios`.",
						},
						{
							name: "superagent",
							message:
								"Use the built-in `requestUrl` function instead of `superagent`.",
						},
						{
							name: "got",
							message: "Use the built-in `requestUrl` function instead of `got`.",
						},
						{
							name: "node-fetch",
							message:
								"Use the built-in `requestUrl` function instead of `node-fetch`.",
						},
						{
							name: "moment",
							message:
								"The 'moment' package is bundled with Obsidian. Please import it from 'obsidian' instead.",
						},
					],
					patterns: [
						{
							group: ["@types/*"],
							allowTypeImports: true,
							message:
								"Only import types from '@types/*' using `import type`. Do not import runtime values.",
						},
					],
				},
			],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
		},
	},
	{
		files: ["src/**/tests/**/*.ts", "src/**/test-utils/**/*.ts", "**/__mocks__/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
				...globals.jest,
			},
		},
	},
];
