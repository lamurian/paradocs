// @ts-check

const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");
const importX = require("eslint-plugin-import-x");

module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  // eslint-plugin-import-x: recommended rules + TypeScript resolver
  {
    plugins: {
      ...importX.flatConfigs.recommended.plugins,
    },
    rules: {
      ...importX.flatConfigs.recommended.rules,
    },
    settings: {
      ...importX.flatConfigs.typescript.settings,
    },
  },
  // Custom rules: complexity, unused vars, import ordering
  {
    rules: {
      complexity: ["error", 15],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", ["sibling", "parent"], "type"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
    },
  },
  // Relative imports must use .ts specifiers: jiti resolves "./x.js" -> x.ts
  // through several failed attempts (about 12ms per import vs about 0.4ms).
  // esquery regex literals cannot contain "/", so match a leading "." and a
  // trailing ".js" as two chained attribute selectors.
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "ImportDeclaration",
          "ExportNamedDeclaration",
          "ExportAllDeclaration",
          "ImportExpression",
        ].map((node) => ({
          selector: `${node}[source.value=/^\\./][source.value=/\\.js$/]`,
          message: "Use .ts for relative specifiers (jiti resolution cost).",
        })),
      ],
    },
  },
  {
    ignores: ["**/node_modules/**", ".pi/**"],
  },
);
