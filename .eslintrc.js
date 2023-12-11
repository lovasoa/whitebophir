module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: "eslint:recommended",
  overrides: [
    {
      env: {
        node: true,
      },
      files: [".eslintrc.{js,cjs}"],
      parserOptions: {
        sourceType: "script",
      },
    },
  ],
  parserOptions: {
    ecmaVersion: "latest",
  },
  globals: {
    Tools: true,
  },
  rules: {
    "no-prototype-builtins": "off",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    semi: ["error", "always"],
    "no-cond-assign": ["error", "always"],
    curly: "error",
  },
};
