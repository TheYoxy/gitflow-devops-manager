const path = require('path');

module.exports = {
  presets: [
    "@babel/preset-typescript",
    ["@babel/preset-env", {"modules": false}]
  ],
  plugins: [
    "@babel/proposal-class-properties",
    "@babel/proposal-object-rest-spread"
  ],

  sourceRoot: path.resolve('./src'),
  only: [
    "**/*.ts"
  ]
};
