import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../src/player.js', import.meta.url), 'utf8'))
  .replace('import.meta.env.BASE_URL', JSON.stringify('/'))
  .replace('import.meta.env.MODE', 'TEST_MODE');
function fixture({ mode = 'test', search, games = [], romExists = true, loaderOkay = true, loaderReady = true, playerSettings, savedEntries = {}, isolated = true } = {}) {
  const classes = new Set();
  let content = '';
  const calls = [];
  const status = {
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    set innerHTML(v) { content = v; },
    get innerHTML() { return content; },
    querySelector: () => ({ addEventListener() {} }),
  };
  const saved = new Map(Object.entries(savedEntries));
  const window = { crossOriginIsolated: isolated, localStorage: {
    get length() { return saved.size; },
    key: i => [...saved.keys()][i] ?? null,
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  } };
  const doc = {
    title: '',
    querySelector: () => status,
    createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
    body: { appendChild(script) {
      calls.push(`script:${script.src}`);
      queueMicrotask(() => {
        if (!loaderOkay) script.onerror?.();
        else {
          script.onload?.();
          if (loaderReady) queueMicrotask(() => window.EJS_ready?.());
        }
      });
    } },
  };
  const ctx = {
    window, document: doc,
    location: { origin: 'https://test.local', search: search || '', href: 'https://test.local/play/' },
    URL, URLSearchParams, Number, String, Array, Promise, console,
    setTimeout, clearTimeout, queueMicrotask,
    fetch: async (url, options = {}) => {
      calls.push(`${options.method || 'GET'}:${url}`);
      if (url.endsWith('games.json')) return { ok: true, json: async () => games };
      if (url.endsWith('player-config.json')) return { ok: true, json: async () => playerSettings || {language:'zh-CN',volume:0.5,autoplay:false,fullscreen:false,controls:{default:{},platforms:{},games:{}}} };
      if (url.includes('emulatorjs/data/loader.js')) return { ok: true, headers: { get: () => search?.includes('threads=1') ? 'application/javascript' : 'text/html' } };
      if (url.includes('/roms/')) return {
        ok: romExists, status: romExists ? 200 : 404,
        headers: { get: key => key === 'content-type' ? 'application/octet-stream' : '1024' },
      };
      throw Error('unexpected fetch ' + url);
    },
  };
  runInNewContext(source, { ...ctx, TEST_MODE: mode });
  return { classes, status, calls, window, saved };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const live = { id: 'test-id', title: '测试 MD', rom: 'roms/MD/中文 文件.bin', core: 'segaMD', gameId: 23 };
test('演示数据没有 ROM 时直接告知，而不是打开一个假播放器', async () => {
  const x = fixture({ search: '?game=preview', games: [{...live,id:'preview',placeholder:true}] });
  await sleep(10);
  assert.match(x.status.innerHTML, /只是演示/);
  assert.equal(x.calls.some(s => s.startsWith('script:')), false);
});
test('缺失 ROM 会显示可操作的配置提示与路径', async () => {
  const x = fixture({ search: '?game=test-id', games: [live], romExists: false });
  await sleep(10);
  assert.match(x.status.innerHTML, /ROM 文件无法访问/);
  assert.match(x.status.innerHTML, /npm run doctor/);
  assert.equal(x.calls.some(s => s.startsWith('script:')), false);
});
test('只有 EJS_ready 触发后才隐藏遮罩，并正确编码中文 URL', async () => {
  const x = fixture({ search: '?game=test-id&volume=0.7&autoplay=1', games: [live] });
  await sleep(25);
  assert.equal(x.status.classList.contains('hidden'), true);
  assert.match(x.window.EJS_gameUrl, /%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.bin/);
  assert.equal(x.window.EJS_core, 'segaMD');
  assert.equal(x.window.EJS_gameID, 23);
  assert.equal(x.window.EJS_startOnLoaded, true);
  assert.equal(x.window.EJS_volume, 0.7);
  assert.equal(x.window.EJS_defaultOptions['save-state-location'], 'download');
});
test('loader.js 无法下载时显示错误并提供重试', async () => {
  const x = fixture({ search: '?game=test-id', games: [live], loaderOkay: false });
  await sleep(15);
  assert.match(x.status.innerHTML, /游戏启动失败/);
  assert.match(x.status.innerHTML, /重新尝试/);
  assert.equal(x.status.classList.contains('hidden'), false);
});
test('loader.js 已下载，但未收到 EJS_ready 时加载提示仍然可见', async () => {
  const x = fixture({ search: '?game=test-id', games: [live], loaderReady: false });
  await sleep(15);
  assert.match(x.status.innerHTML, /正在初始化模拟器核心/);
  assert.equal(x.status.classList.contains('hidden'), false);
  // 清掉测试产生的 90 秒看门狗，避免阻止 Node 测试进程退出。
  x.window.EJS_ready();
});

test('根目录统一配置：通用、平台、游戏键位依次覆盖，保留手柄值', async () => {
  const playerSettings = {
    language: 'ja-JP', volume: 0.25, autoplay: true, fullscreen: false,
    controls: {
      default: { '0': { '3': { value: 'enter', value2: 'START' }, '0': { value: 'x', value2: 'BUTTON_2' } } },
      platforms: { MD: { '0': { '0': { value: 'z' } } } },
      games: { 'test-id': { '0': { '0': { value: 'c' } } } }
    }
  };
  const x = fixture({ search: '?game=test-id&volume=0.9&autoplay=0', games: [{...live, platform:'MD'}], playerSettings });
  await sleep(25);
  assert.equal(x.window.EJS_language, 'ja-JP');
  assert.equal(x.window.EJS_volume, 0.9, 'URL 音量优先');
  assert.equal(x.window.EJS_startOnLoaded, true, '打开 /play 必须直接开始，旧的 autoplay=0 不再生效');
  assert.equal(x.window.EJS_defaultControls[0][0].value, 'c');
  assert.equal(x.window.EJS_defaultControls[0][0].value2, 'BUTTON_2', '平台/游戏覆盖键盘时不删除手柄映射');
  assert.equal(x.window.EJS_defaultControls[0][3].value, 'enter');
});

test('按键映射必须包含完整的四名玩家结构，不触发 EmulatorJS setupKeys 的 undefined[0]', async () => {
  const playerSettings = {
    controls: {
      default: { '0': { '3': { value: 'enter' } } },
      platforms: { MD: { '0': { '0': { value: 'z' } } }, 'FC': {} },
      games: {}
    }
  };
  const x = fixture({ search: '?game=test-id', games: [{...live, platform: 'MD'}], playerSettings });
  await sleep(25);
  const controls = x.window.EJS_defaultControls;
  for (let player = 0; player < 4; player++) {
    for (let button = 0; button < 30; button++) {
      // EmulatorJS data/src/emulator.js setupKeys 用的就是这个索引方式。
      assert.doesNotThrow(() => { void controls[player][button]; });
    }
  }
  assert.equal(Object.keys(controls[0]).length, 30);
  assert.equal(controls[0][0].value, 'z');
  assert.equal(controls[0][0].value2, 'BUTTON_2', '键盘覆盖不能抹去手柄配置');
  assert.deepEqual(Object.keys(controls).sort(), ['0', '1', '2', '3']);
});

test('自动补齐此游戏旧 localStorage 键位，保留原有设置和用户按键', async () => {
  const key = 'ejs-23-segaMD-测试 MD-settings';
  const original = {
    controlSettings: { '0': { '0': { value: 67, value2: 'BUTTON_1' } } },
    settings: { shader: 'disabled' }, cheats: [{ desc: '自定义' }]
  };
  const x = fixture({
    search: '?game=test-id', games: [live],
    playerSettings: { controls: { default: {}, platforms: {}, games: {} } },
    savedEntries: { [key]: JSON.stringify(original) }
  });
  await sleep(25);
  const repaired = JSON.parse(x.saved.get(key));
  assert.equal(repaired.controlSettings[0][0].value, 67, '已有用户按键不能被覆盖');
  assert.equal(repaired.controlSettings[0][1].value, 's', '缺少的按键补上默认值');
  for (let i = 0; i < 4; i++) assert.equal(typeof repaired.controlSettings[i], 'object');
  assert.deepEqual(repaired.settings, original.settings);
  assert.deepEqual(repaired.cheats, original.cheats);
  assert.equal(x.window.EJS_defaultControls, undefined, '不配置自定义映射时完全保留 EmulatorJS 原生映射');
});


test('MD 正确启用 segaMD 六键方案；A/B/C/X/Y/Z 不按通用键名误判', async () => {
  const all = JSON.parse(await readFile(new URL('../roms.config.json', import.meta.url), 'utf8'));
  const playerSettings = all.player;
  const x = fixture({ search: '?game=test-id', games: [{...live, platform:'MD'}], playerSettings });
  await sleep(25);
  assert.equal(x.window.EJS_controlScheme, 'segaMD');
  assert.equal(x.window.EJS_core, 'segaMD');
  const mapping = { 1:'j', 0:'k', 8:'l', 10:'u', 9:'i', 11:'o', 3:'b', 4:'w', 5:'s', 6:'a', 7:'d', 24:'1', 25:'2', 26:'3', 27:'5', 28:'8', 29:'6' };
  for (const [index, keyboard] of Object.entries(mapping)) {
    assert.equal(x.window.EJS_defaultControls[0][index].value, keyboard, `MD button index ${index}`);
  }
  const fc = fixture({ search: '?game=test-id', games: [{...live, platform:'FC', core:'nes'}], playerSettings });
  await sleep(25);
  assert.equal(fc.window.EJS_controlScheme, undefined, '非 MD 不应强制使用 MD 布局');
});

test('MD 玩家一摇杆键盘与摇杆手柄映射均为空，避免 I/J/K/L 冲突', async () => {
  const config = JSON.parse(await readFile(new URL('../roms.config.json', import.meta.url), 'utf8'));
  const x = fixture({ search: '?game=test-id', games: [{ ...live, platform: 'MD' }], playerSettings: config.player });
  await sleep(25);
  const mapped = x.window.EJS_defaultControls[0];
  for (let n = 14; n <= 23; n++) {
    assert.equal(mapped[n].value, '', `analog ${n} keyboard`);
    assert.equal(mapped[n].value2, '', `analog ${n} gamepad`);
  }
  for (const n of [2, 12, 13]) assert.equal(mapped[n].value, '');
});

test('resetControls=1 只对已保存的控制设置应用新预设，不破坏存档和其他设置', async () => {
  const config = JSON.parse(await readFile(new URL('../roms.config.json', import.meta.url), 'utf8'));
  const key = 'ejs-23-segaMD-测试 MD-settings';
  const original = {
    controlSettings: { '0': { '0': { value: 'x' }, '20': { value: 'l' } } },
    settings: { shader: 'crt' }, saveMeta: { lastSlot: 3 }
  };
  const x = fixture({
    search: '?game=test-id&resetControls=1', games: [{ ...live, platform:'MD' }],
    playerSettings: config.player, savedEntries: { [key]: JSON.stringify(original) }
  });
  await sleep(25);
  const updated = JSON.parse(x.saved.get(key));
  assert.equal(updated.controlSettings[0][0].value, 'k');
  assert.equal(updated.controlSettings[0][20].value, '');
  assert.equal(updated.controlSettings[0][24].value, '1');
  assert.deepEqual(updated.settings, original.settings);
  assert.deepEqual(updated.saveMeta, original.saveMeta);
});

test('v0.7 五个平台使用统一方向、START 和快捷键；摇杆键位均清空', async () => {
  const all = JSON.parse(await readFile(new URL('../roms.config.json', import.meta.url), 'utf8'));
  const shared = { 3:'b', 4:'w', 5:'s', 6:'a', 7:'d', 24:'1', 25:'2', 26:'3', 27:'5', 28:'8', 29:'6' };
  const cases = {
    FC: { core:'nes', keys:{8:'j', 0:'k', 1:'', 9:'', 10:'', 11:''} },
    MD: { core:'segaMD', keys:{1:'j', 0:'k', 8:'l', 10:'u', 9:'i', 11:'o'} },
    SFC:{ core:'snes', keys:{8:'j', 0:'k', 11:'l', 9:'u', 1:'i', 10:'o'} },
    GBA:{ core:'gba', keys:{8:'j', 0:'k', 11:'l', 10:'u', 1:'', 9:''} },
    PSP:{ core:'psp', keys:{8:'j',0:'k',1:'u',9:'i',10:'o',11:'l',12:'',13:''} },
  };
  for (const [platform, expected] of Object.entries(cases)) {
    const x = fixture({ search:platform==='PSP'?'?game=test-id&threads=1':'?game=test-id', games:[{...live, platform,core:expected.core}], playerSettings:all.player });
    await sleep(15);
    const keys = x.window.EJS_defaultControls?.[0];
    assert.ok(keys, `${platform} keys`);
    for (const [n,v] of Object.entries({...shared, ...expected.keys})) {
      assert.equal(keys[n]?.value, v, `${platform} button ${n}`);
    }
    for(let n=14;n<=23;n++){
      assert.equal(keys[n]?.value,'', `${platform} analog ${n} keyboard`);
      assert.equal(keys[n]?.value2,'', `${platform} analog ${n} physical controller`);
    }
    assert.equal(keys[2].value,'', `${platform} SELECT keyboard unbound`);
    if (platform==='MD') assert.equal(x.window.EJS_controlScheme, 'segaMD');
    if (platform==='PSP') { assert.equal(x.window.EJS_threads, true); assert.equal(x.window.EJS_core, 'psp'); }
  }
});


test('打开游戏不需要再点击 Start：即使未提供 autoplay 且默认配置为 false 也直接运行', async () => {
  const x = fixture({ search: '?game=test-id', games: [live] });
  await sleep(25);
  assert.equal(x.window.EJS_startOnLoaded, true);
  assert.equal(x.window.EJS_defaultOptions['save-state-location'], 'download');
});

test('手机独立保管存档：公开配置可选择下载或浏览器，原生下载导入回调不被拦截', async () => {
  const config = JSON.parse(await readFile(new URL('../roms.config.json', import.meta.url), 'utf8'));
  const x = fixture({ search: '?game=test-id', games: [live], playerSettings: config.player });
  await sleep(25);
  assert.equal(x.window.EJS_defaultOptions['save-state-location'], 'download');
  for (const key of ['EJS_onSaveState', 'EJS_onLoadState', 'EJS_onSaveSave', 'EJS_onLoadSave']) {
    assert.equal(x.window[key], undefined, `${key} must remain undefined to preserve EmulatorJS native handler`);
  }
  const y = fixture({ search: '?game=test-id', games: [live], playerSettings: {...config.player, saveStateLocation: 'browser'} });
  await sleep(25);
  assert.equal(y.window.EJS_defaultOptions['save-state-location'], 'browser');
});


test('PSP 缺少跨源隔离时给出正确错误，不盲目尝试下载镜像或核心', async () => {
  const psp = { ...live, platform:'PSP', core:'psp', rom:'roms/PSP/game.iso' };
  const x = fixture({search:'?game=test-id&threads=1', games:[psp], isolated:false});
  await sleep(12);
  assert.match(x.status.innerHTML, /跨源隔离/);
  assert.equal(x.calls.some(s => s.startsWith('script:')), false);
  assert.equal(x.window.EJS_threads, undefined);
});


test('Pages 展示版直接提示未上线，不请求目录、ROM 或模拟器核心', async () => {
  const x = fixture({ mode: 'pages', search: '?game=test-id', games: [live] });
  await sleep(10);
  assert.match(x.status.innerHTML, /ROM 暂未上线/);
  assert.deepEqual(x.calls, []);
});
