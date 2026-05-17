import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default defineConfig(
	// Global ignores
	{
		ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/.output/**"],
	},

	// Base ESLint recommended rules
	...tseslint.configs.recommended,

	// Strict TypeScript rules
	...tseslint.configs.strict,

	// Type-aware linting (requires tsconfig)
	...tseslint.configs.strictTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.js"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},

	// Prettier compatibility — disables ESLint formatting rules that conflict with Prettier
	prettierConfig,

	// Prettier integration — runs Prettier as an ESLint rule
	{
		plugins: {
			prettier,
		},
		rules: {
			"prettier/prettier": "error",
		},
	},

	// Project-specific rule overrides
	{
		files: ["**/*.ts"],
		rules: {
			// Enforce consistent type imports for type-only symbols
			"@typescript-eslint/consistent-type-imports": [
				"error",
				{
					prefer: "type-imports",
					fixStyle: "inline-type-imports",
				},
			],

			// Disallow unnecessary type assertions
			"@typescript-eslint/no-unnecessary-type-assertion": "error",

			// Require explicit return types on exported functions
			"@typescript-eslint/explicit-module-boundary-types": "error",

			// Disallow non-null assertions — use proper type guards instead
			"@typescript-eslint/no-non-null-assertion": "error",

			// Require switch statements to be exhaustive
			"@typescript-eslint/switch-exhaustiveness-check": "error",

			// Disallow unused variables (with underscore prefix exception)
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],

			// Disallow any — prefer proper types
			"@typescript-eslint/no-explicit-any": "error",

			// Enforce consistent member accessibility
			"@typescript-eslint/explicit-member-accessibility": [
				"error",
				{
					accessibility: "explicit",
					overrides: {
						constructors: "no-public",
					},
				},
			],

			// Disallow floating Promises (must be awaited or voided)
			"@typescript-eslint/no-floating-promises": "error",

			// Disallow misused Promises in conditional/void contexts
			"@typescript-eslint/no-misused-promises": "error",

			// Consistent array types (T[] not Array<T>)
			"@typescript-eslint/array-type": [
				"error",
				{
					default: "array",
				},
			],

			// Prefer interface for object definitions, type for unions/intersections
			"@typescript-eslint/consistent-type-definitions": ["error", "interface"],

			// Disallow enums — prefer union types for library code
			"no-restricted-syntax": [
				"error",
				{
					selector: "TSEnumDeclaration",
					message: "Don't use enums. Use union types or `as const` objects instead.",
				},
			],
		},
	},

	// Relax rules for test files
	{
		files: ["**/*.test.ts", "**/__tests__/**", "**/test/**"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/explicit-module-boundary-types": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
		},
	},

	// Relax rules for config files (vite, tsup, vitest configs)
	{
		files: ["**/vite.config.ts", "**/tsup.config.ts", "**/vitest.config.ts", "**/eslint.config.js"],
		rules: {
			"@typescript-eslint/explicit-module-boundary-types": "off",
			"@typescript-eslint/explicit-member-accessibility": "off",
			"@typescript-eslint/consistent-type-imports": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
		},
	},
);
