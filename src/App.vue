<script setup>
import { computed, onMounted, ref, watch } from 'vue';

const base = import.meta.env.BASE_URL;
const catalogOnly = import.meta.env.MODE === 'pages';
const query = new URLSearchParams(location.search);
const platforms = [
  { id: 'all', name: '全部平台', sub: 'ALL' },
  { id: 'FC', name: 'FC', sub: 'FAMICOM' },
  { id: 'MD', name: 'MD', sub: 'MEGA DRIVE' },
  { id: 'SFC', name: 'SFC', sub: 'SUPER FAMICOM' },
  { id: 'GBA', name: 'GBA', sub: 'GAME BOY ADVANCE' },
  { id: 'PSP', name: 'PSP', sub: 'PLAYSTATION PORTABLE' },
];
const supportedPlatforms = new Set(platforms.slice(1).map(p => p.id));
const games = ref([]);
const failedCovers = ref(new Set());
const loading = ref(true);
const loadError = ref('');
const search = ref(query.get('q') || '');
const platform = ref(supportedPlatforms.has(query.get('platform')) ? query.get('platform') : 'all');
const format = ref(query.get('format') || 'all');
const folder = ref(query.get('folder') || 'all');
const sort = ref(['name', 'name-desc', 'size-desc', 'size-asc', 'modified'].includes(query.get('sort')) ? query.get('sort') : 'name');

