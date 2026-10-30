# GitHub Pages 游戏大厅

线上地址：https://joenix.github.io/xiaomi-hack-roms/

前端与资源独立发布。生产构建每次打开页面读取
`https://joenix.github.io/xiaomi-hack-roms-libraries/library.json`，按其中的版本目录加载游戏列表、封面、ROM 和播放器配置。

日常更新游戏只需维护 `/Users/joenix/Game/@小咪优化/xiaomi-hack-roms-libraries` 并执行 `pnpm run publish`。不需要重新构建或推送本前端。

- `library.json` 的 `playEnabled` 控制游玩入口，`notice` 控制大厅公告。
- ROM、封面和播放器配置按资源库根地址解析；前端不包含 ROM。
- 配置读取失败会展示明确错误，不使用过时目录掩盖故障。
- 现有打开页面需刷新读取新目录。ROM 与目录使用内容哈希地址。
- `pnpm run build:pages` 构建前端，`pnpm run preview:pages` 本地预览生产模式。
- 本地开发的原有 ROM 扫描和键位设置保持原流程。
- 推送到 `main` 后 GitHub Actions 自动测试并发布前端，仅在修改网站代码时需要。

---

# 小咪 Hack Roms v0.8.7

> 新增 `pnpm run covers:upload`：只上传封面到 OSS，更新线上已有游戏的封面引用，不上传 ROM。沿用 `roms.config.json` 和 `.env.local`。

# 小咪 Hack Roms v0.8.6

纯前端复古游戏大厅。**FC / MD / SFC / GBA / PSP**，检索页和独立的原生 EmulatorJS 播放页。包括 **ROM 扫描、稳健的封面匹配、Libretro 无密钥下载、可选的 LaunchBox 本地封面导入 / IGDB、阿里云 OSS 增量发布**。

> 此项目不包含任何商业 ROM、BIOS 或 EmulatorJS 完整核心文件。请确保你对自行部署的游戏、封面和核心拥有相应的使用与分发许可。

## 1. 第一次在 Mac 启动

要求 Node.js 20.19+，推荐 Node 22/24；pnpm 或 npm 均可。

```bash
pnpm install
```

编辑项目根目录的 `roms.config.json`，例如：

```json
"romsDir": "/Users/你的用户名/Games/ROMs"
```

ROM 文件夹按平台大写命名：

```text
/Users/你/Games/ROMs/
├── FC/   （.nes 等）
├── MD/   （.bin .md .gen 等）
├── SFC/  （.sfc .smc 等）
├── GBA/  （.gba 等）
└── PSP/  （.iso .cso .chd；具体支持取决于实际核心）
```

```bash
pnpm run dev                    # 启动前自动 roms:scan
pnpm run roms:watch             # 可选：持续检测新增 ROM
```

浏览器打开 `http://localhost:5173/`。本地开发通过 Vite 中间件**直接读取外部 ROM 目录**，无需复制大型文件。

### 键位、存档

统一 `roms.config.json` 的 `player.controls.default` / `platforms` / `games` 保存五平台键位：WASD 方向，UIO/JKL 右手，B START，数字 1/2/3/5/6/8 快捷键。模拟摇杆默认清空（PSP 某些游戏依赖摇杆时应单独恢复）。使用游戏 URL `&resetControls=1` 重置此前保存的用户键位，不清除即时存档。EmulatorJS 原生菜单可导出/导入即时存档供手机用户备份。

## 2. 自动补封面（默认开启，不需要注册账号）

v0.8.2 默认使用 **Libretro Thumbnails 的 `Named_Boxarts`** 目录（FC、MD、SFC、GBA、PSP），不需要 API Key。在线封面属于原发行商等权利人；**封面可访问不等于获得商业再分发授权**，公开部署前请确认使用权限。网络不可用、匹配不确定时会保留占位图，不影响扫描或游玩。

`roms.config.json` 已经配置好：

```json
"covers": {
  "enabled": true,
  "provider": "libretro",
  "autoOnScan": true,
  "fetchOnPublish": true,
  "overwriteExisting": false,
  "region": "jp",
  "minMatchScore": 0.9,
  "aliases": {
    "太阁立志传": "Taikou Risshiden",
    "梦幻模拟战2": "Langrisser II",
    "光明力量2": "Shining Force II",
    "光之继承者": "Beyond Oasis"
  },
  "overrides": {}
}
```

