/**
 * @aispin/netease-artist
 *
 * 给一个网易云音乐人 id，抓一份**静态**数据出来：
 *   - 基本信息（名字 / 别名 / 头像 / 简介 / 作品数 / 专辑数）
 *   - 最新 N 首（按专辑发行时间倒序）
 *   - 最热 N 首（用官方「歌手热门 50」的顺序，不是自己按 pop 排）
 *   - 最新 N 张专辑（带曲目，方便"点专辑 = 整张放"）
 *
 * 为什么要"构建时抓、存成 JSON"：
 *   - 页面直接引用网易云接口会被 Referer / 限流 / 跨域三座山挡住；
 *   - 音乐房间是静态站，没有后端，也不想为了几首歌上一个服务；
 *   - 数据变化是"发新歌"级别的低频事件，构建时抓一次完全够。
 *
 * 只依赖 Node 18+ 的全局 fetch，没有第三方依赖 —— 别的项目直接
 * `import { buildArtist } from '@aispin/netease-artist'` 就能用。
 */

import { getJson, mapPool } from './http.js';

const ORIGIN = 'https://music.163.com';

/** 基本信息。用 v1 —— 只有它带 `briefDesc`（艺人简介）。 */
export const artistApi = (id) => `${ORIGIN}/api/v1/artist/${id}`;
/** 官方「热门 50 首」，顺序就是热度序（和自己按 pop 排完全不是一回事）。 */
export const topSongsApi = (id) => `${ORIGIN}/api/artist/top/song?id=${id}`;
/** 专辑列表，`hotAlbums` 实际是"全部专辑 + 发行时间"。 */
export const albumsApi = (id, limit = 200) =>
  `${ORIGIN}/api/artist/albums/${id}?limit=${limit}&offset=0`;
/** 单张专辑（带完整曲目）。 */
export const albumApi = (id) => `${ORIGIN}/api/v1/album/${id}`;

/* ---------------------------------------------------------------- 小工具 */

/** 网易云图片可以带尺寸参数，别直接把 2000px 原图塞进页面。 */
export function coverOf(url, size = 400) {
  if (!url) return '';
  const base = url.split('?')[0];
  return `${base}?param=${size}y${size}`;
}

