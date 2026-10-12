# 工作计划 · aispin.github.io

> **本文件是白板，不是台账。**
>
> 只放**待办**：待做的 **WO** + 待你拍板的 **DR**。
> 🔴 **你验收 OK 就把它从本文件删掉**（不等下一轮）。
> 过程记录、实测数据、踩坑结论一律进 `.workbuddy-ai/memory/`（入口 `MEMORY.md`）；
> 沉淀下来的技术结论进 `docs/`；历史在 git。
>
> ⚠️ 2026-10-12 用户反馈：**「你把快照滚动当流水帐去用了」** ——
> 顶部「📊 滚动快照」段已删。**状态写进每条 WO 自己，不再另开历史段。**

## 规范

| 记号 | 是什么 | 谁做 |
| --- | --- | --- |
| **WO** | Work Order —— 需求原文 / 现状 / 改什么 / 验收判据 | 我做，你验收 |
| **DR** | Decision Request —— **必须由你做的决定** | 你 |

流程：收到需求 → 拆 WO（**影响面大的配一个 DR 请你 review**）→ 本文件单独 commit
→ 无 DR 直接做、有 DR 等你决策 → 做完发起验收 → **你验收 OK 后移出本文件**。
验收有分歧就作为新一轮的新 WO 重新进表（版本历史在 git）。

## 执行注意（常驻，细节在 memory）

- **分支** `feat/v1.2.0-island-courtyard`，**不推 `main`**（推 `main` = 上线）。
- **质量门** `env -u NODE_OPTIONS npm run lint` → **0 error / 33 warning**；不跑 React Compiler。
- **构建前** `mv dist .workbuddy-ai/dist-prev-<ts>`；**推不通改 SSH**，判据 `gh api .../commits/<branch> --jq .sha`。
- **跑截图前** `pkill -f chrome-headless-shell`。
- 其余见 `.workbuddy-ai/memory/MEMORY.md` · `hard-rules.md`。

---

# 📋 待办 WO

## WO-16 · README「参考资料」+4 条 —— **已交付（`303c9bc`），待你验收**

表格 4 行 → 8 行；`kage` / `yingxian-pagoda` 均**无 LICENSE**（默认保留全部权利）
已加 ⚠️；`ai-demo` 与 `threejs-architecture-effects` 是 MIT（做法可学）。
⚠️ 刻意没写"已参考它们做樱花树/飞行" —— 那两个当时还没做。

## WO-20 · `me` 的源码内聚到 `src/me/` —— **已交付，待你验收**

- **你的决定（2026-10-12）**：「根目录 `/me/index.html` 应该挪到 `src/me/` 目录下，
  让源码内聚在各自业务域目录下」。
- **改了什么**：`git mv me/index.html src/me/index.html`（与它的 5 个模块同目录）；
  `vite.config.js` 的 entry 指向 `src/me/index.html`；新增 `flattenHtmlEntries`
  插件把**产物**仍落在 `dist/me/index.html`；dev / preview 的重写目标**拆成两个**。
- 🔴 **核心难点（也是这次唯一的真坑）**：Vite 让「产物路径 = 源码相对 root 的路径」⇒
  挪完产物会落到 `dist/src/me/index.html`、URL 变成 `/src/me/`，
  而 **CI 硬断言 `test -f dist/me/index.html`** ⇒ 构建直接失败。
  所以必须把**源码路径**和**产物路径**解耦。
- ⚠️ 插件**必须用 `writeBundle`**，不能用 `generateBundle`：Vite 是在**它自己的
  post 阶段**才把 HTML 塞进 bundle 的，普通插件的 `generateBundle` 跑在那之前，
  `bundle['src/me/index.html']` 还不存在 ⇒ **静默什么都不做**（第一版就这么写的，
  产物照样落在 `dist/src/me/`，而且没有任何报错）。
  而 `vite-compression` 用的是 `closeBundle`（扫盘再压），`writeBundle` 正好在它之前。
