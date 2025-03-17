import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(async ({ mode }) => {
  // Log the environment and mode
  console.log(`Configuring Vite with mode: ${mode}`);
  
  // Use port 4002 to match our API server
  const apiProxyTarget = 'http://localhost:4002';
  console.log(`Configuring Vite with API proxy target: ${apiProxyTarget}`);
  
  return {
    plugins: [
      react(),
      runtimeErrorOverlay(),
      themePlugin(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
      },
    },
    root: path.resolve(__dirname, "client"),
    build: {
      outDir: path.resolve(__dirname, "dist"),
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "client/index.html"),
        },
        output: {
          manualChunks: {
            'vendor': [
              'react',
              'react-dom',
              'three',
              'three-csg-ts',
              'framer-motion',
              'zustand'
            ],
            'ui': [
              '@radix-ui/react-accordion',
              '@radix-ui/react-alert-dialog',
              '@radix-ui/react-avatar',
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-tabs',
              '@radix-ui/react-tooltip'
            ],
            'utils': [
              'axios',
              'date-fns',
              'zod',
              'clsx',
              'tailwind-merge'
            ]
          }
        }
      },
      chunkSizeWarningLimit: 1000,
      assetsDir: "assets"
    },
    server: {
      hmr: {
        protocol: 'ws',
        host: 'localhost',
      },
      watch: {
        usePolling: true,
        interval: 100,
      },
      // Configure proxy to forward API requests to the API server
      proxy: {
        // Handle API requests including those for Stripe and file uploads
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path: string) => path,
          configure: (proxy: any, _options: any) => {
            proxy.on('error', (err: any, _req: any, _res: any) => {
              console.log('proxy error', err);
            });
            proxy.on('proxyReq', (proxyReq: any, req: any, _res: any) => {
              console.log('Sending Request to the Target:', req.method, req.url);
            });
            proxy.on('proxyRes', (proxyRes: any, req: any, _res: any) => {
              console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
            });
          },
        },
        // Also proxy direct routes for Stripe checkout
        "/direct-checkout": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        // Proxy for pricing endpoints
        "/pricing": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
