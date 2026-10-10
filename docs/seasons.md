# 四季院子 · 技术 Spec

> 状态：**已定稿，待实施**
> 决策日期：2026-10-09 ｜ 基线 tag：`v1.0.2`（`7b67aa8`）
> 讨论稿已归档，本文件是唯一真源。

---

## 0. 决策记录

| # | 决策 | 结论 |
|---|---|---|
| 1 | 季节与昼夜的关系 | **正交** —— `theme` × `season` = 8 态 |
| 2 | 季节从哪来 | **自动按月份** + `?season=` 调试覆盖（**首版不加 UI 按钮**） |
| 3 | 是否新增道具 | **新增** |
| 4 | 新增道具的季节行为 | **摆设常驻**；季节只改其**状态与材质**。真实院子的陈设相对固定，随季节变的是活物与天象 |

决策 4 是本方案的核心模型，见 §2。

---

## 1. 目标与非目标

### 目标

1. 院子从「白天 / 晚上」两种状态，扩展到 **四季 × 昼夜 = 8 态**；
2. 四季**一眼可辨**，靠的是氛围而不是换一套场景；
3. 与门联**自动同步**（今天挂秋联，院子就是秋天）；
4. 不牺牲现有性能预算与视觉契约。

### 非目标

- ❌ 不重写几何，**不改 `config/entranceMetrics.js` 的任何数字**
- ❌ 不引入位图（全站只允许 2 张，见 §7）
- ❌ 不开阴影贴图（`LIGHTS.shadows` 保持 `false`）
- ❌ 不做「季节专属小游戏 / 剧情」
- ❌ 首版不做季节切换 UI

---

## 2. 核心模型：三分法

**真实院子的陈设是固定的**，随季节变的是**活物**与**天象**。所以季节改动按三档归类，
**新增道具一律归 A 档**：

### A · 常驻摆设（invariant）

几何**永不下架、永不换位**。季节**不改它"在不在"**，最多改材质。

台基 / 台明 / 踏跺 / 门槛 / 门枕石 · 大门 + 门框 + 门神 + 倒福 + 春联 + 横批 ·
匾 + 横梁 + 灯笼 · 窗框 + 窗帘 + 窗内 · 木花箱 + 兔 · 风铃 · 白狗 ·
青砖门脸 · 甬路 · **荷花缸（新）** · **石桌石凳（新）** · **竹篱（新）**

### B · 季变状态（seasonal state of invariant things）

同一个物件，换**材质 / 配色 / 开关**。

| 物件 | 春 | 夏 | 秋 | 冬 |
|---|---|---|---|---|
| 柿子树树冠 | 嫩芽 + 花 | 浓荫 | **红果 + 黄叶（现状）** | **不画（秃枝）** |
| 地面影子（画在贴图里） | 中 | 短 | 长 | 最长 |
| 草地 | 返青 + 多花 | 深绿茂盛 | 微黄 | 枯黄 + 雪 |
| 墙上藤蔓 | 新叶 | 深绿 | 转黄 | 枯藤 |
| 荷花缸内容物 | 荷钱 | 荷叶 + 荷花 | 残荷 + 莲蓬 | 薄冰 + 积雪 |
| 花箱植物 | 新芽 | 茂盛 | 结实 | 枯枝 + 南天竹红果 |
| 灯笼亮度 | 低 | 低 | 中 | **高（冬夜长）** |
| 窗内暖光 | 中 | 中 | 中 | 高 |
| 风铃摆幅 | 中 | 小 | 大 | 大 |
| 白狗 / 兔 | —— 中性，不随季节 —— |

### C · 季生（genuinely appears / disappears）

**只有天象与迁徙动物**允许"在 / 不在"。这是全表唯一允许 pop 的一档。

| 项 | 春 | 夏 | 秋 | 冬 |
|---|---|---|---|---|
| 雨 | ✔ 细雨 | ✔ 雷雨 | ✘ | ✘ |
| 雪（落雪） | ✘ | ✘ | ✘ | ✔ |
| 燕子 | ✔ 在（归巢） | ✔ 在（育雏） | ✘ 南飞 | ✘ **空巢** |
| 瓢虫 | ✔ 1 | ✔ 2–3 | ✔ 1 | ✘ 越冬 |
| 蝉声 | ✘ | ✔ | ✔ 寒蝉（弱） | ✘ |

> **空巢比拆掉更动人** —— 冬天燕子窝留着，只是没有鸟。

---

## 3. 季节状态机

### 3.1 唯一真源：`src/config/seasons.js`（新增）

```js
export const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];

export const SEASONS = {
  spring: { id: 'spring', zh: '春', months: [3, 4, 5] },
  summer: { id: 'summer', zh: '夏', months: [6, 7, 8] },
  autumn: { id: 'autumn', zh: '秋', months: [9, 10, 11] },
  winter: { id: 'winter', zh: '冬', months: [12, 1, 2] },
};

/** 3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬（气象季节，非节气）。 */
const BY_MONTH = ['winter','winter','spring','spring','spring',
                  'summer','summer','summer','autumn','autumn','autumn','winter'];

export const seasonIdOf = (date = new Date()) => BY_MONTH[date.getMonth()];
export const seasonZhOf = (date = new Date()) => SEASONS[seasonIdOf(date)].zh;
```

**⚠️ 月份表必须搬家，不能复制。** 这张表现在**已经存在**于 `config/couplets.js`
（`SEASON_BY_MONTH` + `seasonOf()`）。本 spec 把它提到 `seasons.js`，
`couplets.js` 改为**引入**：

```js
// couplets.js —— 保持对外 API 不变（?couplet=秋 仍然可用）
import { seasonZhOf } from './seasons';
export const seasonOf = seasonZhOf;
```

> 这是本项目最贵的一课：**同一张表写两遍，迟早在某个文件里漂移。**

### 3.2 解析：自动 + `?season=`

```js
export function resolveSeason(search = window.location.search) {
  const raw = new URLSearchParams(search).get('season');
  if (raw) {
    const key = raw.toLowerCase();
    const hit = SEASON_IDS.find((id) => id === key)
             || SEASON_IDS.find((id) => SEASONS[id].zh === raw);   // ?season=秋 也认
    if (hit) return { id: hit, source: 'override' };
  }
  return { id: seasonIdOf(), source: 'auto' };
}
```

与 `?couplet=` **同构**（都认 id 与中文名），便于验收时一眼看懂。

#### 3.2b 🔴 `?season=` 必须**同时驱动门联**（✅ 已接线）

第一版只把 `?season=` 接进院子，门联仍然只认系统日期 —— 于是十月里
`?season=spring` 会得到**春天的院子挂着「桂子飘香」**。四季定妆照直接没法看。

优先级定死为：

```
?couplet=  >  ?season=  >  日期链（农历节日 > 法定假期 > 节气 > 季节兜底）
```

- `?couplet=` 仍然最强（它是最具体的调试开关）
- `?season=` 是**硬覆盖**，会**跳过整条日期链** —— 否则十月的寒露节气联会盖掉
  你指定的春天
- `dailyCoupletFor()` 也读 `?season=`，所以 `?season=spring&couplet=off` 得到的是
  春天那副，而不是"今天那一副"

实现只有一处：`couplets.js` 的 `seasonOverrideZh()`（`resolveSeason()` 的
`source === 'override'` 才生效，所以**自动按月份时行为完全不变**）。

### 3.3 运行时可切换：**偏好** vs **解析结果**

2026-10-09 加了设置面板（§10），季节不再"一次会话内恒定"，所以 `useSeason()`
从"每挂载解析一次"改成了读 `SitePreferences`。两个概念必须分开：

| 概念 | 取值 | 谁用 |
|---|---|---|
| **偏好** `season` | `'auto'` \| `'spring'` … | 设置面板的选中态、`resolveCoupletSet()` 的季节参数 |
| **解析结果** | `'spring'` … （**永不** `'auto'`） | 所有渲染消费者（`useSeason()` 的返回值）、`html[data-season]` |

优先级：**`?season=` > 自动（按月份）**。

`?season=` 排最前，是因为它是"把这一页摆成冬天"的**一次性命令** —— 四季定妆照正是
靠这一条。

> 🔴 **2026-10-10：季节偏好不再落盘。** 它曾经存 `localStorage['aispin-season']`，
> 现已**整个删掉** —— 每次刷新都重新判定（`?season=` 覆盖，否则按当月）。
>
> **为什么删**：存档把「季节」变成了一个**粘性状态**。用户在面板里点过一次「冬」，
> 此后无论几月打开都是冬天；更糟的是验收时 `?season=` 只是**初始值**，一旦点过面板
> 就被存档盖住，四季定妆照会拍到上一轮点过的季节。站点本来的设计意图是
> 「**今天几月，院子就是哪一季**」（`config/seasons.js`），存档恰恰破坏了它。
>
> **行为**：面板里点「冬」→ 本次会话立刻变冬；**刷新后回到当月**。所以面板选的季节
> 是"预览"，不是"设置"。`SitePreferences` 的季节 `useEffect` 只写 `html[data-season]`，
> 并顺手 `removeItem` 清掉历史版本留下的键。
>
> 证据：`harness/settings-panel-check.mjs` §0/§2 断言 `localStorage` 里**没有**
> 季节键；§6 手选「春」后刷新，断言 `data-season` 回到当月（autumn）。

**不挂午夜定时器**：`'auto'` 档仍然每挂载解析一次。跨午夜重烘贴图会是一次可见的
pop，而一个开着过夜的标签页不值得为它 pop 一次。刷新即正确 —— 而"刷新即重判"
现在是不落盘的直接推论，不再依赖"用户没点过面板"。

> 🔴 **重渲染 ≠ 画面会更新。**
> 季节变成运行时可切之后，有且只有两类地方**必须自己动手**，漏了会静默停在旧季节：
> 1. **季节 uniform** —— 不能换对象，只能就地改 `.value`（见 §5.1d）
> 2. **只在过渡过程中写值、稳定后 early-return 的插值机** —— 见 §4.2b

---

## 4. 正交轴：`theme` × `season` = 8 态

