# 可以走进去的个人主页 · AISPIN 3D Home

<div align="center">

<img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
<img src="https://img.shields.io/badge/Three.js-0.182-000000?style=for-the-badge&logo=threedotjs" alt="Three.js" />
<img src="https://img.shields.io/badge/R3F-9-9C27B0?style=for-the-badge&logo=react" alt="React Three Fiber" />
<img src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 7" />
<img src="https://img.shields.io/badge/GSAP-3.14-88CE02?style=for-the-badge&logo=greensock&logoColor=black" alt="GSAP" />

**宋式院子 → 推开大门 → 一条走不到头的走廊 → 8 个房间。**

`黄泽昊 / ZEO / AISPIN` 的个人主页。不是一页滚动的简历，
而是一个可以用鼠标走进去的空间：院子里有柿子树、一棵樱花树、风铃和一条小白狗，
左院草地上停着一架**可以点开的小飞机**（点它就接管镜头绕岛飞一圈；飞行中
`WASD` / 方向键 / 拖拽都能操纵它的方向，松开自动回航线，`G` 回航，`Esc` 退出），
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
| `/me` | `src/me/index.html` | 一张平铺的名片页（纯 DOM，**不引 three**） |

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
| 前院小飞机 | 程序化几何 **3 mesh / 3 draw call / 1070 三角形 / 88 KB**，**零位图**（六个零件靠 `part` 顶点属性分色，材质只有一个） |
| 天空云团 | 天空穹顶只富化片元（**0 mesh / 0 draw**）；云团复用画廊那 8 张程序化云草图当**灰度遮罩**，3 个 `InstancedMesh` / 14 朵 / **零位图**。颜色每帧从穹顶的 uniform **派生**，不另存一份色板 |
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
    entrance/          院子、大门、门神、柿子树、樱花树、小白狗、燕子窝、小飞机
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
                       index.html = 该 entry 的 HTML（产物落到 dist/me/index.html）
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

两个 entry 的路径都能直接命中：`/demos/` 命中 `demos/index.html`。
只有不带尾斜杠的 `/me` 需要一条重写规则
（`public/_redirects` 里一条，dev/preview 由 `vite.config.js` 的中间件兜住）。

> ⚠️ **`/me` 的源码路径 ≠ 产物路径**（2026-10-12 起）。源码在
> `src/me/index.html`（与它的模块同目录 —— 让每个业务域自己内聚一个目录），
> 产物在 `dist/me/index.html`（URL `/me/`）。Vite 默认让「产物路径 = 源码
> 相对 root 的路径」，所以 `vite.config.js` 里有个 `flattenHtmlEntries` 插件
> 把它改回去；同时 dev 与 preview 的重写目标是**两个不同的路径**
> （dev → `/src/me/index.html`，preview → `/me/index.html`）。
> 以后再加这种「源码内聚、产物另置」的 entry，照这个套路来。

> ⚠️ **dev 下目录 URL 需要显式重写**：Vite 用 sirv 提供 `public/`，
> 而它配的是 `extensions: []`，**不会**把 `/demos/foo/` 解析成
> `/demos/foo/index.html`。请求落空后被 SPA 兜底接住，打开的是 3D 主站 ——
> 而生产环境却是对的。`vite.config.js` 里的 `rewritePublicDirIndex`
> 就是为了消掉这个「只有 dev 坏」的差异。

---

## 参考资料

造型与技术上的参考。**它们都不是本项目的依赖** —— 每一项都写清了"参考了什么"
以及"有没有真被用进代码"。

