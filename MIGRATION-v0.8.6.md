# 小咪 Hack Roms v0.8.6 — 封面修复使用指南

1. 从旧项目复制你自己的 `roms.config.json`（不要覆盖新版配置），把其中 `covers.sources` 改成 `["launchbox-local", "libretro"]`，再加上 `timeoutMs: 30000`、`retries: 2`。也可直接使用新版 `roms.config.json` 并只修改 `romsDir`。
2. 已抓错的封面需要执行 `pnpm run roms:covers -- --refresh` 才会重试；正确的图片不需要重新扫描 ROM。
3. 查看 `data/matched-covers.json`、`data/unmatched-covers.json`。也可 `pnpm run roms:covers:report` 输出失败分类。

## 额外的合法封面素材

LaunchBox Games Database 没有稳定开放给第三方 Node 脚本的公共下载 API。本项目允许指定你本地已有的、使用权合规的 LaunchBox 图片导出目录，例如 `~/Games/LaunchBox`：

```json
"covers": {
  "enabled": true,
  "sources": ["launchbox-local", "libretro"],
  "launchboxLocalDir": "~/Games/LaunchBox",
  "timeoutMs": 30000,
  "retries": 2
}
```

路径为空则跳过本地来源。脚本会检查 `Images/Sega Genesis/Box - Front` 等文件夹。无本地图库时继续使用 Libretro 在线封面库（无需 Key）。可另行把 `"igdb"` 加入 sources 作为需要凭据的联网备选。

**网络问题与未收录是两回事。** 当站点连续两次连不上，会把后续游戏标记为 `source-unavailable`，而不是谎称游戏名匹配失败。对特定游戏如要强制查询某个原作，可设置 `covers.overrides` 的 `searchTitle`；需要指定地区可同时设置 `region`（`jp` / `us` / `any`）。

不要把阿里云 AccessKey、IGDB Client Secret 放到 `roms.config.json` 或 Git 仓库中；需要凭据时仍只放 `.env.local`。
