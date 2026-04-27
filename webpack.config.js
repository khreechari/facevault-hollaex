const path = require('path');

module.exports = {
  entry: path.resolve(__dirname, 'web/views/Main.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'facevault-kyc-view.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    react: {
      commonjs: 'react',
      commonjs2: 'react',
      root: 'React',
    },
    'react-dom': {
      commonjs: 'react-dom',
      commonjs2: 'react-dom',
      root: 'ReactDOM',
    },
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-react'],
          },
        },
      },
    ],
  },
  mode: 'production',
};