| 项目 | 参考的是什么 | 用进代码了吗 |
|---|---|---|
| [ITomPoland/portfolio-itom](https://github.com/ITomPoland/portfolio-itom) | **本项目的上游**（MIT）。场景骨架、走廊与房间的结构来自它 | ✅ 衍生自它，见下方「许可」 |
| [dgreenheck/tidewater](https://github.com/dgreenheck/tidewater) | 源码研读：渲染管线组织、几何/材质复用、性能清单 | ❌ 只读源码做判断，没有引代码 |
| [dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree) | 程序化树生成：分叉参数的分层设计、LOD 分层、presets 的字段命名 | ❌ 见下方说明 |
| [MengTo/sylva](https://github.com/MengTo/sylva) | **视觉参考**：梦幻森林那一套（苔藓/圆球的形态、指针交互） | ❌ **它不授权复用**，见下方说明 |
| [MengTo/kage](https://github.com/MengTo/kage) | 京都山寺「五章夜游」的实时 Three.js 光影与章节叙事节奏 | ❌ **它不授权复用**，见下方说明 |
| [fanhuayishiy/ai-demo](https://github.com/fanhuayishiy/ai-demo) → **[`sunset-flight-study`](https://github.com/fanhuayishiy/ai-demo/tree/main/sunset-flight-study)** | 三维 demo 合集。**飞机 / 天空 / 云只参考这一个子目录**（《红猪》风格的夕空飞行：奶油白单翼机、紫色雕塑云海、橙金天空、贴尾滚转运镜） | ❌ 只参考做法（MIT）；逐文件清单见下方 📌 |
| [huangbai-AI/yingxian-pagoda](https://github.com/huangbai-AI/yingxian-pagoda) | 应县木塔「一木千年」：六幕滚动三维科普站与可编辑模型 | ❌ **它不授权复用**，见下方说明 |
| [lhlGitHub/threejs-architecture-effects](https://github.com/lhlGitHub/threejs-architecture-effects) | 「可交互自装配 3D 建筑」的 Agent Skill：构件分层与建造动画的组织方式 | ❌ 思路参考（MIT） |

> ⚠️ **`sylva` 不授权复用。** 它的 README 明确写着 *"No license is granted for reuse
> or redistribution of the Sylva code, design, or artwork."*（只有它捆绑的 three.js
> 与 Lexend 字体各自仍是 MIT / OFL）。所以它**只能看、不能抄** —— 列在这里是说清
> "森林那套观感从哪来"，不是"代码从哪来"。
>
> ⚠️ **`kage` 与 `yingxian-pagoda` 同样不授权复用。** 两个仓库里都**没有 LICENSE**
> （GitHub 上显示为 `NONE`）—— 没有许可证就等于**默认保留全部权利**，
> 所以只能看、不能抄它的代码或素材。列在这里同样是说清"观感从哪来"。
>
> ⚠️ **`ai-demo` 与 `threejs-architecture-effects` 是 MIT**，所以**做法可以学**
> （与上面那三条"只能看"的相反）。至于用不用、用到什么程度，以本项目自己的取舍为准。
>
### 📌 `ai-demo` 里我们参考的到底是哪一个：`sunset-flight-study`

**源码入口** — <https://github.com/fanhuayishiy/ai-demo/tree/main/sunset-flight-study>
（`main` @ **`bd4810c8`**，2026-10-10；仓库 MIT）

**在线预览**（**不必 clone** 就能看效果）— <https://fanhuayishiy.github.io/ai-demo/sunset-flight-study/dist/>
配套：效果图 `sunset-flight-study/docs/screenshots/` ·
复现提示词 `sunset-flight-study/docs/RECREATE_PROMPT.zh-CN.md`

> ⚠️ **2026-10-14 记下这一条，起因是「飞机 / 天空 / 云」要对齐时又在磁盘上找不着它了。**
> 搜过全盘：本地**没有**副本，只剩我们自己代码里的引用注释。
> ⇒ **别再假设本地有** —— 要重对齐先看上面的在线预览，或 clone 到
> `.workbuddy-ai/.tmp/`（**别进 git**，它会带一堆位图资产）。

逐文件 —— 只列我们**真的读过并据以做判断**的：

| 参考文件 | 我们从它拿了什么 | 我们这边落在哪 |
| --- | --- | --- |
| `src/sunset-world.js` | `createCloudMaterial`（cel 分色 + 朝阳金边 + 距离霾）、`createSky()` 的穹顶做法 | `shaders/skyClouds.js` · `config/skyClouds.js` · `SceneLighting.jsx` |
| `src/cel-material.js` | 分色阈值 `smoothstep(0.10, 0.135, ndl)`、`createOutlineMaterial` 的描边做法 | `shaders/airplane.js` |
| `src/anime-renderer.js` | 单趟电影后期（**接管一帧的渲染**）、`LinearSRGBColorSpace` 的取色空间 | `entrance/FlightFinish.jsx` · `shaders/flightFinish.js` · `docs/color-space.md` |
| `src/pilot-motion.js` | 「驾驶 = 位置指令」：输入 → 目标位置，航线照旧是航线 | `utils/pilotMotion.js` · `utils/pilotInput.js` |
| `src/flight.js` | 航线的设计思路（`R_NEAR` / `R_FAR`） | `utils/flightPath.js` |
| `docs/validation.md` | 它自己的验收清单 —— 参考"哪些量值得量" | 只读，没引代码 |

**⚠️ 还没读、但下次该先读的：`src/painted-clouds.js`（7.2 KB）**
它有一套**独立于 `sunset-world.js` 的"手绘云"**实现。我们做云的时候只看了
`sunset-world.js` 的 `createCloudMaterial`，**从没打开过这个文件** ——
2026-10-14 诊断"我们的云为什么不如它"时才发现它在这儿
（诊断见 `docs/clouds.md`，待办见 `WORKPLAN.md` 的 WO-32 / DR-V）。
同目录另有 `reference-*.js` 一整套（`reference-flight` / `reference-effects` /
`reference-aircraft`），是它给自己留的「对照基准」。

> ⚠️ **不做依赖、不引代码。** 与本项目「零位图 / 全程序化」冲突的部分明确**不搬**
> （`MarchingCubes` metaball 云、`assets/` 里的位图）—— 见 `config/skyClouds.js`
> 顶上那段「为什么**不**照抄参考实现的云」。
> 另外它的云是**紫色色阶 + 金边**的 cel 语言，本项目是**水墨**（`utils/cloudArt.js`
> 的白身 + 墨线 + 腹灰）—— 这条差异是**故意**的，不是没对齐，别当成 bug 去"修"。

> ⚠️ **`ez-tree` 是 MIT，但本项目的树没有用它。** 它是 `Tree extends THREE.Group`，
> 并且**没有**「只取几何、不取材质」的出口：`generate()` 把顶点灌进
> `this.branches/{verts,normals,indices,uvs,windFactor}` 与
> `this.leaves/{verts,normals,indices,uvs}` 之后，`createBranchesGeometry()` /
> `createLeavesGeometry()` **自己就建材质、写进 mesh**（不返回任何东西）。
> 而默认路径会把 **20 张贴图以 base64 内联进库** —— 产物 **4 MB / gzip 2 936 KB**，
> 且贴图注册表 `Z` 是**模块级**、`import` 当场就把它们 `TextureLoader.load()`
> 解码成 `Texture`（所以 tree-shake 不掉）。这与本项目「**零位图**」的硬规矩
> （见上方"美术"）直接冲突。另外三处与这里的设计不一致：
> 它的枝条是 **`cylinder without end caps`**（源码原话）且**没有关节几何**，
> 而本项目的「树干衔接自然」正是靠**关节椭球**做的；它的叶子是 `alphaTest` 的
> **交叉四边形**（`Billboard.Double` = 两片成 90° 的平面，**不是朝向相机的公告板**，
> `side: DoubleSide`），而这里已经改成有中脉的实体叶片；它的材质是
> `MeshPhongMaterial` 加自带的 `onBeforeCompile` 摆风，而这里走的是四季色板的
> 共享 uniform。草地它也没有 —— 库（`src/lib/`）的导出面里没有草。
> 结论：**留作参考，不做依赖。**
>
> 这几条判断的依据都在 `.workbuddy-ai/memory/`（不随仓库发布）。

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
