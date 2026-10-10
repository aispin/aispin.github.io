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
| **偏好** `season` | `'auto'` \| `'spring'` … | 设置面板的选中态、`localStorage['aispin-season']`、`resolveCoupletSet()` 的季节参数 |
| **解析结果** | `'spring'` … （**永不** `'auto'`） | 所有渲染消费者（`useSeason()` 的返回值）、`html[data-season]` |

优先级：**`?season=` > `localStorage` > 自动（按月份）**。

`?season=` 排最前，是因为它是"把这一页摆成冬天"的**一次性命令**，必须能盖住上一轮
在面板里点过的偏好 —— 四季定妆照正是靠这一条（否则会拍到上次点过的季节）。

**不挂午夜定时器**：`'auto'` 档仍然每挂载解析一次。跨午夜重烘贴图会是一次可见的
pop，而一个开着过夜的标签页不值得为它 pop 一次。刷新即正确。

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
行为回归。所以偏好存的是 `'auto'`（而不是把解析结果存下来）。

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
| `src/context/SitePreferences.jsx` | 新增 `season` / `setSeason`（偏好）+ `html[data-season]`；新增 `setTheme` | ✅ P4 |
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
