import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

const webDevPort = Number(process.env.WEB_DEV_PORT ?? '') || 5174;
// Never use 3000/8080 anywhere (reserved for the legacy Ruby stack).
const forbidden = new Set([3000, 8080]);
if (forbidden.has(webDevPort)) {
  throw new Error('WEB_DEV_PORT=3000/8080 is reserved; pick another port');
}

const serverOrigin = `http://localhost:${process.env.PORT ?? 4300}`;

export default defineConfig({
  root: '.',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        builder: path.resolve(__dirname, 'builder.html'),
        form: path.resolve(__dirname, 'form.html'),
      },
      output: {
        // Deterministic CSS name so Express/Nunjucks can link /assets/web.css.
        assetFileNames(info) {
          const name = info.names?.[0] ?? '';
          return name.endsWith('.css') ? 'web.css' : 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    port: webDevPort,
    strictPort: true,
    proxy: {
      '/api': serverOrigin,
      '/sign_in': serverOrigin,
      '/sign_out': serverOrigin,
      '/passwords': serverOrigin,
      '/templates': serverOrigin,
      '/submissions': serverOrigin,
      '/webhook_urls': serverOrigin,
      '/attachments': serverOrigin,
    },
  },
});
