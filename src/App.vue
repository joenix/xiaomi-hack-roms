<script setup>
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue';
import { createConsoleAudio } from './console-audio.js';
import { loadLibrary, resolveLibraryAsset } from './library.js';

const base = import.meta.env.BASE_URL;
const remoteLibrary = import.meta.env.MODE === 'pages';
const libraryConfig = ref({ playEnabled: !remoteLibrary, notice: '' });
const resourceRoot = ref(new URL(base, location.origin).href);
const catalogOnly = computed(() => !libraryConfig.value.playEnabled);
const notice = computed(() => libraryConfig.value.notice || (catalogOnly.value ? '当前为游戏目录展示版，ROM 暂未上线，暂不提供在线游玩。' : ''));
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

const consoleAudio = createConsoleAudio();
const soundEnabled = ref(true);
try { soundEnabled.value = localStorage.getItem('console-sound') !== 'off'; } catch {}
function unlockAudio() { if (soundEnabled.value) consoleAudio.unlock(); }
function toggleSound() { soundEnabled.value = !soundEnabled.value; try { localStorage.setItem('console-sound', soundEnabled.value ? 'on' : 'off'); } catch {} unlockAudio(); }
let lastPlatformSound = 0, platformTimer;
const platformTrack = ref(null);
let platformGesture = false;
function alignPlatform() {
  const track = platformTrack.value;
  if (!track?.clientWidth) return;
  track.scrollTo({left:platforms.findIndex(p => p.id === platform.value) * track.clientWidth, behavior:'instant'});
}
function settlePlatform(event) {
  if (!platformGesture) return;
  clearTimeout(platformTimer);
  const track=event.currentTarget;
  platformTimer=setTimeout(() => {
    const index=Math.max(0,Math.min(platforms.length-1,Math.round(track.scrollLeft/track.clientWidth)));
    platformGesture=false;
    platform.value=platforms[index].id;
  },140);
}
function cyclePlatform(delta) {
  const index=platforms.findIndex(p=>p.id===platform.value);
  platform.value=platforms[(index+delta+platforms.length)%platforms.length].id;
}
watch(platform, () => {
  lastPlatformSound=performance.now();
  if(soundEnabled.value) consoleAudio.tick(true);
  nextTick(alignPlatform);
},{flush:'sync'});
onMounted(() => { nextTick(alignPlatform); window.addEventListener('resize', alignPlatform); });
onUnmounted(() => { clearTimeout(platformTimer);consoleAudio.close();window.removeEventListener('resize',alignPlatform); });