```bash
pnpm run roms:scan                     # 扫描 ROM 并自动补缺失封面
pnpm run roms:covers                   # 专门补封面：会先同步扫描 ROM 目录
pnpm run roms:scan -- --no-covers      # 仅扫描，不联网
pnpm run roms:covers -- --refresh      # 强制重新查询已自动匹配的封面
```

> **注意：** 上述 `roms:covers -- --refresh` 依赖 npm/pnpm 的参数透传，若没有生效，也可以直接执行 `node tools/fetch-covers.mjs --refresh`。手工放入的封面仍然优先保留，不会自动替换。

下载后放在 `public/covers/auto/`，并将 `cover` / `coverSource` 写回 `public/games.json`。每个平台索引缓存到 `.cache/covers-index/`，避免每次扫描都重新下载整份封面文件列表，7 天后重新查询；断网会继续使用已缓存的索引。已经有封面的游戏跳过，不重复下载。公开发布时 OSS 上传对应封面文件，网页不依赖外部封面站点。

**中文 Hack ROM 注意：** 扫描器不能从任意中文文件名可靠推导出官方英文名称。已预设上面四个常见别名；其他游戏可自行添加到 `covers.aliases`，或用精确覆盖：

```json
"overrides": {
  "MD太阁立志传_小咪优化_v2.1.bin": {
    "searchTitle": "Taikou Risshiden"
  }
}
```

也可以直接放 `public/covers/MD/与ROM文件名相同.webp`，手工图优先。匹配分数不足的会报告未匹配，**不会随便把同一系列其他作品当成正确封面**。

如果你更愿意使用 IGDB，可将 `provider` 改为 `igdb`，然后将 `.env.example` 复制成 `.env.local`，填写 `IGDB_CLIENT_ID` 和 `IGDB_CLIENT_SECRET`。IGDB 的官方 API 需要 Twitch 开发者凭据，免费 API 限非商业用途。密钥切勿提交到仓库。

**开发服务器默认不等待联网封面查询**，所以 `pnpm dev` 能尽快启动；首次导入新 ROM 后推荐先运行 `pnpm roms:scan` 或 `pnpm roms:covers`。`publish` 默认尝试补齐封面。

### v0.8.2：Hack ROM 原作识别和封面复用

针对大量 ROM 不是原版名称（如 `梦幻模拟战2-狮子骑士崛起·一周目PLUS增值版v4.bin`），封面匹配流程升级为：

1. 先检查统一配置 `covers.overrides` 中对单独 ROM 指定的 `searchTitle`。
2. 尝试统一配置 `covers.aliases` 的**最长前缀匹配**（不要求文件名完全等于中文标题）。
3. 使用内置中英文原作名称词典（位于 `tools/cover-identity.mjs`）；例如“梦幻模拟战2”匹配 `Langrisser II`，“斗技王”匹配 `Tougiou King Colossus`，“光明力量1/2”分别处理。
4. 读取普通 MD `.bin/.md/.gen` ROM 的 Sega 头部**海外游戏名称字段**作为额外候选（只读前 512 字节；不保证每个 Hack ROM 保留了正确的头部）。
5. 仍不能识别时才用去掉部分改版信息后的文件名查询。

**页面上展示的文件名不会变更**，封面原作名只是内部查询依据。多个 Hack 版本如果匹配同一个原版封面，会共用一个 `public/covers/auto/` 文件，避免浪费 OSS 流量及存储空间。既有手工封面仍优先，不会覆盖。

```bash
pnpm run roms:scan       # 重新扫描并自动补缺失封面
pnpm run roms:covers     # 专门补图
```

无法自动匹配的游戏会记录到 **`data/unmatched-covers.json`**，包含原始 ROM 相对路径、已识别原作名称、搜索候选和失败原因。

