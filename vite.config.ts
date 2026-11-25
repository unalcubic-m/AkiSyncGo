import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'offline-content-security-policy',
      apply: 'build',
      transformIndexHtml() {
        return [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: "default-src 'self'; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
          },
          injectTo: 'head-prepend',
        }];
      },
    },
  ],
});
