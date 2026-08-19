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
