# 工作计划 · aispin.github.io

> **本文件是白板，不是台账。**
>
> 只放**待办**：待做的 **WO** + 待你拍板的 **DR**。
> 🔴 **你验收 OK 就当轮把它从本文件删掉** —— 不等下一轮迭代。
> 过程记录、实测数据、踩坑结论一律进 `.workbuddy-ai/memory/`（入口 `MEMORY.md`）；
> 沉淀下来的技术结论进 `docs/`；历史在 git。
>
> **新一轮开始时，WO 和 DR 都应该是空的。**
> ⚠️ 2026-10-12 用户明确反馈：**「你把快照滚动当流水帐去用了」** ——
> 已删掉顶部的「📊 滚动快照」段。**状态写进每条 WO 自己，不再另开一段历史。**

## 规范

| 记号 | 是什么 | 谁做 |
| --- | --- | --- |
| **WO** | Work Order —— 一条需求的拆解：需求原文 / 现状 / 改什么 / 验收判据 | 我做，你验收 |
| **DR** | Decision Request —— **必须由你做的决定** | 你 |

流程：

1. 收到需求 → 拆成 WO；**影响面大的，必须配一个 DR 请你 review WO**。
2. 写完本文件**单独 commit**。
3. 无 DR 的 WO → **直接开搞**；有 DR 的 WO → **等你决策完再开搞**。
4. 做完 → 发起验收。
5. 🔴 **你验收 OK 后立刻把该 WO / 已答复的 DR 从本文件删掉。**
   验收若有分歧，**作为新一轮的新 WO 重新进表**（版本历史在 git，不用怕丢）。

## 执行注意（常驻，细节在 memory）

- **分支**：本轮在 `feat/v1.2.0-island-courtyard`，**不推 `main`**（推 `main` = 上线）。
- **质量门**：`env -u NODE_OPTIONS npm run lint` → **0 error / 33 warning**；**不跑 React Compiler**。
- **构建前** `mv dist .workbuddy-ai/dist-prev-<ts>`（沙箱拦 `prepareOutDir`）。
- **推不通**（`github.com:443` 间歇 502）→ 改 SSH；判据永远 `gh api repos/<slug>/commits/<branch> --jq .sha`。
- **跑截图前** `pkill -f chrome-headless-shell`（孤儿 chrome 会把 swiftshader 饿死）。
- 其余环境 / 踩坑 / 基线见 `.workbuddy-ai/memory/MEMORY.md` 与 `hard-rules.md`。

---

# 📋 待办 WO

## WO-16 · README「参考资料」+4 条（影响面小 ⇒ 无 DR，可直接做）

- **需求原文**：「修改 readme 文档，添加下面参考资料」
  - <https://github.com/MengTo/kage>
  - <https://github.com/fanhuayishiy/ai-demo>
  - <https://github.com/huangbai-AI/yingxian-pagoda>
  - <https://github.com/lhlGitHub/threejs-architecture-effects>
- **现状**：README 已有 `## 参考资料` 段（4 行表 + `sylva`/`ez-tree` 两条说明）。
- **改什么**：补 4 行；其中 **2 项没有开源授权**，按现有体例加 `⚠️` 说明。
  | 项目 | 是什么（已核实） | 用进代码了吗 |
  | --- | --- | --- |
  | `MengTo/kage` | 京都山寺夜游五章 Three.js 实时光影 · 1709★ | ❌ 仅观赏（**NONE 授权**） |
  | `fanhuayishiy/ai-demo` | 三维 demo 合集（樱花街角 / 夕空飞行等的**上游**）· MIT · 95★ | 参考做法，见 WO-17/18 |
  | `huangbai-AI/yingxian-pagoda` | 应县木塔六幕滚动三维科普站 + 可编辑模型 · 27★ | ❌ 仅参考（**NONE 授权**） |
  | `lhlGitHub/threejs-architecture-effects` | 「可交互自装配 3D 建筑」的 Agent Skill · MIT · 530★ | ❌ 思路参考 |
- **验收判据**：表格 8 行；两处无授权提示；段序仍是 `部署 / 参考资料 / 许可`。

## WO-17 · 前院两棵樱花树（参考 `sakura-station-corner`）· **影响面大 ⇒ 配 DR-L**

- **需求原文**：「参考 `aispin/ai-demo/tree/main/sakura-station-corner` 在前院种两棵樱花树」
- **现状**：前院只有一棵柿子树（`PersimmonTree`，**4 draw call**：枝/叶/果/影）。
  mesh 预算：**全站基线 704**。樱花树若各占 4 ⇒ +8 mesh，可接受。