- Libretro 按原作/平台收录封面，但并不包含所有新制作的 MD 游戏。《Demons of Asteborg》和《Astebros》可能仍需采用自备封面，或另行选择许可允许的来源；不会误用相似游戏封面。
- 需要指定某个游戏时，修改唯一的 `roms.config.json`，例如 `covers.overrides` 中填 `{ "MD/某文件.bin": { "searchTitle": "Some Game" } }` **不是正确的键**；正确键可以是 `games.json` 的 `id`、`rom`（如 `roms/MD/某文件.bin`）或原始文件名（如 `某文件.bin`）。
- `covers.aliases` 可以直接配 `{ "光明力量2": "Shining Force II" }`，自动覆盖 `光明力量2 上帝之战.bin` 这样的 Hack 文件名，不必为每个版本写一条。
- 暂不支持将游戏光盘或 BIOS 文件作为匹配依据；仅 MD 部分无压缩格式可以尝试读取 ROM 头部名称。

## 3. 阿里云 OSS + CDN（无需 ECS）

**先决条件**：你自行开通中国大陆 OSS Bucket、CDN、HTTPS 域名（通常需完成有效 ICP 备案及满足相应备案资源要求）。建议初期 **一个私有 OSS Bucket + CDN 私有回源**。CDN 入口和 OSS SDK 上传地址是两回事，上传请走 OSS 官方域名。

修改 `roms.config.json`：

```json
"deploy": {
  "provider": "aliyun-oss",
  "region": "oss-cn-shanghai",
  "bucket": "实际-Bucket-名称",
  "baseUrl": "https://你的已备案域名",
  "multipartThresholdMB": 16,
  "verifyRemote": false
}
```

将 `.env.example` 复制成 `.env.local`，在本机填写 **RAM 子账号/凭据**：

```dotenv
OSS_ACCESS_KEY_ID=你的AccessKeyID
OSS_ACCESS_KEY_SECRET=你的AccessKeySecret
IGDB_CLIENT_ID=可选
IGDB_CLIENT_SECRET=可选
```

推荐使用限制到目标 Bucket 的 RAM 身份，授予上传、读取/HEAD、分片管理所需的最小权限，**不要用主账号 AccessKey**。

### 命令

```bash
pnpm run roms:scan                # 本地扫描，并自动补齐缺失封面（可 --no-covers）
pnpm run roms:covers              # 单独扫描并补齐缺失封面，无需密钥
pnpm run publish -- --dry-run     # 预览增量上传；不需要配置阿里云密钥
pnpm run publish                 # 扫描 → 可选补封面 → 上传变化的 ROM/封面 → 最后更新线上 JSON
pnpm run build                   # 只构建网站；不会把外部 ROM 复制到 dist/roms
pnpm run deploy:site             # 增量发布网站 HTML/CSS/JS/EmulatorJS 等文件；不会覆盖线上目录
pnpm run deploy                  # 首次部署/整站更新：构建并发布网站，再发布游戏资源和 JSON
pnpm run test                    # 自动化测试
```

`pnpm run publish`、`pnpm run deploy` 和 `pnpm run covers:upload` 只有在阿里云凭据设置好后才会真正上传。`--dry-run` 只会预览发布内容，不会请求 OSS；可能更新本地缓存/目录元数据。发布脚本使用内容哈希作为 ROM 文件名，未变化文件不会重新上传；运行中失败可重试。默认不自动删除 OSS 上的旧 ROM，避免玩家正在加载时失效。你可以按实际业务手动管理过期资源。

注意 `pnpm run deploy:site` 依赖已经存在的 `dist`，需要先 `pnpm run build`。`deploy` 整体流程最后才发布线上 `games.json`，确保用户看见的目录引用的文件都已上传。

### 单独上传封面到 OSS（v0.8.7 新增）

不需要重新上传 ROM 或重新部署网站。把封面放在 `public/covers/auto/` 或 `public/covers/<平台>/`，并确保 `public/games.json` 中对应游戏的 `cover` 指向图片；自动抓取的封面会由 `pnpm roms:scan` / `pnpm roms:covers` 自动登记。

只需要在原来的 **同一个** `roms.config.json` 中设置阿里云参数（不需要另一份 OSS 配置文件）：