### 4.1 现有契约（照抄的模板）

昼夜已经是**一个 0..1 标量 `k`，0.9s 缓动，首帧吸附**，且三个消费者**逐字同构**：

| 消费者 | 位置 | 作用 |
|---|---|---|
| 天空 / 雾 / 三灯 / **全屏乘法 veil** | `canvas/SceneLighting.jsx` | 全局氛围 |
| 窗内暖光（`color` 推过 1.0 抵消 veil） | `entrance/EntranceProps.jsx` → `WindowCurtain` | 灯亮着 |
| 灯笼 emissive + pointLight + 闪烁 | `entrance/SignSystem.jsx` → `Lantern` | 灯亮着 |

### 4.2 改法：只换端点，**不动插值机器**

季节是**每挂载恒定**的（§3.3），所以不需要第二级缓动。8 个端点退化为：

```
sky = SEASON_LIGHT[season].day.sky.lerp( SEASON_LIGHT[season].night.sky, k )
```

`k` 的缓动、首帧吸附、`veilUniforms`、三灯的 lerp —— **全部原样保留**。

> ⚠️ **未来若要加季节切换 UI**，这里才需要升级成**双线性插值**（季节轴 × 昼夜轴）。
> 届时**必须**给季节轴单独一条缓动（与 `k` 同款写法）。现在不加，是**刻意不做死代码**。

### 4.2b 🔴 换季 = **吸附**，不是插值（✅ 已实现）

上面那个"未来"在 2026-10-09 到了（设置面板能选四季），但**没有**升级成双线性插值
—— 因为换季应当是**瞬间吸附**：它是"换一副牌"，不是"傍晚来临"。0.9s 的缓动在这里
会读成一次诡异的黄昏，而且会让季节轴与昼夜轴互相污染。插值机因此仍然只有一维。

但换季必须**让插值机重写一遍**。三个消费者的写法是：

```
每帧：if (t < 0) t = target; else if (t !== target) { 缓动一步 } else { return }
```

`else { return }` 是关键 —— **值只在过渡过程中被写**。于是"换季时已经稳定"
（深色模式下最常见）就永远等不到一次重算，画面停在旧季节的天空/雾/色温/窗光上。

实现：每个消费者持一个 `lastSeason` ref，换季时把标量归零，下一帧立刻吸附重写。

| 消费者 | 有没有这个问题 | 处理 |
|---|---|---|
| `SceneLighting`（天空 / 雾 / 三灯 / veil） | **有**（稳定后 early-return） | `lastSeason` ref + `t.current = -1` |
| `EntranceProps` → `WindowCurtain`（窗光） | **有**（同上） | `lastSeason` ref + `lit.t = -1` |
| `SignSystem` → `Lantern`（灯笼） | **没有**：那个 useFrame 每帧都写 | 不动（别加死代码） |

> `<fog args={…}>` 的 `args` 换季时确实会变（R3F 的 `is.equ` 对数组做逐元素比较），
> 于是 R3F 会 `detach` 旧的再 `attach` 新的 —— 这一步是安全的（两个循环在
> `swapInstances` 里同步跑完）。但**不能只靠它**：`scene.background` 与三盏灯
> 都不在 `args` 里，必须靠上面那次吸附重写。

### 4.3 端点表：`src/config/seasonLight.js`（✅ 已实现）

**🔑 秋天必须直接复用 `theme.js` 的现有常量**，而不是重新写一份：

```js
import { SCENE, LIGHTS, NIGHT } from './theme';

// 秋天 = 现状。直接引用现有常量，保证逐位一致、且不可能漂移。
const AUTUMN_DAY   = { sky: SCENE.background, haze: SCENE.fogColor, fogNear, fogFar,
                       ambient: {...LIGHTS.ambient}, key: {...LIGHTS.key}, fill: {...LIGHTS.fill} };
const AUTUMN_NIGHT = { veil: {...NIGHT.veil}, sky: NIGHT.sky, haze: NIGHT.haze, fogNear, fogFar,
                       ambient: {...NIGHT.lights.ambient}, key: {...NIGHT.lights.key}, fill: {...NIGHT.lights.fill} };

export const SEASON_LIGHT = { spring: {...}, summer: {...}, autumn: { day: AUTUMN_DAY, night: AUTUMN_NIGHT }, winter: {...} };
export const seasonLightFor = (season) => SEASON_LIGHT[season] || SEASON_LIGHT.autumn;
```

- 每季 **2 组**（day / night），每组 8 个量：`sky / haze / fogNear / fogFar / ambient / key / fill / veil`
- `night.sky` 与 `night.haze` 按**「想看到的样子」**书写，由 `unmultiplyVeil(sky, veil)` 反算
  —— **每季用自己的 veil**（`unmultiplyVeil` 已支持传入 veil 参数），在
  `SceneLighting.jsx` 的 `endpointsFor()` 里算一次并缓存
- 太阳高度角进 `key.position`（见 §5.1 / §4.4）

### 4.3b 季节灯光系数：`seasonGlowFor(season)`（✅ 已实现）

灯笼与窗内暖光是场景里唯一**主动发光**的东西：它们不能跟着天黑变暗（亮着的窗就是窗
存在的理由），所以靠把 `color` **推过 1.0** 去抵消全屏 veil。

于是 veil 越亮，同一份过驱值落到眼里就越亮。冬夜的 veil 是 `0.54/0.60/0.76`（雪把天光
反上来），比秋天的 `0.40/0.46/0.66` 亮约 30% —— 窗会直接**削顶**，而削顶就是把暖色烧成
白，一扇白窗等于没有窗。

**做法：系数取 veil 亮度的倒数，归一到秋天。**

```js
const veilLuma = (v) => 0.2126 * v.r + 0.7152 * v.g + 0.0722 * v.b;
export function seasonGlowFor(season) { /* AUTUMN_LUMA / veilLuma(该季 night.veil) */ }
```

- 这是**推导**出来的，不是手调的：谁改了哪一季的 veil，灯自己会跟上
- ⚠️ 只乘在「过驱量」上（`1 + A * k * s`），**不乘那个 1** —— 那个 1 是白天的窗
  （veil 纯白、等于没乘），乘了会让冬天的窗在白天就暗掉 23%
- 代价：夜里只能补到 ~9% 残差而不是 0。这点残差恰好落在「冬夜窗略亮一点」的方向上，
  不必再修
- 秋天 `s = 1`，所以秋天逐位不变（回归锚点的一部分）

### 4.4 ⚠️ 修正：**影子是画出来的，不是算出来的**

`LIGHTS.shadows = false`，模板刻意关掉了阴影贴图并且**这是要保留的性能红利**。
所以「太阳高度角 → 影长」**不能靠灯**。

**真正的做法：影子是贴图里手绘的那一块。**

`makeTreeTexture()` 里本来就有：

```js
ctx.translate(398 + cfg.shadowDx, GROUND + 12);
ctx.scale(1, cfg.shadow);      // ← 压扁系数 = 影长
const shadow = ctx.createRadialGradient(0, 0, 14, 0, 0, 300);
```

**季节改的就是这个 `shadow`**（冬 0.30 / 春 0.20 / 秋 0.17 / 夏 0.11），
外加 `shadowDx` 表达太阳方位（冬 +22 / 春 −14 / 夏秋 0）。
**零成本，且完全符合本项目"程序化生成"的路子。**

太阳高度角仍然要改 `key.position` —— 但它改的是**明暗（Lambert 项）**，不是影长。
两者都要，别混为一谈。

---

## 5. 分层改动清单

按**性价比从高到低**排。L0 + L1 做完就该能一眼分辨四季 —— **如果不能，说明轴选错了。**

### L0 · 光照（纯数据，收益最大）

| 项 | 位置 | 状态 |
|---|---|---|
| 四季端点表 | `config/seasonLight.js`（新） | ✅ 8 组，见 §4.3 |
| 端点接线 | `canvas/SceneLighting.jsx` | ✅ `DAY`/`NIGHT_FROM` → `seasonLightFor(season)`，插值机器一行未动 |
| 太阳高度 | `seasonLight.js` 的 `key.position` | ✅ 夏至高（12.5）、冬至低（4.5） |
| **画出来的影长** | `utils/entranceArt.js` | ✅ `TREE_SEASON[*].shadow` / `shadowDx` |
| 灯笼季节强度 | `entrance/SignSystem.jsx` | ✅ 乘 `seasonGlowFor(season)`，见 §4.3b |
| 窗内暖光季节强度 | `entrance/EntranceProps.jsx` | ✅ 同上（`WindowCurtain`） |

### L1 · 材质（便宜，高收益）

| 项 | 位置 | 状态 |
|---|---|---|
| **树** | `entranceArt.makeTreeTexture(season)` | ✅ 见 §5.1；树干拼接缝一并修掉（§5.1b） |
| **草** | `shaders/entranceTextures.js` | ✅ 见 §5.2；雪见 §5.2b |
| 藤蔓 | `entranceArt.makeWallInkTexture(w, h, season)` | ⬜ P3（当前仍是常绿） |
| 花箱植物 | `EntranceProps.WoodenPlanter` | ⬜ P3 |
| 荷花缸内容物 | 新组件 | ⬜ P3，见 §6.1 |

> ⚠️ 藤蔓没做四季，是**刻意**的：它和树在同一条水平线上，冬天墙上一片枯黄而藤蔓还
> 油绿会很刺眼。留到 P3 与花箱一起做，届时两者用同一套"枯/荣"参数。

#### 5.1 树的四个状态

`makeTreeTexture(season)`，缓存键 `entrance:tree:${season}`：

| 季节 | 做法 | 状态 |
|---|---|---|
| `spring` | 新调色板 `TREE_SPRING`（提亮 + 偏黄绿）；**果实段换成落花段**（`blossoms: 26`）；地面落花瓣 | ✅ |
| `summer` | 复用 `TREE_GREENS`；**跳过果实段**；树冠 rosette 加密（`rosetteR [36,30]`、`scatterChance 0.34`） | ✅ |
| `autumn` | **逐位等于现状**：`TREE_GREENS` + `TREE_AUTUMN`(30%) + 34 果 + 3 落果 + 14 落叶 | ✅ |
| `winter` | **跳过 canopy / fruit / windfalls / litter 四段**；保留树干/主枝/细枝；枝上积雪 | ✅ |

