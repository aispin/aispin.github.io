# 工作计划 · aispin.github.io

> **本文件是白板，不是台账。**
>
> 只放**待办**：待做的 **WO** + 待你拍板的 **DR**。
> 🔴 **代码一提交，就把该 WO / 关闭的 DR 从这里删掉** —— 不等验收、不等下一轮。
> 过程记录、实测数据、踩坑结论一律进 `.workbuddy-ai/memory/`（入口 `MEMORY.md`）。
>
> **新一轮迭代开始时，WO 和 DR 都应该是空的。**
> **已交付的东西不留在这里** —— 技术结论在 `docs/`、过程在 git 历史。

## 规范

| 记号 | 是什么 | 谁做 |
| --- | --- | --- |
| **WO** | Work Order —— 一条需求的拆解：需求原文 / 现状 / 改什么 / 验收判据 | 我做，你验收 |
| **DR** | Decision Request —— **必须由你做的决定** | 你 |

流程：

1. 收到需求 → 拆成 WO；**影响面大的，必须配一个 DR 请你 review WO**。
2. 写完本文件**单独 commit**（交给 git 管版本）。
3. 无 DR 的 WO → **直接开搞**；有 DR 的 WO → **等你决策完再开搞**。
4. 做完 → 发起验收。
5. 🔴 **代码提交后立刻把该 WO / 已答复的 DR 从本文件删掉。**
   验收若有分歧，**作为新一轮的新 WO 重新进表**（版本历史在 git，不用怕丢）。

## 执行注意（常驻，细节在 memory）

- **分支**：本轮在 `feat/v1.2.0-island-courtyard`，**不推 `main`**（推 `main` = 上线）。
- **质量门**：`env -u NODE_OPTIONS npm run lint` → **0 error / 33 warning**；**不跑 React Compiler**。
- **构建前** `mv dist .workbuddy-ai/dist-prev-<ts>`（沙箱拦 `prepareOutDir`）。
- **推不通**（`github.com:443` 间歇 502）→ 改 SSH；判据永远 `gh api repos/<slug>/commits/<branch> --jq .sha`。
- **跑截图前** `pkill -f chrome-headless-shell`（孤儿 chrome 会把 swiftshader 饿死）。
- 其余环境 / 踩坑 / 基线见 `.workbuddy-ai/memory/MEMORY.md` 与 `hard-rules.md`。

---

# 📊 滚动快照（2026-10-11 19:20）

主题：**孤岛院子（v1.2）** —— 把固定的正面院子改成真能绕一圈看的 3D 场景。
分支 **`feat/v1.2.0-island-courtyard`**（不是 `main`，不影响线上）。

已交付：环绕相机状态机 + 受限轨道、`IslandGround`、`BambooGrove`、竹篱笆小院、
**WO-6 三处封口**（雾 / 只在人在走廊里时渲染 / 退到门前自动退出）、
「外观与内部解绑」、`settleLerp` dt 补偿、竹子贴脸让开（DR-H）、
窄视口放开环绕上限（DR-I）、`sw.js` 的 `respondWith` 兜底修复（`v6 → v7`）。
**验收材料 / 探针 / 结论全在 `.workbuddy-ai/memory/`**（当日日志 + `MEMORY.md`）。

---

# 📋 待办 WO

> 本轮全部来自用户 2026-10-11 的 6 条反馈（4 条改动 + 2 个 bug）。
> **影响面较大的三条我已在 WO 里写死了我的取值和理由**（屋身高度、藤宽、侧檐），
> 按你的常驻指示"先按你认为最佳的方案执行" —— 数值不合适就是一轮新的 WO。

### WO-7 · 屋身加高，目标"比柿子树略高一点点"

- **现状**：`HOUSE_EAVE_Y = FLOOR_Y + 5.0 = 3.25`（墙头/檐口），
  `HOUSE_RIDGE_Y = 7.635`（屋脊）。
  **实测柿子树的可视树冠顶 ≈ 3.35（秋）/ 3.48（夏）**
  —— 判据是 `entranceArt.js` 的 `EDGE.y0 = 300` + rosette 半径上限
  `1.7 × (30+26) = 95 px`，按 128 px/单位折回 6×8 平面（组 y=0.95）。
  ⇒ **树梢和墙头几乎等高（3.48 vs 3.25）**，这就是"房子看着比树矮"的来源。
  正面机位（z=28、fov 60 竖向）根本看不到屋面，用户只看到「墙 + 压顶」。
