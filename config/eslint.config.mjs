import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [{
    ignores: ["**/node_modules/", "**/main.js", "**/dist/"],
}, ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
), {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        globals: {
            ...globals.node,
        },

        parser: tsParser,
        ecmaVersion: 5,
        sourceType: "module",
    },

    rules: {
        "no-unused-vars": "off",

        "@typescript-eslint/no-unused-vars": ["error", {
            args: "none",
        }],

        // Disallow importing runtime values from type-only packages.
        // Allows: `import type {...} from '@types/...';`
        // Disallows: `import {...} from '@types/...';`
        // Use the TS-aware variant so we can allow type-only imports through restrictions
        "no-restricted-imports": "off",
        "@typescript-eslint/no-restricted-imports": ["error", {
            allowTypeImports: true,
            patterns: [
                {
                    group: ["@types/*"],
                    message: "Only import types from '@types/*' using `import type`. Do not import runtime values.",
                },
            ],
        }],

        "@typescript-eslint/ban-ts-comment": "off",
        "no-prototype-builtins": "off",
        "@typescript-eslint/no-empty-function": "off",
    },
}];
