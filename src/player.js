/**
 * 小咪 Hack Roms 原生 EmulatorJS 播放器（独立 HTML 页面）。
 * 这里不创建自定义模拟器 UI，只负责数据校验、启动、错误提示。
 */
const base = import.meta.env.BASE_URL;
const rootUrl = new URL(base, location.origin);
const params = new URLSearchParams(location.search);
const status = document.querySelector('#status');
let emulatorReady = false;
let hasFailed = false;
let loadingTimer = null;
const log = (...args) => { if (params.get('debug') === '1') console.info('[Hack Roms]', ...args); };

function escapeHTML(input) {
  return String(input).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function setLoading(title, message) {
  if (hasFailed || emulatorReady) return;
  status.classList.remove('hidden');
  status.innerHTML = `<div class="message"><div class="spinner"></div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(message)}</p><div class="hint">首次加载模拟器核心可能需要联网，建议使用稳定网络。</div></div>`;
}
function errorView(title, message, detail = '') {
  if (emulatorReady) return;
  hasFailed = true;
  if (loadingTimer) clearTimeout(loadingTimer);
  document.title = `${title} · 小咪 Hack Roms`;
  status.classList.remove('hidden');
  status.innerHTML = `<div class="message"><div class="symbol">!</div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(message)}</p><div class="actions"><a href="${base}">← 返回游戏大厅</a><button type="button" id="retry">重新尝试</button></div>${detail ? `<div class="hint">${escapeHTML(detail)}</div>` : ''}</div>`;
  status.querySelector('#retry')?.addEventListener('click', () => location.reload());
  console.error('[Hack Roms]', title, message, detail);
}
function readBool(key, fallback = false) {
  const value = params.get(key);
  if (value === null) return fallback;
  return value === '1' || value === 'true';
}
function readVolume(value, fallback = 0.5) {
  if (value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}
function normalizeRomPath(filePath) {
  if (!filePath || typeof filePath !== 'string' || filePath.startsWith('/') || filePath.includes('\\')) {
    throw new Error('ROM 必须是站点内的相对路径，例如 roms/MD/example.bin');
  }
  const segments = filePath.split('/');
  if (segments.some(part => !part || part === '.' || part === '..')) throw new Error('ROM 路径不合法');
  const url = new URL(segments.map(encodeURIComponent).join('/'), rootUrl);
  if (url.origin !== location.origin || !url.pathname.startsWith(rootUrl.pathname)) {
    throw new Error('ROM 必须位于当前网站的资源目录内');
  }
  return url.href;
}
async function checkRom(url) {
  // HEAD 可以在不下载整个 PSP 镜像的情况下检查文件是否存在。
  let response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  if (response.status === 405 || response.status === 501) {
    response = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    // 即使服务器不支持 Range，也不要在启动前下载整个大型 ROM。
    await response.body?.cancel();
  }
  if (!response.ok) throw new Error(`ROM 地址响应 HTTP ${response.status}`);
  if (/text\/html/i.test(response.headers.get('content-type') || '')) {
    throw new Error('ROM 地址返回了 HTML（常见原因：路径配置错误或静态网站返回了首页）');
  }
  if (response.headers.get('content-length') === '0') throw new Error('ROM 文件为空');
  return response;
}
async function loadGames() {
  const response = await fetch(`${base}games.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`games.json 请求失败：HTTP ${response.status}`);
  const games = await response.json();
  if (!Array.isArray(games)) throw new Error('games.json 必须是数组');
  return games;
}
async function loadPlayerSettings() {
  const response = await fetch(`${base}player-config.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`播放器配置加载失败：HTTP ${response.status}，请执行 npm run roms:scan`);
  const settings = await response.json();
  if (!settings || typeof settings !== 'object' || !settings.controls) throw new Error('player-config.json 格式错误，请重新扫描');
  return settings;
}
function mergeControls(...layers) {
  const merged = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [player, buttons] of Object.entries(layer)) {
      if (!/^[0-3]$/.test(player) || !buttons || typeof buttons !== 'object') continue;
      for (const [button, mapping] of Object.entries(buttons)) {
        if (!/^(?:[0-9]|1[0-9]|2[0-9])$/.test(button) || !mapping || typeof mapping !== 'object') continue;
        if (!Object.hasOwn(merged, player)) merged[player] = {};
        merged[player][button] = { ...(merged[player][button] || {}), ...mapping };
      }
    }
  }
  return merged;
}
/**
 * 不把「增量映射」直接交给 EmulatorJS：一些已部署的版本会直接把它当成
 * 整份按键表，之后的 setupKeys() 会访问 controls[1][0] 而抛异常。
 * 以官方 RetroPad 默认映射为基底，补齐玩家 0~3 及玩家一号全部 30 个槽位。
 * 保留 value2（物理游戏手柄）的默认值，避免只配置键盘时破坏手柄。
 */