- **改什么**：只抬 `HOUSE_EAVE_Y`，**不动 `HOUSE_PITCH`（你说整体效果不错）**。
  `FLOOR_Y + 5.0` → **`FLOOR_Y + 6.0`**（3.25 → 4.25，比最高的夏季树梢高 0.77）。
  派生量全部自动跟：`HOUSE_WALL_H`、`HOUSE_RIDGE_Y`（→ 8.635）、山墙、屋面、椽头、
  `HOUSE_COPING_Y`（藤的锚点）。
- **判据**：墙头（4.25）> 树冠顶（3.48）；`HOUSE_EAVE_Y` 仍远高于走廊顶
  （`FLOOR_Y + 3.5 = 1.75`）；正面机位截图里压顶线明显高于树梢。

### WO-8 · 侧面三角形山墙改黄白色 + 侧面加屋檐

- **现状**：`GableWall` 画的是**纯三角**（`shape` 只有三个点；矩形那半截由侧墙
  `ShellWall` 负责 —— 组件顶上那句"矩形 + 三角"的注释是旧的，实际不重叠）。
  它和砖墙共用 `SONG_WALL_FRAG` ⇒ 现在是灰砖三角。
  屋面 `ROOF_WIDTH = HOUSE_HALF_W * 2 = 22` ⇒ **硬山**，屋面与山墙齐平、没有侧檐。
- **改什么**：
  1. 新增 `GABLE_FRAG`（GLSL 只许住在 `src/shaders/`）—— 黄白抹灰面，
     带竖向微渐变 + `NOISE_GLSL` 的纸纹，和砖墙同一套"程序化 + 颗粒"的语汇。
  2. `ROOF_WIDTH = HOUSE_HALF_W * 2 + 2 * HOUSE_SIDE_OVERHANG`，新增
     `HOUSE_SIDE_OVERHANG = 0.9`（与前后出檐同值）⇒ 屋面从 22 变 23.8，**悬山**。
     山墙三角保持原尺寸，屋面从它两侧挑出去。
- **判据**：侧视截图里三角是黄白、屋面在三角两侧各挑出 0.9；山墙斜边与屋面坡度
  仍然重合（`HOUSE_RIDGE_Y` 依旧只由墙长一半推出来）。

### WO-9 · 常春藤重做：加宽 / 变细 / 打磨

- **现状**：`WALL_INK_W = 10`、`WALL_INK_H = 6` 的透明 overlay，
  runners 全落在 **world x ∈ [1.18, 4.62]**（只占 overlay 的左半边），
  所以画面上只是门右侧一缕细藤。
- **改什么**：
  1. **加宽**：runners 重新铺满 overlay，并让 overlay 只覆盖**门右侧那半面墙**
     （中心从 x=0 挪到 x≈5.9），跨度 ≈ **10.8**，即"和右侧外墙一样宽"
     —— 我按"从大门右边一直到前墙右边缘"理解（前墙半宽 11）。
     ⚠️ 门左半边**不放藤**（左边是柿子树，本来就满了）。
  2. **变细**：`limb(...)` 的主干笔画 13 → **9**，支条同比收细；
     叶簇半径略降，避免"糊成一片"。
  3. **打磨**：卷须/叶脉密度、疏密节奏重排（现状 runners 只有 5 条，太稀）。
- **判据**：藤横跨前墙右半边；枝干明显变细；**不能爬到窗上**
  （窗这次要挪到 x=5.0，见 WO-10 —— 两个改动一起验）。

### WO-10 · 窗户离门距离 ×2，另一侧加一个对称窗

- **现状**：`WINDOW_X = 2.5`（洞 `WINDOW_HOLE`，半宽 0.7）。
  前墙的洞由 `SONG_WALL_FRAG` 的 `max(rectHole(uHoleDoor), rectHole(uHoleWindow))` 出。
