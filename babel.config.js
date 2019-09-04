const path = require('path');

module.exports = {
  presets: [
    "@babel/env",
    "@babel/typescript"
  ],
  plugins: [
    "@babel/proposal-class-properties",
    "@babel/proposal-object-rest-spread"
  ],
  sourceRoot: path.resolve('./src'),
  minified: true,
  only: [
    "**/*.ts"
  ]
};