> 冬秃枝是**删四段代码**，不是做一套新资产 —— 因为 `LIMBS` 那 13 条主枝是**手写死的**。

参数全部进 `TREE_SEASON` 表（`canopy / foliage / rosetteR / scatterChance / fruit /
blossoms / windfalls / litter / litterKind / shadow / shadowDx / snow`），
`treeSeasonOf(season)` 取；未知季节落到秋天。**秋天一栏是原值搬进表里，不是"又调了一遍"。**

#### 5.1b 🔴 树干「像拼接出来的」—— 成因与修法（✅ 已修）

用户的反馈原文：「看看我们那棵树的树干有没有办法优化，现在像是拼接出来的。」

**成因**：`taperedPath()` 画完轮廓后调了 `c.closePath()`。这个函数被**树干和 13 条主枝
共用**，于是每一段骨架都有一条**端面封口线**：

| 谁 | 封口在哪 | 宽度 |
|---|---|---|
| 树干 | 根部（y≈894，被草坪盖住） | 86 |
| scaffold A/B/C | **各自的起点 = 分叉点 (390,648)** | 44 / 44 / 40 |
| 各条子枝 | 各自挂到父枝上的那一点 | 20 / 18 / 16 |

三条主枝的封口线各自**垂直于自己第一段的方向**，全部交汇在分叉点 —— 四条线在一个点上
交叉，这就是那道"拼接缝"。

**修法：去掉 `closePath()`。** 两条性质让它成为最便宜的一次修复：

1. **对填充零影响** —— canvas 规范里 `fill()` 与 `clip()` 会**隐式闭合**子路径，
   只有 `stroke()` 会因此不再画端面。而树干/主枝的墨线恰好是唯一在意这件事的地方。
2. 🔑 **不消耗任何随机数** —— 所以树的整体形态逐位不变，秋天的回归锚点得以保留。

**已实测（不是断言）**：把 `HEAD` 版的旧树与新 `makeTreeTexture('autumn')` 逐像素比对，
**1459 个像素不同 / 全图 0.1855%**，最大通道差 105，差异外接框 `x 248..538, y 433..899`
—— 正好落在 13 条主枝的起点封口线 + 树干根部封口线上，**别处一个像素都没动**。

> 复现方法：`git show HEAD:src/utils/entranceArt.js > src/utils/__old-entranceArt.js`，
> 写一个同时 import 两个模块、把两张 768×1024 画到 canvas 后逐像素比对的临时页，
> 用 `harness/shot-page.mjs` 截一张差异图。**用完立刻删掉那两个临时文件。**

#### 5.1c 🔴 冬雪画在枝条上：**竖直段必须跳过，不是缩短**（✅ 已修）

冬天给主枝/细枝加积雪，做法是沿每条枝的**法线朝上**偏一段（canvas 的 y 轴朝下，
"朝上"即 `ny < 0`），而不是简单地把 y 减小 —— 减 y 对水平走向的枝会把雪线整个挪到
枝条外面去。

**踩到的坑**：第一版把偏移量乘了个"朝上程度" `|ny|`。想法是「越竖直挂的雪越少」，
但 `|ny| → 0` 只是让雪线**贴回枝条中线** —— 于是树干上出现一条**从分叉点一路拖到
根部的白线**（树干的 `|ny| ≈ 0.08`，偏移量只剩 1.4 px，正好压在树干中间）。

**短 ≠ 对，得 `continue`。** 现在把折线按 `|ny| >= 0.30` 切成若干段、只给连续段描边；
树干（`|ny| ≈ 0.08`）自然一段都不画 —— 物理上也对，竖直的枝干挂不住雪。
**树干那一条调用已经删掉**：留着它看起来像"给树干也上了雪"，但实际一个像素都落不下去。

#### 5.1d 🔴 季节 uniform 只能**就地改 `.value`**，不能换对象（✅ 已实现）

P1 的写法是 `useMemo(() => makeSurfaceUniforms(w, h, origin, season), [..., season])`
—— 季节变化时造一个**新的 uniforms 对象**。P1 里这没问题（季节每挂载恒定，只会建一次），
但设置面板让季节变成运行时可切之后，这个写法会**静默失效**。

**为什么**（读了 three 与 R3F 的源码才敢下结论）：

1. three 在材质上缓存 `materialProperties.uniforms` 与 `materialProperties.uniformsList`
   —— 后者是一串 `{ id, uniform }`，指向 uniform **对象**。上传时读的是这些对象里的 `.value`。
2. 这两者**只在 program 变化时**才重建（`getProgram()` 末尾
   `materialProperties.currentProgram = program; materialProperties.uniformsList = null;`）。
   而 `materialProperties.uniforms` 只在"新 program 被构建"那条分支里被赋值为
   `programCache.getUniforms(material)`，对 `ShaderMaterial` 来说**就是 `material.uniforms` 本身**。
3. R3F 更新 `uniforms` prop 走的是 `applyProps()` 的最后一个分支 `root[key] = value`
   —— **整体替换**。`uniforms` 是个普通对象（没有 `.set`/`.copy`），所以上面 5 条特判
   一条都不命中。
4. `material.needsUpdate = true` **也救不了**：program 缓存命中且
   `currentProgram` 未变时会 early-return，`uniformsList` 照样不重建。

→ 新对象里的值**永远不会被上传**，画面停在旧季节，且没有任何报错。

**修法**：`applyGroundSeason(uniforms, season)` 保留 uniform 对象本身、只改 `.value`
（数组与数字都是每帧现读的，所以换掉 `.value` 的引用就够）。它只写
`groundSeasonUniforms()` 里出现的键，调用方自己加的 `uInk` / `uHoleDoor` / `uCapFrac`
原样不动 —— 台基那块 `uCapFrac = 2.0` 的材质因此**刻意不接季节**，同时也是回归对照。

配套 hook `hooks/useSeasonUniforms(factory, deps)`：对象身份永远不变、`season` 不进 deps，
季节变化走 `useLayoutEffect` 就地改值（layout effect 是为了在浏览器下一次绘制前写完，
不闪一帧旧色）。三个调用点：`EmptyCorridor`（草）、`GateBase`（台明/踏跺顶面）、
`EntranceDoors`（甬路 + 幕墙）。

> 另一个**看起来**可行的方案是在 `<shaderMaterial>` 上加 `key={season}` —— 换季重建
> 材质，新材质拿到全新的 `materialProperties`，`uniformsList` 自然会重建。但 R3F 卸载时
> 会 `dispose()` 旧材质，three 的 `releaseProgram` 会递减 program 的 `usedTimes`；
> 一旦某个 shader 只有这一个用户，程序就被删掉，下次要**重新编译着色器**（可见卡顿）。
> 就地改 `.value` 没有这个问题。

#### 5.2 草地：**必须改 `grassSurface()`，不能分别改两个 shader**

`STONE_FRAG`（甬路）与 `GRASS_FRAG`（草地）**共用** `grassSurface(vec2 gw)`。
历史上这两个 surface 曾各有一套调色板 + 两套坐标系，在石路矩形边上相接 ——
「生硬」的定义，**解法是删掉接缝而不是柔化它**。

所以季节调色板**只加在 `grassSurface` 里**，两个 shader 同时得到，接缝不可能裂。

改法（**palette uniforms，不要把季节分支写进 GLSL**）—— ✅ 已实现：

```glsl
// 声明在 GRASS_GLSL 里，**只声明一次**：STONE_FRAG（甬路）与 GRASS_FRAG（草地）
// 都 include 这段，所以两边的季节色板天生相同。
uniform vec3  uGrassA;        // 基色 A（原 vec3(0.408,0.514,0.298)）
uniform vec3  uGrassB;        // 基色 B（原 vec3(0.278,0.400,0.220)）
uniform vec3  uMoss;          // 苔色
uniform vec3  uTip;           // 受光叶尖
uniform vec3  uFlowerA/B/C;   // 花瓣色阶 2..4（第 1 阶奶白仍是 GLSL 里的基准常量）
uniform float uFlowerDensity; // 原 `if (h.x > 0.08) continue;` 的 0.08
uniform float uSnow;          // 0..1 积雪覆盖
```

- ⚠️ 花色**不是**一个 `uFlowerTint` 偏移，而是 3 个色阶 —— 原实现就是
  `mix(奶白, A) → mix(B) → mix(C)` 三段，拆成一个 tint 会改变秋天的花
- `uSnow` 是**雪的主要实现**：地面薄雪 = 一次 `mix(col, snowColor, uSnow * mask)`。
  **零新增几何。** 其余三季 `uSnow = 0`，而 `mix(col, x, 0.0)` 在数值上严格等于
  `col` —— 这是秋天回归锚点成立的前提之一
- 花密度：春 **0.16** / 夏 0.08 / 秋 0.08 / 冬 **0**
- 色板经 `groundSeasonUniforms(season)` → `makeSurfaceUniforms(w, h, origin, season)`
  分发（它已统一 `uSize/uOrigin/uInLawn/uCapFrac`），**别在组件里各写一份**。
  `season` **默认 `'autumn'`**，所以忘记传的调用方（墙、台基）既不会变黑也不会变色

#### 5.2b 雪：三处，全是 uniform，零几何（✅ 已实现）

| 位置 | 做法 | 为什么 |
|---|---|---|
| 草地 / 甬路草边 | `grassSurface()` 里一次 mix，`mask = 0.42 + 0.58·smoothstep(fbm)` | 低频噪声做出「没盖满、还露着枯草」的斑驳；纯白平铺像塑料布 |
| 甬路石板 / 台明 / 踏跺顶面 | `STONE_FRAG` 里再叠一层**薄得多**的雪，**乘 `inPath`** | 石板是**扫过的路**。`* inPath` 必须：草边已经吃过厚雪，再叠一层会比草地还白，接缝立刻回来 |
| 压顶 / 瓦当滴水檐口 | `SONG_WALL_FRAG` 里 `smoothstep(capBase…) + eaveMask*0.80` | 冬天最容易露馅的一笔：地面全白了、屋顶还是黑的，场景立刻"假"。**砖墙立面保持干净** —— 垂直面挂不住雪 |

