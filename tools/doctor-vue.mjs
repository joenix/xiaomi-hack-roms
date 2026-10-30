/**
 * 从当前项目实际加载 Vite 和 vite.config.js，验证 .vue 文件是否被 Vue 插件转换。
 * 运行：pnpm run doctor:vue
 */
import { resolve } from 'node:path';
import { cwd, exitCode } from 'node:process';

const configPath = resolve(cwd(), 'vite.config.js');
let server;
try {
  const { createServer } = await import('vite');
  const vue = await import('@vitejs/plugin-vue');
  if (typeof vue.default !== 'function') throw new Error('@vitejs/plugin-vue 的默认导出不可用');
  server = await createServer({
    configFile: configPath,
    server: { middlewareMode: true, hmr: false, watch: null },
    logLevel: 'error',
  });
  const pluginNames = server.config.plugins.map(plugin => plugin.name);
  console.log('Vite 配置：', server.config.configFile || configPath);
  console.log('Vue 插件：', pluginNames.filter(name => /vue/i.test(name)).join(', ') || '未找到');
  if (!pluginNames.includes('vite:vue')) {
    throw new Error('当前 Vite 配置未注册 vite:vue，请检查 vite.config.js 的 plugins: [vue(), ...]');
  }
  const result = await server.transformRequest('/src/App.vue');
  if (!result?.code || result.code.includes('<script setup>') || result.code.includes('<template>')) {
    throw new Error('App.vue 没有正确转换，检查是否由 Vue 插件处理');
  }
  console.log('✅ App.vue 已由 Vue 插件成功转换。Vite 配置和插件均正常。');
} catch (error) {
  console.error('❌ Vue 启动自检失败：', error?.stack || error);
  console.error('请在项目根目录执行 pnpm install，并确认当前项目使用的是解压包中的 vite.config.js。');
  process.exitCode = 1;
} finally {
  if (server) {
    try { await server.close(); } catch (error) { console.error('关闭检查服务器失败：', error?.message || error); }
  }
}
