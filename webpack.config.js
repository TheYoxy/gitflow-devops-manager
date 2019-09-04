const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  entry: ["@babel/polyfill", './src/main.ts'],
  devtool: 'inline-source-map',
  module: {
    rules: [
      {
        test: /\(?!spec\)\.ts$/,
        use: 'babel-loader',
        exclude: [/node_modules/, /src\/spec/]
      }, {
        test: /\.js$/,
        use: ["source-map-loader"],
        enforce: "pre"
      }
    ]
  },
  target: "node",
  externals: [
    'yargs',
    'listr',
    'nodegit',
    'config'
  ],
  resolve: {
    modules: ['node_modules'],
    extensions: ['.ts', '.js']
  },
  plugins: [new webpack.BannerPlugin({banner: "#!/usr/bin/env node", raw: true}),],
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist')
  },
  optimization: {
    minimizer: [new TerserPlugin({
      chunkFilter: (chunk) => chunk.name !== 'vendor',
      parallel: true,
    })]
  }
};
