import { defineConfig } from 'vite';
import { sites } from '@openai/sites-vite-plugin';

export default defineConfig({
    plugins: [sites()],
    build: {
        target: 'es2022',
        sourcemap: false,
    },
    server: {
        host: '127.0.0.1',
        port: 8080,
        strictPort: true,
    },
});