- **验收判据（全部实测通过）**：
  | 判据 | 结果 |
  | --- | --- |
  | 搬前 vs 搬后的 `dist/me/index.html` | **逐字节相同**（搬家对产物零影响）|
  | CI 三条 sanity-check | `dist/index.html` · `dist/me/index.html` · `dist/404.html` 全在 |
  | dev `/me` 与 `/me/` | 200，且标题是**名片页自己的**（不是 3D 主站的）|
  | preview `/me` 与 `/me/` | 200，同上 |
  | 残留 `dist/src/` | 无（插件顺手清空目录）|
  | lint | 0 error / 33 warning |

## WO-17 · 前院一棵樱花树（DR-L 已定）· 参考 `sakura-station-corner`

- **需求原文**：「参考 sakura-station-corner 在前院种两棵樱花树」
  → **2026-10-12 追加决定**：「放**花箱前面草地的中间**（做**一棵**看效果，
  落樱参考真实樱花树的季节）」。
- **现状**：前院只有一棵柿子树（`PersimmonTree`，**4 draw call**）。全站 mesh 基线 **704**。
- **改什么**：
  - 新增 `utils/sakuraTree.js`：**沿用柿子树那套骨架原则**（锥形管 / **关节椭球** /
    子枝起点回退 + 起始方向偏向父枝 / 冠内撒叶），换樱花的花簇与姿态。
  - 新增 `components/canvas/entrance/SakuraTree.jsx`：枝 1 + 花簇 1 + 影 1 ⇒ **3 draw call**。
  - **落樱**：1 个 `InstancedMesh`，**只在春天**开（真实樱花季）。复用 `WeatherLayer`
    的粒子思路；花瓣复用四季色板。
  - 位置：花箱前面的草地中间（避让荷花缸 / 花箱 / 石桌 / 草带 / 白狗）。
- **验收判据**：不穿墙不压窗（`probe-tree-fit.mjs` 扩到樱花）；mesh 增量 ≤ 6；
  两棵树各自 seed 稳定（契约 1）；落樱只在 spring 有粒子。

## WO-18 · 前院小飞机 + `/flight`（DR-M 已定）· 参考 `sunset-flight-study`

- **需求原文**：「前院摆一架小飞机，**点击**在 `/flight` 路由下进入飞行模式。」
- **2026-10-12 决定**：**按建议的 (i) 查询参数 + (i) 接管主站相机**；
  用户追加：**「效果要保障」**。
- **现状**：本项目**没有路由系统** —— 模式一律靠查询参数（`config/cameraMode.js` 读
  `URLSearchParams`，如 `?fly`）。
- **改什么**：前院加 1 架小飞机（单 mesh 或 `InstancedMesh`）+ 点击拾取 → 进入 `?flight`；
  **接管主站相机**做一段飞行；退出后主站状态**不得残留**。
- **「效果要保障」落到判据上**（这条是 DR-M 的重点，不能只靠"看着还行"）：
  - 进出场无残留：走既有 `probe-transition-leak.mjs`。
  - 飞行相机的姿态/位置**可量**：加一个探针，进 `?flight` 后按脚本推进若干帧，
    断言相机确实在预期的轨迹上（不是"镜头没动"）。
  - 新增 mesh / draw call / 体积增量**报数**。
  - **两种视口都要拍**（见 memory 的"屏幕空间效果尺寸必须跟视口走"）。

## WO-19 · 柿子树的"假"：树干像粘土 / 叶子像纸片（DR-K 定 (d)、DR-O 定 (i)）

- **需求原文**：「柿子树的树干是光滑的像粘土没有树皮的感觉」「叶子像纸片」
  → **2026-10-12 决定**：**DR-K 按 (d)**（守住零位图，用程序化手段把写实度顶上去）；
  **DR-O 按 (i)**（不为树皮/叶放宽零位图）。
