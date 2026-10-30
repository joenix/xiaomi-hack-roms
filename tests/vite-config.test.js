import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// 把 vite.config.js 的三条 import 替换为测试替身，不要求 npm 依赖已安装。
const content = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const prepared = content
  .replace(/^import .*;\s*$/gm, '')
  .replace('export default defineConfig(', 'globalThis.actualConfig = defineConfig(')
  .replaceAll('import.meta.dirname', '"/tmp/fake-project"');
const sandbox = {
  defineConfig: v => v,
  URL,
  vue: () => ({ name: 'fake-vue' }),
  resolve: (...a) => a.join('/'),
  externalRomsPlugin: () => ({ name: 'fake-external-roms' }),
};
runInNewContext(prepared, sandbox);
const plugin = sandbox.actualConfig.plugins.find(p => p.name === 'psp-isolation');
assert.ok(plugin, 'PSP 插件必须被注册');

function fakeServer() {
  const handlers = [];
  function connectApp() {}
  return { handlers, middlewares: { use(handler) { handlers.push(handler); return connectApp; } } };
}

for (const hook of ['configureServer', 'configurePreviewServer']) {
  test(`${hook} 不意外返回 Connect app`, () => {
    const server = fakeServer();
    assert.equal(plugin[hook](server), undefined);
    assert.equal(server.handlers.length, 1);
  });
}

test('PSP 线程模式仅对播放器响应设置跨源隔离响应头', () => {
  const server = fakeServer();
  plugin.configureServer(server);
  const middleware = server.handlers[0];
  for (const [url, isolated] of [
    ['/play/?threads=1', true],
    ['/play/index.html?threads=1', true],
    ['/play/?threads=0', false],
    ['/?threads=1', false],
  ]) {
    const headers = {};
    let nextCalled = false;
    middleware({ url }, { setHeader(key, value) { headers[key] = value; } }, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(Boolean(headers['Cross-Origin-Opener-Policy']), isolated, url);
    assert.equal(Boolean(headers['Cross-Origin-Embedder-Policy']), isolated, url);
  }
});
