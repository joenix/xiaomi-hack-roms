import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { externalRomsPlugin } from './tools/serve-roms.mjs';


/**
 * PSP 线程模式所需隔离响应头。
 * Vite 7 的 configureServer 函数不能隐式返回 connect.use() 的返回值，
 * 否则 Vite 会把 Connect app 当作后置回调执行，引发 req/res 为 undefined。
 */
function pspIsolation() {
  const useHeaders = (server) => {
    server.middlewares.use((req, res, next) => {
      const request = new URL(req.url || '/', 'http://localhost');
      if (['/play/', '/play/index.html'].includes(request.pathname) && request.searchParams.get('threads') === '1') {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      }
      next();
    });
    // 特意不 return server.middlewares.use()：避免 Vite 7 将其视为启动后钩子。
  };
  return { name: 'psp-isolation', configureServer: useHeaders, configurePreviewServer: useHeaders };
}

export default defineConfig({
  plugins: [vue(), externalRomsPlugin(), pspIsolation()],
  // 默认部署在域名根目录；如部署到子路径，在此处修改 base 即可。
  base: '/',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        play: resolve(import.meta.dirname, 'play/index.html'),
      },
    },
  },
});
