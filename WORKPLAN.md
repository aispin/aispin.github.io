# 工作计划 · aispin.github.io

> **本文件是白板，不是台账。**
>
> 只放**待办**：待做的 **WO** + 待你拍板的 **DR**。
> 🔴 **代码一提交，就把该 WO 删掉** —— **不等验收、不等下一轮**
> （用户 2026-10-08 原话：「完成的WO、关闭的DR要在**提交代码后**及时从 Workplan 移除。
> Workplan 永远只留待办 WO 和 DR」）。
> 过程记录、实测数据、踩坑结论一律进 `.workbuddy-ai/memory/`（入口 `MEMORY.md`）；
> 沉淀下来的技术结论进 `docs/`；历史在 git。
> ⚠️ 所以本文件里**不该出现「已交付，待验收」这种段落** —— 那又是台账。
>
> ⚠️ 2026-10-12 用户反馈：**「你把快照滚动当流水帐去用了」** ——
> 顶部「📊 滚动快照」段已删。**状态写进每条 WO 自己，不再另开历史段。**

## 规范

| 记号 | 是什么 | 谁做 |
| --- | --- | --- |
| **WO** | Work Order —— 需求原文 / 现状 / 改什么 / 验收判据 | 我做，你验收 |
| **DR** | Decision Request —— **必须由你做的决定** | 你 |

流程：收到需求 → 拆 WO（**影响面大的配一个 DR 请你 review**）→ 本文件单独 commit
→ 无 DR 直接做、有 DR 等你决策 → 做完发起验收 → **代码一提交就移出本文件**。
验收有分歧就作为新一轮的新 WO 重新进表（版本历史在 git）。

## 执行注意（常驻，细节在 memory）

- **分支** `feat/v1.2.0-island-courtyard`，**不推 `main`**（推 `main` = 上线）。
- **质量门** `env -u NODE_OPTIONS npm run lint` → **0 error / 33 warning**；不跑 React Compiler。
- **构建前** `mv dist .workbuddy-ai/dist-prev-<ts>`；**推不通改 SSH**，判据 `gh api .../commits/<branch> --jq .sha`。
- **跑截图前** `pkill -f chrome-headless-shell`。
- 其余见 `.workbuddy-ai/memory/MEMORY.md` · `hard-rules.md`。

---

# 📋 待办 WO

> 上一轮（云朵第四轮 / 第五轮）的 WO-32a~f、WO-33a~f 全部已提交出表，历史在 git。
> 本轮（2026-10-16 用户追加）：**「档案馆」改成「履历」房间**，新路由 `/career`，
> 数据源换成 `experiences.json`，墙面参考 `public/demos/web3d/career/index.html`
> 的"文字生成背景"技法；同时把该技法抽成独立模块供其他房间复用。

## 本轮已量的底数（不是障碍，但决定设计）

- **对着门那面墙**：平面 24 × 16（`ContentRoom.BackWall`，房间局部 z = −10）。
  相机进门后停在墙前 **8.11** 单位、正对法线（实测 `camDir` 与 `wallNormal`
  点积 = −1.000），此时**屏幕上看得见的墙面是 16.59 × 9.35**，中心在墙局部
  y ≈ +0.65 ⇒ 全幅贴图会有 **31% 宽 / 42% 高**落在框外，白付显存。
  探针 `probe-career-room.mjs`。
- **房间现状**：4 列 × 3 行 = 12/页；`about` 现在渲染 **11 张卡**
  （profile 简介 + 5 条经历 + 4 个项目 + 关注方向），**只用了 experiences 的前 5 条**。
  而 `experiences.json` 有 **8 条**（中英各 8）⇒ 8 条正好 **4×2 一页**放得下，不用翻页。
- **渲染开销（在房间里，HIGH 档）**：26 draw calls / 1060 tri / 134 textures /
  68 programs；全场 canvas 贴图 114 张 ≈ **78.5 MB** 估算显存。
- **文字生成背景的模块已经有了**：`src/utils/texturalArt.js`（技法来自那个 demo，
  复用 `engine/art.js` 的种子/画布/纹理缓存；配色参数化，暖色一组是
  `WARM_TEXTURAL`）。已验：同输入两次**逐字节相同**、模糊真的生效、
  1024×683 → 74 ms / 1536×1024 → 160 ms / 2048×1366 → 304 ms（含强制冲刷）。
  预览图见 `.workbuddy-ai/shots/career/textural-*.png`，
  探针 `probe-textural-module.mjs`。

---

## WO-C2 · 房间改名「履历」+ 新路由 `/career`

**改什么**（显示名 + 路由；内部 id 是否一起改见 **DR-2**）
- `src/config/theme.js`：`ROOMS` 第 1 条 `zh:'档案'` → **`zh:'履历'`**；
  `ROOM_COPY` 换成履历的一句话。
- `src/hooks/useDocumentMeta.js`：`ROOM_META` 的 `path:'/about'` → **`'/career'`**，
  title/description 跟着改；`PATH_TO_ROOM` 加 `'/career'`。