const selectedId = ref('');
const filtersOpen = ref(false);
const filterDialog = ref(null);
const gameDialog = ref(null);
const searchTrigger = ref(null);
const detailsOpen = ref(false);
const panelOpen = computed(() => filtersOpen.value || detailsOpen.value);
let panelStart;
function startPanelSwipe(event) { panelStart = {x:event.clientX,y:event.clientY}; }
function endPanelSwipe(event) {
  if(panelStart && !event.target.closest('input,select') && event.clientX-panelStart.x>90 && Math.abs(event.clientY-panelStart.y)<60){filtersOpen.value=false;detailsOpen.value=false;}
  panelStart=null;
}
watch(detailsOpen,async open=>{await nextTick();if(open)gameDialog.value?.querySelector('button')?.focus({preventScroll:true});});
watch(filtersOpen, async open => {
  await nextTick();
  if (open) filterDialog.value?.querySelector('input')?.focus({preventScroll:true});
  else searchTrigger.value?.focus({preventScroll:true});
});
function revealSelection() {
  const rail = document.querySelector('.game-rail');
  const card = rail?.querySelector('.is-selected');
  if (!card) return;
  const target = rail.scrollLeft + card.getBoundingClientRect().left - rail.getBoundingClientRect().left - (rail.clientWidth - card.clientWidth) / 2;
  rail.scrollTo({ left: target, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

const selectedGame = computed(() => matchingGames.value.find(g => g.id === selectedId.value) || matchingGames.value[0]);
const clock = ref('');
let clockTimer, gamepadFrame;
let lastPad = 0;
function updateClock() { clock.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
let drag;
function beginTrackDrag(event) {
  if(event.pointerType !== 'mouse')return;
  event.preventDefault();
  drag={track:event.currentTarget,x:event.clientX,left:event.currentTarget.scrollLeft,moved:false,pointer:event.pointerId};
}
function dragTrack(event) {
  if(!drag)return;
  const delta=event.clientX-drag.x;
  if(Math.abs(delta)>5){
    drag.moved=true;
    drag.track.setPointerCapture(event.pointerId);
    drag.track.style.scrollSnapType='none';
    if(drag.track.classList.contains('game-rail'))startRailGesture();else platformGesture=true;
    drag.track.scrollLeft=drag.left-delta;
    event.preventDefault();
  }
}
function endTrackDrag() {
  if(!drag)return;
  const {track,moved,pointer}=drag;
  track.style.scrollSnapType='';
  if(track.hasPointerCapture(pointer))track.releasePointerCapture(pointer);
  if(moved){if(track.classList.contains('game-rail'))settleRail({currentTarget:track});else settlePlatform({currentTarget:track});}
  drag=null;
}
let railGesture = false, railTimer;
function startRailGesture() { railGesture = true; }
function settleRail(event) {
  if (!railGesture) return;
  clearTimeout(railTimer);
  const rail = event.currentTarget;
  railTimer = setTimeout(() => {
    railGesture = false;
    const bounds = rail.getBoundingClientRect();
    const center = bounds.left + bounds.width / 2;
    const cards = [...rail.querySelectorAll('.game-card')];
    const nearest = cards.reduce((best, card) => {
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - center);
      return !best || distance < best.distance ? { card, distance } : best;
    }, null);
    const index = cards.indexOf(nearest?.card);
    if (index >= 0) selectedId.value = matchingGames.value[index].id;
  }, 160);
}
function selectGame(game) { railGesture = false; selectedId.value = game.id; }
function moveSelection(delta) {
  const list = matchingGames.value;
  if (!list.length) return;
  const index = Math.max(0, list.findIndex(g => g.id === selectedGame.value?.id));
  selectedId.value = list[(index + delta + list.length) % list.length].id;
  nextTick(() => document.querySelector('.game-card.is-selected')?.focus({ preventScroll: true }));
}
function launchSelected() { if (selectedGame.value && !catalogOnly.value) location.href = playUrl(selectedGame.value); }
function handleKey(event) {
  if (event.key === 'Escape') { filtersOpen.value = false; detailsOpen.value=false; return; }
  if (panelOpen.value || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
  if (event.key === 'Enter' && event.target.closest('.game-card')) { event.preventDefault(); launchSelected(); return; }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); moveSelection(event.key === 'ArrowRight' ? 1 : -1); }
}
function pollGamepad(time) {
  const pad = navigator.getGamepads?.()?.[0];
  if (pad && time - lastPad > 240 && !panelOpen.value) {
    if (pad.buttons[15]?.pressed || pad.axes[0] > .6) { moveSelection(1); lastPad = time; }
    else if (pad.buttons[14]?.pressed || pad.axes[0] < -.6) { moveSelection(-1); lastPad = time; }
    else if (pad.buttons[0]?.pressed) { launchSelected(); lastPad = time; }
  }
  gamepadFrame = requestAnimationFrame(pollGamepad);
}
onMounted(() => { updateClock(); clockTimer = setInterval(updateClock, 1000); window.addEventListener('keydown', handleKey); gamepadFrame = requestAnimationFrame(pollGamepad); });
onUnmounted(() => { clearInterval(clockTimer); cancelAnimationFrame(gamepadFrame); clearTimeout(railTimer); window.removeEventListener('keydown', handleKey); });

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
watch(selectedGame, (game,previous) => { if(game && previous && game.id!==previous.id && soundEnabled.value && performance.now()-lastPlatformSound>100)consoleAudio.tick();nextTick(revealSelection); });
const filtered = computed(() => search.value.trim() || platform.value !== 'all' || format.value !== 'all' || folder.value !== 'all' || sort.value !== 'name');
function clearFilters() { search.value = ''; platform.value = 'all'; format.value = 'all'; folder.value = 'all'; sort.value = 'name'; }
function countFor(id) { return id === 'all' ? games.value.length : games.value.filter(game => game.platform === id).length; }
function fileUrl(relative) { return resolveLibraryAsset(relative, resourceRoot.value); }
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
    let list;
    if (remoteLibrary) {
      const library = await loadLibrary({ origin: location.origin });
      resourceRoot.value = library.resourceRoot.href;
      libraryConfig.value = library.config;
      list = library.games;
    } else {
      const response = await fetch(`${base}games.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      list = await response.json();
      if (!Array.isArray(list)) throw new Error('games.json 必须是数组');
    }
    games.value = list.filter(game => supportedPlatforms.has(game.platform) && game.rom && !game.placeholder);
  } catch (error) { loadError.value = String(error?.message || error); }
  finally { loading.value = false; }
});
</script>

<template>
  <div class="app-window" :class="{ 'panel-open': panelOpen }" @pointerdown.capture="unlockAudio" @keydown.capture="unlockAudio">
  <div class="console-shell" :inert="panelOpen">
    <div class="ambient" aria-hidden="true"><img v-if="selectedGame?.cover && !failedCovers.has(selectedGame.id)" :key="selectedGame.id" :src="fileUrl(selectedGame.cover)" @error="markFailedCover(selectedGame.id)" /></div>
    <header class="console-header">
      <a :href="base" class="brand"><span class="brand-icon">✚</span> 小咪 <span>Hack Roms</span></a>
      <span class="header-divider"></span><span class="current-section">游戏</span>
      <div class="header-actions"><button class="sound-toggle" :aria-label="soundEnabled ? '关闭切换音效' : '开启切换音效'" :aria-pressed="soundEnabled" @click="toggleSound">{{ soundEnabled ? '♪' : '♩' }}</button><button ref="searchTrigger" @click="filtersOpen = true" :aria-expanded="filtersOpen" aria-controls="filters" aria-label="搜索与筛选">⌕ <span>搜索与筛选</span></button><time>{{ clock }}</time><span class="profile" aria-label="小咪游戏库">咪</span></div>
    </header>
    <main>
      <div class="platform-wheel" aria-label="滑动切换游戏平台">
        <button class="wheel-arrow" aria-label="上一个平台" @click="cyclePlatform(-1)">‹</button>
        <div ref="platformTrack" class="platform-track" @pointerdown="event => { platformGesture = true; beginTrackDrag(event); }" @pointermove="dragTrack" @pointerup="endTrackDrag" @pointercancel="endTrackDrag" @touchstart.passive="platformGesture = true" @wheel.passive="platformGesture = true" @scroll.passive="settlePlatform">
          <button v-for="sys in platforms" :key="sys.id" class="platform-stop" :aria-pressed="platform === sys.id" @click="platform = sys.id"><strong>{{ sys.id === 'all' ? '游戏库' : sys.name }}</strong><small>{{ sys.sub }} · {{ countFor(sys.id) }} 款游戏</small></button>
        </div>
        <button class="wheel-arrow" aria-label="下一个平台" @click="cyclePlatform(1)">›</button>
      </div>
      <nav class="platforms" aria-label="游戏平台"><button v-for="sys in platforms" :key="sys.id" :class="{ active: platform === sys.id }" :aria-pressed="platform === sys.id" @click="platform = sys.id">{{ sys.name }}<span>{{ countFor(sys.id) }}</span></button></nav>

      <div class="collection-label"><span>你的游戏库 <b>{{ matchingGames.length }}</b></span><button v-if="filtered" class="text-button" @click="clearFilters">清除筛选 ×</button><span v-else>经典，再次出发</span></div>
      <div v-if="loading" class="center-state" role="status">正在读取游戏库…</div>
      <div v-else-if="loadError" class="center-state" role="alert">无法加载资源目录：{{ loadError }}</div>
      <div v-else-if="!matchingGames.length" class="center-state"><h2>{{ games.length ? '没有找到匹配的游戏' : '游戏库暂无游戏' }}</h2><p>试试其他关键字或平台。</p><button @click="clearFilters">清除筛选</button></div>
      <template v-else>
        <div class="rail-controls"><button aria-label="上一款游戏" @click="moveSelection(-1)">←</button><button aria-label="下一款游戏" @click="moveSelection(1)">→</button></div>
        <section class="game-rail" aria-label="选择游戏" @pointerdown="beginTrackDrag" @pointermove="dragTrack" @pointerup="endTrackDrag" @pointercancel="endTrackDrag" @touchstart.passive="startRailGesture" @wheel.passive="startRailGesture" @scroll.passive="settleRail"><div class="game-grid">
          <button v-for="game in matchingGames" :key="game.id" class="game-card" :class="{ 'is-selected': selectedGame?.id === game.id }" :aria-pressed="selectedGame?.id === game.id" :aria-label="`选择 ${game.title}`" @click="selectGame(game)" @focus="selectGame(game)">
            <div class="cover-frame" :class="`cover-${game.platform.toLowerCase()}`"><div v-if="!game.cover || failedCovers.has(game.id)" class="cover-fallback"><span class="fallback-symbol">✚</span><strong>{{ shortName(game.title) }}</strong><span class="fallback-label">{{ game.platform }} · 暂无封面</span></div><div v-else class="cover-art"><img :src="fileUrl(game.cover)" :alt="`${game.title} 封面`" loading="lazy" decoding="async" @error="markFailedCover(game.id)" /></div><span class="cover-platform">{{ game.platform }}</span></div>
            <span class="tile-title">{{ game.title }}</span>
          </button>
        </div></section>
        <div class="mobile-position" aria-label="切换游戏"><button aria-label="上一款游戏" @click="moveSelection(-1)">‹</button><span>{{ matchingGames.findIndex(g => g.id === selectedGame?.id) + 1 }}<i> / {{ matchingGames.length }}</i></span><button aria-label="下一款游戏" @click="moveSelection(1)">›</button></div>
        <section v-if="selectedGame" :key="selectedGame.id" class="game-detail" aria-label="选中的游戏">
          <div class="detail-copy"><div class="eyebrow"><span class="status-dot"></span>{{ selectedGame.platform }} <span> / </span> HACK ROM COLLECTION</div><h1>{{ selectedGame.title }}</h1><p class="subtitle">{{ selectedGame.subtitle || '熟悉的世界，全新的可能。' }}</p><div class="detail-meta"><span>{{ (selectedGame.format || 'ROM').toUpperCase() }}</span><span>{{ formatSize(selectedGame.sizeBytes) }}</span><span v-if="formatDate(selectedGame.modifiedAt)">更新于 {{ formatDate(selectedGame.modifiedAt) }}</span></div>
          <div class="detail-actions"><a v-if="!catalogOnly" class="launch-button" :href="playUrl(selectedGame)"><span>▶</span> 开始游戏</a><button v-else class="launch-button" disabled>暂未开放游玩</button><button class="game-options" aria-label="查看游戏详情" @click="detailsOpen = true">···</button><span class="selection-count">{{ matchingGames.findIndex(g => g.id === selectedGame.id) + 1 }} <i>/ {{ matchingGames.length }}</i></span></div>
          <details class="file-details"><summary>游戏文件信息</summary><p>{{ selectedGame.sourceName || selectedGame.rom }}</p><p v-if="selectedGame.folder">{{ selectedGame.folder }}</p></details></div>
          <div class="detail-art" aria-hidden="true"><img v-if="selectedGame.cover && !failedCovers.has(selectedGame.id)" :src="fileUrl(selectedGame.cover)" @error="markFailedCover(selectedGame.id)" /><span v-else>{{ shortName(selectedGame.title) }}</span></div>
        </section>
      </template>
      <p v-if="notice" class="catalog-notice" role="status">{{ notice }}</p>
    </main>

    <footer class="console-footer"><div><span class="key">←</span><span class="key">→</span> 切换游戏 <span class="footer-gap"><span class="key">Enter</span> 确认</span><span class="footer-gap">手柄：方向键切换 · A 启动</span></div><span>小咪的经典游戏空间</span></footer>
  </div>
      <section ref="filterDialog" id="filters" class="filter-panel filter-drawer" :class="{ active: filtersOpen }" :inert="!filtersOpen" :aria-hidden="!filtersOpen" aria-label="搜索与筛选" @pointerdown="startPanelSwipe" @pointerup="endPanelSwipe">
        <div class="drawer-heading"><button @click="filtersOpen = false" aria-label="返回游戏库">‹</button><h2>搜索游戏</h2></div>
        <input v-model="search" type="search" placeholder="搜索游戏名称、ROM 或路径" aria-label="搜索游戏" />
        <div class="filter-fields"><label>文件格式<select v-model="format"><option value="all">全部格式</option><option v-for="ext in fileFormats" :key="ext" :value="ext">{{ ext.toUpperCase() }}</option></select></label><label>文件夹<select v-model="folder"><option value="all">全部文件夹</option><option v-for="dir in folders" :key="dir" :value="dir">{{ dir }}</option></select></label><label>排序<select v-model="sort"><option value="name">名称 A → Z</option><option value="name-desc">名称 Z → A</option><option value="modified">最近更新</option><option value="size-desc">大小 ↓</option><option value="size-asc">大小 ↑</option></select></label></div>
        <button class="text-button" :disabled="!filtered" @click="clearFilters">重置筛选</button><button class="text-button" @click="filtersOpen = false">完成 · {{ matchingGames.length }} 款游戏</button>
      </section>
    <section ref="gameDialog" class="filter-panel filter-drawer game-sheet" :class="{ active: detailsOpen }" :inert="!detailsOpen" :aria-hidden="!detailsOpen" aria-label="游戏详情" @pointerdown="startPanelSwipe" @pointerup="endPanelSwipe">
      <template v-if="selectedGame"><div class="drawer-heading"><button aria-label="返回游戏库" @click="detailsOpen = false">‹</button><h2>游戏详情</h2></div><h3>{{ selectedGame.title }}</h3><p>{{ selectedGame.platform }} · {{ formatSize(selectedGame.sizeBytes) }}</p><p class="sheet-file">{{ selectedGame.sourceName || selectedGame.rom }}</p><p v-if="formatDate(selectedGame.modifiedAt)">更新于 {{ formatDate(selectedGame.modifiedAt) }}</p></template>
    </section>
  </div>
</template>
