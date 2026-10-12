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

# 📊 滚动快照（2026-10-12）

主题：**孤岛院子（v1.2）** —— 把固定的正面院子改成真能绕一圈看的 3D 场景。
分支 **`feat/v1.2.0-island-courtyard`**（不是 `main`，不影响线上）。

已交付：环绕相机状态机 + 受限轨道、`IslandGround`、竹篱笆小院、
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

**2026-10-12 三件事全部落地（用户当轮的三条指示）**：
① **DR-J 答"留"** ⇒ 狗尾巴草草带就此定案（`7d33d9e`，无改动）。
② **柿子树重构成真 3D**（`b951e4f`）：照用户给的 `public/demos/web3d/tree/`
   搬到项目里 —— **锥形管 + 关节椭球**（"树干衔接自然"的全部秘密）+ **冠体积内
   撒叶**（"树冠饱满"）。骨架 1 个 mesh、叶 / 果各 1 个 `InstancedMesh`、
   地面投影 1 片 ⇒ **4 次 draw call**（demo 那棵树是 3000+ mesh）。
   旧贴图树整段删除，`entranceArt.js` 2729 → 1543 行。
③ **DR-A 答"要"**：雾从 36~66 拉远到 **76~128**，新增**天空穹顶**（地平线 =
   雾色，天顶 = 季色，太阳方位一条暖晕），地面 60 → **180** 半宽，
   轨道上限 28 → **38**（这才第一次看得见整座岛 + 海平线）。
④ **DR-C 答"换成"**：竹林 → **超现实幻想梦幻森林**（`DreamForest`）：
   细杆 + **完美圆球冠** + 外缘透光 + 球面斑点 + 云雾化；170 棵 / 2 次 draw call。
   `BambooGrove.jsx` 删除，`BAMBOO_*` 一整套配置改名 `FOREST_*`。

**2026-10-12 追加 · `sw.js` 预缓存的修复（用户贴控制台日志）**：
用户贴的四条里其实有**两个病**。第一条（`Response.error()`）是**设计内**行为 ——
服务器停了 + 该资源没进过缓存；`vite preview` 那条长寿命后台任务被回收了。
但另外两条暴露了两个**真 bug**，都已修（`v7` → `v8`）：

- `manifest.webmanifest: ERR_CONNECTION_REFUSED` —— 它在 `PRECACHE_URLS` 里，
  但静态分支的正则**没有 `webmanifest`** ⇒ SW 根本不接管 ⇒ 走裸网络。
  **"在预缓存清单里"≠"会被 fetch 处理器接管"。**
- `assets/main-*.js` —— 静态分支只 `caches.open(RUNTIME)`，**从没读过 `PRECACHE`**
  ⇒ install 期下的 favicon / maskable 图标 / 字体离线时**一个都取不出来**，
  「精确预缓存核心外壳」实际只兑现了首页一张 HTML。
  ⇒ 改成 RUNTIME 优先、落空再问 PRECACHE。

判据 `probe-sw-fetch.mjs` 从 7 条扩到 **10 条**（新增三条"断网 + 只靠预缓存"），
**先验过红**：拿 v7 跑 **7/10**（三条全 `Failed to fetch`）；v8 **10/10**，
content-type 分别是 `application/manifest+json` / `image/svg+xml` / `font/woff2`。
顺带修好 `check-sw-dev.mjs` —— 它**端口写死 5199** 而 dev 在 **5173**，长期跑不起来
（"一条跑不起来的判据等于没有判据"），改成从 argv 取。

---

# 📋 待办 WO

> 用户 2026-10-11 的 6 条反馈（4 条改动 + 2 个 bug）全部已交付
> （WO-7…WO-12，见 git 历史）。本轮暂无待办 WO。

---

# 🙋 待你拍板的 DR

> 本轮开始时表里是 **DR-J**（狗尾巴草留/调/换）、**DR-A**（拉远雾 + 天空盒）、
> **DR-C**（竹林 impostor）。三条用户都已答复并落地（见上面的快照），按白板规矩
> **全部出表**。
>
> 🔴 顺带一个**还没答**的问题（从 DR-J 里继承下来）：**左窗会被柿子树的树冠
> 压掉一部分**。3D 树重构之后已经缓解 —— 树冠底在 world y 1.83，而窗顶只有
> 0.75，所以窗是**从冠下露出来**的；树干也从 x −3.55 往右挪到 −3.20，不再压
> 在窗上。要不要再挪，看定妆照 `.workbuddy-ai/shots/wo-final-house/`。
>
> 下一轮开始时这里应该是空的。**有分歧就是新一轮的新 WO。**
