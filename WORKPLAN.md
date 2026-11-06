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
>
> 2026-11-04 用户再次要求：**只保留待办的 WO 与未决的 DR**。
> 「已答复的 DR」整段（DR-W/Q/R/S/T/U/V、DR-1~4、DR-E、DR-P）已归档到
> `.workbuddy-ai/memory/2026-11-04.md` 末尾，本文件不再保留。

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
- **质量门** `env -u NODE_OPTIONS npm run lint` → **0 error / 32 warning**；不跑 React Compiler。
- **构建前** `mv dist .workbuddy-ai/dist-prev-<ts>`；**https push 不通就换 SSH**
  （`git push git@github.com:aispin/aispin.github.io.git <branch>`），
  判据 `gh api .../commits/<branch> --jq .sha`。
- **端口**：dev 5199 / `dist` 4199，实际只 listen **`127.0.0.1`**（不是 `[::1]`）；
  curl 加 `--noproxy '*'`。
- **跑截图前** `pkill -f "chrome-headless-shel[l]"`（带字符类，否则杀掉自己所在的 shell）。
- 其余见 `.workbuddy-ai/memory/MEMORY.md` · `hard-rules.md`。

---

# 📋 待办 WO

> **空。** 「创意实验房间换成实验环」已于 2026-11-05 提交（`b922f06`）：
> 房间 `studio` → `craft`，`CraftRing` 接管渲染 + `CraftHud` 25 块玻璃展板，
> 深链/别名/滚轮/浮层/返回全部验过（`.workbuddy-ai/harness/probe-craft-room.mjs`）。

---

> 上一轮 5 项已全部提交并推送（`c51d8ff` 关闭按钮 hover · `c2a76b0` 深链幕帘开两次 ·
> `aff01df` events→experiences highlights · `5be5aa2` labs→真 demo + 改名「创意实验」），
> 逐条判据在 `.workbuddy-ai/memory/2026-11-05.md`。
> 更早的 WO-32 / WO-33 / WO-C1~C5、以及 `career` 时空隧道那一整批，历史都在 git。

---

# 🙋 待你拍板的 DR

### DR-F · 其余 5 个内容房间要不要也换成「隧道」这种空间？

- **背景**：`career` 现在是一整条星空隧道（自带 Scene、接管渲染、DOM HUD）。
  另外 5 个内容房间（posts / videos / music / ai，加已改完的 craft）里，
  craft 也是接管渲染的独立空间（实验环），其余 4 个仍是 `ContentRoom` 那套
  4×N 贴卡墙。**两种空间语言现在并存。**
- **为什么问**：隧道是"往里走"的纵向空间，贴卡墙是"站在屋里看一面墙"。
  同一个人从履历走进工作室，会明显感到"换了个产品"。
- **选项**：
  - **(A) 只 career / craft 是独立空间**（现状）。履历因为"在时间里穿行"这个隐喻
    最贴切，实验环因为 25 个 demo 是并列关系；其余房间按各自内容形态保留贴卡墙。
    改动量 0。
  - **(B) 全部换成隧道**。统一空间语言，但 videos 的内容形态（视频墙、播放器）
    在隧道里要重新设计交互；music 还要处理音频与滚动的关系。改动量大。
  - **(C) 挑一两个**（比如 posts = 文章时间线）也用隧道，其余不动。
- **代价提示**：接管渲染的房间**不能有第二个同时挂载**（`useFrame(cb,1)` 会互相覆盖），
  多个接管房间要共用一份接管宿主，不是复制粘贴。
