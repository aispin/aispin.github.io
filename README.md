# 可以走进去的个人主页 · AISPIN 3D Home

<div align="center">

<img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
<img src="https://img.shields.io/badge/Three.js-0.182-000000?style=for-the-badge&logo=threedotjs" alt="Three.js" />
<img src="https://img.shields.io/badge/R3F-9-9C27B0?style=for-the-badge&logo=react" alt="React Three Fiber" />
<img src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 7" />
<img src="https://img.shields.io/badge/GSAP-3.14-88CE02?style=for-the-badge&logo=greensock&logoColor=black" alt="GSAP" />

**宋式院子 → 推开大门 → 一条走不到头的走廊 → 8 个房间。**

`黄泽昊 / ZEO / AISPIN` 的个人主页。不是一页滚动的简历，
而是一个可以用鼠标走进去的空间：院子里有柿子树、风铃和一条小白狗，
走廊两侧是 8 扇门，每扇门后面是一个房间。

</div>

---

## 这是什么

一个纯前端的 3D 个人站点。没有后端，没有数据库，所有内容都是
`src/data/*.json` 里的静态数据，构建时打包进去。

进入方式：镜头从院门口起飞，穿过大门，落在无限循环的走廊里。
滚动前进，走廊会一直延伸；点任意一扇门，就进到那个房间。

| 房间 | 内容 |
|---|---|
| 档案 | 经历、教育、在意的方向 |
| 摄影 | 摄影作品 |
| 工作室 | 做过的项目，以及还在实验的念头 |
| 文稿 | 随笔、笔记，以及站外连载的小说 |
| 视频 | 短片与日常记录 |
| 音乐 | 自己写的曲子与配乐 |
| AI+ | 自己做的 Skills、工具与应用 |
| 联系 | 联系方式与社交账号 |

---

## 两个入口

构建时产出**两个独立的 HTML entry**，各自打包、互不拖累：

| 路径 | 入口 | 是什么 |
|---|---|---|
| `/` | `index.html` | 3D 房子（React + three.js） |
| `/me` | `me/index.html` | 一张平铺的名片页（纯 DOM，**不引 three**） |

`/me` 是「给 HR、合作方、搜索引擎看的那一面」：姓名、三种身份、代表作品、
已发行曲目、联系方式，一屏一屏排下来，不需要鼠标在 3D 里走。
它的内容同样来自 `src/data/`（见下方"内容维护"），视觉沿用
`public/demos/web3d/3d-ip-landing/` 原型的现代落地页风格，与 3D 房子的
宋式暖纸风刻意区分开。

两个页面共用 `localStorage` 里的 `aispin-theme` / `aispin-language`，
所以在房子切到夜间模式，再打开 `/me` 也是夜间模式。

> `/me` 的打包体积：**me chunk 20 KB + 共享数据 chunk 71 KB + CSS 17 KB**
> （gzip 后合计约 39 KB）。因为它只 import `src/data/*.json` 和
> `src/audio/bgm.js`，完全绕开了 three.js —— 这正是分成两个 entry 的理由。

---

## 随手放的原型：`/demos`

`public/demos/` 是放临时原型与试验页面的地方。丢一个目录进去，
**构建时会自动**扫出 `demos.json` 和一张列表页 `demos/index.html`，
缺 `README.md` 的还会按 `index.html` 里的标题/描述补一份。

```bash
node scripts/build-demos-index.mjs   # 手动跑；vite dev / build 也会自动调
```

识别规则：根目录下的单个 `.html` 算一个 demo；每个深度 ≥1 且含有 `.html`
的目录算一个 demo，`index.html` 当入口，其余 `.html` 记为 variants。

---

## 技术栈

| | |
|---|---|
| 框架 | React 19 · Vite 7 |
| 3D | three 0.182 · @react-three/fiber 9 · @react-three/drei 10 |
| 动效 | GSAP 3.14 |
| 样式 | SCSS（`sass`） |
| 离线 | 手写 Service Worker（`public/sw.js`）+ Web App Manifest |

---

## 美术：全部程序化生成

**这个项目几乎没有位图素材。** 青砖墙、瓦当、水墨画、门神、春联、
木头家具、纸张、云、屏幕上的每一张贴图，都是用 `CanvasRenderingContext2D`
在运行时画出来的 —— 没有一张 jpg/png，全站位图只剩一张头像 webp。

做这件事的公共设施在 `src/engine/`：

| 模块 | 作用 |
|---|---|
| `engine/art.js` | 确定性随机（`seededRand`）、画布工具、**按 key 缓存的 `CanvasTexture`** |
| `engine/resources.js` | 几何体与材质的复用缓存、抠图材质、世界坐标 UV |
| `engine/audioBus.js` | 全站**唯一**的 `AudioListener` |