```json
"deploy": {
  "provider": "aliyun-oss",
  "region": "oss-cn-shanghai",
  "bucket": "你的Bucket名称",
  "baseUrl": "https://你的已备案域名",
  "multipartThresholdMB": 16,
  "verifyRemote": false,
  "coverUpload": { "updateCatalog": true }
}
```

重要：上面只是 `deploy` 配置片段；请保留 `roms.config.json` 的 ROM、按键和其他配置。**AccessKey 不得写在此文件**；仍然放在本机 `.env.local`，使用受限 RAM 权限：

```dotenv
OSS_ACCESS_KEY_ID=你的RAM访问密钥ID
OSS_ACCESS_KEY_SECRET=你的RAM访问密钥Secret
```

**已经通过 `pnpm publish` 首次发布过游戏目录**的情况下，日常一条命令：

```bash
pnpm run covers:upload
```

它会读取 `public/games.json` 实际引用的封面、计算内容哈希、仅上传 OSS 尚不存在的文件，**随后读取线上 `games.json`，只替换已有游戏的 `cover` 字段**，保留线上带哈希的 ROM URL、gameId、其他所有字段。多个 Hack 版本自动按各自 ID 更新。OSS 上传或验证失败时不会修改线上目录；重复执行不会重复上传同一图片。新的文件路径带哈希，避免浏览器/CDN 缓存旧图。

```bash
pnpm run covers:upload -- --dry-run     # 只预览，完全不接触 OSS / 不需要密钥
pnpm run covers:upload                 # 上传封面并更新线上 games.json
pnpm run covers:upload -- --files-only # 仅上传文件，不修改线上 games.json
```

**首次上线**：OSS 中还没有 `games.json` 时先运行 `pnpm run publish`（正常发布 ROM 和目录）；以后想单独更换封面再执行 `covers:upload`。如果某个 ROM 是新增游戏、尚未出现在 OSS 的 `games.json` 中，脚本会跳过该游戏并提示先运行 `pnpm publish`。

- 脚本只上传 **`public/games.json` 已引用的图片**；没有和游戏关联的文件（如站点 Banner、散落的素材）不在此命令上传范围。Banner 继续通过 `deploy:site` 发布。
- OSS 对象路径和旧版内容发布兼容，类似 `covers/auto/md-taiko-<sha>.webp`，实际 key 由本地 `id` 与图片内容决定。
- CDN 上的 `games.json` 建议设置不缓存或短缓存；更新后若仍旧图，检查该目录文件的缓存，而不是重复上传图片。
- 未处理额外的 OSS 权限授权；远端读取 `games.json`、HEAD 校验和上传等权限需由 RAM 用户配置。公开部署请确认封面图片的使用权。

### OSS/CDN 必要设置

