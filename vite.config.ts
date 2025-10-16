import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

export default defineConfig({
  optimizeDeps: {
    include: ['lucide-react']
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          resolve: {
            alias: {
              '@': resolve(__dirname, './src'),
              '@components': resolve(__dirname, './src/components'),
              '@hooks': resolve(__dirname, './src/hooks'),
              '@utils': resolve(__dirname, './src/utils'),
              '@styles': resolve(__dirname, './src/styles'),
              '@pages': resolve(__dirname, './src/pages'),
              '@contexts': resolve(__dirname, './src/contexts'),
            },
          },
          build: {
            outDir: 'dist/electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          resolve: {
            alias: {
              '@': resolve(__dirname, './src'),
              '@components': resolve(__dirname, './src/components'),
              '@hooks': resolve(__dirname, './src/hooks'),
              '@utils': resolve(__dirname, './src/utils'),
              '@styles': resolve(__dirname, './src/styles'),
              '@pages': resolve(__dirname, './src/pages'),
              '@contexts': resolve(__dirname, './src/contexts'),
            },
          },
          build: {
            outDir: 'dist/electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@components': resolve(__dirname, './src/components'),
      '@hooks': resolve(__dirname, './src/hooks'),
      '@utils': resolve(__dirname, './src/utils'),
      '@styles': resolve(__dirname, './src/styles'),
      '@pages': resolve(__dirname, './src/pages'),
      '@contexts': resolve(__dirname, './src/contexts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600, // Increase from 500kb to 600kb
    commonjsOptions: {
      include: [/lucide-react/, /node_modules/]
    },
    // Use esbuild minification (faster and already included)
    minify: 'esbuild',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
      },
      output: {
        // Manual chunk splitting for better caching and smaller bundles
        manualChunks: {
          // Core React libraries
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],

          // Heavy charting library
          'vendor-charts': ['recharts'],

          // Search functionality
          'vendor-search': ['fuse.js'],

          // UI libraries
          'vendor-ui': ['framer-motion', 'lucide-react', 'cmdk', '@radix-ui/react-dialog'],

          // Database
          'vendor-db': ['idb'],
        },
      },
    },
    // Use esbuild for CSS minification (Lightning CSS has issues with Tailwind escapes)
    cssMinify: 'esbuild',
  },
});