三条必须遵守的契约（写在 `art.js` 顶部）：

1. **确定性** —— 不用 `Math.random()`，只用 `seededRand(key)`，
   同一个 key 永远给出同一串数。否则每次刷新贴图都不一样。
2. **缓存即查表** —— 生成器可以在 render body 里直接调用，
   因为它实际上只是一次 `Map` 查找。
3. **宽高比契约** —— 画布按它最终贴到的那个平面的真实宽高比作画，
   并导出 `*_ASPECT` 常量。不要照抄参考图的像素比例。

程序化贴图的生成器都在 `src/utils/*Art.js`，着色器在 `src/shaders/`。

---

## 性能

场景是**故意**做得比"能跑就行"更省资源的，几个实测数字：

| | |
|---|---|
| 几何体复用 | 入场场景 distinct geometry **1008 → 446**，走廊 **735 → 169**（最大复用次数 96） |
| 透明材质 | **477 → 321**（其中 219 个是抠图被误标成透明） |
| 音频 | 42 个 `PositionalAudio` 各自 `new AudioListener()` → **全站 1 个** |
| 阴影 | `castShadow` / `receiveShadow` 全库 0 处，所以 shadow map pass 直接关掉 |
| 生产构建 | three / react / gsap / r3f 各自独立 chunk（`three` 719 KB → gzip 187 KB） |
| `/me` 的体积 | me chunk **20 KB** + 共享数据 71 KB + CSS 17 KB（gzip 后 ~39 KB），**不含 three** |

另外：

- **`RoomWarmup`** 在加载屏后面把所有房间挂在屏幕外预热一遍着色器，
  避免进房间那一刻卡一下。
- **三级画质降级**：按 `navigator.deviceMemory`、CPU 核数、视口尺寸
  自动调整 `dpr`、抗锯齿和贴图精度。软件 WebGL 的机器会降到 LOW 档，
  而不是直接黑屏。
- **字体是构建期子集**：Maple Mono CN 源字体约 18 MB，永不入库；
  只提交按 `src/` 全量字符集裁剪出来的子集（见下方"字体"）。

---

## 目录结构

```
src/
  components/canvas/   3D 场景
    entrance/          院子、大门、门神、柿子树、小白狗、燕子窝
    corridor/          无限走廊、门、门牌、装饰
    rooms/             8 个房间
    audio/             SpatialSfx / AmbientSource
    shaders/           自定义材质
  engine/              可复用引擎层（art / resources / audioBus）
  utils/               程序化贴图生成器（*Art.js）
  shaders/             GLSL 片段（墙面、地板、水墨…）
  config/              theme.js（房间表、灯光、字体、双语房间文案）
  data/                站点内容（JSON）
  audio/               Web Audio：生成式 BGM 引擎、环境音、纸声音效
  me/                  /me 名片页（纯 DOM，无 React / 无 three）
me/index.html          /me 的 HTML entry
scripts/               构建期脚本（字体子集、demos 索引、AI 项目同步）
public/                静态资源（字体、声音、贴图、demos）
```

> **文案放哪**：双语房间名/描述在 `config/theme.js` 的 `ROOM_COPY`，
> 内容型文案直接写在 `data/*.json` 里（字段用 `{ "zh": …, "en": … }`
> 或成对的 `title` / `titleEn`）。没有一个单独的 i18n 目录 ——
> 曾经有过 `src/i18n/*.json`，但从来没有代码读它，是**改了不生效**的陷阱，
> 已删除（归档在 `.workbuddy-ai/removed-dead-i18n-*.tar.gz`）。

---

## 本地开发