> `SONG_WALL_FRAG` 不 include `GRASS_GLSL`，所以 `uniform float uSnow;` 要在它里面
> **自己再声明一次**。名字必须与 `makeSurfaceUniforms` 分发的那个一致 ——
> three 忽略多余的 uniform，也**不会**为缺失的 uniform 报错，写错就是**静默不生效**。

### L2 · 道具

见 §6。分「常驻新道具」与「季生」两类。

### L3 · 声音（性价比之王）

`src/audio/ambience.js` **已经是一张声明式预设表**（`AMBIENCE_NAMES = ['wind','city','sea']`，
每项是 `[{noise, filters, gain, lfo}]` 的层叠结构，现场合成、零素材）。
**季节环境音 = 往 `PRESETS` 里加 4 条。**

| 季节 | 预设 | 结构方向 |
|---|---|---|
| 春 | `spring-rain` | 带通白噪（细雨沙沙）+ 极慢 LFO |
| 夏 | `summer-cicada` | 窄带噪 + **高频 AM 调制**（蝉的振鸣）+ 一条更慢的起伏 |
| 秋 | `autumn-insects` | 稀疏短促脉冲（虫鸣）+ 低频风 |
| 冬 | `winter-hush` | 极低电平风噪，**近乎无声**（留白就是冬） |

⚠️ **沿用本模块的既有硬规则：各层 LFO 频率必须互不成谐波** —— 一旦成整数倍，
十几秒后能听出周期，底噪立刻"死"掉。

⚠️ **不做加载即播。** 起播点只有「推开大门」与「面板里主动取消静音」（现有 BGM 契约）。
季节环境音必须挂在**同一个起播闸门**后面。判「在不在响」用 `!paused && currentTime > 0`
或 `synth.audible`，**不能用 `paused`**。

### L4 · 文字

**已完成。** `couplets.js` 的四副季节联 + `?couplet=秋` 早就在跑，本方案只需按 §3.1
把月份表搬过去、让它与院子共用同一个真源。

---

## 6. 新道具规格

**统一规则：新增道具一律常驻（A 档）。季节只改其状态与材质，不改"在不在"。**

### 6.1 荷花缸（用户点名，P3）

> 用户原话：「荷花缸这种摆设型的建议常驻。真实的院子一般摆设相对固定。」

**常驻部分**：陶缸（`LatheGeometry`，与燕子窝同款做法）+ 水面（1 个 plane + 程序化水贴图）。
**位置**：窗下木花箱外侧，或台明一侧。**四季不动。**

**季变内容物**（B 档）：

| 季节 | 内容物 |
|---|---|
| 春 | 水面 + 刚冒出的**荷钱**（几片小圆叶） |
| 夏 | **荷叶田田** + 1–2 朵荷花（粉/白）+ 一只蜻蜓 |
| 秋 | **残荷**（枯黄卷边叶）+ **莲蓬** —— 「留得残荷听雨声」 |
| 冬 | 水面**结薄冰** + 缸沿积雪；荷叶全无 |

预算 ≈ 12 mesh。

### 6.2 石桌石凳（P3）

庭院最经典的固定陈设。石桌 1（桌面 + 柱 + 基座）+ 石凳 2（座 + 柱）。
**四季不动**；冬加积雪、秋加落叶。预算 ≈ 8 mesh。

### 6.3 竹篱（P3，可选）

沿墙矮竹篱。**用程序化贴图 + alphaTest 平面**（与树、藤蔓同款做法），
**不做实体几何** —— 1–2 mesh 就够。季节只改攀爬植物的配色。

### 6.4 季生道具（C 档）

| 项 | 实现 | 新增 mesh |
|---|---|---|
| 落雪 | 相机前的滚动噪声 shader 平面 | 1–2 |
| 地面/墙头积雪 | `grassSurface` 的 `uSnow` + `SONG_WALL_FRAG` 压顶上方一条雪带 | **0** |
| 雨幕 | 相机前 shader 平面（斜纹 + 湿地反光） | 1–2 |
| 燕子 / 瓢虫 | **已有**，只改数量与显隐 | 0 |

---

## 7. 硬约束与预算

| 约束 | 值 | 来源 |
|---|---|---|
| mesh 总数 | **≤ 760**（基线 697，新增 ≤ +60） | `harness/scene-stats.mjs` |
| 贴图上传 / 显存 | 不超现状 59 / 64.5 MB | `harness/texture-inventory.mjs` |
| 位图 | **全站只允许 2 张**（两个头像） | 项目视觉契约 |
| 随机数 | **禁 `Math.random()`**，用 `mulberry32(hashString(key))` | `engine/art.js` 契约 |
| 贴图缓存键 | **季节必须进 key** | 否则切季拿到上一季的图 |
| 几何真源 | **不动 `config/entranceMetrics.js`** | 入口竖向几何唯一真源 |

### 贴图：按需烘 + 缓存，**绝不 4 套并行驻留**

这是**春联那一课的推广**：39 套门联**只烘当前一套**，因为全烘是 117 张贴图 ≈ 95 MB 显存。

季节同理：树 768×1024 ≈ 786 KB / 张。只烘当前季 = 786 KB。
**切回旧季必须命中缓存、0 新烘。**

`RoomWarmup` 预热**当前季节**。
⚠️ 低端机 `RoomWarmup` 直接 `return null`，那笔开销会落到进场景那一刻 —— **别让它变重**。

---

## 8. 验收

按项目惯例：**无头截图 + 同机位对比**（`harness/shot-at.mjs` 多机位 + `harness/imgdiff.py`）。

### 8.1 定妆照

**8 张**（4 季 × 明/暗），同机位，拼 contact sheet 一次看全。
直达参数：`?season=winter&theme=dark`（也可写 `?season=冬`）。

### 8.2 断言

1. **回归锚点**：`?season=autumn` 的光照与树，与改动前**逐字节一致**
   —— 因为秋天直接复用 `theme.js` 常量（§4.3）。这是本方案最便宜的回归测试。
2. **不重烘**：连续切 2 轮季节，**只有第一次**烘新贴图（第二次 0 新增请求）
3. mesh 总数 ≤ 760
4. 贴图显存不超预算
5. **0 console error**
6. 每张图算 `sha1`，**相邻相同即报错**
   —— 防止「拍错机位还报 ✅」（本项目的经典事故）

### 8.3 已知的无头坑（必须遵守）

- app 首绘后会**整页 reload**，`window.__scene` 会被清空 → 轮询谓词必须
  `if (!window.__scene) return false;` 守卫，且 `sleep(6000)` soak
- **机位注入必须挂到渲染路径上**（补丁 `renderer.render()` 开头的 `camera.updateMatrixWorld()`），
  并**用 `setInterval` 守着重装** —— 自己开 rAF 写 `camera.position` 会被控制器每帧盖掉，
  症状是「两张相隔 17 单位的图逐字节相同，脚本还在报 ✅」
- 用 `?noloader=1` 更稳；`RoomWarmup` 会饿住主线程 ~25s，React effect 到 **t≈31s** 才跑
- 网格数要**等稳定**（t=35s 能读到 1035，t=50s 才收敛到 726）—— **别中途读数**

---

## 9. 分期

| 期 | 内容 | 完成判据 | 状态 |
|---|---|---|---|
| **P1** | L0 光照 + 树的四季 + 草的四季 + 雪的 uniform（**纯数据，零新增几何**） | 8 张定妆照一眼可辨；`?season=autumn` 与改动前逐位一致（**唯一例外见下**） | ✅ 2026-10-09 |
| **P2** | L3 声音 + 燕子/瓢虫的季生开关 | 关掉画面只听声音也能分辨季节 | ✅ 2026-10-10（§9.3） |
| **P3** | 常驻新道具（荷花缸 / 石桌石凳 / 竹篱）+ 季生天象（雨 / 雪）+ 藤蔓/花箱四季化 | 每季有自己的"物证"；mesh ≤ 760 | 🟡 石桌石凳已交付；荷花缸（位置已定：**与花箱并列**）/ 竹篱 / 雨雪 ⬜ |
| **P4** | 季节切换 UI（设置面板；**不做**双线性插值，换季改为吸附 —— 见 §4.2b） | 面板能切四季，且**同一次会话内**场景真的跟着变 | ✅ 2026-10-09 |

**P1 是成败判据**：如果只做 L0+L1 就已经能一眼分辨四季，后面都是加分项；如果不能，说明轴选错了。

> **P1 的回归锚点唯一例外**：秋天**不再**是逐字节一致，因为 §5.1b 的树干修复
> 故意改了描边 —— 差异已实测为 **0.1855% 的像素，且全部落在主枝起点封口线上**。
> 除描边之外，秋天的一切（光照、草色、果实、落叶、影长）逐位不变。

#### 9.1 P1 验收记录（2026-10-09）

| 项 | 结果 |
|---|---|
| `npm run lint` | **0 error / 33 warning**（与基线一致） |
| `npm run build` | ✅ 760 modules，4.62s |
| `harness/chunk-graph.mjs` | ✅ 无环；react chunk 195.5 KB（阈值 <120 KB 判误分类，未触发） |
| 生产冒烟 `smoke.mjs` | **meshes 697**（= 基线）、`rootChildren 1`、`hasCanvas true`、**ERRORS (0)** |
| 秋天树 A/B 像素比对 | **1459 px / 0.1855% 不同**，max Δ105，bbox `x 248..538, y 433..899` |
| 8 组合 × 2 机位定妆照 | 见 `.workbuddy-ai/seasons-2026-10-09/` |

#### 9.2 P4 验收记录（2026-10-09）

