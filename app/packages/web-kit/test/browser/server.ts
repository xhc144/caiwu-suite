import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4328, strictPort: true },
});
await server.listen();