const EJS_DEFAULT_BUTTONS = {
  0: { value: 'x', value2: 'BUTTON_2' },
  1: { value: 's', value2: 'BUTTON_4' },
  2: { value: 'v', value2: 'SELECT' },
  3: { value: 'enter', value2: 'START' },
  4: { value: 'up arrow', value2: 'DPAD_UP' },
  5: { value: 'down arrow', value2: 'DPAD_DOWN' },
  6: { value: 'left arrow', value2: 'DPAD_LEFT' },
  7: { value: 'right arrow', value2: 'DPAD_RIGHT' },
  8: { value: 'z', value2: 'BUTTON_1' },
  9: { value: 'a', value2: 'BUTTON_3' },
  10: { value: 'q', value2: 'LEFT_TOP_SHOULDER' },
  11: { value: 'e', value2: 'RIGHT_TOP_SHOULDER' },
  12: { value: 'tab', value2: 'LEFT_BOTTOM_SHOULDER' },
  13: { value: 'r', value2: 'RIGHT_BOTTOM_SHOULDER' },
  14: { value: '', value2: 'LEFT_STICK' },
  15: { value: '', value2: 'RIGHT_STICK' },
  16: { value: 'h', value2: 'LEFT_STICK_X:+1' },
  17: { value: 'f', value2: 'LEFT_STICK_X:-1' },
  18: { value: 'g', value2: 'LEFT_STICK_Y:+1' },
  19: { value: 't', value2: 'LEFT_STICK_Y:-1' },
  20: { value: 'l', value2: 'RIGHT_STICK_X:+1' },
  21: { value: 'j', value2: 'RIGHT_STICK_X:-1' },
  22: { value: 'k', value2: 'RIGHT_STICK_Y:+1' },
  23: { value: 'i', value2: 'RIGHT_STICK_Y:-1' },
  24: { value: '1' },
  25: { value: '2' },
  26: { value: '3' },
  27: {},
  28: {},
  29: {},
};

function completeControls(overrides = {}) {
  const complete = { 0: {}, 1: {}, 2: {}, 3: {} };
  for (const [button, binding] of Object.entries(EJS_DEFAULT_BUTTONS)) {
    complete[0][button] = { ...binding };
  }
  for (const [player, buttons] of Object.entries(overrides)) {
    if (!/^[0-3]$/.test(player) || !buttons || typeof buttons !== 'object') continue;
    for (const [button, mapping] of Object.entries(buttons)) {
      if (!/^(?:[0-9]|1[0-9]|2[0-9])$/.test(button) || !mapping || typeof mapping !== 'object') continue;
      complete[player][button] = { ...(complete[player][button] || {}), ...mapping };
    }
  }
  return complete;
}

/**
 * 修复本域名、当前游戏以前保存的残缺按键对象。只补按键，不删除任何存档，
 * 也不修改已有的自定义映射、模拟器设置或作弊码。
 * EmulatorJS 的游戏状态和即时存档存储在独立的数据区域中。
 */
function repairStoredControls(gameId, gameName, desired = null, forceReset = false) {
  try {
    const store = window.localStorage;
    if (!store) return;
    const prefix = `ejs-${gameId}-`;
    const suffix = `-${gameName}-settings`;
    const keys = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(prefix) && key.endsWith(suffix)) keys.push(key);
    }
    for (const key of keys) {
      const data = JSON.parse(store.getItem(key));
      if (!data || typeof data !== 'object') continue;
      if (forceReset && desired) {
        // 只覆盖模拟器的按键配置，不清除存档、作弊码或画面设置。
        data.controlSettings = completeControls(desired);
        store.setItem(key, JSON.stringify(data));
        log('已按统一配置重置此游戏的键盘和摇杆映射', key);
        continue;
      }
      if (!data.controlSettings || typeof data.controlSettings !== 'object') continue;
      const controls = data.controlSettings;
      const baseline = completeControls();
      let changed = false;
      for (let player = 0; player < 4; player++) {
        if (!controls[player] || typeof controls[player] !== 'object') {
          controls[player] = {};
          changed = true;
        }
        if (player === 0) {
          for (const [button, mapping] of Object.entries(baseline[0])) {
            if (!controls[player][button] || typeof controls[player][button] !== 'object') {
              controls[player][button] = mapping;
              changed = true;
            }
          }
        }
      }
      if (changed) {
        store.setItem(key, JSON.stringify(data));
        log('已修复此游戏浏览器内不完整的旧按键配置', key);
      }
    }
  } catch (error) {
    log('旧按键配置检查跳过', error);
  }
}

