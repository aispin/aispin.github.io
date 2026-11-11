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

### WO-5 · 音乐房间换成唱盘（原型已交，等确认）

- **需求原文**：「目前的音乐房间毫无设计感，需要推翻重新做」
  「先实现 web3d 的适用于音乐作品展示、播放的 demo」。
- **原型**：`public/demos/web3d/vinyl-player/`（`25ff73e` + `9101beb`）——
  一台真会响的唱盘：封套是作品、唱片是声音、**唱臂角度 = 播放进度（可直接拖）**、
  盘沿那圈短针是"正在发生的事"。右侧是**精选 / 最新 / 最热三张列表 + 一排最新专辑**
  （点专辑 = 整张上盘）。判据见该目录 README + `harness/probe-vinyl.mjs`（53 条全绿）。
- **数据**：`packages/netease-artist/`（`@aispin/netease-artist`，零依赖）+
  `npm run data:music` ⇒ `public/data/netease-music-zeo.json`（艺人 `49232788`，
  最新 12 / 最热 12 / 最新 4 张专辑）。**页面不碰接口**，只 fetch 这份 JSON；
  拿不到就只剩精选集、最新/最热置灰。
- **现状**：`ContentRoom` 里 `music: { platform:'MUSIC', layout:'editorial' }`，
  4×N 贴卡墙，`openItem` 传的是 `url/demoUrl/repository`（**从不传 `item.file`**）⇒
  点「播放」什么都不会响。整段要删。
- **改什么**：按接管房间那套做 `RoomMusic`（`useTakeoverStage` + `useFrame(cb,1)`）
  + `MusicHud`（搬 demo 的 DOM），`shells.music` 已有；`CONTENT_ROOM_IDS` 收成
  `['videos']`，`SELF_READY_IDS` 加 `'music'`；`ITEM_KIND` / `ROOM_ACCENT.music`
  一并清掉。房间里的列表/专辑数据同样读 `public/data/netease-music-zeo.json`
  （构建时生成，不新增运行时依赖）。
- **验收判据**：`/music` 深链直接进；精选 6 首 + 最新/最热各 12 首都能播；
  点专辑能整张上盘；拖唱臂能跳；深浅色 × 中英 4 组截图对得上；
  退出房间后音频必须停（**别让 BGM 和房间音源打架**，见 `audioManager`）。
- ⚠️ **先等用户确认这个原型**，再动 3D 房间。

### WO-6 · 摄影房间换成「接触印相带」（原型已交，等确认）

- **需求原文**：「开始重新设计 Gallery 和 Videos 房间，一样的思路，先出 web3d 的
  demo，先出 Gallery 的，放 demos/web3d/gallery 目录」。
- **原型**：`public/demos/web3d/gallery/`（`8be015a`）—— 一条**环状印相带**，
  12 张按真实画幅（3:4 / 4:3 / 16:9）排开、在深度里退远，滚轮/拖动沿带走，
  点一帧抬起来看大图 + 展签。判据 `harness/probe-gallery.mjs`（23 条全绿，dev+dist）。
- **数据**：`public/data/pixabay-aispin.json`（`npm run data:photos`，
  来自 `packages/pixabay-user`）。房间直接读这份 JSON。
- **现状**：`ContentRoom` 里 `gallery` 走 `GalleryRoom.jsx`（8 张 canvas 占位画），
  作品是 `src/data/photos.json`（原 `photography.json`）里手写的 8 条，**没有真照片**。
- **改什么**：`RoomGallery`（`useTakeoverStage` + `useFrame(cb,1)`）+ `GalleryHud`
  （搬 demo 的 DOM），`CONTENT_ROOM_IDS` 再收一格；`GalleryRoom.jsx` /
  `photoPlaceholder.js` / `texturePreloadList` 里那套 canvas 占位画可以整段退场。
- **验收判据**：`/gallery` 深链直接进；12 帧都在、按真实画幅；滚轮/拖动/键盘都能走；
  点帧开大图带展签与外链；深浅色 × 中英 4 组对得上；**退出房间不留定时器**。
- ⚠️ **先等用户确认这个原型**，再动 3D 房间。Videos 房间的同款原型还没做。

### WO-7 · Videos 房间的 web3d 原型（未开始）

- **需求原文**：同 WO-6，「先出 Gallery 的」⇒ Videos 排在其后。
- **数据**：`public/data/pixabay-aispin.json` 的 `latestVideos`（**当前是空数组** ——
  aispin 账号在 Pixabay 上没有视频，`packages/pixabay-user` 的抓取路径已验证会
  识别 `/videos/` 卡片，只是没数据）。所以这个房间要先决定「没有视频时显示什么」，
  或者等真的传了视频再做。
- **待你拍板**：空数据时是「放一段说明 + 引导去 B 站/YouTube」，还是干脆先不做。

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

### WO-3 · 手机上几乎点不到房门（走廊，**8 个房间都受影响**）

- **怎么发现的**：验 AI 房间的点门链时，`probe-room-door.mjs ai … 390x844` 一路
  `luma=135` 恒定、`room=null` —— 点了个空气。
- **根因**（两条约束刚好错开）：
  1. `DoorSection.handleClick` 有 `|camZ − doorZ| > TILT_START(15)` 就 `return`
     ⇒ 必须走到门前 **15 单位内**才点得动；
  2. 390 宽时水平 FOV 只有 **~30°**（1440 宽是 85°），而走廊会左右轻摆
     （yaw ±0.11 rad）⇒ 走到 15 单位内时门心已经贴到左边缘。
     实测投影：`dz 20.3 → sx −3`、`dz 17.3 → sx −28`、`dz 14.3 → sx −14`、
     `dz 11.3 → sx 0`。门扇约 72px 宽，所以只有**内侧半扇**能点。
- **不是本轮引入的**：所有门的 x 都在 ±2.3~3.5，`TILT_START` 也是老的。
- **可选方向**：窄屏把相机 FOV 按宽高比补到等效 ~55° 水平（`fov = 2·atan(tan(h/2)/aspect)` 反过来算），
  或窄屏把 `TILT_START` 放宽到 22，或窄屏给门加一块跟随相机的 DOM 热区。
  ⚠️ 动 FOV 会影响**整个走廊的构图**（门匾、装饰、院子外观），要先量再改。
- **临时结论**：`probe-room-door.mjs` 窄视口停在 `doorZ + 13` 并把点击点夹进
  `[3, W−3]`，能过；真机上"贴边点"的体验仍是问题。

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
