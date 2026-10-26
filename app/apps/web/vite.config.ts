import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 开发模式：vite 提供页面，/trpc 转发到本地服务（scripts/dev.mjs 会同时启动两者并传入同一个令牌）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CAIWU_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/trpc': { target: `http://127.0.0.1:${process.env.CAIWU_SERVER_PORT ?? 3210}` } },
    fs: { allow: ['../..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
});
