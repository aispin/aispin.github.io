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

### WO-STUDIO-1 · 创意实验房间换成「实验环」（静态原型已交付，等确认）

- **需求原文**：「现在创意实验的排版很简陋，我希望酷炫的 web3d（svg, canvas,
  webgl, glsl shader 等技术），并且每个 demo 可以通过 iframe 浮层去体验效果。
  先在 demos 目录实现静态 demo 效果，我确认后再整合到 3d 房间。」
- **已做**：`public/demos/web3d/ring-gallery/` —— 全屏 GLSL 星云 +
  25 块玻璃展板绕成一圈（圆柱投影 x = f·tanθ）+ iframe 浮层。
  桌面一屏 4 块、手机 1 块，滚动/拖动转动，点焦点板开浮层。
  环**首尾相接**（`21af3a1`）；底部说明改成展板的注解（倒三角 + 竖线 +
  无卡片无按钮），`/demos/` 的落地页也已换成它（`51bcf89`）；
  滚轮"一次手势只走一格、手势一结束立刻能翻下一格"（`8bd4c9f`，判据看事件流
  形状而不是静默定时器），26 个 demo 的 description 也补齐到各自的 meta
  （`9fe8f6b`）。
- **待你确认**：视觉方向（深空星云 + 玻璃展板 + 类别色弧）与交互
  （转动环 + 点展板进浮层）是否对。
- **确认后才做**：把这套搬进 3D 房间 —— `rooms/StudioLab.jsx`（接管渲染，
  同 `CareerTunnel` 的骨架）、`ui/StudioHud.jsx`、`state/studioLab.js`，
  并把 `studio` 从 `CONTENT_ROOM_IDS` 里摘掉、`RoomWarmup` 的预热副本换房间。
  ⚠️ 半成品已经写好并暂存在 `.workbuddy-ai/wip/studio-lab/`（未接线、
  未提交），整合时以 `ring-gallery/index.html` 定稿的视觉为准重写，别直接拿来用。

---

> **其余待办：空。**
>
> 上一轮 5 项已全部提交并推送（`c51d8ff` 关闭按钮 hover · `c2a76b0` 深链幕帘开两次 ·
> `aff01df` events→experiences highlights · `5be5aa2` labs→真 demo + 改名「创意实验」），
> 逐条判据在 `.workbuddy-ai/memory/2026-11-05.md`。
> 更早的 WO-32 / WO-33 / WO-C1~C5、以及 `career` 时空隧道那一整批，历史都在 git。

---

# 🙋 待你拍板的 DR

### DR-F · 其余 5 个内容房间要不要也换成「隧道」这种空间？

- **背景**：`career` 现在是一整条星空隧道（自带 Scene、接管渲染、DOM HUD）。
  另外 5 个内容房间（studio / posts / videos / music / ai）仍是 `ContentRoom`
  那套 4×N 贴卡墙。**两种空间语言现在并存。**
- **为什么问**：隧道是"往里走"的纵向空间，贴卡墙是"站在屋里看一面墙"。
  同一个人从履历走进工作室，会明显感到"换了个产品"。
- **选项**：
  - **(A) 只 career 是隧道**（现状）。履历因为"在时间里穿行"这个隐喻最贴切，
    其余房间按各自内容形态保留贴卡墙。改动量 0。
  - **(B) 全部换成隧道**。统一空间语言，但 studio/videos 的内容形态（视频墙、
    播放器）在隧道里要重新设计交互；music 还要处理音频与滚动的关系。改动量大。
  - **(C) 挑一两个**（比如 posts = 文章时间线）也用隧道，其余不动。
- **代价提示**：接管渲染的房间**不能有第二个同时挂载**（`useFrame(cb,1)` 会互相覆盖），
  多个隧道房间要共用一份接管宿主，不是复制粘贴。
- **当前状态**：等你选。**默认按 (A) 不动。**

  **2026-11-05 补充（针对 studio 已单独分析过，结论贴在下面）：**

  - `studio` 已改名「创意实验」，内容源从 `labs.json` 换成扫盘生成的
    `demos/demos.json`（25 个真 demo，3 页）。**它不适合隧道**：隧道的隐喻是
    *时间*（纵向 = 时间轴），25 个 demo 之间没有时间序，硬排成走廊等于编一个
    不存在的叙事；而且 demo 本身异质（霓虹文字 / 火箭 / 语音识别 / web3d），
    一套空间语言装不下。
  - **真正的缺口不是"缺落地页"，是"回路断了"**：房间点 demo 走
    `window.open(url, '_blank', 'noopener,noreferrer')` ⇒ demo 页**拿不到
    referrer**，左上角返回胶囊固定指 `/demos/`（文件索引）⇒ 回到索引再回主页，
    **房间不在链上**，回来只能靠关标签页。
  - 所以如果要动，动的是这两件小事（**待你点头，尚未开工**）：
    - **P1** 打开时带 `?from=studio`，胶囊文案改「← 创意实验」并指回 `/studio`。
      （必须显式传参 —— `noreferrer` 让 `document.referrer` 一定是空，这条路走不通。）
    - **P2** `demos.json` 加 `thumb`，房间里的 demo 卡 hover 显示预览。
  - ~~P3 `/demos/index.html` 保持现状~~ —— **已作废**：2026-11-05 按用户要求
    把 `/demos/` 换成了环形画廊本身（`51bcf89`），所以从房间点开 demo 后，
    胶囊回 `/demos/` 落到的就是这个画廊，回路比原来短了一截。
  - **判据**：从房间点开 demo → 胶囊显示「← 创意实验」→ 点回落回房间。
  - **反过来该重做的时候**：demo 涨到 40+ 或开始有"系列"（同主题 5~6 个变体），
    卡片墙才撑不住，那时才值得给**类别**一层空间（三个展台而不是 3 页翻页）。
    25 个 / 3 页现在刚好。
