// Lets the app import the shared @back40/core package from ../../packages/core.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../packages/core')];
config.resolver.extraNodeModules = {
  '@back40/core': path.resolve(__dirname, '../../packages/core/src'),
};
module.exports = config;
