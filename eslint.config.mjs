import react from 'eslint-plugin-react';
import globals from 'globals';
import mochaPlugin from 'eslint-plugin-mocha';
import tseslint from 'typescript-eslint';

export default [
  {
    files: ["src/**/*.jsx"],
    ...react.configs.flat.recommended,
  },
  {
    files: ["server/*.js", "mavlink/*.js"],
    ...mochaPlugin.configs.recommended,
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
      },
      globals: {
        ...globals.node, ...globals.mocha
      },
    },
  },
  // typescript-eslint recommended, scoped to the backend .ts files only so the
  // TS parser/rules never apply to the still-JS tree during the migration.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["server/**/*.ts", "mavlink/**/*.ts"] })),
  {
    files: ["server/**/*.ts", "mavlink/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: {
        ...globals.node, ...globals.mocha
      },
    },
    rules: {
      // Loose to match the gradual tsconfig; tighten with the strictness roadmap.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },
  {
    ignores : [
      "node_modules/",
      "build/",
      "coverage/",
      "test-results/",
      "playwright-report/",
      "blob-report/",
      "**/*.d.ts",
    ],
  },
  {
    plugins: {
      react
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser, ...globals.node
      },
    },
    rules: {
      // ... any rules you want
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react/prop-types': 'off',
     },
    settings: {
      react: {
        version: "detect",
      },
    },
  }
];
