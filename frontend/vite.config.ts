import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Pre-bundle heavy deps so dev-server startup + page navigation are snappier
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router',
      '@reduxjs/toolkit',
      'react-redux',
      'axios',
      'socket.io-client',
      'framer-motion',
    ],
  },
  esbuild: {
    // Strip console + debugger in production builds for smaller, faster bundles
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    legalComments: 'none',
    target: 'es2020',
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: false,
    minify: 'esbuild',
    // Inline assets smaller than 4 KB as base64 to save round-trips
    assetsInlineLimit: 4096,
    modulePreload: {
      // Inject polyfill for browsers that don't support <link rel=modulepreload>
      polyfill: true,
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core React runtime — always first to load
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router/')) {
            return 'vendor-react';
          }
          // State management
          if (id.includes('node_modules/@reduxjs/') || id.includes('node_modules/react-redux/') || id.includes('node_modules/immer/')) {
            return 'vendor-redux';
          }
          // Animation library — large, only needed on animated pages
          if (id.includes('node_modules/framer-motion/')) {
            return 'vendor-motion';
          }
          // Network & realtime
          if (id.includes('node_modules/axios/') || id.includes('node_modules/socket.io-client/') || id.includes('node_modules/engine.io-client/')) {
            return 'vendor-network';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['producteevpro.up.railway.app'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
