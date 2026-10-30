import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const doctor = readFileSync(new URL('../tools/doctor-vue.mjs', import.meta.url), 'utf8');
test('Vue 插件已被引入并注册，且声明依赖', () => {
  assert.match(viteConfig, /from ['"]@vitejs\/plugin-vue['"]/);
  assert.match(viteConfig, /plugins:\s*\[vue\(\)/);
  assert.ok(pkg.devDependencies['@vitejs/plugin-vue']);
});
test('Vite dev/build 显式指定配置文件', () => {
  assert.match(pkg.scripts.dev, /--config \.\/vite\.config\.js/);
  assert.match(pkg.scripts.build, /--config \.\/vite\.config\.js/);
});
test('doctor:vue 通过 Vite 实际转换 App.vue', () => {
  assert.equal(pkg.scripts['doctor:vue'], 'node tools/doctor-vue.mjs');
  assert.match(doctor, /createServer/);
  assert.match(doctor, /transformRequest\('\/src\/App\.vue'\)/);
});