| 项 | 结果 |
|---|---|
| `npm run lint` | **0 error / 33 warning**（与基线一致） |
| `npm run build` | ✅ 通过 |
| `harness/chunk-graph.mjs` | ✅ 无环；react chunk 195.5 KB |
| `harness/settings-panel-check.mjs` | ✅ 全绿；**同一次会话内**秋→冬→春，三张院子图 sha1 互不相同；换季时场景 uniform 与树贴图都实测改变 |
| 证据图 | `.workbuddy-ai/settings-2026-10-09/`（面板开/关 × 明暗 + 三季院子） |

#### 9.3 P2 验收记录（2026-10-10）

`harness/verify-wo2-seasons.mjs`（新增，一次加载内走完四季 + 推门进走廊）：

| 判据 | 结果 |
|---|---|
| A 不做加载即播 | 手势前 `AudioBufferSource` = **0** |
| B 秋（冷启动）声床搭得起来 | 5 层 / 8 条 LFO；外层增益淡入目标 **0.250**（非静音） |
| C 换季换声床 | 面板切 春/夏/秋/冬，声床每次都重建；**六对签名两两不同** |
| D 无谐波锁相 | 慢速 LFO 合成包络 max\|ACF\|（3–90 s）**0.603 / 0.654 / 0.660 / 0.697**，上限 0.80 |
| E 与走廊互斥 | 推门后燕子 **4 → 0**（院子卸载）、`stop()` **+10**（= 4 噪声层 + 6 LFO，一个不剩） |
| F 燕子数量 | 春 2 / 夏 2 / 秋 1 / 冬 **0** 只 |
| F2 瓢虫 | 春/夏/秋在、冬 **不在** |
| G 无整页 reload | 页面实例指纹未变 |
| `npm run lint` | **0 error / 33 warning**（与基线一致） |
| `npm run build` | ✅ 通过 |
| `harness/chunk-graph.mjs` | ✅ 无环（react 195.5 KB） |
| 生产冒烟 `smoke.mjs` @70s | `rootChildren 1` / `hasCanvas true` / **meshes 701** / `ERRORS (0)` / RASTERS **2 张** |
| 物证图 | `.workbuddy-ai/wo2-2026-10-10/nest-4seasons.png`（四季燕子窝特写，春2/夏2/秋1/冬空窝） |

> 物证图用 `harness/shot-wo2-nest.mjs`：**不动相机**，把燕子窝的世界坐标
> `[0.86, 1.14, 22.22]` 投影到 NDC 算出屏幕矩形，再 clip 截图放大。
> ⚠️ 刻意**不用** `shot-at.mjs` —— 那个走 rAF 每帧写 `camera.position`，
> 而 R3F 在自己的 rAF 里"先更新控制器、再 render"，读回 `camera.position`
> 确实是你的值但**渲染用的是控制器的机位**（MEMORY.md 记过这个坑）。
> 不碰相机 ⇒ 不可能拍错。

⚠️ **`meshes` 必须读 plateau（`waitMs ≥ 65000`）**。`smoke.mjs` 文件头自己记着实测曲线：
55 s 读到 1005（RoomWarmup 预热的房间还挂着）、65 s+ 才落到 696 —— **同一个构建**。
生产 701 与 dev 下 `verify-wo2-seasons.mjs` 的秋天 **701 逐数吻合**。
相对 P1 的 697：石桌石凳 **+17**、秋天少一只燕子 **−13** ⇒ 净 **+4**。
（⚠️ 秋天**不再**与改动前逐位一致 —— §9 那条锚点是 **P1 的产物**，P2 故意改了它。）

**⚠️ 第一版判据是错的，两条都记在这里以免重犯：**

1. 「任意两条 LFO 之比不得接近整数（±2%）」——**方向反了**。它把 φ⁵ = 11.0885
   （离整数 11 只差 0.8%）判成失败，而那对恰恰最好（0.0113 vs 0.1253 相差
   0.001 Hz ⇒ 拍频周期 1000 s）。真正会死循环的是比值**正好**等于整数。
   改成量**自相关峰值**：φ 梯子 0.60–0.70、现有 `wind` 0.558、
   故意整数倍（0.02/0.04/0.06）**1.000** —— 阈值 0.80 分得很干净。
2. 「推门后燕子归零」在**冬天**测是**假绿** —— 冬天燕子本来就是 0，
   点中门与没点中给出同一个结果。改成先切回**春**（4 个燕子 mesh）再推门。

**四季声床的可辨识度**（"关掉画面只听声音也能分辨季节"的可测代理）：

| 季 | 层数 | 慢速 LFO | 快速调制 | 结构 |
|---|---|---|---|---|
| 春 `spring-rain` | 4 | 6 | — | 2.4 kHz 带通白噪的"沙沙" + 极慢雨势 |
| 夏 `summer-cicada` | 4 | 4 | **43.0 / 69.6 Hz** | 窄带（Q=13）噪声被高频 AM ⇒ 振鸣 |
| 秋 `autumn-insects` | 5 | 5 | **5.0 / 8.1 / 13.1 Hz** | 大深度增益 LFO ⇒ 一串串"唧唧" |
| 冬 `winter-hush` | 4 | 5 | — | 极低电平风噪（总增益 ≈ 别季的 60%） |

**实现要点（都不是"加数据"那么免费）：**

- **频率阶梯**：`SLOW = r₀·φᵏ`（φ = 黄金比）。四条声床共 15 条 LFO 全靠这把
  梯子取，任意两条之比都是 φ 的幂 —— 那条"互不成谐波"的硬规则从"手挑数字"
  变成了**结构保证**。⚠️ 别把 0.0113 这种值"四舍五入成好记的数"，那会把
  φ 的幂破坏掉（见 `ambience.js` 的阶梯注释）。
- **AM 也是 LFO**：本模块只有"往 `filter.frequency` 或 `gain.gain` 上叠正弦"
  一种调制。蝉的振鸣 = 窄带噪声 + `depth ≈ gain` 的 43 Hz 增益 LFO ——
  不需要新的音频原语。虫鸣的"短促脉冲"同理，只是频率落在 5–13 Hz。
- **挂载边界写在结构上**：`CourtyardAmbience` 挂在 `Experience.jsx` 里
  **和 `EntranceDoors` 同一个 `!hasEntered` 分支**，互斥是免费得到的。
  ⚠️ 别改成读 `isInRoom` —— 院子阶段它一直是 false。
- **起播沿用既有闸门**：`createAmbience` 内部走 `whenUnlocked`，所以手势前
  只排队、不建 AudioContext（判据 A 实测 0）。`whenUnlocked` 在已解锁时会
  **立即执行**，所以从大门走出去（`markExited` → `hasEntered` 翻假 → 院子
  重新挂载）时声床会立刻重建，不会哑掉。
- **燕子窝冬天连命中盒一起撤**：留一个"指针变手型、点下去没反应"的死交互，
  比没有交互更像坏了。

---

#### 9.4 WO-4 验收记录（2026-10-10 · 环境音配平 / 桌凳积雪与落叶 / 台基换季漏配）

用户一轮报了三条（原话见 `.workbuddy-ai/memory/2026-10-10.md`）：

| # | 需求 | 结论 |
|---|---|---|
| 1 | 春夏秋环境音比冬天大；先拉平四季、再整体调低 | ✅ `BED_TRIM` + `COURTYARD_VOLUME` |
| 2 | 冬季桌凳上的积雪不自然；（秋季是否放几张落叶和 2 个果实） | ✅ 雪盖重画 + 落叶 + 2 枚柿子 |
| 3 | 过道两边的草冬天还是绿的 | ⚠️ **当前代码里复现不出来**，见下 §9.4d |

**9.4a 环境音配平（两级音量，别混）**

原来四条声床各按**音色**手调、从没配过**响度**。实测各床"层增益 RMS"：

| 季 | 配平前 | `BED_TRIM` | 配平后 |
|---|---|---|---|
| 春 `spring-rain` | 0.1544 | **0.69** | 0.1065 |
| 夏 `summer-cicada` | 0.3055 | **0.35** | 0.1069 |
| 秋 `autumn-insects` | 0.1690 | **0.63** | 0.1065 |
| 冬 `winter-hush` | 0.1065 | 1.00（基准） | 0.1065 |

第二级（"整体多大声"）是 `CourtyardAmbience` 的 `COURTYARD_VOLUME`：0.5 → **0.325**
（×0.65）⇒ 0.1065 × 0.65 ≈ **0.0692**，比原来的冬天还低 35%。

🔴 **两级绝不能互相顶替**：`BED_TRIM` 是"四季之间的相对关系"，`COURTYARD_VOLUME`
是"铺底音量"这一个旋钮。用改 `BED_TRIM` 的方式整体降音，会把相对关系一起改掉。

⚠️ **只有增益能乘 `trim`，频率不能**：`gain` LFO 的 `depth` 调制的是 `gain.gain`，
要跟着乘；`filter` LFO 的 `depth` 单位是 **Hz**，乘了就改了音色。
`summer-cicada` 的 `depth ≈ gain`，最容易踩这一条。

**回归**：`verify-wo2-seasons.mjs` 40 条断言全 ✅ / `ERRORS (0)` —— 判据 C 比的是
**LFO 频率签名**，本次只动增益，所以四季签名仍两两不同（这是有意的：配平不该改音色）。

**9.4b 桌凳积雪：`makeSnowCapTexture` —— 第一版**静默什么都没做****

原来的雪是**一块 `#E4E9EF` 的纯色矩形平面**每边缩进一点 ⇒ 直边 + 均匀色 + 零厚度，
读成一张白贴纸（用户报的正是这个）。

重画成程序化贴图（`utils/entranceArt.js`）：底色 + 径向厚度 + 70 个淡斑 + **沿周长
啃边** + 内侧"薄雪"冷带。🔴 **第一版边界仍是直的**，原因记在这里以免重犯：

- 啃边循环用的 `globalCompositeOperation = 'destination-out'`，
  而 **`destination-out` 的擦除量 = 源的 alpha**；
- 那一行**没有重设 `fillStyle`**，它还是上一步最后一次 `createRadialGradient`
  留下的**局部**渐变（半径 r、r 以外 alpha 恒 0）⇒ 整圈啃边**一个像素都没擦掉**；