- CDN 私有 Bucket 回源或其他合法的只读访问方式；对公网开放网站时即使 Bucket 私有，CDN 资源仍然可被访问。
- 根目录 `/` 显式改写至 `/index.html`，`/play/` 改写到 `/play/index.html`，不要把 ROM 路径错误回退成 HTML。
- 对 `games.json` / `player-config.json` / HTML 配置**不缓存或很短的 TTL**；启用既有 CDN 缓存规则之后，可能还需人工刷新历史缓存。带内容哈希的 ROM 路径允许长期缓存。
- PSP 核心使用 `EJS_threads`，生产环境需对 `/play/` 页面配置 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`，确保 `window.crossOriginIsolated === true`；建议把完整 EmulatorJS 官方 `data` 放进 `public/emulatorjs/data/`，避免 COEP 限制跨域脚本。与 OSS/CDN 关联的响应头、Range=206 请求应按真实 PSP ROM 测试。
- EmulatorJS 的实际 ROM 载入行为可能一次下载整个 PSP 镜像，**CDN Range 支持不等于浏览器一定增量载入**。请关注流量费用和移动端内存。
- 不要为 OSS 配置允许匿名上传的权限；证书、RAM 密钥和本机 ROM 绝对路径不能放到 `public`。

## 4. 工程结构

```text
xiaomi-hack-roms/
├── roms.config.json       # 本地统一配置（gitignored）
├── .env.local             # 仅本地密钥（gitignored）
├── local-roms/            # 默认本机 ROM 文件夹（可改成 Mac 其他路径）
├── public/
│   ├── games.json         # 本地扫描生成的目录
│   ├── player-config.json # 公开播放器配置，不含密钥和绝对路径
│   └── covers/            # Banner、自动抓取的封面
├── tools/
│   ├── scan-roms.mjs      # 本地扫描
│   ├── fetch-covers.mjs   # 自动补封面
│   ├── libretro-covers.mjs # 无密钥的官方公共封面目录
│   ├── content-manifest.mjs
│   ├── oss-client.mjs
│   ├── publish.mjs        # 增量发布内容
│   ├── upload-covers.mjs  # 独立上传封面并更新线上 cover 引用
│   ├── deploy-site.mjs    # 单独发布站点
│   └── deploy-all.mjs     # 一键整站发布
├── src/                   # Vue 游戏检索页、原生播放器启动逻辑
├── play/index.html        # 独立全屏模拟器页
└── dist/                  # 仅静态网站构建产物
```

本地 `games.json` 使用原始可访问 `roms/FC/...` 地址；线上脚本生成 **内容哈希 ROM 地址的远程目录**，不会污染本地目录。公开网站读根目录 `games.json`，这份目录由脚本最后上传。

## 5. 当前验证与限制

自动化测试覆盖扫描、配置、URL 编码、跨平台按键、外置 ROM Range、哈希地址、OSS 部署清单过滤、安全校验和 dry-run。**本包不包含实际 ROM，也没有真实阿里云 Bucket、完整 EmulatorJS 资源，所以无法宣称端到端上传或 PSP 真实游玩已验证。**


## v0.8.4：目录封面完整展示

- 旧版游戏卡使用横向框、`object-fit: cover`，造成竖版和盒装封面被强制裁切；新版**统一使用 3:4 浅色封面舞台**，图片以 `object-fit: contain` 完整居中显示，不剪裁 LOGO 和四周内容。
- 盒装封面、横版卡带标签、自制 Hack 海报都保留各自比例；图片四周留出少量呼吸空间，并用轻微阴影突出主体。**不会生成、修改或裁剪已下载的封面图片文件。**
- 缺少封面或远程图片加载失败时，会显示统一的中性占位卡，不会出现破图；占位文字和正常封面分支互斥，不会从图片留白处透出来。
- 移动端保持双列布局与完整封面；长 Hack 名称在卡片里最多显示两行，标题完整内容可通过元素 title 查看。
- 此版本只改 Vue 目录卡片及 CSS；原有 ROM 扫描器、自动封面下载、OSS 发布、EmulatorJS 和键位配置均未改动。

升级：保留自己的 `roms.config.json` 中的 `romsDir` 及其他个人配置即可，不需要重新下载封面，也不需要重新扫描 ROM。执行 `pnpm install && pnpm dev`。网站已上线的情况下，页面样式发布使用 `pnpm run deploy:site`。


## v0.8.4 — 封面悬停交互微调

游戏卡片不再向上位移，卡片边框、背景、阴影以及游戏文字保持固定不变。桌面鼠标悬停时，仅封面原图在原有的 3:4 舞台内平滑放大约 5%，鼠标移出平滑复原；封面仍保持 `object-fit: contain` 完整显示。悬停时“立即游玩”标签无过渡动画，手机触摸不触发封面放大。偏好减少动态效果的系统环境中将停用缩放。

这次只修改了 `src/style.css` 的悬停样式，不影响 ROM 扫描、封面下载、OSS 发布、玩家存档或模拟器。

## v0.8.5 — Vue 启动报错诊断

针对 `[plugin:vite:import-analysis] ... Install @vitejs/plugin-vue to handle .vue files`：

1. 先执行 `pnpm install`。
2. 执行 `pnpm run doctor:vue`，此命令用当前实际的 Vite 配置尝试转换 `src/App.vue`；若失败会输出详细堆栈。
3. 检查通过后执行 `pnpm run dev`。

`dev`、`build` 和 `preview` 都显式使用项目根目录的 `vite.config.js`，减少因选错配置而导致 Vue 插件未生效的情况。

**说明**：ZIP 的 `vite.config.js` 原本就已经引用并注册 `@vitejs/plugin-vue`；如果本地仍提示缺失，请核对本地文件是否完整覆盖、`pnpm install` 是否完成，尤其是 `pnpm run doctor:vue` 的输出。不要直接把该错误归因于 Vue SFC 语法。


## v0.8.6 — Hack 封面联网稳定性及多来源升级

针对一批 MD Hack ROM 大量出现 `This operation was aborted`、少量图片匹配错误的情况：

- 每次请求拥有独立的 `AbortController`，默认 **30 秒超时，最多重试 2 次**（三次尝试），对 429、5xx、网络故障和超时进行有界退避；404 不反复尝试。
- 先利用中文 Hack 名称识别**原版游戏**，同原作的多个 Hack 在同一轮扫描中共用结果；不因为不同 Hack 后缀就下载重复封面。
- 同一来源、同一平台连续网络失败两次，暂时熔断该来源，避免 20 多个 ROM 逐个重复等待超时。下次执行可以重新尝试。
- 增加独立报告：`data/unmatched-covers.json` 分类列出网络超时 / 服务不可用 / 没找到；`data/matched-covers.json` 记录匹配标题、查询词和来源。命令 `pnpm run roms:covers:report` 查看未匹配汇总。
- 仅下载并验签 PNG/JPEG/WebP 图片，拒绝伪装成图片的 HTML。优先沿用已下载的封面及封面来源；只有显式 `--refresh` 才重新匹配自动封面，手工准备的封面不受影响。
- 新增 **可选的 LaunchBox 本地封面导入**。LaunchBox Games Database 没有稳定、公开、可确认独立使用权限的批量图片下载 API，所以本项目**不会假装通过 LaunchBox 网站自动爬图**。如果电脑上安装了 LaunchBox 或有合法导出的封面目录，可以优先从本地导入。不开启该来源时继续使用无需密钥的 Libretro；IGDB（需要密钥）仍可作为可选在线来源。

### 建议的统一封面配置

仅需要在已有的 `roms.config.json` 的 `covers` 节点中增加这些字段，其他 `player.controls`、`romsDir` **保持原样**：

```json
{
  "enabled": true,
  "provider": "libretro",
  "sources": ["launchbox-local", "libretro"],
  "launchboxLocalDir": "",
  "timeoutMs": 30000,
  "retries": 2,
  "region": "jp",
  "minMatchScore": 0.9,
  "autoOnScan": true,
  "fetchOnPublish": true,
  "overwriteExisting": false
}
```

以上是 `covers` 的字段示例，不是整个 `roms.config.json`；保留自己的 `aliases`、`overrides`。当本地有 LaunchBox 图片文件夹时，设置 `launchboxLocalDir` 为 **LaunchBox 安装根目录**，例如 `~/Games/LaunchBox`，并确保它包含 `Images/Sega Genesis/Box - Front/` 等目录。也可在 `covers.sources` 中加入 `"igdb"`，同时在 `.env.local` 填写 `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET`；不必改动线上前端。

```bash
pnpm run roms:scan                   # 扫描并补缺封面
pnpm run roms:covers                 # 只补封面，不重复下载成功项
pnpm run roms:covers -- --refresh    # 重查自动匹配的封面（例如调完 region 后）
pnpm run roms:covers:report          # 分类查看失败及待人工处理项
```

某游戏必须使用日版、或日版与美版封面差异较大时，可在 `covers.overrides` 对该游戏添加 `{"searchTitle":"Langrisser II", "region":"jp"}`。如果本地已经准备好准确的 Hack 专属图，按原项目方法放进 `public/covers/<平台>/` 即可优先使用。

**网络限制**：如果在中国大陆无法稳定访问 `thumbnails.libretro.com`，重试仍不能保证下载成功。本版会快速分类为“来源不可用”，不会虚报为游戏名不匹配；可以优先导入本地封面或配置合法可用的授权数据源。公开网站使用封面需自行确认版权和数据来源的使用条款。

**测试边界**：项目提供 Node 自动测试和受控的模拟请求测试；本执行环境没有 npm 注册表与封面网站网络访问，**不能宣称已实测中国大陆网络上的图片下载或实际 Vue 页面构建**。