- **当前状态**：等你选。**默认按 (A) 不动。**

  **2026-11-05 补充（针对创意实验房间已单独分析过，结论贴在下面）：**

  - 「创意实验」内容源是扫盘生成的 `demos/demos.json`（25 个真 demo）。
    **它不适合隧道**：隧道的隐喻是*时间*（纵向 = 时间轴），25 个 demo 之间没有
    时间序，硬排成走廊等于编一个不存在的叙事；而且 demo 本身异质
    （霓虹文字 / 火箭 / 语音识别 / web3d），一套空间语言装不下 ⇒ 已改成
    环形展板（`b922f06`）。
  - **真正的缺口不是"缺落地页"，是"回路断了"**：房间里点 demo 走
    `iframe` 浮层（同源，不跳走），但浮层右上角"新标签打开"仍是
    `target="_blank"` ⇒ 一旦用那个入口，demo 页拿不到 referrer，
    左上角胶囊固定指 `/demos/`（文件索引）⇒ 房间不在链上。
  - 所以如果要动，动的是这两件小事：
    - ~~**P1** 打开时带 `?from=craft`，胶囊文案改「← 创意实验」并指回 `/craft`~~
      —— **2026-11-05 已做**（`?from=craft` 写进 iframe 与「新标签打开」，
      `public/demos/_from.js` 负责改写胶囊）。必须显式传参：`noreferrer`
      让 `document.referrer` 一定是空，这条路走不通。
    - ~~**P2** `demos.json` 加 `thumb`，房间里的展板 hover 显示预览~~
      —— **2026-11-06 已做**：`public/demos/thumbs/<id>.webp`（26 张，640 宽，
      合计 0.2MB），`thumb` 字段由 `build-demos-index.mjs` 按磁盘上有没有这个
      文件推导；展板悬停 0.28s 后淡入，触摸设备上焦点板常显。
  - ~~P3 `/demos/index.html` 保持现状~~ —— **已作废**：2026-11-05 按用户要求
    把 `/demos/` 换成了环形画廊本身（`51bcf89`），所以从房间新标签打开
    demo 后，胶囊回 `/demos/` 落到的就是这个画廊，回路比原来短了一截。
  - **判据**：从房间浮层点「新标签打开」→ 胶囊显示「← 创意实验」→ 点回落回房间。
    ✅ 已满足（25 个 demo 里 10 个有胶囊的那批；另外 15 个独立 demo 本来就没有
    胶囊，各自带自己的左上角 HUD，硬塞一个会压住原有信息 —— 见
    `.workbuddy-ai/memory/2026-11-05.md` §17）。
  - **反过来该重做的时候**：demo 涨到 40+ 或开始有"系列"（同主题 5~6 个变体），
    环形展板才撑不住，那时才值得给**类别**一层空间（三个展台而不是转一圈）。
    25 个现在刚好。

### DR-G · 文章体系怎么落：md 源 + 静态 HTML 产物（**待拍板**）

- **需求原文**：「处理 articles.json（先讨论方案，注意未来文章应该都不需要人类写，
  由 AI 代笔）：A. markdown 文件 + 文章渲染 html 模板；B. 参考 demos，文章直接
  静态化为 html 文件，搭配文章专属的酷炫屌炸天的落地页」。
- **底数**（2026-11-06 实测，明细在 `.workbuddy-ai/memory/2026-11-06.md` §3）：
  - 18 篇（zh 10 / en 8）；正文 **占主包 gzip 的 49%**（46.7KB / 94.7KB）。
  - 文章**没有 URL** ⇒ 不能分享、不进索引、JSON-LD 里的 `Article` 没有 `url`。
  - `seo-plugin` 读的是 `a.date` / `a.summary`，数据里是 `publishedAt` /
    `description` ⇒ `dist/llms.txt` 的 18 行**全是空描述无日期**（活 bug）。
  - `MarkdownBody.jsx` 是 277 行手写 parser，**不支持有序列表 / 嵌套列表 / 代码高亮**。
- **我的判断**：A 和 B 不是二选一 —— **A 是写法，B 是产物**。
  AI 代笔 ⇒ 源必须是最省 token、最可 diff 的格式（md + frontmatter）；
  读者/爬虫 ⇒ 产物必须是有稳定 URL 的静态 HTML。两者合成一条流水线，
  和 `build-demos-index.mjs` 扫盘生成 `/demos/` 是同一条路。
- **推荐方案（合体）**：
  ```
  content/articles/<locale>/<slug>.md      唯一真源（AI 写，人只审）
    ↓ scripts/build-articles.mjs（构建期，buildStart 钩子）
  public/articles/<slug>/index.html        每篇一页（og / JSON-LD / canonical）
  public/articles/index.html               文章落地页
  public/articles/articles.json            只有元数据（3.4KB gz），房间用
  ```
  - frontmatter 决定一切：`title/description/date/tags/lang/slug/pair/theme/seed/draft`。
  - **`theme` 是闭集**（如 `paper|neon|ink|blueprint|warm`），`seed` 缺省按 slug 哈希
    ⇒ 每篇的"专属落地页"由 theme × seed 组合出来，**不是每篇手写 CSS**。
  - 构建期校验（这就是"AI 写、人不管"的前提）：缺 `description`、slug 冲突、
    正文过短、未知 theme、图片不存在 ⇒ **构建失败并指出文件**。