/** 123456 → "2:03" */
export function fmtDuration(ms) {
  if (!ms || !Number.isFinite(ms)) return '0:00';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 时间戳 → "YYYY-MM-DD"。
 *
 * ⚠️ 用 **UTC** 日期，不是北京时间。网易云的 `publishTime` 基本都是
 * "北京 00:00"（时间戳落在 UTC 16:00），按 UTC 取日期正好是艺人设定的**前一天**；
 * 实测 ZEO 的《Electro Surge》= 1786982400000 → UTC 2026-08-17 / 北京 2026-08-18，
 * 而站上（和 o-doctor 里那份手写数据）显示的是 2026.08.17。
 * 也就是说网易云页面按 UTC 日期展示，这里跟着它走，两处才对得上。
 * 想改成北京时间：把 timeZone 换成 'Asia/Shanghai' 即可（会整体 +1 天）。
 */
export function isoDate(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** 曲目数：`size` 有时缺失，退回 `tracks.length` 或 `songSize`。 */
const albumSize = (a) => a.size ?? a.songSize ?? (Array.isArray(a.tracks) ? a.tracks.length : 0);

/* ---------------------------------------------------------------- 归一化 */

function normalizeSong(raw, album) {
  const al = raw.al || raw.album || {};
  const dt = raw.dt ?? raw.duration ?? 0;
  /* album 可能是**原始**专辑对象（带 picUrl），也可能是 normalizeAlbum 的产物
     （封面已经裁好、叫 cover）—— 两种都要认。 */
  const pic = album ? album.picUrl || album.cover : al.picUrl;
  return {
    id: String(raw.id),
    name: raw.name,
    album: album ? album.name : al.name || '',
    albumId: String(album ? album.id : al.id ?? ''),
    cover: coverOf(pic),
    duration: dt,
    durationText: fmtDuration(dt),
    publishedAt: album ? album.publishedAt : '',
    trackNo: raw.no ?? null,
    popularity: raw.pop ?? 0,
    /* fee: 0 免费 / 1 需会员 / 8 低音质免费。8 也能用外链播，所以不拿它筛曲目。 */
    fee: raw.fee ?? 0,
    url: `${ORIGIN}/#/song?id=${raw.id}`,
    outerUrl: `${ORIGIN}/song/media/outer/url?id=${raw.id}.mp3`,
  };
}

function normalizeAlbum(a, tracks) {
  const publishedAt = isoDate(a.publishTime);
  return {
    id: String(a.id),
    name: a.name,
    type: a.type || '专辑',
    cover: coverOf(a.picUrl),
    publishedAt,
    year: publishedAt ? publishedAt.slice(0, 4) : '',
    size: albumSize(a),
    description: a.description || '',
    url: `${ORIGIN}/#/album?id=${a.id}`,
    tracks: (tracks || []).map((s) => normalizeSong(s, { ...a, publishedAt })),
  };
}

/* ---------------------------------------------------------------- 主流程 */

/**
 * @param {object} opts
 * @param {number|string} opts.id          网易云音乐人 id
 * @param {number} [opts.latest=12]        最新多少首
 * @param {number} [opts.hot=12]           最热多少首
 * @param {number} [opts.albums=6]         最新多少张专辑（含曲目）
 * @param {number} [opts.albumFetch=0]     抓多少张专辑的曲目来拼"最新"（0 = 全部）
 * @param {number} [opts.concurrency=3]    并发请求数，别把人家接口打爆
 * @param {(msg:string)=>void} [opts.log]
 */
export async function buildArtist(opts = {}) {
  const {
    id,
    latest = 12,
    hot = 12,
    albums = 6,
    albumFetch = 0,
    concurrency = 3,
    log = () => {},
  } = opts;

  if (!id) throw new Error('缺少音乐人 id（--id）');

  log(`→ 基本信息 artist/${id}`);
  const artistRes = await getJson(artistApi(id));
  const a = artistRes.artist;
  if (!a) throw new Error(`拿不到音乐人 ${id}（可能已注销或 id 不对）`);

  log('→ 热门 50 首');
  const topRes = await getJson(topSongsApi(id));
  const topSongs = Array.isArray(topRes.songs) ? topRes.songs : [];

  log('→ 专辑列表');
  const albumRes = await getJson(albumsApi(id));
  const rawAlbums = (albumRes.hotAlbums || []).slice().sort(
    (x, y) => (y.publishTime || 0) - (x.publishTime || 0)
  );
  log(`   共 ${rawAlbums.length} 张`);

  /* 「最新」按专辑发行时间排，所以得知道每张专辑里有什么。
     默认全抓（这个艺人 16 张、99 首，十几个请求，构建时完全可接受）；
     `albumFetch` 给大艺人留个口子。 */
  const fetchCount = albumFetch > 0 ? Math.min(albumFetch, rawAlbums.length) : rawAlbums.length;
  const toFetch = rawAlbums.slice(0, fetchCount);

  log(`→ 抓 ${fetchCount} 张专辑的曲目（并发 ${concurrency}）`);
  const details = await mapPool(
    toFetch,
    concurrency,
    async (al) => {
      const r = await getJson(albumApi(al.id));
      return { album: al, songs: Array.isArray(r.songs) ? r.songs : [] };
    },
    (err, al) => log(`   ! 跳过《${al.name}》：${err.message}`)
  );

  const albumById = new Map();
  const allSongs = [];
  for (const d of details) {
    if (!d) continue;
    const norm = normalizeAlbum(d.album, d.songs);
    albumById.set(norm.id, norm);
    for (const s of norm.tracks) allSongs.push(s);
  }

  /* 最新：专辑发行时间倒序；**同一张专辑内按曲序正序**（新专辑的第 1 首在最前，
     而不是把整张专辑倒着念一遍） */
  const latestSongs = allSongs
    .slice()
    .sort(
      (x, y) =>
        (y.publishedAt || '').localeCompare(x.publishedAt || '') ||
        (x.trackNo ?? 0) - (y.trackNo ?? 0)
    )
    .slice(0, latest);

  /* 最热：直接用官方热门顺序 —— 别自己按 `pop` 排，
     那个字段是 5 / 10 这种粗粒度分档，排出来等于没排。 */
  const hotSongs = topSongs
    .slice(0, hot)
    .map((s) => {
      const album = albumById.get(String(s.al?.id)) || s.al || {};
      return normalizeSong(s, album);
    });

  const latestAlbums = rawAlbums
    .slice(0, albums)
    .map((al) => albumById.get(String(al.id)) || normalizeAlbum(al, []));

  return {
    generatedAt: new Date().toISOString(),
    source: {
      provider: 'netease',
      artistId: String(id),
      artistUrl: `${ORIGIN}/#/artist?id=${id}`,
      endpoints: { artist: artistApi(id), topSongs: topSongsApi(id), albums: albumsApi(id) },
    },
    artist: {
      id: String(a.id ?? id),
      name: a.name || '',
      alias: Array.isArray(a.alias) ? a.alias : [],
      avatar: coverOf(a.picUrl || a.img1v1Url, 600),
      bio: a.briefDesc || '',
      songCount: a.musicSize ?? null,
      albumCount: a.albumSize ?? rawAlbums.length,
      url: `${ORIGIN}/#/artist?id=${id}`,
    },
    latestSongs,
    hotSongs,
    latestAlbums,
  };
}
