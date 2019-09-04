const path = require('path');

module.exports = {
  presets: [
    "@babel/env",
    "@babel/typescript"
  ],
  plugins: [
    "@babel/proposal-class-properties",
    "@babel/proposal-object-rest-spread",
    "@babel/plugin-transform-runtime"
  ],
  sourceRoot: path.resolve('./src'),
  minified: false,
  only: [
    "**/*.ts"
  ]
};