function unique(field) {
  return [...new Set(games.value.map(g => g[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}
const fileFormats = computed(() => unique('format'));
const folders = computed(() => unique('folder'));
const matchingGames = computed(() => {
  const q = search.value.trim().toLocaleLowerCase();
  return games.value.filter(game => {
    if (platform.value !== 'all' && game.platform !== platform.value) return false;
    if (format.value !== 'all' && game.format !== format.value) return false;
    if (folder.value !== 'all' && game.folder !== folder.value) return false;
    if (q) {
      const searchable = [game.title, game.subtitle, game.sourceName, game.rom, game.platform].filter(Boolean).join(' ').toLocaleLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const name = () => a.title.localeCompare(b.title, 'zh-CN', { numeric: true });
    if (sort.value === 'name-desc') return -name();
    if (sort.value === 'size-desc') return (b.sizeBytes || 0) - (a.sizeBytes || 0) || name();
    if (sort.value === 'size-asc') return (a.sizeBytes || 0) - (b.sizeBytes || 0) || name();
    if (sort.value === 'modified') return String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')) || name();
    return name();
  });
});
const filtered = computed(() => search.value.trim() || platform.value !== 'all' || format.value !== 'all' || folder.value !== 'all' || sort.value !== 'name');
function clearFilters() { search.value = ''; platform.value = 'all'; format.value = 'all'; folder.value = 'all'; sort.value = 'name'; }
function countFor(id) { return id === 'all' ? games.value.length : games.value.filter(game => game.platform === id).length; }
function fileUrl(relative) { return `${base}${String(relative).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`; }
function playUrl(game) { return `${base}play/?game=${encodeURIComponent(game.id)}${game.platform === 'PSP' ? '&threads=1' : ''}`; }
function shortName(title) { return String(title || 'ROM').slice(0, 2); }
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '大小未知';
  const mb = bytes / 1048576;
  return mb < 1 ? `${Math.round(bytes / 1024)} KB` : mb < 1024 ? `${mb.toFixed(mb < 10 ? 1 : 0)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}
function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function markFailedCover(gameId) {
  // Cover 图加载失败时改为占位卡，不留破图；也不显示背景文字透过透明留白。
  failedCovers.value = new Set([...failedCovers.value, gameId]);
}
watch([search, platform, format, folder, sort], () => {
  const q = new URLSearchParams();
  if (search.value.trim()) q.set('q', search.value.trim());
  if (platform.value !== 'all') q.set('platform', platform.value);
  if (format.value !== 'all') q.set('format', format.value);
  if (folder.value !== 'all') q.set('folder', folder.value);
  if (sort.value !== 'name') q.set('sort', sort.value);
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
});
onMounted(async () => {
  try {
    const response = await fetch(`${base}games.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const list = await response.json();
    if (!Array.isArray(list)) throw new Error('games.json 必须是数组');
    games.value = list.filter(game => supportedPlatforms.has(game.platform) && game.rom && !game.placeholder);
  } catch (error) { loadError.value = String(error?.message || error); }
  finally { loading.value = false; }
});
</script>

<template>
  <div class="site-shell">
    <header class="site-header">
      <div class="container nav-layout">
        <a :href="base" class="brand" aria-label="小咪 Hack Roms 首页">
          <span class="brand-mark" aria-hidden="true"><i class="cross">✚</i><i class="buttons">●●</i></span>
          <span class="brand-name">小咪 <strong>Hack Roms</strong><small>RETRO GAMES, REIMAGINED</small></span>
        </a>
        <nav class="main-links" aria-label="顶部导航"><a :href="base" class="selected">游戏大厅</a><a href="#filters">检索游戏</a></nav>
        <a class="nav-action" href="#catalog">浏览游戏 <span>↗</span></a>
      </div>
    </header>

    <section class="hero">
      <div class="container hero-copy">
        <div class="hero-eyebrow"><span class="dot"></span> MADE BY 小咪 · HACK ROMS</div>
        <h1>熟悉的游戏，<br /><em>{{ catalogOnly ? '在这里发现。' : '打开就能玩。' }}</em></h1>
        <p>FC / MD / SFC / GBA / PSP<br class="mobile-only" /> 五大游戏平台，{{ catalogOnly ? '一站浏览与检索。' : '一站检索、直接开玩。' }}</p>
      </div>
    </section>

    <main class="container site-main">
      <p v-if="catalogOnly" class="catalog-notice" role="status">当前为游戏目录展示版，ROM 暂未上线，暂不提供在线游玩。</p>
      <section id="filters" class="filter-panel" aria-label="游戏检索筛选面板">
        <div class="panel-heading"><div><span class="panel-kicker">FIND A GAME</span><h2>发现游戏<span class="heading-accent">.</span></h2></div><span class="panel-caption">SEARCH · FILTER · PLAY</span></div>
        <div class="search-area">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7.2"/><path d="m16.5 16.5 5 5"/></svg>
          <input v-model="search" type="search" placeholder="搜索名称、ROM 文件名、路径..." aria-label="搜索游戏" spellcheck="false" />
          <span class="search-shortcut">本地目录检索</span>
        </div>
        <div class="filter-grid">
          <label class="filter-field"><span>游戏平台 · 来自一级目录</span><select v-model="platform" aria-label="游戏平台"><option value="all">全部平台</option><option v-for="sys in platforms.slice(1)" :key="sys.id" :value="sys.id">{{ sys.id }} · {{ sys.sub }}</option></select></label>
          <label v-if="fileFormats.length" class="filter-field"><span>文件格式 · 扫描扩展名</span><select v-model="format" aria-label="文件格式"><option value="all">全部格式</option><option v-for="ext in fileFormats" :key="ext" :value="ext">.{{ ext.toUpperCase() }}</option></select></label>
          <label v-if="folders.length" class="filter-field"><span>所在子文件夹</span><select v-model="folder" aria-label="所在子文件夹"><option value="all">全部文件夹</option><option v-for="dir in folders" :key="dir" :value="dir">{{ dir }}</option></select></label>
          <label class="filter-field"><span>排序方式 · 文件信息</span><select v-model="sort" aria-label="排序方式"><option value="name">名称 A → Z</option><option value="name-desc">名称 Z → A</option><option value="modified">文件修改时间 · 最新</option><option value="size-desc">文件大小 · 从大到小</option><option value="size-asc">文件大小 · 从小到大</option></select></label>
        </div>
        <div class="platform-chips" aria-label="平台快捷筛选"><button v-for="sys in platforms" :key="sys.id" class="platform-chip" :class="{ active: platform === sys.id }" type="button" @click="platform = sys.id">{{ sys.name }} <span>{{ countFor(sys.id) }}</span></button></div>
        <div class="filter-footer"><span class="result-count"><span class="small-dot"></span>已收录 <strong>{{ games.length }}</strong> 款 · 匹配 <strong>{{ matchingGames.length }}</strong> 款</span><button type="button" class="reset-button" :disabled="!filtered" @click="clearFilters">↺ 重置筛选</button></div>
      </section>

      <section id="catalog" class="catalog-section" aria-label="游戏目录">
        <div class="catalog-heading"><div><span class="overline">YOUR ROM COLLECTION</span><h2>游戏目录 <span class="counter">{{ matchingGames.length.toString().padStart(2, '0') }}</span></h2></div><span class="catalog-tip">{{ catalogOnly ? '小咪 Hack ROM 收藏目录' : '来自你的本地 ROM 扫描' }} <span>↘</span></span></div>
        <div v-if="loading" class="center-state">正在读取游戏目录...</div>
        <div v-else-if="loadError" class="center-state error">无法加载 games.json：{{ loadError }}</div>
        <div v-else-if="!games.length" class="center-state empty"><div class="empty-icon">▣</div><h3>还没有收录 ROM</h3><p>在根目录 <code>roms.config.json</code> 配置你的本地 ROM 文件夹，然后执行 <code>npm run roms:scan</code>。页面不会凭空生成游戏和分类。</p></div>
        <div v-else-if="!matchingGames.length" class="center-state empty"><div class="empty-icon">⌕</div><h3>没有找到匹配的游戏</h3><p>可以调整平台、文件格式或搜索关键字。</p><button class="reset-button solid" type="button" @click="clearFilters">清除筛选</button></div>
        <div v-else class="game-grid">
          <component :is="catalogOnly ? 'article' : 'a'" v-for="game in matchingGames" :key="game.id" class="game-card" :href="catalogOnly ? undefined : playUrl(game)" :aria-label="catalogOnly ? game.title : `游玩 ${game.title}`">
            <div class="cover-frame" :class="`cover-${game.platform.toLowerCase()}`">
              <div v-if="!game.cover || failedCovers.has(game.id)" class="cover-fallback">
                <span class="fallback-symbol" aria-hidden="true">▧</span>
                <strong>{{ shortName(game.title) }}</strong>
                <span class="fallback-label">暂无封面 · {{ game.platform }}</span>
              </div>
              <div v-else class="cover-art">
                <img :src="fileUrl(game.cover)" :alt="`${game.title} 封面`" loading="lazy" decoding="async" @error="markFailedCover(game.id)" />
              </div>
              <span class="cover-platform">{{ game.platform }}</span><span class="play-overlay">{{ catalogOnly ? 'ROM 暂未上线' : '▶ 立即游玩' }}</span>
            </div>
            <div class="game-info">
              <h3 :title="game.title">{{ game.title }}</h3>
              <p :title="game.sourceName || game.rom">{{ game.sourceName || game.rom }}</p>
              <div class="game-meta"><span>{{ (game.format || 'ROM').toUpperCase() }} <span class="meta-sep">/</span> {{ formatSize(game.sizeBytes) }}</span><span class="game-arrow">{{ catalogOnly ? '未上线' : '↗' }}</span></div>
              <span v-if="formatDate(game.modifiedAt)" class="file-date">文件修改于 {{ formatDate(game.modifiedAt) }}</span>
            </div>
          </component>
        </div>
        <p class="catalog-footnote">※ 平台、格式、路径、大小和文件修改时间来自本地扫描；不根据文件名臆测游戏玩法或版本性质。PSP 运行依赖 PPSSPP 核心、线程支持及浏览器兼容性。请仅使用有权使用、分发的 ROM。</p>
      </section>
    </main>
    <footer class="site-footer"><div class="container footer-row"><strong>小咪 <span>Hack Roms</span></strong><span>POWERED BY EMULATORJS · BUILT FOR RETRO LOVERS</span></div></footer>
  </div>
</template>
