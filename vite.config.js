import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import eslint from 'vite-plugin-eslint';

export default defineConfig({
    plugins: [
        react(),
        eslint(),
    ],
    build: {
        outDir: 'build',
    },
    test: {
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{js,jsx}'],
            exclude: ['src/**/*.test.{js,jsx}'],
            reporter: ['text', 'text-summary'],
            // Coverage ratchet (see docs/TESTING.md): thresholds track the
            // highest coverage achieved and may only be raised. Target: 100.
            thresholds: {
                statements: 100,
                branches: 100,
                functions: 100,
                lines: 100,
            },
        },
    },
    server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
                secure: false
            },
            '/socket.io': {
                target: 'http://localhost:3001',
                changeOrigin: true,
                ws: true,
                secure: false
            }
        }
    },
    base: '/'
});
