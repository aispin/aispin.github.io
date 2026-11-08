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
- **质量门** `env -u NODE_OPTIONS npm run lint` → **0 error / 43 warning**；不跑 React Compiler。
- **构建前** `mv dist .workbuddy-ai/dist-prev-<ts>`；**https push 不通就换 SSH**
  （`git push git@github.com:aispin/aispin.github.io.git <branch>`），
  判据 `gh api .../commits/<branch> --jq .sha`。
- **端口**：dev 5199 / `dist` 4199，实际只 listen **`127.0.0.1`**（不是 `[::1]`）；
  curl 加 `--noproxy '*'`。
- **跑截图前** `pkill -f "chrome-headless-shel[l]"`（带字符类，否则杀掉自己所在的 shell）。
- 其余见 `.workbuddy-ai/memory/MEMORY.md` · `hard-rules.md`。

---

# 📋 待办 WO

### WO-2 · AI 房间改版（原型已出，**等你确认**再进 3D）

- **需求原文**：「对这个房间进行重新改版，结合 AI 主题，力求酷炫屌炸天。沿用文稿房间的
  改版思路：先在 `demos/web3d` 下创建适合这个房间的 demo 原型，我确认后再在 3D 房间中编码实现。」
- **2026-11-08 追加（用户定调）**：「核心目标是项目介绍+项目演示（如有 demoUrl），用户需要
  一眼看到项目名称、描述，点击可以去演示页、github。**不能为了酷而酷**。」
  ⇒ 原型按此重做：活体退成包住预览卡的场，中心永远是那一页。
- **现状**：原型 `public/demos/web3d/ai-symbiosis/index.html` 已可跑
  （`http://localhost:5199/demos/web3d/ai-symbiosis/`，0 console error，桌面 1440×900 与
  手机 390×844 两版都验过）。**尚未进 3D 房间**，也没进 `demos.json`（确认后再生成缩略图）。
- **现在长什么样**：左栏「序号 / 名称 / 描述 / 语言·日期 / 系列六步 / 两个按钮」，
  右边一张 16:9 卡里**真的在跑这个项目的落地页**（同源 iframe，1440×810 渲染后缩放）。
  点卡片或「在线试玩」→ 全屏浮层里可交互，Esc 关闭。换一件时活体炸开、卡片换成新页面，
  炸开那 1.15s 正好盖住 iframe 的加载空窗。
- **数据事实**（别再过一遍）：24 件**全部**有 `demoUrl`，2026-11-08 逐条 curl 全 200；
  `爆款短视频工作流 1/6…6/6` 是**六件有顺序的套件**，正好排在 #1–#6。
- **技术**：裸 WebGL（不引 three），3 个 draw call；相机基向量在 CPU 算、投影写在顶点着色器；
  输入层复用 `public/demos/_pager.js`（target 给 `body`，否则滚轮落进卡片里收不到）。
- **确认后要做**：`RoomInterior` 加 `roomId === 'ai'` 分支 + 新建 `rooms/AiSymbiosis.jsx`
  （走 `rooms/takeover.js` 那套进场节奏，别复制三份）+ `ui/AiHud.jsx` + `.scss`
  + `ROOM_COPY.ai` 改文案 + `_from.js` 的 ROOMS 加 `ai` + 缩略图 + `build-demos-index.mjs` 重跑。
  ⚠️ 3D 房间里 iframe 必须放 DOM 层（和 craft 的浮层同一套），不能塞进 WebGL。
- **判据**：`node .workbuddy-ai/harness/probe-room-door.mjs ai` 进场/退场亮度表与
  career / craft / posts 同形（走廊 ~220 → 房间 ≤20，退场反向），深链 `/ai?noloader=1` 3.2s 内进屋。

---

### WO-1 · `prefers-reduced-motion` 下点履历的门进不去

- **现象**：系统开「减少动态效果」后，走到 `career` 门前点门，相机对上门就
  停住 —— 门不开、也不进房间；等到 9s 仍是走廊（亮度 234 恒定）。
  `gallery` / `craft` / `posts` 在同样条件下 0.6s 内就进屋了。
- **已排除**：**不是**本轮「三个房间共用进场节奏」改出来的。同一支用例在
  改之前的产物（`.workbuddy-ai/dist-prev-1793978071`，`python3 -m http.server`
  起在 4299）上结果一模一样。