- `src/components/canvas/rooms/ContentRoom.jsx`：`ROOM_TITLES` 的 `about` → 履历。
- `public/sitemap.xml`：`<loc>.../about</loc>` → `/career`。
- `index.html` SEO fallback：`<a href="/about">` → `/career`、`<article id="about">`、
  以及第 76 行那句「ABOUT 档案」。
- `public/_redirects` 注释里提到的 `/about` 一并更新。

**验收判据**
1. 直接打开 `/career` → 自动传送进房间（深链）；`document.title`、`link[rel=canonical]`、
   `og:url` 三者都是 `/career`。
2. 走廊地图（`NavigationUI`）第 1 格显示「履历 / CAREER」。
3. `sitemap.xml` 里不再有 `/about`。

## WO-C3 · 履历房间的内容与墙面

**改什么**
- 数据源换成 `getLocalizedCollection('experiences', language)` **全 8 条**，
  不再掺 profile / projects / skills。
- 布局改成 **4 × 2 = 8/页**（现在是 4×3=12/页），一页放下，**去掉翻页**。
- 卡面重排：公司名（大字）+ 岗位 + 日期（`endDate` 缺失 ⇒ 「至今 / Present」）
  + 地点 + `responsibilities` 摘要。`performance[]` 可选，有则带一条。
- **对着门那面墙**用 `texturalArt` 生成背景（暖色版，`WARM_TEXTURAL`），
  把公司名平铺进去。贴图尺寸**按 tier 分档**（见下面的坑 ②）。
- 生成时机放进 `RoomWarmup`（`RoomWarmup.jsx:122` 那处已经预挂 `roomId="about"`），
  让 HIGH/MEDIUM 档在预加载屏后面付掉成本。

**验收判据**
1. 同机位 before/after 截图（`?noloader=1`，`probe-career-room.mjs` 的 `suggestCam`）。
2. 8 条经历的卡面**四角投影全部落在可见窗口内**（|x| ≤ 8.3、−4.0 ≤ y ≤ 5.3）。
3. 无翻页控件；`pageCount === 1`。
4. 进房间那一刻**帧间隔没有 > 100 ms 的尖峰**（`room-entry-stall.mjs` 的 HIGH 档读数）。
5. draw calls 增量 **< 15**；新增贴图显存 ≤ 8 MB（MEDIUM 档）。
6. `env -u NODE_OPTIONS npm run lint` → 0 error / 33 warning。

---

# 🙋 待你拍板的 DR

### DR-1 · 旧的 `/about` 链接怎么处理

**背景**：`/about` 是**已经公开索引过**的 URL（`public/sitemap.xml` 里就有一条），
外面可能已经有人存了链接。改成 `/career` 之后，旧链接会走 SPA 兜底落到走廊
（不报错，但深链失效、也不会自动跳）。

- **(A) 保留别名**：在 `getInitialRoomFromUrl()` 里把 `/about` 映射到 `career`，
  旧链接照常进房间（URL 仍是 `/about`，或再 `replaceState` 成 `/career`）。
  代价：多一处要维护的映射。
- **(B) 直接弃用**：只留 `/career`。代价：旧链接静默失效。
- **(C) 别名 + Cloudflare 301**：`public/_redirects` 加一条真 301
  （GitHub Pages 会忽略该文件，只有 Cloudflare Pages 生效）。

### DR-2 · 内部 `roomId` 要不要一起从 `about` 改成 `career`

**背景**：现在全站满足 `route === roomId` 的不变量（`/gallery`↔`gallery` …）。
只改路由不改 id，这个不变量就破了 —— 能用，但下一个人会踩。

- **(A) 一起改**（推荐）：动 9 个文件（`theme` / `CorridorSegment` / `RoomInterior` /
  `RoomWarmup` / `TeleportRoom` / `App` 的 `DOOR_Z` / `ContentRoom` /
  `ScreenReaderOverlay` / `useDocumentMeta`）。不变量保持。
- **(B) 只改显示名与路由**：内部仍叫 `about`，改动面最小。

### DR-3 · 墙面配色走哪一套

**背景**：参考的 demo 是**深色霓虹**（底色 `#06070c`、色团低明度、整体很暗），
而房间是**暖白奶油 + 木色**。照搬会把房间撕开。

- **(A) 只借技法、配色改暖**（推荐）：文字平铺 + 色团 + 模糊全部保留，
  但底色用房间的奶油、色团用 `ACCENT.about = #E0A46A` 系的琥珀。
  墙还是"房间的一部分"。
- **(B) 整面墙照搬 demo 的深色**：做成"房间里嵌了一块暗色屏幕"，对比强烈。
  代价：和现有 `#FFF6E9` 墙、`PALETTE.wood` 地板的关系要重新设计，
  而且房间没有独立光源（全站 `shadows={false}`、房间只有一盏 `pointLight`）。

### DR-4 · 文本背景落在**墙**上还是落在**卡片**上