- **改什么**：
  1. `WINDOW_X` 2.5 → **5.0**（正好 2 倍）。
  2. 新增 `WINDOW_X_LEFT = -5.0` + `WINDOW_HOLE_LEFT`；shader 加 `uHoleWindow2`
     与第三个 `max`。
  3. `EntranceDoors` 里镜像一套窗框 + 窗帘 + hover 热区（探头小人镜像，
     `AVATAR_REST_X` 取负）。
- **判据**：两窗关于大门对称、各自离门 5.0；两个洞都透出窗帘；
  hover 时小人从对应那一侧探头。

### WO-11 · BUG：门缝透白边

- **现状**：用户图 2 —— 两扇门叶之间的门缝上有一条亮白竖边。
  `makeDoorFrameTexture` 的注释里记着**同一类**问题（"the corridor's white wall
  showed through as a bright band straight across the top of the doors"），
  当年是靠 `headFrac` 让上槛跨满「叶顶 → 框顶」解决的 ——
  **说明"框没盖住缝"这个模式在本组件里出现过一次**。
- **改什么**：以复现结论为准（`probe-entrance-bugs.mjs` 的门缝近景 + 截图），
  大概率是把 `#e0e0e0` 那层框/背板的覆盖范围补到门缝上，或给门缝加一道
  压条；**不排除**是门叶贴图边缘 alpha 透出的框底。
- **判据**：门缝近景里不再出现亮色像素（对门缝做一条竖向像素采样，
  亮度不得高于两侧叶面）。

### WO-12 · BUG：进门/出门时身后一堵黑墙，约 2 秒后消失

- **现状**：入场滑行 **2.4 s**，其间 `hasEntered` 仍为 `false`
  ⇒ `IslandGround / HouseShell / ForecourtFence / BambooGrove / EntranceDoors /
  SignSystem / WeatherLayer` **全都还挂着**，而走廊已经可见
  （`corridorVisible = hasEntered || doorOpening`）。
  `HouseShell` 的**后端封口**是一堵 22 宽的墙（`z = −1.85`），
  **横在 7 宽的走廊里** —— 进门后朝前看，它就是走廊尽头那堵墙。
  2 秒后消失 = `markEntered()` 那一刻 `HouseShell` 整棵卸载。
- **改什么**：把 `HouseShell` 的**后端封口**从"屋身外观"里摘出来，
  改成只在"人真的在外面"时挂（而不是"没进门"时挂）——
  或者干脆按 `camZ` 判：相机越过前墙后就不再画后端封口。
- **判据**：入场滑行全程，走廊前方不再出现横墙；`probe-corridor-seal.mjs` 13/13 不变。

---

# 🙋 待你拍板的 DR

### DR-A · 要不要拉远雾 + 加天空盒？（**想要"海平线"就必须答"要"**）

- **现状**：`config/seasonLight.js` 的 fogFar 只有 **36（冬夜）~66（春）**。
  雾就是世界边界 —— 正因为雾这么近，岛才做到 r=30 就够，**省掉了一整个天空盒 + 远景 LOD**。
- **要**：能看到远处海平线、"孤岛"的孤立感成立。代价：`seasonLight.js` 写着
  「季节的空气感一半靠雾」，拉远雾 = **8 个状态（4 季 × 昼夜）全量视觉回归**。
- **不要**：保持现状 —— 岛边缘化进雾里，"岛"是靠岸线和竹林读出来的，不是靠看见边界。

### DR-C · 远处竹林要不要做 impostor？

- **现状**：420 根竹子全程真几何（2 个 InstancedMesh）。
- **做**：省 draw call / 顶点。代价：tidewater 的 `LODFade.js:21-50` 用 Bayer 4×4 抖动做
  交叉淡入淡出，**那个方案依赖 TAA 才能不闪** —— 我们**没有 TAA**，照抄会闪。
  要上就得改用静态抖动图案或纯距离剔除。
- **不做**：维持现状（先量一帧的实际开销再决定，`mesh-curve.mjs` 平台期判据）。

> **DR-D**（门楼嵌在院墙里）与 **DR-E**（外壳往 −z 拉多长）**已被 WO-6 取代并作废**。
> **DR-G / DR-H / DR-I** 均已答复并落地，随各自 WO 出表。