- 唯一擦到的是恰好落在最后那个斑圆心附近的一小块（凳面贴图右下角那块深色圆斑）。
- ⚠️ 这类 bug **不报错、不警告**，只有把贴图单独画出来看才发现 ——
  根目录临时页 `__artpreview.html`（`<script type="module">` 引 `*Art.js`，
  把 `texture.image` 排 contact sheet），**5 秒**。用完立刻删。

另外两条是调出来的，不是想出来的：

- **`SNOW_INSET` 0.05 → 0.09**：桌面在默认机位下只有 ~180 px 宽、贴图 569 px
  ⇒ 屏幕**降采样 ~3 倍**，0.05 的啃边只剩 2~8 px，读不出来。
- **孔不能是正圆、也不能大**：`alphaTest = 0.5` 之下，孔是"石头直接露出来"
  （不是薄雪）。第一版 9 个正圆孔读成一排**波点**；改成 4 组、每组 3~5 个小圆错位叠。

**9.4c 秋：落叶 + 2 枚柿子**

- 落叶 `makeLeafLitterTexture`：**一张贴图 + 一块平面**（叶子是平的，贴上去读起来
  完全对，省 3 个 mesh）。6 片主体 + 2 片碎叶，叶形复用 `drawLeaf`（与柿子树同一套
  笔法，所以"看起来是一棵树掉下来的"）。
  ⚠️ 同样因为屏幕降采样 3 倍，叶长取 `0.10~0.20 × H`（≈8~16 px 屏幕），再小就糊成噪点。
- 2 枚柿子：`FRUIT_R = 0.038`、压扁 0.8，色号与树上的果同族（`#E8722A` / `#D9621F`）。
  ⚠️ 球心 y = `R × squash` 才正好坐在桌面上。

**9.4d 台基换季漏配（真 bug，已修）**

`GateBase.jsx` 的 `plinthUniforms` 是
`useMemo(() => ({ ...makeSurfaceUniforms(PLINTH_W, PLINTH_H, [...]), ... }))` ——
**没传 `season`**，于是吃到 `makeSurfaceUniforms` 的默认值 `autumn` ⇒ `uSnow` 恒为 0。
后果：台明/踏跺的顶面（走 `useSeasonUniforms`）冬天落雪了，**唯独它们脚下那圈台基还是干的**
—— 就是本文件开头那句"雪后的院子里只有门前那块石头是干的"又犯了一次，只是换了一层。

改为 `useSeasonUniforms((season) => ...)`。**查法可复现**：`harness/identify-stuck-ground.mjs`
遍历整个场景打印所有 `uSnow === 0` 的贴地 mesh —— 修前恰好命中这一块
（`PlaneGeometry 10×0.3` @ world z=22.1），**修后 1 → 0**。

⚠️ 这类 bug **不报错、不崩**，只让一块面停在旧季节 ⇒ "给 `makeSurfaceUniforms`
传 season" 这条**必须靠工具查，不能靠眼睛**。

**9.4e 用户报的"过道两边的草还是绿的"—— 当前代码里复现不出来**

证据链（全部在当前 `main` 工作区、`?season=winter&noloader=1` 下跑）：

| 检查 | 工具 | 结果 |
|---|---|---|
| 所有 `uSnow === 0` 的贴地 mesh | `identify-stuck-ground.mjs` | **0 个**（修台基前是 1 个） |
| 所有贴地 mesh（y ∈ [-2.8,-1.2]，84 个） | `list-ground-level-meshes.mjs` | 8 个 GRASS surface **全部 `uSnow=1`**、`uGrassA` 全是冬色 |
| 冬季默认机位 1920×410 整帧偏绿像素 | PIL | 强绿 0.297%，**连通域全在 x 928~1262 = 墙上** |
| 冷启动冬 / 运行中切冬 / 4 档机位 / 5 组 x·z | `probe-closeup-winter.mjs` | 草坪与地面**全是雪白** |

冬天院子里**仅剩的绿**是两处，且都是用户 **2026-10-09 明确决定"暂不处理"** 的：
**外墙藤蔓**（画在墙贴图里，`LEAF_DEEP/MID/LIT`）与**窗下花箱**的绿色枝叶
（`EntranceProps.jsx` 的 `#3F7A35` / `#4C8A3F` / `#5FA24A` 圆柱+球）。

⚠️ **另一个必须知道的可能**：用户看的很可能**不是当前构建**。实测
`https://aispin.github.io` 的 `Experience-*.js`（375 KB）里
`uSnow` / `uGrassA` / `uVergeGreen` / `uTip` / `uFlower*` **一个都没有**，
且**仍留着写死的** `vec3(0.302, 0.400, 0.204)`（沿阶草）——
即线上站点**早于整个四季工程（P1）**，落后本地 `main` 22 个提交（未推）。
而"沿阶草冬天还绿"这件事**已经在 `a494035`（2026-10-09 20:12）修过一轮**，
commit message 里用户的原话就是「冬天院子过道的草需要处理下」。

⇒ **结论：先向用户确认构建来源 / 硬刷新，再决定是否动藤蔓与花箱。** 见 §12-6。
（2026-10-10 下午**已找到"用户为什么看到旧画面"的机制**，见 §9.4g。）

**9.4f 本轮质量门**

- `npm run lint` → **0 error / 33 warning**（基线）
- `npm run build` ✅（`Experience-BFqw0XmL.js` 389 KB）
- `chunk-graph.mjs` → **无环**，react chunk 195.5 KB，退出码 0
- 生产冒烟（`waitMs = 70000`）→ `rootChildren 1` / `hasCanvas true` / **meshes 704** /
  `ERRORS (0)` / 只有 2 张白名单位图
- `verify-wo2-seasons.mjs` → 全 ✅

**9.4g 「为什么用户会看到旧画面」查清了：dev 也注册了 service worker（真 bug，已修）**

§9.4e 把"用户看到绿草"归到"可能不是当前构建"，但**没查出机制**。这一轮补齐了，
并且它是**真 bug**，不是用户操作问题。

`public/sw.js` 的静态资源分支是**按扩展名**匹配的：

```js
if (/\.(js|css|woff2?|png|jpe?g|webp|svg|ico|json)$/i.test(url.pathname) || url.pathname.startsWith('/textures/')) {
  const cached = await cache.match(request);
  return cached || network;            // ← stale-while-revalidate
}
```

而 `src/main.jsx` 里注册 SW **没有按环境分流**（`import.meta.env.PROD` 那个判断根本不存在）。
于是 **Vite dev 也注册**了 SW，而 dev 服务的正是 `/src/shaders/entranceTextures.js`
这种**不带内容哈希**的模块 —— 路径以 `.js` 结尾，**正好命中**。后果是一种很迷惑的错位：

| 文件 | dev 路径 | 命中 SW 缓存？ |
|---|---|---|
| `StoneTable.jsx` / `GateBase.jsx`（组件） | `/src/**.jsx` | ❌ 不命中 → **总是最新** |
| `entranceTextures.js`（**四季色板就在这**） | `/src/**.js` | ✅ 命中 → **可能是旧的** |

⇒ 用户看到的画面**组件是新的、shader 是旧的**：石桌石凳都在（组件新），
但地面色板停在缓存里的那一版 —— 这就是"过道两边的草冬天还是绿的"。

**修法**（两处）：

1. `src/main.jsx`：注册按环境分流 —— `PROD` 才注册；**dev 反过来主动注销 SW + 清空所有 cache**。
   只加 `PROD` 判断不够：已经注册过的 SW 会一直留着，必须显式注销。
2. `public/sw.js`：`VERSION` `aispin-v5` → **`aispin-v6`**，让线上已存在的旧缓存
   在 `activate` 时被清掉。

**判据**：`harness/check-sw-dev.mjs` —— dev 页面载入后
`registrations === 0 && caches.length === 0`。实测：
`dev: controller=false registrations=0 caches=[] ✅`。
生产侧：`dist/sw.js` 含 `aispin-v6`，`main-*.js` 保留 `sw-update-ready`
（`getRegistrations` 被 `import.meta.env.PROD` 判定为死代码后正常 DCE 掉，计数 0）。

⚠️ 这是本仓库第一次出现"**dev 与生产用了同一套缓存语义**"的事故。生产产物带内容哈希，
缓存它们是安全的；dev 的模块路径不带哈希，**任何缓存都是错的**。

---

**9.4h 「四季石板路上都是积雪」—— 石头太白 + 两条噪声（2026-10-10 下午）**

用户原话（附春季截图）：**"可以明显看到石板路上的积雪。经体验，目前四季石板路上吗都是积雪。
并且，即使是冬季，石板路上的积雪也没有和周边雪地做到自然融合的效果"**。

截图里那片"积雪"是**台明 / 踏跺**（`GateBase.jsx`，`uInLawn = 0` 的 STONE_FRAG），
不是甬路。三个说法分别对应两个**独立**的原因：

**原因 ①：石头本身太白（不是雪）。**

`SEASON_GROUND` 里 spring/summer/autumn 的 `uSnow` **都是 0** —— 读色板会得出"这三季没雪"。
所以必须**量像素**。把台明/踏跺顶面的四角投影到屏幕、只采**多边形内部**（内缩 18%，
躲开边缘反走样与倒角），实测三季**逐通道差 ≤ 1**：

| 面 | mean | p95 | max |
| --- | --- | --- | --- |
| 台明顶面（改前） | (168,149,126) | (221,202,175) | (235,215,184) |
| 踏跺顶面（改前） | (178,161,139) | (214,196,171) | (220,201,174) |

三季完全一致 ⇒ **不是雪，是石头**。原因在色板本身：`s2 = 0.816` 叠上倒角（×1.06）
与石材噪声（×1.08）后峰值到 0.934 ⇒ sRGB **238**，已经是"接近纯白"。
用户读到的"积雪"就是它。

**原因 ②：冬季石板的雪和草地不是同一场雪。**

