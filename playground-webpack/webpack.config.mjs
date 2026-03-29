import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VueLoaderPlugin } from 'vue-loader'
import HtmlWebpackPlugin from 'html-webpack-plugin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default async (env, argv) => {
  const isDev = argv.mode === 'development'
  const plugins = [
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin({ template: './index.html' }),
  ]

  if (isDev) {
    const { AnnotaskWebpackPlugin } = await import('annotask/webpack')
    plugins.push(new AnnotaskWebpackPlugin())
  }

  return {
    entry: './src/main.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js', '.vue'],
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    module: {
      rules: [
        { test: /\.vue$/, loader: 'vue-loader' },
        { test: /\.ts$/, loader: 'ts-loader', options: { appendTsSuffixTo: [/\.vue$/], transpileOnly: true } },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      ],
    },
    plugins,
    devServer: {
      port: 8090,
      hot: true,
      historyApiFallback: true,
    },
  }
}
