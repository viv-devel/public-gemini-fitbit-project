
import globals from "globals";
import pluginJs from "@eslint/js";
import jest from "eslint-plugin-jest";

export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  pluginJs.configs.recommended,
  {
    ...jest.configs['flat/recommended'],
    files: ['**/*.test.js'],
    rules: {
        ...jest.configs['flat/recommended'].rules,
        'jest/no-commented-out-tests': 'off',
    }
  }
];
