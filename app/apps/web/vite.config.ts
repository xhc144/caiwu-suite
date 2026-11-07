import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 开发模式：vite 提供页面，/trpc 转发到本地服务（scripts/dev.mjs 会同时启动两者并传入同一个令牌）。
export default defineConfig({
  plugins: [react()],
  server: {
    // 与本地服务一致只监听 IPv4 回环；默认的 localhost 在部分 Windows 上解析为 ::1，而 ::1 可能被安全软件拦截。
    host: '127.0.0.1',
    port: Number(process.env.CAIWU_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/trpc': { target: `http://127.0.0.1:${process.env.CAIWU_SERVER_PORT ?? 3210}` } },
    fs: { allow: ['../..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
});