- **根因（已量，详见 `.workbuddy-ai/memory/2026-10-12.md` §14.3）**：
  ez-tree demo 的逼真建立在**位图贴图 + glb 模型资产**上（草地是 `grass.glb`
  实例化 5000 次；树皮每种树 4 张 1k 位图；叶子是带 alpha 的位图四边形）——
  **那两样正是本项目禁止的**。所以问题不是算法，是"我们选了不能靠贴图的路"。
- **改什么（全部程序化）**：
  1. **树皮**：`TREE_BARK_FRAG` 的 fbm 现在**只改颜色、不扰法线** ⇒ 光照下表面还是平的。
     改成**由 fbm 的梯度扰动法线**（解析/有限差分；把梯度投影到切平面再扰），
     并加一层高频细节 + 拉开裂纹对比。
  2. **叶**：四片三角面 + 中脉，形状**簇内 6 片完全相同**、且不透光、无沿叶渐变。
     改：① 每片叶**形状抖动**（长/宽/中脉深/左右不对称 ⇒ 6 片各不相同）；
     ② 沿叶长**着色渐变**（叶尖/叶基不同）；③ **透光**（背光时叶会亮）+
     **wrap 光照**柔化明暗交界。
- **验收判据**：同机位 before/after 定妆照（**不做逐像素 A/B** —— 本仓截图噪声底
  7.8%，见 `hard-rules §26`）；triangle 增量报数；`check-glsl-backticks.py` 干净；
  lint 0/33。
- ⚠️ 果子的"飘离树冠"已于 `83dee3f` 独立修完（`probe-fruit-attach.mjs` C1/C2 全过），
  **不在本 WO 范围内**。

---

# 🙋 待你拍板的 DR

> DR-N（类 `me` 的小模块放哪）你已答复：**源码内聚到 `src/<业务域>/`** ——
> 已按这个做掉（见 WO-20），按白板规矩**出表**。
> 你选的这条比我原来的 (C) 更干净：我提的是"源码进 `apps/`、产物改名回 `dist/`"，
> 而你说的是**把 entry 和它的模块放一起** —— 那才是真正的内聚，
> 连"源码的家"这个概念都不需要新增一层目录。

### DR-P · 「零位图」要留一个**有限放宽**的口子吗（备查，当前**不启用**）

- **你要求的**：「DR-O 按 1 做优化，**新增加一个 DR 做有限放宽的说明**」。
- **背景**：DR-K 已查明 ez-tree demo 的逼真来自**位图贴图 + glb 资产**，
  而本项目硬规矩是 **零 jpg/png（只用 webp）、全站只允许 2 张位图**。
  DR-O 选了 (i)「不放宽，继续程序化」，WO-19 就按这条做。
- **这个 DR 记录的是"万一将来顶不上去"时的退路**（**现在不动**）：
  - **可放宽的最小集合**：**2 张 webp** —— ① 树皮 **normal** 一张
    （比 color 有效得多：树皮的"糙"主要读自法线，不是颜色）；
    ② 叶片 **形状 alpha** 一张（叶缘不规整 + 叶脉，一次解决很多片叶的观感）。
  - **不放进来的**：color 贴图（我们能程序化出色）、每物种一套 4 张、
    `grass.glb` 这类模型资产（那会连带改 `public/` 与体积预算）。
  - **放开的代价**（真要启用时要同步改的地方）：README「美术」段的零位图声明、
    `.workbuddy-ai/memory/hard-rules.md` 里的相关条目、以及
    `texturePreloadList.js` 的预载清单。
  - **触发条件**（写清楚，免得变成"随手就放宽"）：WO-19 做完之后，
    若**树皮**或**叶片**仍然明显"不像"，再回来启用；启用前先量一次
    "程序化版本 vs 贴图版本"的同机位对照。
- **当前状态**：**不启用**。此条只作决策留痕。
