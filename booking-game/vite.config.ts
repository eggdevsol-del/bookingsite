import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
// @ts-expect-error plain ESM module without types
import { createApi } from './server/api.mjs';

/** Mounts the same API the production server uses, so dev and prod behave alike. */
function api(): Plugin {
  const mount = async (server: { middlewares: { use: (fn: any) => void } }) => {
    const handler = await createApi();
    server.middlewares.use(async (req: any, res: any, next: () => void) => {
      if (!(await handler.handle(req, res))) next();
    });
  };
  return { name: 'ink-consult-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  // HTTPS=1 serves a self-signed certificate so phones on your Wi-Fi get
  // WebGPU, motion sensors and the service worker (all need a secure page).
  plugins: [process.env.HTTPS === '1' ? basicSsl() : null, api()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2500 },
});