function platformForGame(game) {
  if (game.platform) return game.platform;
  const names = { nes: 'FC', segaMD: 'MD', snes: 'SFC', gba: 'GBA', psp: 'PSP', ppsspp: 'PSP' };
  return names[game.core] || '';
}
async function getEmulatorDataPath() {
  // 如用户将官方 stable/data 放到 public/emulatorjs/data，则完全走本地资源。
  // 其余情况才使用官方 CDN，避免误用 Vite 的 HTML fallback 作为 loader.js。
  const local = `${base}emulatorjs/data/`;
  try {
    const res = await fetch(`${local}loader.js`, { method: 'HEAD', cache: 'no-cache' });
    if (res.ok && !/text\/html/i.test(res.headers.get('content-type') || '')) {
      log('使用本地 EmulatorJS', local);
      return local;
    }
  } catch (error) { log('未找到本地 EmulatorJS:', error); }
  log('使用官方 EmulatorJS CDN');
  return 'https://cdn.emulatorjs.org/stable/data/';
}
function loadEmulatorScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`无法下载 ${url}`));
    document.body.appendChild(script);
  });
}

async function start() {
  if (import.meta.env.MODE === 'pages') {
    return errorView('ROM 暂未上线', '当前网站仅展示游戏目录和封面，暂不提供在线游玩。');
  }
  try {
    const gameKey = params.get('game');
    let game;
    if (gameKey) {
      const games = await loadGames();
      game = games.find(item => item.id === gameKey);
      if (!game) return errorView('没有找到这个游戏', `games.json 中不存在「${gameKey}」，请重新扫描 ROM。`);
      if (game.placeholder) return errorView('这个封面只是演示', '项目里没有附带这个 ROM。请在 roms.config.json 指定自己的 ROM 目录，运行 npm run roms:scan 后再试。');
    } else {
      // 临时测试 ROM，不会保存进 JSON：?rom=roms/MD/test.bin&core=segaMD
      const rom = params.get('rom');
      const core = params.get('core');
      if (!rom || !core) return errorView('还没有选择游戏', '请从游戏大厅选择游戏，或提供 rom 和 core 参数。');
      game = { id: 'test', gameId: 999999, title: 'ROM 临时测试', rom, core };
    }
    // PSP 需要 SharedArrayBuffer。开发环境会在带 threads=1 的播放器文档上设置 COOP/COEP。
    // 即使是手工复制的 /play/?game=... 链接也能升级到正确的 URL。
    if (platformForGame(game) === 'PSP' && params.get('threads') !== '1') {
      const next = new URL(location.href);
      next.searchParams.set('threads', '1');
      location.replace(next.href);
      return;
    }
    if (platformForGame(game) === 'PSP' && window.crossOriginIsolated !== true) {
      return errorView('PSP 运行环境未就绪', 'PSP 需要浏览器支持跨源隔离 (SharedArrayBuffer)。请检查服务器为 /play/ 设置 COOP 与 COEP 响应头，或尝试在支持的桌面浏览器中运行。', '开发环境通过 ?threads=1 添加隔离头；生产环境参见 README 的 PSP 部署说明。');
    }
    const core = game.core;
    if (!core || !/^[a-z0-9_-]+$/i.test(core)) {
      return errorView('核心配置不正确', '请检查 games.json 的 core 字段。');
    }
    const romUrl = normalizeRomPath(game.rom);
    setLoading('正在检查 ROM 文件', game.title);
    try {
      await checkRom(romUrl);
    } catch (error) {
      return errorView('ROM 文件无法访问', '文件尚未放入指定目录，或者开发服务器没有正确读取到文件。请检查 roms.config.json、平台目录大小写，并执行 npm run doctor。', `${game.rom} · ${error.message}`);
    }
    log('ROM 可访问', romUrl);
    const [dataPath, playerSettings] = await Promise.all([getEmulatorDataPath(), loadPlayerSettings()]);
    if (platformForGame(game) === 'PSP' && dataPath.startsWith('https://')) {
      return errorView('PSP 核心需要本地资源', 'PSP 的跨源隔离会限制外部 CDN 脚本，请先把 EmulatorJS 官方 data 目录部署到 public/emulatorjs/data，再发布网站。');
    }
    document.title = `${game.title} · 小咪 Hack Roms`;
    window.EJS_player = '#game';
    window.EJS_core = core;
    // MD 必须使用六键手柄方案。不能用通用 RetroPad 显示名称判断实际 A/B/C/X/Y/Z。
    // EmulatorJS 官方支持 EJS_controlScheme；配置必须在 loader.js 之前指定。
    if (platformForGame(game) === 'MD') window.EJS_controlScheme = 'segaMD';
    if (platformForGame(game) === 'PSP') window.EJS_threads = true;
    window.EJS_gameUrl = romUrl;
    window.EJS_gameName = game.title;
    window.EJS_gameID = Number(game.gameId) || 999999;
    if (game.bios) {
      const biosUrl = normalizeRomPath(game.bios);
      try { await checkRom(biosUrl); }
      catch (error) { return errorView('BIOS 文件无法访问', '请检查 games.json 的 bios 字段以及 public/bios 下的文件。', error.message); }
      window.EJS_biosUrl = biosUrl;
    }
    window.EJS_pathtodata = dataPath;
    window.EJS_language = params.get('lang') || playerSettings.language || 'zh-CN';
    window.EJS_disableAutoLang = true;
    window.EJS_volume = readVolume(params.get('volume'), playerSettings.volume ?? 0.5);
    // 游戏大厅点击即开始游戏，不再依赖 Start；避免旧链接 autoplay=0 阻止启动。
    // 个别手机浏览器因媒体策略仍需首次触摸以解锁音频。
    window.EJS_startOnLoaded = true;
    window.EJS_fullscreenOnLoaded = readBool('fullscreen', playerSettings.fullscreen === true);
    // 默认将即时存档下载成 .state 文件，用户可在手机「文件」App 中保存和备份。
    // 浏览器里已保存的个性化设置可能覆盖默认选项；用户可在原生设置里选择。
    // 不设置 EJS_onSaveState / EJS_onSaveSave / EJS_onLoadState / EJS_onLoadSave，
    // 因为注册自定义回调会影响 EmulatorJS 原生的导出/导入行为。
    const stateTarget = playerSettings.saveStateLocation === 'browser' ? 'browser' : 'download';
    window.EJS_defaultOptions = { 'save-state-location': stateTarget };
    window.EJS_color = '#17cbb0';
    const controlConfig = playerSettings.controls || {};
    const gameSettings = Object.hasOwn(controlConfig.games || {}, game.id) ? controlConfig.games[game.id] : undefined;
    const configured = mergeControls(controlConfig.default, controlConfig.platforms?.[platformForGame(game)], gameSettings);
    // 仅在确实有自定义键位时覆写，并向各种 EmulatorJS 版本提供完整结构。
    if (Object.keys(configured).length) window.EJS_defaultControls = completeControls(configured);
    // 用户可在 URL 中使用 resetControls=1 显式应用最新预设到已有设置。
    // 默认不改写玩家此前自定义的键位，且始终不操作 SRAM/即时存档。
    repairStoredControls(window.EJS_gameID, game.title, configured, params.get('resetControls') === '1');
    log('按键预设', configured);
    // EmulatorJS 的官方 EJS_ready 回调才意味着 UI 已初始化；script.onload 不代表可以玩。
    window.EJS_ready = () => {
      log('EmulatorJS ready');
      emulatorReady = true;
      if (loadingTimer) clearTimeout(loadingTimer);
      status.classList.add('hidden');
    };
    window.EJS_onGameStart = () => log('游戏已开始运行');
    window.EJS_onExit = () => { location.href = base; };
    setLoading('正在加载 EmulatorJS', dataPath.startsWith('http') ? '首次运行需要连接官方 EmulatorJS CDN。' : '正在读取本地 EmulatorJS 资源。');
    loadingTimer = setTimeout(() => {
      if (!emulatorReady) errorView('模拟器初始化超时', 'ROM 已找到，但 EmulatorJS 没有成功初始化。可能是 CDN 被拦截、核心资源不可达或浏览器不兼容。建议打开浏览器 Console 查看错误；也可将 EmulatorJS 官方 data 目录部署在 public/emulatorjs/data。', `核心：${core} · 资源：${dataPath}`);
    }, 90000);
    await loadEmulatorScript(`${dataPath}loader.js`);
    log('loader.js 已加载，等待 EJS_ready');
    if (!emulatorReady) setLoading('正在初始化模拟器核心', `${game.title} · ${core}`);
  } catch (error) {
    errorView('游戏启动失败', error?.message || '发生未知错误。', '如果是模拟器资源无法下载，请检查当前网络能否访问 cdn.emulatorjs.org。');
  }
}
start();
