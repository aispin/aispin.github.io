# @aispin/pixabay-user

给一个 Pixabay 用户 id，抓他的**最新 N 件作品**（照片 / 插画 / 矢量 / 视频），产出一份静态 JSON。

零依赖、独立可发布，不进站点 bundle。给 Gallery / Videos 房间供数据。

```bash
node packages/pixabay-user/src/cli.js -u aispin-40699950 --latest 12 -o public/data/pixabay-aispin.json
```

## 为什么是抓，不是 API

**Pixabay 官方 API 没有"按用户筛选"的参数。** `/api/` 支持 `q / id / category / colors /
orientation / order / page`…，没有 `user` / `user_id`。而且必须带 `key`（免费注册，
100 req/60s）。也就是说：想按用户取，只能抓页面。

页面抓取的门槛是 **Cloudflare**：

| 做法 | 结果 |
| --- | --- |
| `curl` / `https.get` | **403**「Just a moment...」 |
| 无头 Chrome，默认 UA | **403** |
| 无头 Chrome + `--disable-blink-features=AutomationControlled` + **Emulation** 覆盖 UA | **200** |

🔴 最后一条里有两个坑，都实测过：

1. **UA 必须用 `Emulation.setUserAgentOverride`**，不能用 `Network.setUserAgentOverride`。
   后者只改请求头，`navigator.userAgent` 还是 `HeadlessChrome`，Cloudflare 照样拦。
2. **必须带 `--no-sandbox`**。不加的话 `Target.createTarget` 出来的页面会立刻
   `Inspector.targetCrashed`，之后每个 CDP 调用都超时（macOS 也会踩，不是 Linux 专属）。

## 为什么不用 puppeteer

`packages/` 下的包要能被别的项目直接 `import`，不该拖一个 300MB 的浏览器依赖。
Node 22 自带 `WebSocket`，CDP 只是"发 JSON、收 JSON" —— `src/browser.js` 一百多行够了。

需要本机有 Chrome。找不到时用 `--chrome <path>` 或 `CHROME_PATH` 指定。

## 用法

```bash
# 基本
pixabay-user -u aispin-40699950 --latest 12 -o photos.json

# 也可以直接给用户页 URL
pixabay-user -u https://pixabay.com/users/aispin-40699950/

# 只要照片（不含插画）
pixabay-user -u aispin-40699950 --type photo

# 看浏览器在干什么（调试用）
pixabay-user -u aispin-40699950 --headful
```

| 参数 | 说明 |
| --- | --- |
| `-u, --user` | 用户页 URL，或 `aispin-40699950` 这种「名字-id」 |
| `-l, --latest` | 最新 N 件，默认 **12** |
| `-p, --popular` | 最热 N 件，默认 0（不抓） |
| `-t, --type` | `all` \| `photo` \| `illustration` \| `vector` \| `video`，默认 `all` |
| `-o, --out` | 输出文件，可重复；不给就打 stdout |
| `--chrome` | Chrome 路径 |
| `--headful` | 显示窗口 |

## 输出

```json
{
  "generatedAt": "2026-11-12T...",
  "source": { "url": "https://pixabay.com/users/aispin-40699950/", "scrapedWith": "headless chrome (CDP), no api key" },
  "user": { "name": "aispin", "avatar": "https://cdn.pixabay.com/user/…", "bio": "…", "url": "…" },
  "latestPhotos": [
    {
      "id": "8426798",
      "type": "photo",
      "title": "Snowy alpine mountain peaks",
      "description": "Snowy alpine peaks above forested slopes beneath a clear blue sky.",
      "publishedAt": "2023-12-05",
      "tags": ["Mountain", "Landscape", "Snow", "Sky", "Nature"],
      "width": 4032, "height": 2268,
      "image": "https://cdn.pixabay.com/photo/…/mountain-8426798_1280.jpg",
      "preview": "https://cdn.pixabay.com/photo/…/mountain-8426798_640.jpg",
      "url": "https://pixabay.com/photos/mountain-landscape-snow-sky-nature-8426798/",
      "views": 142, "downloads": 9, "likes": 3,
      "exif": { "Camera": "Dji Fc3582" }
    }
  ],
  "latestVideos": [],
  "popularPhotos": [],
  "total": { "photos": 12, "videos": 0, "listed": 15 }
}
```

- `latestPhotos` / `latestVideos` 分开，因为**房间不同**（Gallery 用前者，Videos 用后者）。
- 顺序 = **发布日期倒序**。列表页的顺序本来就是"最新"，但日期只有详情页有，
  所以要抓完再排一次；同日期按列表原顺序（稳定的）。
- `image` 是 1280 宽的预览（`preview` 是 640）。**原图要 full API access，抓不到**，
  而且原图动辄好几 MB —— 网页展示用 1280 足够。

## 几个页面坑（都实测过）

- **用户页没有"视频"这个 tab 链接**，`?order=latest` 的列表里也没有 `<video>`。
  视频要靠列表卡片里 `href` 是 `/videos/...` 的那些来识别 —— 目前 aispin 这个
  账号一个视频都没有，所以 `latestVideos` 是空数组。
- **详情页不能只等 `<img>` 就绪**：骨架屏里也有图，会读到 `datePublished: null`、
  `width: null`。判据必须是「`ld+json` 里出现 `ImageObject`/`VideoObject` 且带 headline」。
- **tag 要认路径**：`/photos/search/mountain/` 是媒体自己的 tag；
  `/images/search/fall/` 是全站「热门分类」下拉菜单，混进来就是
  Fall / Thanksgiving / Christmas。
- **标题带 SEO 后缀**（`… photo` / `… illustration`），要剪掉；类型已经是单独字段。
- **别用 `id` 排序当"最新"**：老作品编辑一次 id 不变但会往前挪，列表顺序才是真顺序。
- 🔴 抓取脚本里那段跑在页面里的 `READ_DETAIL` 是**模板字符串**：里面不许出现反引号，
  也不要用正则字面量（`\/` 会被转义吃掉，报 `Unexpected token ']'`）——
  路径判断改成了 `split('/')`。

## 版权 / 使用边界

Pixabay Content License：可以免费用于商业用途，但——

- **不要长期热链**官方 CDN（文档明确：`URL valid for 24 hours`、`permanent hotlinking not allowed`）。
  临时展示可以，长期用要下载到自己服务器。
- 本项目当前**只存 URL 不存图**，等于"临时展示"。真要长跑，`pixabay-user` 可以加一个
  `--download <dir>`，但那样就得考虑仓库体积（每张几百 KB × 12）。