草地用 `fbm(gw*0.62+61.0)`，石板用 `fbm(gw*0.85+17.0)` —— 颜色虽然都是同一个 `vec3`，
**噪声是两条**。于是边界两侧"哪块露底、哪块积厚"各说各话：雪是同一片白，
但斑驳对不上，眼睛读到的就是两种材料。

**修法**（`src/shaders/entranceTextures.js`）：

1. 把雪的**颜色与覆盖度提到 `GRASS_GLSL` 顶部，只定义一次**：
   `SNOW_COL` + `snowCoverage(gw)`。草地与石板都调它。
2. `STONE_FRAG` 的冬季薄雪改成 `uSnow * snowCoverage(gw) * inPath * swept`。
   `swept` 是**折率**（路中间扫得干净、靠边留雪堆），让石板上的雪读成"扫剩的斑块"，
   而不是一层均匀的膜。`* inPath` 仍然必须 —— 草边已经吃过厚雪，再叠一层就比草地还白。
3. 色板整体压暗、**色相不动**（仍 ~33° 暖调，与青砖墙的冷调对比是有意为之）：
   `s1` 0.722/0.663/0.592 → **0.520/0.470/0.408**；
   `s2` 0.816/0.745/0.639 → **0.600/0.545/0.472**；
   `s3` 0.639/0.580/0.514 → **0.442/0.396/0.340**。

**判据**（`harness/shot-apron-seasons.mjs` 投影多边形 + `harness/sample-apron-poly.py` 采内部像素）：

| 面 / 季 | mean | p95 | max | nearwhite |
| --- | --- | --- | --- | --- |
| 台明 春夏秋（改后） | (135,119,99) | (164,149,129) | (173,157,136) | 0.0% |
| 踏跺 春夏秋（改后） | (137,123,103) | (154,140,121) | (160,146,126) | 0.0% |
| 台明 冬（改后） | (175,168,159) | **(218,218,218)** | (228,231,235) | 15.1% |
| 踏跺 冬（改后） | (178,171,163) | **(217,218,219)** | (223,225,227) | 21.3% |

- **春夏秋**：p95 从 (221,202,175) 落到 (164,149,129)，max 从 235 落到 173 ⇒ 不再是"接近纯白"。
- **冬**：p95 从改前的 (227,218,207)（通道极差 20，偏暖）变成 **(218,218,218)（极差 0）** ——
  正好等于 `SNOW_COL`。这是"两边共用同一场雪"的直接证据。`p95−p05` 也从 136 拉到 **162**，
  即雪是**斑驳**的（15.1% 的中性白 + 深色石缝露底），不是一层均匀白膜。
- 对照：冬季石板与两侧草地反算出的雪覆盖度**都是 ≈0.40** —— 同一场雪。
  石板仍比草地亮，那是因为**石头底色比草亮**（150 vs 90），不是雪多。
  物证图：`.workbuddy-ai/wo6-2026-10-10/apron-sheet.png`（四季对照）、`winter-blend-zoom.png`。

🔴 **回归锚点的新例外（必须知道）**：`s1/s2/s3` **硬编码在 GLSL 里、不分季** ——
`SEASON_GROUND` 只管草地色板。所以**压暗石头会同时改掉秋天**。
秋天的"逐位一致"从这一版起**不再覆盖石板**（它仍然覆盖光照、树、草色、果实、落叶）。
这是**有意的**：石头太白是加季节之前就存在的问题，用户这次要求的是改观感，不是季节回归。
要恢复"石板也逐位"只有一条路：把 `s1/s2/s3` 也搬进 `SEASON_GROUND`，四季各给一组 ——
但那等于承认"石板颜色该随季节变"，与 §2 的 A 档（常驻摆设）不符。

**本轮质量门**：`npm run lint` → **0 error / 33 warning**（基线）· 四季各一张 1600×900 全图，
`ERRORS (0)` · `uSnow` 实测 spring/summer/autumn = **0**、winter = **1**。

---

**9.4i 「石板永远停在首次进入的那个季节」—— `useSeasonUniforms` 的对象身份被换掉了**

用户原话（2026-10-10 15:0x）：**「页面首次进去是什么季节，此时切换其他季节，石板就永远是
页面首次进去时那个季节的样式。石板两边依然与相连的地面没有很融合，有明显分界线。」**

**这两句是同一个 bug。** 而且它**不是**季节色板的问题 —— 色板每季都算对了。

### 机制

`hooks/useSeasonUniforms.js` 原来写的是：

```js
const uniforms = useMemo(() => factory(season), deps);   // ❌
```

而 `EntranceDoors` 给甬路那组传的 deps 是
`[pathWidth, pathLength, pathCenterZ, position]`，其中 **`position` 是父组件内联的
`position={[0, 0, 22]}`** —— 每次渲染都是**新数组**。于是：

1. `useMemo` 每次都重建一个 **新的 uniforms 对象**；
2. R3F 把 `material.uniforms` **整体替换**成新对象；
3. 但 three 的 `materialProperties.uniformsList` 是 **program 建立时**抓住的
   —— 它指着**第一个**对象，且只在 program 变化时才重建；
4. 换季时 `applyGroundSeason` 改的是**新**对象，GPU 读的是**旧**对象 ⇒
   **甬路静默冻在首季**。

⚠️ **最阴的一点：读 `material.uniforms` 会读出"已经更新了"的假象** ——
那里是新对象、值是 winter；GPU 用的却是旧对象。所以这个 bug **必须靠对象身份指纹查**
（`harness/probe-stone-season-stuck.mjs` 给每个 `uniforms` 与 `uniforms.uSnow`
打 id），**不能靠读值，也不能靠眼睛**。

**为什么只有甬路中招**：六个 `useSeasonUniforms` 调用点里，只有它是 deps 里带了
**不稳定引用**的。其余（草皮 `[corridorWidth, length, zCenter]`、台基/台明/踏跺
`[apronCenterZ, worldZ]` 等）全是数字 ⇒ 探针实测只有 `z=26.52` 那块的
`uniforms#11 → #21`（对象被换），其余 9 块 `#N → #N`。

### 第二句「石板两边有明显分界线」是同一件事

甬路两侧那条"草边"（verge）走的是**共享的 `grassSurface(gw)`** —— 它**也是季节色**。
冻住之后：甬路的草边还是**首季的绿**，而旁边的草坪已经**换成冬天的白**
⇒ 石路两侧各出现一条**绿边**，夹在白雪里 = 用户说的"明显分界线"。

（顺带确认：**接缝本身早就删干净了**。春季实测 y=870 上，草坪 x<548 与甬路草边
x∈[548,620] 的绿是同一个 `(92,128,69)`，差 ≤1 —— 这是"共用 grassSurface + 同一世界
坐标系"的功劳。所以那条线**不是**接缝回来了，是**季节没同步**。）

### 修法（三处，`aae7746` 之后的新提交）

1. 🔴 **`useSeasonUniforms` 改成身份由 `useRef` 锁死**：首帧建一次，之后**永不替换**，
   deps / season 变化时只把新值**就地**写进同一批 uniform 对象（新增的键只在第一次补进去）。
   这样**deps 里再混进不稳定引用也不会再破坏身份** —— 治的是病根。
2. `EntranceDoors` 的 deps 只依赖**原始值**：`[pathWidth, pathLength, pathCenterZ,
   position[0], position[2]]`。
3. `Experience.jsx` 把内联数组提成模块常量 `ENTRANCE_POSITION`（`EntranceDoors` 与
   `SignSystem` 共用），从源头去掉这个 footgun。

### 判据

**① 对象身份**（`harness/probe-stone-season-stuck.mjs`）：

| | 修前 | 修后 |
| --- | --- | --- |
| 甬路 `uniforms` 身份 | `#11 → #21`（被换掉 ⇒ 冻住） | **`#11 → #11`** |
| 被替换的块数 | 1 | **0** |
| 换季后"变了"的块数 | 10（读值假象） | **10（真变了）** |

**② 渲染级 A/B**（`harness/verify-path-season-live.mjs` + `harness/compare-two.py`）——
同一流程「`?season=spring` 冷启动 → 面板点冬 → 截图」，只换代码：

| 区域 | mean_abs | >8 的像素 |
| --- | --- | --- |
| **甬路带** `(520,790,1090,900)` | **33.48** | **50.70%** |
| 左草坪 `(60,650,470,890)` | **0.00** | 0.00%（逐位相同） |
| 右草坪 `(1130,650,1560,890)` | **0.00** | 0.00%（逐位相同） |
| 门脸/台阶以上 | 0.00 | 0.01% |
| 树冠/墙顶 | 0.01 | 0.12% |

⇒ 改动**只**影响甬路，其余全画面逐位不变。甬路带均色 `(146,145,120) → (178,172,162)`
（暖石 → 积雪）；对照图 `.workbuddy-ai/wo7-2026-10-10/ab-band.png` 里能直接看到
**修前那两条绿边**。

**本轮质量门**：`npm run lint` → **0 error / 33 warning**（基线）。

---

## 10. 设置面板（2026-10-09 · P4 的 UI 部分）

需求原话：「将那个暗黑模式的图标按钮，改成设置按钮吧，弹设置面板，里面可以选暗黑
模式、四季。方便用户体验功能。设置面板的样式，参考 MAP 面板」

### 10.1 为什么是**两行选择**，不是一个循环按钮

`theme`（明暗）× `season`（四季）是**正交**的两个轴（§4），共 8 态。一个"点一下轮换"
的图标按钮表达不了两个轴 —— 四季要盲点三次才知道到了哪一季。所以：

| 位置 | 内容 |
|---|---|
| HUD 第 3 个按钮 | 齿轮（`.hud-btn`，与旁边 4 个同款）。原来这里是 ☀/☾ 的明暗切换 |
| 面板第 1 行 | 外观：`浅色` / `深色` |
| 面板第 2 行 | 季节：`自动` / `春` / `夏` / `秋` / `冬` |
| 面板底部 | 一句话说清"现在到底哪一季"（选「自动」时 chip 上看不出来） |

**「自动」必须有**。本站一直以来的默认行为是按月份自动换季；如果面板只有四季四选一，
用户碰一次面板之后，"以后每个月自己变"就永久变成了"停在这一季"—— 这是一次静默的
行为回归。所以偏好里有 `'auto'` 这一档。

