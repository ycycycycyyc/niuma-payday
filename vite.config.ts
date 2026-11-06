import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { rolldownOptions: { input: { app: 'index.html', pet: 'pet.html' } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
