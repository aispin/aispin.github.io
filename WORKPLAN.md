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

# 📊 滚动快照（2026-10-11 23:05）

主题：**孤岛院子（v1.2）** —— 把固定的正面院子改成真能绕一圈看的 3D 场景。
分支 **`feat/v1.2.0-island-courtyard`**（不是 `main`，不影响线上）。

已交付：环绕相机状态机 + 受限轨道、`IslandGround`、`BambooGrove`、竹篱笆小院、
**WO-6 三处封口**（雾 / 只在人在走廊里时渲染 / 退到门前自动退出）、
「外观与内部解绑」、`settleLerp` dt 补偿、竹子贴脸让开（DR-H）、
窄视口放开环绕上限（DR-I）、`sw.js` 的 `respondWith` 兜底修复（`v6 → v7`）。
**WO-7~WO-12（用户 2026-10-11 的 6 条反馈）全部落地**：
屋身加高（檐口 `FLOOR_Y + 6.0`，实测树冠顶 3.83 → 墙头 4.25）、
山墙改黄白抹灰 + 侧面出檐（悬山，`ROOF_WIDTH` 22 → 23.8）、
常春藤重做（铺满右半面墙、枝干 13/9 → 9/6 px、绕开右窗）、
窗户离门 ×2（2.5 → 5.0）+ 左侧对称窗（三个洞 + 两个探头小人）、
门缝透白边（洞口 alpha 必须 1.0）、进门时身后那堵黑墙（后端封口跟 `corridorVisible`）。
**墙脚那道矮竹篱换成狗尾巴草草带**（`FoxtailGrass`）：沿整面前墙铺开
（世界 x −10.5…10.5），程序化 3 棱锥台 + 纺锤穗、共 2 次 draw call，
四季色板 `SEASON_FOXTAIL`；避让是**按每片叶的扫掠包围盒**和实测障碍物
（台明 / 白狗 / 荷花缸 / 花箱）做三维相交判掉，判据 `probe-grass-clearance.mjs`。
被替换的 `BambooFence.jsx` 与 `makeBambooFenceTexture` 一并删除（死代码）。
**用户第二轮两条报障也全部落地**：
① 「退出门口时的 BUG」= 屋外那一整套的**边界不统一** —— 退场滑行 1.3 s 里
`hasEntered` 还是 true，而 `EntranceDoors` / `IslandGround` / `SignSystem` /
`BambooGrove` / `WeatherLayer` 只写了 `!hasEntered` ⇒ 前墙上只剩一个**光洞**。
提成一个 `outdoorVisible` 谓词，全部走它；另加"门从开着往回关"（`swingShut`），
否则相机会穿过**关着的门板**（整屏门神年画闪一下）。判据 `probe-transition-leak.mjs`。
② 「进门后竹子出现了」= 竹林的排除带只有 z ∈ [−2.85, 39.15]，而**走廊往 −z 是无限的**
⇒ 屋后那一段竹子长在走廊的管子里（实测 150 根 |x| ≤ 3.7，走廊一直画到 z = −57.85）。
新增 `CORRIDOR_CLEAR_HALF_W`：按 |x| 一刀切、**不看 z**。判据 `probe-bamboo-corridor.mjs`。
**验收材料 / 探针 / 结论全在 `.workbuddy-ai/memory/`**（当日日志 + `MEMORY.md`）。

---

# 📋 待办 WO

> 用户 2026-10-11 的 6 条反馈（4 条改动 + 2 个 bug）全部已交付
> （WO-7…WO-12，见 git 历史）。本轮暂无待办 WO。

---

# 🙋 待你拍板的 DR

### DR-J · 狗尾巴草草带：留、调、还是换回竹篱？

- **现状**：「看看效果」的东西 —— 已按你说的做完（门口两边都要、和墙宽一样、
  不和花箱穿透）。四季定妆照在 `.workbuddy-ai/shots/wo-grass-final/`。
- **留**：就这样。它是全项目第一条**实体几何**的草（竹篱当年栽在"零厚度
  平面绕到侧面就消失"上），2 次 draw call，四季跟着 `SEASON_FOXTAIL` 变。
- **调**：密度 / 高度 / 穗的大小都是 `utils/foxtailGrass.js` 顶上的常量，
  改一个数就是新一轮。
- **换回**：`git revert` 即可（`BambooFence.jsx` 与它的贴图在同一个提交里删的，
  一起回来）。
- ⚠️ 顺带一个还没答的问题（上一轮就留在表外）：**左窗被柿子树冠压掉一部分**
  —— 树冠横跨 world x −5.24…−1.46，左窗在 −5.7…−4.3。要不要把树往左挪一点？

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
