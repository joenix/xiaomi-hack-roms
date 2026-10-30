/**
 * 本地 ROM 配置。相对路径以项目根目录为基准，支持 ~（用户家目录）。
 * 默认仍使用 public/roms，因此旧项目无需迁移。
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const publicRoot = path.join(projectRoot, 'public');
export const catalogPath = path.join(publicRoot, 'games.json');
export const coverRoot = path.join(publicRoot, 'covers');
export const playerConfigPath = path.join(publicRoot, 'player-config.json');

export function resolveConfigPath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('roms.config.json 的 romsDir 必须是非空路径');
  const raw = value.trim();
  let expanded = raw;
  if (raw === '~') expanded = homedir();
  else if (raw.startsWith('~/') || raw.startsWith('~\\')) expanded = path.join(homedir(), raw.slice(2));
  return path.resolve(projectRoot, expanded);
}

const KNOWN_PLATFORMS = new Set(['FC', 'MD', 'SFC', 'GBA', 'PSP']);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validateControls(layer, where) {
  if (!plainObject(layer)) throw new Error(`${where} 必须是 JSON 对象`);
  for (const [player, keys] of Object.entries(layer)) {
    if (!/^[0-3]$/.test(player) || !plainObject(keys)) throw new Error(`${where}.${player} 应是玩家编号 0~3 的对象`);
    for (const [button, binding] of Object.entries(keys)) {
      if (!/^(?:[0-9]|1[0-9]|2[0-9])$/.test(button) || !plainObject(binding)) throw new Error(`${where}.${player}.${button} 不合法（按键编号 0~29）`);
      if (!Object.keys(binding).length || Object.keys(binding).some(k => !['value', 'value2'].includes(k))) throw new Error(`${where}.${player}.${button} 仅支持 value/value2`);
      for (const value of Object.values(binding)) {
        if (typeof value !== 'string' || value.length > 100) throw new Error(`${where}.${player}.${button} 键位值必须为字符串（最多 100 字符）`);
      }
    }
  }
}
function normalizePlayerSettings(raw) {
  if (!plainObject(raw)) throw new Error('player 必须是 JSON 对象');
  const language = raw.language ?? 'zh-CN';
  const volume = raw.volume ?? 0.5;
  const autoplay = raw.autoplay ?? true; // 播放器本身始终直接启动，此字段只为旧版配置兼容。
  const fullscreen = raw.fullscreen ?? false;
  const saveStateLocation = raw.saveStateLocation ?? 'download';
  if (typeof language !== 'string' || !/^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$/.test(language)) throw new Error('player.language 格式错误');
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('player.volume 应为 0～1');
  if (typeof autoplay !== 'boolean' || typeof fullscreen !== 'boolean') throw new Error('player.autoplay/fullscreen 必须为布尔值');
  if (!['download', 'browser'].includes(saveStateLocation)) throw new Error('player.saveStateLocation 必须是 download 或 browser');
  const controls = raw.controls ?? {};
  if (!plainObject(controls)) throw new Error('player.controls 必须是 JSON 对象');
  const base = controls.default ?? {};
  const platforms = controls.platforms ?? {};
  const games = controls.games ?? {};
  validateControls(base, 'player.controls.default');
  if (!plainObject(platforms)) throw new Error('player.controls.platforms 必须是 JSON 对象');
  for (const [system, bindings] of Object.entries(platforms)) {
    if (!KNOWN_PLATFORMS.has(system)) throw new Error(`未知游戏平台的键位配置：${system}`);
    validateControls(bindings, `player.controls.platforms.${system}`);
  }
  if (!plainObject(games)) throw new Error('player.controls.games 必须是 JSON 对象');
  for (const [game, bindings] of Object.entries(games)) {
    if (!game || game === '__proto__' || game === 'constructor' || game === 'prototype') throw new Error('无效的游戏键位配置 ID');
    validateControls(bindings, `player.controls.games.${game}`);
  }
  return { language, volume, autoplay: true, fullscreen, saveStateLocation, controls: { default: base, platforms, games } };
}

export async function loadRomConfig() {
  const configFile = path.join(projectRoot, 'roms.config.json');
  let raw = {};
  if (existsSync(configFile)) {
    try { raw = JSON.parse(await readFile(configFile, 'utf8')); }
    catch (err) { throw new Error(`配置文件 roms.config.json 解析失败：${err.message}`); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('roms.config.json 顶层必须是 JSON 对象');
  }
  const romRoot = resolveConfigPath(raw.romsDir ?? './public/roms');
  const scanIntervalMs = raw.scanIntervalMs ?? 2000;
  if (!Number.isInteger(scanIntervalMs) || scanIntervalMs < 500 || scanIntervalMs > 60000) {
    throw new Error('scanIntervalMs 应设为 500～60000 之间的整数（毫秒）');
  }
  const isExternal = path.resolve(romRoot) !== path.resolve(path.join(publicRoot, 'roms'));
  const player = normalizePlayerSettings(raw.player ?? {});
  return { romRoot, scanIntervalMs, isExternal, player };
}

/** 防止 ROM 文件夹中符号链接越界读取其他本机文件。 */
export async function safeRomFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(s => !s || s === '.' || s === '..')) {
    throw new Error('ROM 相对路径无效');
  }
  const full = path.resolve(root, ...relative.split('/'));
  const rootReal = await realpath(root);
  const fileReal = await realpath(full);
  if (fileReal !== rootReal && !fileReal.startsWith(rootReal + path.sep)) throw new Error('ROM 文件超出配置的目录范围');
  const fileStat = await stat(fileReal);
  if (!fileStat.isFile()) throw new Error('不是普通 ROM 文件');
  return { full: fileReal, stat: fileStat };
}