需要 **Node.js 20+**。

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 产出 dist/
npm run preview      # 本地预览构建结果
npm run lint
```

> 首次进场景时着色器要编译，低端机/软件渲染下会慢几秒 —— 这是正常的，
> `RoomWarmup` 就是为了把这个代价挪到加载屏后面。

---

## 内容维护

站点内容全在 `src/data/`，改 JSON 即可，不需要动组件：

```
site.json         站点标题、作者、SEO
profile.json      档案（教育、技能、联系方式）
projects.json     工作室项目
articles.json     文稿
photography.json  摄影
videos.json       视频
music.json        音乐
aiProjects.json   AI+（由 scripts/refresh-ai-projects.mjs 从 GitHub 同步）
experiences.json  工作经历
events.json       时间线
labs.json         实验中的念头
me.json           /me 名片页的编辑性文案（身份、作品选哪些、联系区文案）
```

`me.json` 里不重复存事实 —— 姓名/邮箱来自 `profile.json`，作品来自
`projects.json`（用 `projectId` 引用），曲目来自 `music.json`。
`src/me/meData.js` 负责把这几份接起来，所以改一处不会漏另一处。

`aiProjects.json` 可以重新拉取：

```bash
GITHUB_TOKEN=xxx node scripts/refresh-ai-projects.mjs
```

---

## 字体

界面和场景文字用 **Maple Mono CN**。源字体约 18 MB，**不入库**；
仓库里只提交裁剪后的子集：

| 文件 | 用途 |
|---|---|
| `public/fonts/maple-ui.woff2` | DOM / CSS 首选 |
| `public/fonts/maple-ui.woff` | DOM 的 woff 兜底，**同时也是 3D 场景字体** |

> 上面两个是**同一份子集的两种 flavour**，字符集完全相同、内容逐字节等价
> （所以 DOM 和 3D 可以共用一个文件）。历史上还多出过 `maple-cn.woff`
> （与 `maple-ui.woff` 逐字节相同的重复品）和 `maple-3d.woff`
> （按"最小场景字符集"裁的旧产物 —— 正是它缺字触发了上面那个 CDN 崩溃），
> 两者都已删除。

`public/fonts/` 里**只有这两个文件** —— 全站（DOM + 3D 场景）只有一个字体家族。
历史上还并存过三个手写体（`CabinSketch-Bold` / `CabinSketch-Regular` /
`RubikScribble-Regular`，以及更早的 `FrederickatheGreat-Regular`），
它们都是 Latin-only，覆盖不了中文与符号，任何一个动态字符串落到它们身上
都会触发下面那个 CDN 崩溃；而那点"手写感"在 3D 场景里几乎看不出来。
**2026-10-07 已整体删除**，归档在 `.workbuddy-ai/removed-sketch-fonts-*.tar.gz`，
不要再按旧文档去找它们。

> ⚠️ **3D 场景必须用 woff，不能用 woff2** —— troika（drei 的 `<Text>`）
> 只解析 ttf/otf/woff。而且场景字体**必须覆盖所有可能出现的字**：
> 一旦缺字，troika 会回退到 `cdn.jsdelivr.net` 的 unicode-font-resolver，
> 这个 CDN 在国内/离线环境不可达，promise 被拒后 `<Text>` 会永远不同步 ——
> 而 drei 的 `Text` 是 suspend 的，**整个 R3F 场景会一起挂住**。
>
> 所以 `scripts/build-scene-fonts.py` 收集 `src/` 下出现的**每一个字符**
> 来裁剪，宁可大一点也不能缺字。

改了 `src/` 下任何文案（`data/*.json`、`config/theme.js`、组件里的中文字面量）
之后都要重新生成子集，否则新字会缺：

```bash
python3 scripts/build-scene-fonts.py
```

---

## 部署

构建产物是纯静态文件，`dist/` 直接丢给任意静态托管即可。
仓库里带了 GitHub Pages 的配置：

- `.github/workflows/deploy.yml` —— push 到 `main` 自动部署
- `public/.nojekyll` —— 让 GitHub Pages 发布下划线开头的文件
- `public/_headers` · `public/_redirects` —— Cloudflare Pages 用
- 构建时会把 `index.html` 复制成 `404.html`，保证任意深链都能落到 SPA 入口

两个 entry 的路径都能直接命中：`/me/` 命中 `me/index.html`，
`/demos/` 命中 `demos/index.html`。只有不带尾斜杠的 `/me` 需要一条重写规则
（`public/_redirects` 里一条，dev/preview 由 `vite.config.js` 的中间件兜住）。

> ⚠️ **dev 下目录 URL 需要显式重写**：Vite 用 sirv 提供 `public/`，
> 而它配的是 `extensions: []`，**不会**把 `/demos/foo/` 解析成
> `/demos/foo/index.html`。请求落空后被 SPA 兜底接住，打开的是 3D 主站 ——
> 而生产环境却是对的。`vite.config.js` 里的 `rewritePublicDirIndex`
> 就是为了消掉这个「只有 dev 坏」的差异。

---

## 许可

代码以 [MIT License](LICENSE) 开源。

本项目是 Tomasz "ITom" Szmajda 的开源作品
（[portfolio-itom](https://github.com/ITomPoland/portfolio-itom)）的**衍生作品**：
保留了 MIT 许可与原始版权声明，并在其上做了大量改造 ——
场景主题从原作的走廊/房间改为宋式院子，美术资源全部重做为程序化生成，
并新增了可复用引擎层与性能优化。

> **注意**：原作 README 声明「所有个人素材、3D 贴图、图片与文案的版权归
> Tomasz Szmajda 所有，未经许可不得复用」。本项目已**移除并替换**了原作的
> 全部素材与文案，因此仓库中不包含原作的个人素材。

---

<div align="center">

*Designed and developed by **ZEO** (黄泽昊)*

</div>
