// esbuild config for bundling the VS Code extension
const esbuild = require('esbuild');
const glob = require('glob');
const path = require('path');

const extensionConfig = {
  bundle: true,
  external: ['vscode', 'electron', '@sentry-prompt/core'],
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
  outfile: 'dist/extension.js',
  entryPoints: ['src/extension.ts'],
  banner: {
    js: '#!/usr/bin/env node',
  },
};

// Build the extension
esbuild
  .build({
    ...extensionConfig,
    minify: process.env.NODE_ENV === 'production',
  })
  .then(() => {
    console.log('✅ Extension bundled successfully');
  })
  .catch((err) => {
    console.error('❌ Extension build failed:', err);
    process.exit(1);
  });