- **方向**：`TRANSITION_SCALE = 0.12` 把 `alignDuration` 压到 ~0.18s，
  `openDoor` 的 `onComplete`（以及它里面那个 8s 兜底定时器）似乎没跑到 ——
  相机被 `useInfiniteCamera` 重新接管回走廊就是证据。而 career 是唯一一个
  `onReady` 要等字体 + 8 张 canvas 光栅化（~1s）的房间，这个 1s 的空窗
  大概率和 0.18s 的过场错位。**待查**，不要只看「门开没开」，要看
  `alignDuration` 那条 tween 是否被 kill。
- **判据**：`emulateMediaFeatures({name:'prefers-reduced-motion',value:'reduce'})`
  下点 career 门，1.5s 内 `currentRoom === 'career'` 且画面亮度 < 20。
- **复现脚本**：`/tmp/rm.mjs` 那套（滚到 z ≤ 14 → 找门 → 点 → 采样），
  也可以直接照 `harness/probe-room-door.mjs career` 加 `emulateMediaFeatures`。

> 「创意实验房间换成实验环」已于 2026-11-05 提交（`b922f06`）：
> 房间 `studio` → `craft`，`CraftRing` 接管渲染 + `CraftHud` 25 块玻璃展板，
> 深链/别名/滚轮/浮层/返回全部验过（`.workbuddy-ai/harness/probe-craft-room.mjs`）。

---

> 上一轮 5 项已全部提交并推送（`c51d8ff` 关闭按钮 hover · `c2a76b0` 深链幕帘开两次 ·
> `aff01df` events→experiences highlights · `5be5aa2` labs→真 demo + 改名「创意实验」），
> 逐条判据在 `.workbuddy-ai/memory/2026-11-05.md`。
> 更早的 WO-32 / WO-33 / WO-C1~C5、以及 `career` 时空隧道那一整批，历史都在 git。

---

# 🙋 待你拍板的 DR

### DR-A · AI 房间叫什么名字（现名「AI+」）

- **为什么问**：房间里装的是 AI 相关项目 / AIGC / 人机共创，现名「AI+」是**技术标签**，
  不是这间房在做的事 —— 而且 `+` 在门匾、菜单、`<title>` 里都不好看。
- **候选**（都能对上 WO-2 那只活体，副标题 `ROOM_COPY.ai` 负责把「AI」讲清楚）：

  | 名称 | 英文 | 好在哪 | 风险 |
  | --- | --- | --- | --- |
  | **共生**（推荐） | SYMBIOSIS | 人机共创本来就是共生；一词、好记、和原型里那只活体是一件事 | 名字里没有「AI」，靠副标题点明 |
  | 共创 | CO-CREATION | 最直白准确 | 平淡，像部门 OKR |
  | 潜空间 | LATENT | 模型内部的空间，酷 | 圈内术语，普通访客不懂 |
  | 造物 | FABRICATION | 造出来的东西，配活体 | 略生僻，容易读成「造物主」 |

- **当前状态**：等你选。**默认按「共生」**；URL 仍保持 `/ai`（不换路由，免得外链失效）。
- **选定后要改**：`theme.js` 的 `{ id:'ai', zh:'AI+' }`、`useDocumentMeta.js` 的 title/description、
  `ROOM_COPY.ai`、门匾与菜单、`index.html` / `manifest.webmanifest` 里的站点描述。

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

### DR-I · 成就弹窗压在房间底边中点的控制条上

- **现象**：`corridor_enter`（"Click a door to enter"）这条成就是**交互式**的
  —— 要你点一下喇叭才算完，**不会自动消失**。它固定居中在视口底部，正好盖住
  文稿房间（以及将来任何"底边中点"的 HUD）那颗控制条。
- **代价**：首次进站的人，进房间后头几秒看不到页码和搜索键（点一下喇叭就好）。
- **选项**：
  - **(A) 不动**：它是一次性的，且是站级 UI；房间 HUD 的位置是用户 2026-11-06
    明确要求的（"放底部中间"）。
  - **(B) 弹窗上移**：把成就弹窗抬到 `bottom: 96px`，让出底边那一带。
  - **(C) 房间 HUD 上移**：违反用户要求，不推荐。
- **当前状态**：等你选。**默认按 (A) 不动**。