- **上游做法（已核实）**：demo 是**三株樱花 + 持续落樱**，代码在 `src/assets/flora`；
  贴图**全部运行时 Canvas2D 程序化生成，零外部图片**；有 `?style=toon` 平涂 / 三渲二两套。
  ⚠️ **它是另一套树生成器**，不是 ez-tree，也不与我们的 `persimmonTree.js` 同源。
- **改什么（草案）**：新增 `utils/sakuraTree.js`（沿用柿子树的三条骨架原则：锥形管 /
  关节椭球 / 子枝回退 + 朝向偏置）+ `components/canvas/entrance/SakuraTree.jsx`；
  花瓣用 1 个 `InstancedMesh` 做持续飘落（复用 `WeatherLayer` 的粒子思路）；
  四季表现接 `SEASON_*` 色板。
- **要你定的（→ DR-L）**：放哪 / 两棵的大小关系 / 要不要落樱 / 落樱是否只春天。
- **验收判据（草案）**：不穿墙、不压窗（`probe-tree-fit.mjs` 扩到樱花）；mesh 增量 ≤ 10；
  两棵树的形态由不同 seed 决定且**各自稳定**（契约 1）。

## WO-18 · 前院小飞机 + `/flight` 飞行模式（参考 `sunset-flight-study`）· **影响面最大 ⇒ 配 DR-M**

- **需求原文**：「参考 `aispin/ai-demo/tree/main/sunset-flight-study`，前院摆一架小飞机，
  点击在 `/flight` 路由下进入飞行模式。」
- **现状（已核实）**：**本项目没有路由系统** —— "模式"一律靠 URL 查询参数
  （`src/config/cameraMode.js` 读 `URLSearchParams`，如 `?fly`）。第二个页面是
  `/me`（`me/index.html` + `vite.config.js` 的 `rewriteMePage` 中间件）。
- **上游做法（已核实）**：`sunset-flight-study` 是一个**独立应用**
  （`aircraft.js` 23 KB / `flight.js` / `pilot-input.js` / `cel-material.js` /
  `anime-renderer.js` / `painted-clouds.js`），模型·环境·轨迹·音效**全程序生成**，
  默认「夕空飞行」+ `?scene=classic` 日间双机。
- **改什么（草案）**：前院加 1 架小飞机（`InstancedMesh`/单 mesh）+ 点击拾取
  （`onClick`）→ 进入 `/flight`。
- **要你定的（→ DR-M）**：`/flight` 是**查询参数**、**真前端路由**、还是**新的 Vite entry**？
  进入后是"接管主站相机绕着岛飞"还是"独立页面/独立场景"？飞机在外面是静物还是待机动画？
- **验收判据（草案）**：点击命中率；进入/退出后主站状态不残留（走既有 `probe-transition-leak`）；
  新增 mesh / draw call 与体积增量报数。

## WO-19 · 柿子树的"假"：叶子像纸片 / 果子飘离树冠 / 树干像粘土 · **影响面中～大 ⇒ 配 DR-O**

- **需求原文**：「我们柿子树目前看起来还是很假，叶子像纸片，果子有飘离树冠的情况，
  树干是光滑的像粘土没有树皮的感觉」
- **现状（已逐条定位，见 DR-K）**：
  1. **果子飘离树冠 —— 🔴 这是真 bug，且是注释与代码矛盾。**
     `src/utils/persimmonTree.js:613-620`：注释写「半径 **0.97~1.02** ⇒ 果正好卡在叶壳上」，
     而代码是 `randRange(rand, 1.10, 1.20)` —— **落在冠壳之外 10~20%**。
     叶团最远只到 `rho` 0.86~1.0（同文件 592-604 行的 `shell` 分支）
     ⇒ 果必然悬在叶外。历史：第一版果在叶**里面**（看不见），为了"看得见"把半径推出去，
     **推过头了**。修法不能只改数字 —— 要**贴着真实叶团**放。
  2. **树干像粘土** —— `shaders/persimmonTree.js` 的 `TREE_BARK_FRAG` **有**程序化 fbm 竖裂纹，
     但**只改颜色、不扰动法线** ⇒ 表面在光照下仍是光滑的。真树的"糙"主要读自**法线变化**。
  3. **叶子像纸片** —— `makeLeafTuftGeometry()` 是实体几何叶（2200 团 × 8 三角形），
     `DoubleSide`，有 `uWind` 风。缺的是**叶缘不规整 / 叶脉细节 / 透光感**，
     以及**单叶尺度的层次**。
