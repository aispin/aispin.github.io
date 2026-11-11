#!/usr/bin/env node
/**
 * CLI：netease-artist --id 49232788 --out data.json
 *
 * 设计成"能进 npm scripts"的形状：参数全是可选的，除了 id；
 * `--out` 可以给多次（同一份数据写到多个位置，比如 src/ 与 public/ 各一份）。
 */

import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildArtist } from './index.js';

const HELP = `
netease-artist — 把网易云音乐人的公开数据抓成静态 JSON

用法
  netease-artist --id <音乐人id> [选项]

选项
  -i, --id <id>          网易云音乐人 id（必填，浏览器地址栏 /artist?id= 后面那串数字）
  -o, --out <file>       输出文件；可重复给多次。不给则打印到 stdout
      --latest <n>       最新多少首（默认 12）
      --hot <n>          最热多少首（默认 12）
      --albums <n>       最新多少张专辑，含曲目（默认 6）
      --album-fetch <n>  抓多少张专辑的曲目来拼"最新"，0 = 全部（默认 0）
      --concurrency <n>  并发请求数（默认 3）
      --min              压缩输出（默认带缩进，方便 diff）
  -h, --help             显示这段

例子
  netease-artist --id 49232788 --out public/data/netease-music-zeo.json
  netease-artist -i 49232788 --latest 20 --hot 20 --albums 8 \\
                 --out src/data/x.json --out public/data/x.json

输出
  { generatedAt, source, artist, latestSongs[], hotSongs[], latestAlbums[] }
`;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        id: { type: 'string', short: 'i' },
        out: { type: 'string', short: 'o', multiple: true },
        latest: { type: 'string' },
        hot: { type: 'string' },
        albums: { type: 'string' },
        'album-fetch': { type: 'string' },
        concurrency: { type: 'string' },
        min: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    });
  } catch (err) {
    console.error(`${err.message}\n${HELP}`);
    process.exit(2);
  }

  const { values } = parsed;
  if (values.help || !values.id) {
    console.log(HELP.trim());
    process.exit(values.id ? 0 : 2);
  }

  const log = (msg) => console.error(msg);
  const t0 = Date.now();

  const data = await buildArtist({
    id: values.id,
    latest: num(values.latest, 12),
    hot: num(values.hot, 12),
    albums: num(values.albums, 6),
    albumFetch: num(values['album-fetch'], 0),
    concurrency: Math.max(1, num(values.concurrency, 3)),
    log,
  });

  const json = JSON.stringify(data, null, values.min ? 0 : 2);
  const outs = values.out && values.out.length ? values.out : null;

  if (!outs) {
    process.stdout.write(`${json}\n`);
  } else {
    for (const o of outs) {
      const file = resolve(process.cwd(), o);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${json}\n`, 'utf8');
      log(`✓ ${o}`);
    }
  }

  const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
  log(
    `\n${data.artist.name} · ${data.artist.songCount ?? '?'} 首 / ${data.artist.albumCount ?? '?'} 张专辑` +
      `\n  最新 ${data.latestSongs.length} 首 · 最热 ${data.hotSongs.length} 首 · 专辑 ${data.latestAlbums.length} 张` +
      `\n  ${kb} KB · ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
