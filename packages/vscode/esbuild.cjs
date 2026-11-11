// esbuild config for bundling the VS Code extension and webview
const esbuild = require('esbuild');
const path = require('path');

// ── Extension bundle ──────────────────────────────────────────────────────────
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

// ── Webview bridge bundle (ESM, browser) ─────────────────────────────────────
const bridgeConfig = {
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
  outfile: 'dist/webview-bridge.js',
  entryPoints: ['src/webview-bridge.ts'],
  banner: {
    js: '// PromptSentry Webview Bridge',
  },
};

// ── Webview app bundle (ESM, browser, React) ─────────────────────────────────
const appConfig = {
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
  outfile: 'dist/webview-app.js',
  entryPoints: ['src/webview-app.tsx'],
  banner: {
    js: '// PromptSentry Webview App',
  },
  jsx: 'transform',
  jsxImportSource: 'react',
  alias: {
    '@sentry-prompt/core': path.resolve(__dirname, '../core/src/index.ts'),
  },
};

async function build() {
  const env = process.env.NODE_ENV || 'development';
  const minify = env === 'production';

  try {
    // Build extension
    await esbuild.build({ ...extensionConfig, minify });
    console.log('✅ Extension bundled successfully');

    // Build webview bridge
    await esbuild.build({ ...bridgeConfig, minify });
    console.log('✅ Webview bridge bundled successfully');

    // Build webview app
    await esbuild.build({ ...appConfig, minify });
    console.log('✅ Webview app bundled successfully');

    console.log('🎉 All bundles complete');
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
}

build();
