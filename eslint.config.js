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
  {
    ignores: ["**/node_modules/**"],
  },
);
