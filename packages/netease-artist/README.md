# @aispin/netease-artist

给一个**网易云音乐人 id**，抓一份可以直接放进静态站的 JSON：

- 基本信息：名字 / 别名 / 头像 / 简介 / 作品数 / 专辑数
- **最新 N 首**（按专辑发行时间倒序，同专辑按曲序正序）
- **最热 N 首**（用官方「歌手热门 50」的顺序）
- **最新 N 张专辑**（带完整曲目，所以"点专辑 = 整张放"能实现）

零依赖，只用 Node 18+ 的全局 `fetch`。

## 为什么是"构建时抓、存 JSON"

音乐房间是纯静态站。直接在前端打网易云接口会被三件事卡住：`Referer` 校验、
限流、跨域。而"发新歌"是低频事件 —— 构建时抓一次，页面只读同源的静态 JSON，
既快又不会被封。

## 用法

```bash
# 直接跑（不装也能跑）
node packages/netease-artist/src/cli.js --id 49232788 --out public/data/netease-music-zeo.json

# 或者当 bin 用
npx netease-artist -i 49232788 --latest 20 --hot 20 --albums 8 -o data.json
```

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `-i, --id` | 音乐人 id（地址栏 `/artist?id=` 后面那串数字） | **必填** |
| `-o, --out` | 输出文件，**可以给多次** | 打印到 stdout |
| `--latest` | 最新多少首 | 12 |
| `--hot` | 最热多少首 | 12 |
| `--albums` | 最新多少张专辑（含曲目） | 6 |
| `--album-fetch` | 抓多少张专辑的曲目来拼"最新"，0 = 全部 | 0 |
| `--concurrency` | 并发请求数 | 3 |
| `--min` | 压缩输出（默认带缩进，方便 diff） | 否 |

## 编程接口

```js
import { buildArtist } from '@aispin/netease-artist';

const data = await buildArtist({
  id: 49232788,
  latest: 12,
  hot: 12,
  albums: 4,
  log: console.error,
});
```

## 输出结构

```jsonc
{
  "generatedAt": "2026-11-11T02:54:26.943Z",
  "source": { "provider": "netease", "artistId": "49232788", "artistUrl": "…", "endpoints": { … } },
  "artist": {
    "id": "49232788", "name": "ZEO", "alias": ["ZEO"],
    "avatar": "https://p1.music.126.net/…?param=600y600",
    "bio": "…", "songCount": 99, "albumCount": 16, "url": "…"
  },
  "latestSongs": [
    {
      "id": "3440589170", "name": "Universe's NO.1(摇摇领先)",
      "album": "Electro Surge", "albumId": "393292034",
      "cover": "…?param=400y400",
      "duration": 185505, "durationText": "3:06",
      "publishedAt": "2026-08-17", "trackNo": 1,
      "popularity": 10, "fee": 8,
      "url": "https://music.163.com/#/song?id=3440589170",
      "outerUrl": "https://music.163.com/song/media/outer/url?id=3440589170.mp3"
    }
  ],
  "hotSongs": [ /* 同结构 */ ],
  "latestAlbums": [
    {
      "id": "393292034", "name": "Electro Surge", "type": "EP",
      "cover": "…", "publishedAt": "2026-08-17", "year": "2026",
      "size": 6, "description": "…", "url": "…",
      "tracks": [ /* 同 latestSongs 结构 */ ]
    }
  ]
}
```

## 几个踩过的坑（都写进代码注释了）

- **`code` 不是 200 也要当失败**。网易云失败时照样回 HTTP 200，body 里塞
  `{code: 4xx}`，不判就会得到"成功的空列表"。
- **必须带 `Referer: https://music.163.com/`**，否则部分端点直接 403。
- **`/api/artist/songs` 已经不给匿名用了**（返回空数组），所以"最新"是
  从**专辑**里拼出来的：先拿专辑列表，再逐张拿曲目。
- **"最热"别自己按 `pop` 排**。`pop` 是 5 / 10 这种粗粒度分档，排出来等于没排；
  `/api/artist/top/song` 给的顺序才是官方的热度序。
- **日期按 UTC 取**。`publishTime` 基本是"北京 00:00"（时间戳落在 UTC 16:00），
  按 UTC 取日期才是网易云页面显示的那一天，否则整体 +1 天。
- **`fee` 不拿来做筛选**。`fee: 8`（低音质免费）照样能用外链播；
  按 `fee` 过滤会把能播的歌干掉一半。

## 这份数据被谁用

- `public/data/netease-music-zeo.json` —— ZEO 的构建产物，黑胶 demo 与音乐房间共用
- 重新生成：根目录 `npm run data:music`
