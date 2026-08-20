import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'chrome-fx',
    description:
      'Injects an fx WASM agent on every page so you can chat with it and let it drive the browser.',
    permissions: [
      'storage',
      'unlimitedStorage',
      'tabs',
      'scripting',
      'offscreen',
      'cookies',
    ],
    host_permissions: ['<all_urls>'],
    // Chrome's default MV3 CSP is `script-src 'self'`, which blocks
    // WebAssembly.compile / instantiate. WXT only injects
    // 'wasm-unsafe-eval' during `pnpm dev`, so production builds must
    // declare it or the offscreen fx-term.wasm host fails to start.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    web_accessible_resources: [
      {
        resources: ['/panel.html', '/chunks/*', '/assets/*', '/wasm/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
  vite: () => ({
    optimizeDeps: {
      include: ['just-bash/browser', 'libfx/browser'],
    },
  }),
});