> 2026-10-10 又往前走了一步：**季节偏好根本不落盘**（§3.3）。面板选的季节是"本次
> 会话的预览"，刷新即回到「自动」。这样即使将来有人把「自动」档删掉，也最多影响一次
> 会话 —— 存档这条把回归变永久的路已经被封死了。

### 10.2 样式：照抄 MAP 面板，一处共用

`.settings-panel` 与 `.map-panel` 是**同一张撕纸卡片**：同样的居中下沉、同样的
`drop-shadow`、同样的 `--paper-texture` 伪元素、同样的 `.close-btn`。

撕纸的 `clip-path` 抽成了 SCSS 变量 **`$torn-paper-clip`**，两块面板共用 ——
写两份一定会漂移，同一屏上就会出现两种撕法。用变量而不是 `@extend`，是为了让两块
面板各自保留自己的盒子语义（宽度、内边距），只共享"边缘怎么撕"。

**深色下这块纸仍然是白的**，与 MAP 面板一致，是有意的：纸就是纸，一张白纸在暗房间里
也还是白的；而"白纸 + 深墨"在两种主题下都是最易读的一组对比。（MAP 的**房间卡**之所以
有 dark 覆盖，是因为 `.aispin-map` 的底色本身被压暗了 —— 这里没有那层底色。）

### 10.3 顺带修掉的：面板互斥

四个面板（map / audio / achievements / settings）原来各是一个独立布尔，于是
「地图开着再点音频」会让两张卡片叠在同一角，而 `hudState` 只能报出其中一个
（按优先级取第一个），另一个的按钮就永远显示成"没打开"。

现在合并成**一个** `openPanel` 状态（`'map' | 'audio' | 'achievements' | 'settings' | null`），
互斥是构造出来的，`hudState` 直接回传它。`hudToggle` 的语义变成
`prev === id ? null : id`（点当前打开的那个 = 收起）。

### 10.4 门联：**必须跟着面板走**（否则重演 §3.2b）

`CoupletWall` 原来 `useMemo(..., [])` 只算一次。现在依赖**偏好**（不是解析结果）重算：
传解析结果会把"按月份算出来的那一季"当成显式指定，**节气联 / 节日联就永远不出现了**。
`resolveCoupletSet(date, pref)` / `dailyCoupletFor(date, pref)` 因此多了第二个参数，
`'auto'` 与不传同义（都回落到 `?season=`）。

---

## 11. 文件清单

### 新增

| 文件 | 职责 | 状态 |
|---|---|---|
| `src/config/seasons.js` | 季节 id / 月份表 / `resolveSeason` / `SEASON_AUTO` —— **唯一真源** | ✅ P1 · P4 |
| `src/config/seasonLight.js` | 8 组光照端点（秋天引用 `theme.js`）+ `seasonGlowFor` | ✅ P1 |
| `src/hooks/useSeason.js` | 读**偏好** → 返回**解析后**的季节 id | ✅ P1 · P4 |
| `src/hooks/useSeasonUniforms.js` | 季节 uniform 的**就地更新**（对象身份不变，见 §5.1d） | ✅ P4 |
| `src/components/canvas/audio/CourtyardAmbience.jsx` | 院子四季声床的挂载点（读 `useSeason` + `useAudio`，按季选预设） | ✅ P2 |
| `.workbuddy-ai/harness/verify-wo2-seasons.mjs` | WO-2 验收：四声床 / 换季 / 互斥 / 燕子瓢虫季生 | ✅ P2 |
| `.workbuddy-ai/harness/shot-wo2-nest.mjs` | 燕子窝四季特写（投影定框 + clip 截图，**不动相机**） | ✅ P2 |
| `src/components/canvas/entrance/CourtyardProps.jsx` | 荷花缸 / 石桌石凳 / 竹篱 | ⬜ P3 |
| `src/utils/courtyardArt.js` | 上述道具的程序化贴图 | ⬜ P3 |
| `src/shaders/seasonFx.js` | 雨幕 / 落雪的 shader | ⬜ P3 |
| `.workbuddy-ai/harness/shots-seasons.mjs` | 8 组合定妆照（每组合换 URL 重载，见文件头） | ✅ |
| `.workbuddy-ai/harness/shot-page.mjs` | 截 **http URL** 页面（补 `shot-html.mjs` 只走 `file://` 的空） | ✅ |
| `.workbuddy-ai/harness/settings-panel-check.mjs` | 设置面板证据脚本（面板 / 换季 / 明暗 / 互斥） | ✅ P4 |

### 修改

| 文件 | 改动 | 状态 |
|---|---|---|
| `src/config/couplets.js` | `seasonOf` 从 `seasons.js` 引入（**删掉本地月份表**）；`resolveCoupletSet/dailyCoupletFor` 收季节**偏好** | ✅ |
| `src/context/SitePreferences.jsx` | 新增 `season` / `setSeason`（偏好）+ `html[data-season]`；新增 `setTheme`。**2026-10-10：季节偏好不再落盘**（删掉 `localStorage['aispin-season']` 读写，刷新即重判） | ✅ P4 |
| `src/components/canvas/SceneLighting.jsx` | 端点季节化（`endpointsFor` 带缓存）；**换季吸附**（`lastSeason` ref） | ✅ |
| `src/components/canvas/Experience.jsx` | 挂 `CourtyardAmbience`（与 `EntranceDoors` 同一个 `!hasEntered` 分支） | ✅ P2 |
| `src/components/canvas/entrance/EntranceDoors.jsx` | 树与甬路传季节；幕墙压顶积雪；`CoupletWall` 跟偏好重算；**瓢虫冬季不挂** | ✅ |
| `src/components/canvas/entrance/EntranceProps.jsx` | `WindowCurtain` 乘 `seasonGlowFor`；**换季吸附**；**`SwallowNest` 按季 2/2/1/0 只** | ✅ |
| `src/components/canvas/entrance/EmptyCorridor.jsx` | 草地传季节 uniform（改走 `useSeasonUniforms`） | ✅ |
| `src/components/canvas/entrance/GateBase.jsx` | 台明/踏跺顶面传季节（落雪；改走 `useSeasonUniforms`） | ✅ |
| `src/components/canvas/entrance/SignSystem.jsx` | 灯笼乘 `seasonGlowFor`（每帧都写，不需要吸附） | ✅ |
| `src/components/ui/SiteControls.jsx` | 第 3 个按钮：明暗 → **设置**（齿轮） | ✅ P4 |
| `src/components/ui/NavigationUI.jsx` | 新增设置面板；四面板合并为单一 `openPanel`（互斥） | ✅ P4 |
| `src/styles/NavigationUI.scss` | `$torn-paper-clip` 变量 + `.settings-panel` 全套 | ✅ P4 |
| `src/utils/entranceArt.js` | `makeTreeTexture(season)`；`TREE_SEASON` 表；**树干 `closePath` 修复**；枝上积雪 | ✅ |
| `src/shaders/entranceTextures.js` | `grassSurface` 季节 palette + `uSnow`；`SONG_WALL_FRAG`/`STONE_FRAG` 积雪；`applyGroundSeason()` 就地更新 | ✅ |
| `src/audio/ambience.js` | 4 条季节预设进 `PRESETS` | ⬜ P2 |

---

## 12. 开放问题

1. ~~**冬天的地面**：薄雪盖住 `grassSurface` 之后，甬路的石板是否也要压一层雪？~~
   **✅ 已答（P1 实现时定的）**：压，但**薄得多**，且乘 `inPath` 只落在石板上。
   石板是**扫过的路**，草边已经吃过厚雪 —— 不乘 `inPath` 草边会比草地还白，
   那条直边接缝立刻回来（§5.2 的历史教训）。见 §5.2b。
2. ~~**荷花缸的位置**：窗下（与花箱并列）还是台明一侧？~~ 
   **✅ 已答（2026-10-10，用户）**：**与花箱并列**（窗下木花箱外侧）。P3 照此实现。
3. ~~**夏天的蝉声**：是走 `ambience` 的常驻铺底，还是走 `sfx` 的偶发？~~ 
   **✅ 已答（2026-10-10，用户）**：走 **`ambience` 的常驻铺底**。
   已按此实现（§5.3 的 `summer-cicada`）：两条 43.0 / 69.6 Hz 的 AM 振鸣，
   各自的滤波截止上再挂一条慢 LFO 做"忽远忽近" —— 是持续声床，但不是死循环。
4. **春/夏的树冠是不是太"满"了**：`spring`/`summer` 的 rosette 半径分别取
   `[30,26]` / `[36,30]`，夏天明显更浓 —— 但夏天**没有果实**，所以"浓"是它唯一的
   识别特征。若验收觉得春夏两季分不开，第一个该动的就是这个数。⬜ 待验收
5. **冬天的树**：秃枝是否要**保留 wind chime 的挂点**？现在风铃挂在树上
   （`EntranceDoors` 的 tree group 内 `[0.45, 0.15, 0.05]`），冬秃枝时挂点视觉上还成立吗？
6. 🔴 **"过道两边的草冬天还是绿的"**（2026-10-10 用户复报）—— **待用户确认**。
   当前代码里复现不出来（§9.4e 的完整证据链）。两个候选解释：
   - **(a) 构建不是当前代码**：线上站点落后 22 个提交、且早于 P1（实测其 bundle 里
     没有 `uSnow`/`uVergeGreen` 等任何季节 uniform，还留着写死的沿阶草绿）。
     若用户看的是线上 / 旧 dist，**硬刷新或推 `main` 即解决**。
   - **(b) 用户指的是"外墙藤蔓 + 窗下花箱"**：这是冬天院子里仅剩的两处绿，
     而它们**是 2026-10-09 用户自己决定"暂不处理"的**（见 WORKPLAN 的 🚫 条）。
     若要改，需**单独做一次 A/B** —— 动它会破坏秋天的逐位回归锚点。
   ⇒ **在用户答复前不要动藤蔓/花箱**。
