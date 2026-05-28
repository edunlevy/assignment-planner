module.exports = function (api) {
  // api.cache(true) sets a "forever" strategy and must be the only cache call.
  // We read NODE_ENV directly from process.env instead of using api.env(),
  // which would internally call api.cache.using() and conflict.
  api.cache(true);
  const isTest = process.env.NODE_ENV === 'test';

  if (isTest) {
    // Lean test config for Jest:
    // - NativeWind excluded (its Babel plugin starts a CSS watcher that hangs Jest)
    // - react-native is fully mocked in jest.setup.js so its source is never
    //   transformed; transformIgnorePatterns excludes all of node_modules
    // - Only the project's own source files are transformed by babel-preset-expo
    return {
      presets: [
        ['babel-preset-expo', { jsxImportSource: 'react' }],
      ],
    };
  }

  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