- **三条不能踩的线**：
  1. 🔴 **零位图**：hero 只能是程序化（canvas / SVG / shader），AI 生图不算数。
  2. 🔴 **构建确定性**：同一份 md 必须产出逐字节相同的 HTML（无时间戳、无随机），
     否则每次 build 都是脏 diff。seed 一律由 slug 哈希，不许 `Math.random()`。
  3. 🔴 **一份渲染器**：构建期产出 HTML 片段，房间浮层与静态页**共用**
     （`dangerouslySetInnerHTML` + 现有的 `.markdown-body` 样式），
     不要留两套 parser。构建期要 sanitize（禁 `<script>` / `on*`）。
- **已拍板（2026-11-06）**：
  - **(1) 入口哲学 = 参考创意实验房间**：房间、静态页**均可访问**，谁也不锁在谁后面。
  - **(2) 落地页 = 用 web3d 重做文稿房间本身**，**完全替换**现在那面 4×N 卡墙
    （用户原话：「现在卡墙没有设计感且平淡无奇。我希望每个房间都是独一无二的 web3d 秀」）。
  - **(3) 依赖**：加 `markdown-it`（**必须最新版**），并**顺便把现有依赖全量升级**。
- **房间形态已定：经折装（accordion fold）** —— 一条长纸，一折一篇，沿对角线退进暗处，
  当前这一折立起来面对你。选它的理由是**空间轴不撞车**：career 纵向隧道（序列）、
  craft 环形展板（并列）、posts 一条长卷（长度）。篇数涨到 100 只是带子更长，不改设计。
  - 原型已交付：**`/demos/web3d/posts-fold/`**（`public/demos/web3d/posts-fold/`）。
    折页 300×420、单折角 ±24°、带子偏 30°、折距 = `W·cos(24°)` 才是共边真折痕；
    非焦点折只留巨大浅色页码 + 折痕（显示标题会被前景页遮一半，像 bug）；
    景深 = `blur` + `brightness(.86)` + `opacity` 三重衰减。
  - 实现选型：**CSS 3D + DOM，不用 three** —— 折页上全是中文标题正文，走 three 得渲成
    纹理：缩放会糊、不能选中、读屏读不到。平面用 `translate3d/rotateY` 与 three 的 plane
    视觉几乎无差别。代价是没有真光照/真阴影（现在是 `box-shadow` + 手绘明暗）。
  - 还没接的：真实数据（`content/articles/<locale>/<slug>.md` 的 frontmatter）、
    阅读层换成与静态页共用的 HTML 片段、`_from.js` 里加 `posts` 一行。
  - **交互层已抽出公共件 `public/demos/_pager.js`**：滚轮（判据与 craft 房间逐字相同）/
    拖动（含触屏）/ 方向键，一次手势只走一格。房间落地时直接复用同一套判据，
    别再写第二份。🔴 拖动**不能用** `setPointerCapture`（会吞掉子元素的 click）。
  - 目录面板（`/` 或 `⌘K` 唤出，搜索 + ↑↓ + Enter）也已在原型里跑通，
    房间版按同一交互接。
  - **HUD 全在底边中点**（页码 · 语言 · 🔍 搜索）：3D 房子顶部已有站级菜单，
    房间再占右上角会让人上下两个角来回看。🔴 房间版**语言跟随房子** —— 带
    `?loc=zh|en` 进来就锁死并摘掉语言组（`#bc.is-locked`），不留两个切换器。
  - **阅读层撑满视窗高度**（上下各 24px），页眉固定、正文自己滚，文末
    `← 上一篇 / 下一篇 →` 用 `margin-top:auto` 钉在纸底。🔴 容器必须是
    `flex + align-items:stretch`，`grid + place-items:center` 会让长文把纸撑到
    2400px；滚动子项必须写 `min-height:0`。
- **分期**（每期单独 commit）：
  - **P1 止血**：正文搬出主包（md 文件 + 房间按需 fetch）⇒ 主包 gzip 94.7 → ~50KB；
    顺手修 `seo-plugin` 的字段错配。
  - **P2 静态页**：`build-articles.mjs` + `/articles/<slug>/` + 落地页 + sitemap/llms.txt。
  - **P3 专属视觉**：theme × seed 的程序化 hero。
  - **P4 房间落地**：把 `posts-fold` 原型接进 `src/`（换成 `useFrame` 接管的房间），
    卡片点开走静态页或阅读层，复用 `?from=posts` 胶囊回路。
  - ⚠️ **卡墙先留着**：P4 落地之前 `ContentRoom` 不动，别半途改成四不像。