- **改什么（草案）**：① 果改为"取真实叶团、沿外法线偏移半颗果"⇒ 保证贴冠且露头；
  ② 树皮把 fbm 的**梯度**转成法线扰动（`dFdx/dFdy` 或解析梯度）+ 提裂纹对比；
  ③ 叶子加叶缘扰动 + 叶脉 + 双层（内层暗、外层亮）提体积感。
- **要你定的（→ DR-O）**：**要不要为"树皮/叶"放宽"零位图"硬规矩**（见 DR-O）。
- **验收判据（草案）**：果—叶"贴合度"用数值判据（每颗果到最近叶团的距离 ≤ 叶团半径），
  **不靠截图**（本仓截图 A/B 噪声底 7.8%，见 `hard-rules §26`）。

---

# 🙋 待你拍板的 DR

## DR-K · 树 / 草的写实度路线（原「要不要用 ez-tree」—— 根因已探明，请拍板往哪走）

- **问题（2026-10-12 追加）**：「为什么它 demo（<https://www.eztree.dev/>）里面的树和草地
  比我们的逼真很多？」
- **答：因为它的逼真建立在「位图贴图 + glb 模型资产」上，而这两样本项目的硬规矩禁止。
  不是我们的算法不如它，是我们选了一条不能靠贴图的路。** 四条证据（全部读过源码）：

  1. 🔴 **草地根本不是程序化的。** demo 用 `GLTFLoader` 加载 **`/models/grass.glb`**
     （外加 `flower_white/blue/yellow.glb` 三种花），`GrassOptions.instanceCount = 5000`
     （上限 25000）、`scale = 100`、`patchiness = 0.7`（`src/app/grass.js`）。
     ⇒ 一个**真实建模的草簇资产** × 5000 实例，对比我们的「3 棱锥台 + 纺锤穗」。
     ⚠️ **而且它在库里根本没有** —— `src/lib/` 的导出面只有
     `Tree / Trellis / TreePreset / BarkType / Billboard / LeafType / TreeType`，
     `src/app/grass.js` 是 **demo 应用**的代码。**引 ez-tree 拿不到这片草。**
  2. **树皮是 4 张 1k 位图/种**（color / normal / **ao** / roughness），
     birch / oak / pine / willow 各一套 = **16 张**（`src/lib/assets/bark/*.jpg`）。
     贴法见 `createBranchesGeometry()`：`mat.aoMap / mat.map / mat.normalMap / mat.roughnessMap`。
     ⇒ 树干有纹理、有**凹凸**、有粗糙度变化。
  3. **叶子是带 alpha 的位图四边形**（`src/lib/assets/leaves/{ash,aspen,oak,pine}_color.png`）
     + `alphaTest` + `dithering: true`（`createLeavesGeometry()`）
     ⇒ 叶形**不规整**、有叶脉、有明暗，不是干净的多边形。
  4. **还有一整套环境**：`src/app/environment.js` 装配 `Ground + Grass + Skybox + Rocks + Clouds`。
     "逼真"里有很大一块来自**光照与环境**（天空盒、云、岩石、地面、阴影），不只是树本身。

- **三个抱怨的逐条归因**（与上面的根因一一对应）：
  | 用户说的 | 根因 | 能不能在"零位图"下改善 |
  | --- | --- | --- |
  | 树干光滑像粘土 | 没有 normal 贴图 ⇒ 光照下表面平坦；我们的 fbm **只改颜色** | ✅ 能（把 fbm 的高频转成**法线扰动**） |
  | 叶子像纸片 | 没有 alpha 叶位图 ⇒ 叶形规整、缺叶脉/透光 | ✅ 大部分能（叶缘扰动 + 叶脉 + 透光近似） |
  | 果子飘离树冠 | 🔴 **我们自己的 bug**（半径 1.10~1.20 在外壳之外） | ✅ 能（且与 ez-tree 无关） |

- **选项**：
  - **(a) 什么都不动**（原建议，但现在有了新信息：三个抱怨里只有 1 个是 bug、2 个是"没贴图"）。
  - **(b) 只出一张 `presets` 参数映射表**附 `docs/`（`angle/children/gnarliness/force/
    length/taper/start/twist` ↔ 我们的 `SPREAD/OUT_BIAS/UP_BIAS/FWD_BIAS/LEN_FALLOFF`）。
  - **(c) 真引 ez-tree** —— 仍要 fork/vendor 剥掉 base64 贴图注册表 `Z`；
    而且**引了也不解决"像纸片/像粘土"**，因为那两样正是它的**贴图**带来的，
    剥掉贴图后它比我们更差（枝条 `cylinder without end caps`、**没有关节几何**）。
  - **(d) 【新·推荐】守住零位图，用程序化手段把写实度顶上去** —— 落到 **WO-19**。
    这条路能修掉 3 个抱怨里的 3 个（1 个是 bug、2 个是 shader/几何问题），
    且不破规矩、不加体积。