- **(A) 整面墙做文本背景 + 8 张卡片叠上去**（推荐）：一进门就是一整面
  "文字浮雕墙"，卡片浮在前面。视觉冲击最大，也最像 demo 的气质。
- **(B) 卡片各自带文本背景，墙保持素色**：等于把 demo 的**每张卡**搬过来
  （demo 本来就是每张卡一张贴图）。代价：8 张卡 = 8 张贴图，
  显存和生成耗时都是 (A) 的数倍（实测 1024×683 一张 110 ms ⇒ 8 张 ≈ 880 ms）。
- **(C) 两者都做**：墙一层淡背景 + 卡片各带一层。最贵。

### DR-P · 「零位图」要留一个**有限放宽**的口子吗（备查，当前**不启用**）

- **你要求的**：「DR-O 按 1 做优化，**新增加一个 DR 做有限放宽的说明**」。
- **背景**：DR-K 已查明 ez-tree demo 的逼真来自**位图贴图 + glb 资产**，
  而本项目硬规矩是 **零 jpg/png（只用 webp）、全站只允许 2 张位图**。
  DR-O 选了 (i)「不放宽，继续程序化」，WO-19 已按这条做完（`f7fc1ac`）。
- **这个 DR 记录的是"万一将来顶不上去"时的退路**（**现在不动**）：
  - **可放宽的最小集合**：**2 张 webp** —— ① 树皮 **normal** 一张
    （比 color 有效得多：树皮的"糙"主要读自法线，不是颜色）；
    ② 叶片 **形状 alpha** 一张（叶缘不规整 + 叶脉，一次解决很多片叶的观感）。
  - **不放进来的**：color 贴图（我们能程序化出色）、每物种一套 4 张、
    `grass.glb` 这类模型资产（那会连带改 `public/` 与体积预算）。
  - **放开的代价**（真要启用时要同步改的地方）：README「美术」段的零位图声明、
    `.workbuddy-ai/memory/hard-rules.md` 里的相关条目、以及
    `texturePreloadList.js` 的预载清单。
  - **触发条件**（写清楚，免得变成"随手就放宽"）：WO-19 已交付（`f7fc1ac`）；
    若你验收时仍觉得**树皮**或**叶片**明显"不像"，再回来启用；启用前先量一次
    "程序化版本 vs 贴图版本"的同机位对照。
- **当前状态**：**不启用**。此条只作决策留痕。

---

## 已答复的 DR（出表留痕）

> **DR-W**（首屏把相机往后拉、代价认不认）→ **你要的，就按量出来的做**。
> 已交付 `2e4a6dd`（WO-33a）：休息机位 z=28 → **45**。
> 这里放的是量出来的 z（`wo33-probe.mjs` 把飞机与屋壳的 8 个角投到 NDC）：
> 38 屋脊出框（NDC y 1.021）、40 飞机左翼出框（x −1.215）、42 两者都进框但飞机只余
> 0.053、**45** 飞机左翼尖 NDC −0.948（4:3 视口下刚好卡住）—— 取 45。
> 真源已收进 `src/config/restPose.js`（原来 28 散在 `App.jsx` 与 `useInfiniteCamera`
> 两处，第一帧在旧机位、第二帧瞬移）。
>
> **DR-Q**（飞行视图上不上单趟电影后期）→ **选 (A) 只限飞行视图**。已折进 WO-29。
>
> **DR-R**（樱花要不要也停风摆）→ **选 (A) 一起停**。已交付 `c1b3566`（WO-28a）。
> 顺带把 `probe-tree-crown.mjs` 的 C5 **反向**、补了 C6（落樱的 `uTime` 必须留）。
>
> **DR-S**（云朵走哪条路）→ **选 (A) billboard + GLSL fbm**。已折进 WO-30。
> ⚠️ 明确**不做**真 raymarch —— 全屏开销与本项目三级降级冲突。
>
> **DR-T**（第二棵柿子树的落点 / 两棵要不要一样）→ **选「紧邻、接受两冠融合」**。
> 已交付 `c513c51`（WO-27）。
> 🔴 这次我自己的选项里**有两个数字是错的**（「冠半径 2.55」实为 ≈3.2 ——
> 2.55 是 `CROWN_PAD` 常量；「紧邻点 x ≈ −0.6」其实在甬路上）。量过之后重问了一次，
> 你确认"就要紧邻"。⇒ **教训：选项里给坐标之前必须先量。**
>
> **DR-U**（樱花怎么和柿子树分开）→ **选三刀全上**。已折进 WO-28b。
>
> **DR-V**（云："抄哪一层"）→ **选 (d)+(a)+(b)：路线 C**——
> SDF 烘焙法线（不走 metaball 几何）+ 现在就修 WO-32a/b 两个纯 bug。
> 已交付 `ee10d13`（WO-32a~d，含分色/凹谷/金边/统一墨线/实例排序）。
> 墨线**保留**（没有走 (c) 水粉换语言）；WO-32e/f 留白板。
