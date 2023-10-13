const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");
const { VueLoaderPlugin } = require("vue-loader");

module.exports = [
  {
    // Configuration for Electron
    entry: "./electron/src/index.ts",
    target: "electron-main",
    module: {
      rules: [
        {
          test: /\.ts$/,
          include: /electron/,
          use: [{ loader: "ts-loader" }],
        },
      ],
    },
    output: {
      path: path.join(__dirname, "./dist"),
      filename: "index.js",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
  },
  {
    // Configuration for Vue
    entry: {
      "app-launcher": "./vue/src/components/app-launcher/index.ts",
    },
    target: "electron-renderer",
    node: {
      // Enable Node.js modules
      __dirname: false,
      __filename: false,
      global: true,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          include: /vue/,
          use: [
            {
              loader: "ts-loader",
              options: {
                appendTsSuffixTo: [/\.vue$/],
              },
            },
          ],
        },
        {
          test: /\.vue$/,
          loader: "vue-loader",
        },
        {
          test: /\.scss$/,
          use: ["style-loader", "css-loader", "sass-loader"],
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader"],
        },
      ],
    },
    plugins: [
      new VueLoaderPlugin(),
      new HtmlWebpackPlugin({
        filename: "app-launcher.html",
        template: "./vue/public/index.html",
        chunks: ["app-launcher"],
      }),
      new webpack.DefinePlugin({
        BASE_URL: JSON.stringify("./"),
      }),
    ],
    output: {
      path: path.join(__dirname, "./dist/vue"),
      filename: "[name].js",
    },
    resolve: {
      extensions: [".ts", ".js", ".vue"],
    },
  },
];