## DR-L · 樱花树怎么放（属 WO-17）

- 要你定：**两棵的相对位置与大小**（都在屋前？一棵左一棵右？一大一小？）、
  **要不要持续落樱**、**落樱是否只在春天**、樱花色是否要走四季色板。
- 已知约束：前院已有柿子树 + 荷花缸 + 花箱 + 石桌 + 白狗 + 草带，
  樱花要**避让**这些（沿用草带那套"按每片叶的扫掠包围盒判相交"的做法）。

## DR-M · `/flight` 怎么实现（属 WO-18）

- 要你定三件事：
  1. **`/flight` 的形态**：(i) 查询参数（如 `?flight`，与现有 `?fly`/`?season=` 一致）
     / (ii) 真前端路由 / (iii) **新的 Vite entry**（像 `/me` 那样，最重、但最独立）。
  2. **进入后是什么**：(i) 接管主站相机、就在这座岛上飞
     / (ii) 独立场景（＝把 `sunset-flight-study` 搬进来当第二世界）。
  3. **飞机在前院**：静物 / 待机动画 / 可点击的拾取物（要不要 hover 提示）。
- 我的倾向：**(i) 查询参数 + (i) 接管主站相机** —— 最贴合现有架构、增量最小；
  独立场景那条实质上是"把另一个项目整个搬进来"，体积与理念代价都很大。

## DR-N · `me` 要不要挪到（生成到）`public/` 下

- **现状（已核实）**：`me/index.html` 是**Vite 的第二个 entry**，里面是
  `<script type="module" src="/src/me/main.js">` ⇒ **必须被打包**（模块图：
  `fluidBg.js / main.js / me.css / meData.js / player.js`）。`/me` 由
  `vite.config.js` 的 `rewriteMePage` 中间件改写到 `me/index.html`。
- **关键结论：直接把 `me/` 挪进 `public/` 会坏掉。** `public/` 是**逐字节拷贝**，
  Vite 不会处理它 —— `src="/src/me/main.js"` 会 404。`public/demos/*` 之所以能放那儿，
  是因为它们是**已经构建好的产物**（预构建 dist），不是源码。
- 两条路：
  - **(i) 保持现状**（Vite entry）：`/me` 参与 `npm run build`、有 hash、不提交产物。
    代价：多一个 entry + 一个中间件。
  - **(ii) 预构建后生成到 `public/me/`**：`/me` 变成纯静态目录（现有
    `rewritePublicDirIndex` 直接就能服务 `/me/`，中间件可删）、可独立分享。
    代价：**必须把构建产物提交进仓库并保持同步** —— 这正是本项目栽过的
    "**一份会漂移的副本**"（`hard-rules §28`），`public/demos/*` 已经在吃这个苦。
- **我的建议：(i) 保持现状**，除非你的目标是「让 `/me` 能脱离主站单独部署/分享」。

## DR-O · 「零位图」硬规矩要不要为「树皮 / 叶子」放宽（属 WO-19）

- **现状**：全站只允许 2 张位图（`apple-touch-icon` 是只吃 PNG 的例外），其余全程序化。
- **选项**：
  - **(i) 不放宽**（继续程序化）：正常线扰动做树皮、叶缘扰动 + 叶脉做叶。
    预期效果：从"粘土/纸片"提升到"能看"，但**到不了 ez-tree 的观感**。
  - **(ii) 有限放宽**：为"树"这一类**最多放 2 张 webp**（例如 1 张树皮 normal +
    1 张叶形 alpha）。预期效果：**一步接近 demo**。代价：破现有硬规矩，
    需要同步改 README「美术」段与 `hard-rules`。
  - **(iii) 完全学 demo**（每物种 4 图 + glb 草）：与项目定位（全程序化、零位图）冲突，不建议。
- **我的建议：(i) 先做 (i)** —— 因为 3 个抱怨里有 1 个是 bug（果）、2 个是
  shader/几何问题（粘土、纸片），**先把这三条做掉再回头看还差多少**。
  真到了"必须贴图"那一步，再回来拍 (ii)，那时是**有依据的决定**，不是猜的。
