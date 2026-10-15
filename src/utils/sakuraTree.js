import * as THREE from 'three';

import { seededRand, randRange } from '../engine/art';
import {
    makeAcc,
    pushTri,
    growSkeleton,
    boxOfPoints,
    boxOfPositions,
    makeClusterGeometry,
    emitBlade,
    clusterExtent,
    scatterCluster,
    crownFromTips,
    makeRhoOf,
    packInstances,
    shadeOf,
} from './treeSkeleton';

/**
 * 樱花树（染井吉野）的 3D 骨架 / 花 / 叶 / 落樱 —— 纯数学。
 * ==================================================================
 *
 * WO-17。用户原话：「参考 `sakura-station-corner` 在前院种两棵樱花树」
 * → 2026-10-12 追加：「做**一棵**看效果，落樱参考真实樱花树的季节」
 * → 当天晚些又纠正位置：「**放在右边院子（绿色草地）的中间位置**，
 *   现在是在窗口前了」。
 *
 * ⚠️ 这份文件**不知道自己在院子里的哪一点** —— 落点是组件的常量
 * （`SakuraTree.jsx` / `EntranceDoors.jsx` 的 `SAKURA_POS`），
 * 生成器只负责"树长什么样"。落点的推导（右院草地中心怎么算出来的）
 * 写在 `EntranceDoors.jsx` 的 `SAKURA_POS` 注释里。
 *
 * 🔴 骨架**不是**这份文件写的
 * --------------------------
 * 锥形管 / 关节椭球 / 子枝起点回退 + 起始方向偏向父枝 —— 那三条
 * "树干衔接自然"的原则的实现**只有一份**，在 `utils/treeSkeleton.js`。
 * 这里只做两件事：给柿子树的机器换一套**形态参数**，再换一套**冠**。
 *
 * 和柿子树的差别（都是"樱花长什么样"决定的）
 * -----------------------------------------
 * | | 柿子树 | 樱花树 |
 * |---|---|---|
 * | 树形 | 主干高、冠偏圆 | **主干矮、冠像伞**（比高更宽） |
 * | 枝 | 上扬 | **横展**，梢头略垂（`UP_BIAS` 更小 / `OUT_BIAS` 更大） |
 * | 枝数 | 3 → 2~3 | 同 |
 * | 垂枝 | 无 | **有**（`DROOP`，WO-28b 第二刀）|
 * | 冠 | `PAD` 2.55 / 2.40（近圆）| **2.90 宽 / 1.75 高**（扁而阔）|
 * | 冠的朝向 | 随机（可能歪向墙） | **强制朝外**（`leanCrownForward`）|
 * | 春 | 嫩叶 | **满树花**（叶是夏秋的事）|
 * | 秋 | 挂果 | 叶转橙红（不挂果）|
 *
 * 🔴 WO-28b：为什么必须"差异化"（用户原话「樱花树长的太像柿子树了」）
 * ------------------------------------------------------------------
 * 根因**不是配色，是骨架**：两棵树共用 `utils/treeSkeleton.js` 的同一个
 * 生长器 ⇒ 分枝角度 / 长度衰减 / 关节椭球全是同一套数学，剪影层面就是
 * 同一棵树换了个颜色。所以差异必须做在**形态参数**上，三刀一起上：
 *
 *   ① **比例** —— 更矮、更宽、冠更扁（伞形）；主干更短 ⇒ 更低就分叉。
 *      最狠的一刀是 `SAKURA_H` 从 5.35 降到 **4.75**：从此樱花是**矮的那棵**
 *      （柿子树 5.25），一高一矮、一圆一伞，并排站着才不会认错。
 *      ⚠️ 这一刀**推翻了**原来那句"樱花是比柿子树大一点的那棵"（WO-17 的
 *      注释），是 WO-28b 有意改的：差异化优先于体量写实。
 *   ② **垂枝** —— 4~6 根细枝"先上后垂"（`DROOP`，机器在 `treeSkeleton`）。
 *   ③ **簇尺度** —— 花簇比柿子叶团**更小、更密**（`TUFTS_PER_TIP` 更高、
 *      `TIP_BALL` 更小、每团的 `scales` 更小）。
 *
 * 🔴 四季：**花只在春天**
 * ----------------------
 * 这是"落樱参考真实樱花树的季节"的直接落地。真实的染井吉野：
 * 三月下旬到四月中开满花（**先花后叶**），五月起长叶，秋天叶转黄红，冬天秃。
 * 所以：
 *   · **春** → 花簇（`blossom`）+ 落樱（`petal`）；
 *   · **夏 / 秋** → 叶冠（`canopy` 用叶片几何）；
 *   · **冬** → 只有枝。
 * 三个 mesh **同一套实例矩阵**（花和叶占同一批位置，反正一次只显示一种），
 * 所以多出来的只有"一个几何体 + 一个 mesh"，不是两棵树。
 *
 * 代价（和柿子树同一把尺子）
 * -------------------------
 * 骨架 1 个几何体 + 花簇 1 + 叶冠 1 + 地面影 1 + 落樱 1 ⇒ **5 个 mesh**。
 * 同时**可见**的最多是 4 个（春：骨架 + 花 + 影 + 落樱）。
 * 用户给的预算是"mesh 增量 ≤ 6"，够了。
 *
 * ⚠️ 树是远景摆件，`frustumCulled` 不能开：实例矩阵是挂载后才写的，
 *    自动包围球会把整棵树剔掉（竹篱栽过的那个坑）。
 */

/* ------------------------------------------------------------------ */
/* 形态常量 —— 「改树」就改这一段                                       */
/* ------------------------------------------------------------------ */

/**
 * 树高（根 → 冠顶），世界单位。
 *
 * ⚠️ 屋身檐口是 `FLOOR_Y + 6.0` = **4.25**（世界 y），树根在 `GRASS_Y` = −2.09。
 *
 * 🔴 WO-28b 起 **4.75**（原来 5.35）—— 樱花从此是**矮的那棵**：
 *    柿子树 `PERSIMMON_H` = 5.25 ⇒ 冠顶 **3.12**（世界，逐顶点实测 5.209 局部）；
 *    樱花 4.75 ⇒ 冠顶 **2.60**（实测 4.685 局部），比柿子树**低 ≈ 0.52**、
 *    比檐口（4.25）低 **1.65**。
 *    这是"差异化"三刀里最狠的一刀（见文件头那张表）：一高一矮、一圆一伞，
 *    并排站着才不会认错。**有意推翻**了原来"樱花比柿子树大一点"那条
 *    （WO-17 的注释），差异化的优先级高于体量写实。
 *    判据：`harness/probe-sakura.mjs` C1（逐顶点量真实几何顶 ≤ `SAKURA_H`）、
 *    `probe-tree-extent.mjs` C1（柿子树那一侧同一条）。
 */
export const SAKURA_H = 4.75;

const KEY = 'sakura-tree-3d-v1';

/** 每根枝条用几段折线画出来（越多越弯）。 */
const SEGS = 3;
const MAX_DEPTH = 4;

/**
 * 主干：**比柿子树矮得多**（1.24 vs 2.05）—— 樱花很早就分叉。
 * WO-28b ①：从 1.62 收到 1.24（"主干更短、更低就分叉"），同时**略微加粗**
 * （R0 0.225→0.245）：矮而壮的主干才撑得住一把横向摊开的伞，细高杆读成"竹竿"。
 */
const TRUNK_LEN = 1.24;
const TRUNK_R0 = 0.245;
const TRUNK_R1 = 0.165;

/** 每深一层：长度 / 半径的衰减。长度衰减**比柿子树慢**（冠更大）。 */
const LEN_FALLOFF = [0.80, 0.78, 0.74, 0.70];
const RAD_FALLOFF = 0.60;

/**
 * 每层的向上偏置 —— 比柿子树小得多（樱花是伞形，不是圆锥）。
 * ⚠️ WO-28b ① 试过再压低一档（0.17/0.09/0.042/0.018），**退回来了**：
 *    压低 `UP_BIAS` ⇒ 枝梢在竖向上摊平 ⇒ 冠薄成一张**饼**，春天满树花时
 *    读成"一张圆桌"而不是一棵树（A/B 定妆照上很明显）。
 *    ⇒ **`UP_BIAS` 是唯一有分量的"厚度"杠杆**，这一条**保持原值**；
 *      "更扁"交给 `CROWN_PAD_*` 与整体降矮去表达。
 *
 *    🔴 另外两个"看着像杠杆、实测都不是"的（都是**只动这一个常量**的对照测量，
 *      同一个 `probe-sakura.mjs`）：
 *      · `TIP_BALL` 0.40 → 0.58（球半径 **+45%**）：冠厚 2.003 → 2.033（**+0.030**）
 *      · `CROWN_PAD_Y` 1.75 → 1.05（**−40%**）：冠厚 2.003 → 1.778（**−0.225**）
 *      冠厚 2.0 里枝梢竖向跨度只占 0.70（= 0.647 raw × k）；剩下那一截主要是
 *      **`fill` 团撒在冠椭球里**撑起来的（`crownR.y` ≈ 0.61 raw）＋ 每团自身的
 *      外接半径 —— 两个都不是"单点可控"的常量。
 *      ⇒ 想加厚**就去动 `UP_BIAS`**，别去动那个球或 `PAD`（会白改一轮）。
 */
const UP_BIAS = [0.24, 0.14, 0.075, 0.035];
/**
 * 每层的**向外**偏置 —— 比柿子树大（横展）。
 * WO-28b ①：温和放大一档（0.40/0.56/0.50 → 0.46/0.64/0.58）⇒ 冠更宽。
 * ⚠️ 见 `UP_BIAS` 上面那条：这一条加太多同样会把冠摊成饼。
 */
const OUT_BIAS = [0.08, 0.46, 0.64, 0.58];
/**
 * 每层额外的 **+z** 偏置 —— 树**本地 −z 朝墙**。
 * 和柿子树同一个理由：冠要在镜头这一侧站得住，又不能扎进墙里。
 */
const FWD_BIAS = [0.02, 0.08, 0.13, 0.14];
/** 冠的进深压扁系数。比柿子树略松（0.58）：樱花冠更宽，压太狠会像纸片。 */
const DEPTH_SQUASH = 0.58;
/** 每层子枝相对父枝张开的角度（弧度）。比柿子树大 ⇒ 枝更"散"。 */
const SPREAD = [0.74, 0.86, 0.94, 0.96];

/**
 * 🔴 垂枝（WO-28b ②）—— **可选**特性，机器在 `utils/treeSkeleton.js` 的 `grow`。
 *
 * 用户要的是「4~6 根**下垂**的细枝（先上后垂）」。做法：给 `grow` 一个可选
 * `spec.droop`，让它对一部分枝在过 `startT` 之后**逐步**叠一个向下的量。
 *
 * ⚠️ 这个字段**不写就等于没有这个特性**：柿子树不写 ⇒ 那块代码整段跳过、
 *    一次随机数都不多抽 ⇒ 它的几何哈希逐位不变
 *    （`probe-tree-pair.mjs` W1 的锚点 `30e58fd9…`）。
 *
 * | 字段 | 含义 |
 * | --- | --- |
 * | `depthMax` | 只让 1~2 级枝垂（再深就整冠下垂了，那是垂枝樱，不是染井吉野）|
 * | `every` | `{深度: 步长}` —— 该深度每 `步长` 根挑 1 根（**按深度分开数**）|
 * | `segs` | 垂枝用几段折线（比 `SEGS` 多：3 段画不出弧）|
 * | `up` | 起始竖直分量（> 0 ⇒ 先上扬）|
 * | `sink` | 竖直分量按 `up − sink·u²` 走 ⇒ 中途转平、末段猛坠 |
 * | `lengthScale` | 垂枝更长（有地方可垂）；**只作用于这一节**，不级联 |
 * | `radiusScale` | 垂枝是**细枝**：整根（含子枝）按此收细 |
 *
 * ⚠️ `every` 必须**按深度分开**：一级枝的序号是 0/4/8（深度优先、二级枝数量
 *    不定），全局一个 `% 2` 正好全中 ⇒ 三根一级枝**全部**垂，主骨架都挂了。
 * ⚠️ 竖直分量是**构造**出来的，不从父枝继承；而且**不级联给子枝** ——
 *    否则骨架一路扎穿地面（`rawBox.y0 = −0.53`），归一化把整棵树抬起来。
 *    两处错误的完整记录在 `treeSkeleton.grow()` 的注释里。
 *
 * 判据：`harness/probe-tree-droop.mjs`（D1 条数 4~6 · D2 先上后垂 ·
 * D3 梢头低于起点 ≥ 自身弧长的 10% · D4 是弧不是直棍 · D5 柿子树没有垂枝 ·
 * D6 梢头不扎到树根以下 · D7 整根骨架不扎到树根以下）。
 */
const DROOP = {
    depthMax: 2,
    every: { 1: 2, 2: 2 },
    segs: 6,
    up: 0.34,
    sink: 2.30,
    lengthScale: 1.35,
    radiusScale: 0.66,
};

/** 关节椭球（见 `treeSkeleton` 文件头）。与柿子树同值。 */
const JOINT_SCALE = 1.10;
const JOINT_ELONG = 1.34;
const JOINT_SQUASH = 0.96;
const JOINT_INSET = 0.26;
const CHILD_INSET = 0.58;
const CHILD_DIR_BIAS = 0.32;

/**
 * 每个末梢周围撒几团、散布半径（世界单位）。
 * WO-28b ③：**更密、更细碎** —— 每梢 14→19 团，散布球收小（0.46→**0.40**）。
 *
 * 🔴 一条被实测**推翻**的猜测（留在这里，免得再犯）
 * ------------------------------------------------
 * 中间曾经把 `TIP_BALL` 调回 0.58，理由是"它同时是冠**厚度**的主要来源"。
 * 同机位、**只动这一个常量**的对照测量（`probe-sakura.mjs`，
 * `UP_BIAS` / `OUT_BIAS` 都不动）：
 *
 *   | `TIP_BALL` | 主冠宽 | 主冠厚 | 宽÷厚 | k |
 *   | --- | --- | --- | --- | --- |
 *   | 0.40 | 6.661 | **2.003** | 3.325 | 1.0794 |
 *   | 0.58 | 6.617 | **2.033** | 3.254 | 1.0717 |
 *
 * ⇒ 球半径 +45%，冠厚只动 **+0.030**（1.5%）。冠厚实际由
 *   `CROWN_PAD_Y × 主冠末梢竖向跨度`（跨度只有 0.647）加上 3400 团 `fill`
 *   撑起来，跟这个球**基本无关**。
 *   （"饼 vs 伞"那一次真正的解药是**恢复 `UP_BIAS`**；球只是陪着一起改、
 *    白背了功劳 —— 这也是"一次只动一个变量"值得的原因。）
 * 既然厚度不吃它、而 ③ 要的正是"团更小更碎" ⇒ 取 **0.40**。
 */
const TUFTS_PER_TIP = 19;
const TIP_BALL = 0.40;
/** 冠体积里另外撒几团。WO-28b ③：2500 → 3400（密度）。 */
const FILL_TUFTS = 3400;
/**
 * 冠半径相对"末梢包围盒"的放大系数。
 * 🔴 **横向 / 竖向分开给**：枝梢包围盒竖向天生就扁，同一个系数会长出一个扁饼。
 *    这里横向远大于竖向 ⇒ 伞形，正是樱花的样子。
 *
 * WO-28b ① / WO-33b ① 的取值（`harness/probe-sakura.mjs` 逐顶点、与柿子树同一把尺子）：
 *
 * | 冠 | 柿子树 | 樱花（改前）| 樱花（WO-28b）| 樱花（WO-33b）|
 * | --- | --- | --- | --- | --- |
 * | 横向 | 2.55 | 2.30 | 2.90 | **2.90** |
 * | 竖向 | 2.40 | 1.95 | 1.75（扁）| **2.45** |
 * | 进深 | 2.55 | 2.45 | 2.40 | **2.40** |
 *
 * ⚠️ 这张表**必须和下面三个常量逐字一致** —— 它中途漂过一次
 *    （表里写 2.78/1.42/2.62，代码是 2.90/1.75/2.40），是 WO-28b 收尾时
 *    逐行核对才发现的。改常量时**顺手改这张表**。
 *
 * 「比柿子树宽、比柿子树扁」正是伞形樱花要的关系。第一版取 2.72 ⇒ 冠宽
 * 7.35（比柿子树宽 34%），在 22 宽的屋面前是一棵**遮住半扇墙**的巨物 ——
 * 所以收回来过一次。WO-28b 因为整体降矮（`SAKURA_H` 5.35→4.75），归一化
 * 尺度变大，同一个横向系数摊出来的伞更宽，于是重新放到 **2.90**
 * （实测冠宽 6.66，比柿子树 5.62 宽 18%）。
 * 判据 C2 卡的是"宽 ÷ 厚 ≥ 1.6"，防的是反向塌成扁饼。
 *
 * 🔴 WO-33b ①：`CROWN_PAD_Y` 1.75 → **2.45**（用户：「树冠变圆一点，现在是
 *    一个扁扁的椭圆」）。实测主冠 **6.661 × 2.003 ⇒ 3.325** 变成
 *    **6.346 × 2.411 ⇒ 2.632**（`harness/wo33b-crown-tune.mjs` 的扫描表）。
 *
 *    ① **为什么动 `PAD_Y` 而不是 `UP_BIAS`** —— 这与上面 `UP_BIAS` 那段说的
 *       "它是唯一有分量的厚度杠杆"**不矛盾，但容易误读**：那句话讲的是
 *       "别把冠压成一张饼"，而**圆度**（宽÷厚）是另一回事。同一次扫描里
 *       `UP_BIAS` 加大两档（0.24→0.34→0.44），厚度 **2.003 → 1.997 → 1.992**
 *       （几乎不动），宽度却 6.661 → 6.433 → 6.220 ⇒ 宽÷厚只从 3.325 走到
 *       **3.122**。原因：`UP_BIAS` 抬高的是**枝梢**，而冠的可见形体由
 *       `fill` 团（3400 条）撑起来，团的位置只跟冠椭球走。
 *       ⇒ **要圆度就动 `PAD_Y`，要"别成饼"才动 `UP_BIAS`。**
 *    ② **为什么不动 `PAD_X`** —— 收 `PAD_X` 同样能降宽÷厚（2.90→2.55 ⇒ 2.950），
 *       但那会把樱花冠收到 5.9，比柿子树（5.62）只宽 5%，把 WO-28b 刻意做的
 *       "樱花更宽"关系丢掉了。
 *    ③ ⚠️ **屏幕上的剪影变化远小于 `crownAspect`**：用户看到的是**含垂枝**的
 *       琥珀色团，而垂枝叶不随 `PAD_Y` 走；`k` 又随冠顶抬高而变小。
 *       同机位截图逐像素量（`harness/crown-silhouette.py`）：**2.034 → 1.911**。
 *       所以 `crownAspect` 只是**调参的尺子**，不是"用户看到的那个数"。
 *    ④ `crownR.y` 此刻压着一个 `max(spanY/2, 0.35)` 的**地板**：
 *       非垂枝末梢竖向跨度只有 0.647 ⇒ spanY/2 = 0.3235 < 0.35
 *       ⇒ **`crownR.y = 0.35 × PAD_Y`，与末梢跨度无关**（改 `UP_BIAS` 改不动它）。
 *    ⑤ 顺带量到的：抬高冠椭球**也**把冠左缘那片稀疏的"垂下来的细条"填实了
 *       （同机位、冠左缘 ROI 逐像素：琥珀覆盖率 **0.302 → 0.405**，+34%）。
 *       那片细条的来源见下面 `shellChance` 调用点旁边的注 —— 它是**垂枝梢头
 *       的叶团**（4 条垂枝末端 |q| = 2.02~3.13，即挂在冠底以下 2~3 条冠半径，
 *       中位数 2.055，四条一致 ⇒ 是**设计**不是离群怪枝）。
 */
const CROWN_PAD_X = 2.90;
const CROWN_PAD_Y = 2.45;
const CROWN_PAD_Z = 2.40;

/** 枝条的分段数 / 横截面边数。与柿子树同值。 */
const TUBULAR = [16, 12, 9, 8, 6];
const RADIAL = [10, 8, 6, 5, 4];

// ⚠️ 这里**不放** `rand` —— 随机数生成器由 `buildSakuraTree` 每次新建后传进来。
const SPEC = {
    segs: SEGS,
    maxDepth: MAX_DEPTH,
    trunkLen: TRUNK_LEN,
    trunkR0: TRUNK_R0,
    trunkR1: TRUNK_R1,
    lenFalloff: LEN_FALLOFF,
    radFalloff: RAD_FALLOFF,
    upBias: UP_BIAS,
    outBias: OUT_BIAS,
    fwdBias: FWD_BIAS,
    spread: SPREAD,
    tubular: TUBULAR,
    radial: RADIAL,
    jointScale: JOINT_SCALE,
    jointElong: JOINT_ELONG,
    jointSquash: JOINT_SQUASH,
    jointInset: JOINT_INSET,
    childInset: CHILD_INSET,
    childDirBias: CHILD_DIR_BIAS,
    childRadiusJit: [0.84, 0.98],
    childLenJit: [0.03, 0.05],
    // 樱花枝比柿子树**更歪**（老樱花树的枝是出了名的拧）
    trunkJitter: 0.15,
    trunkLift: 0.080,
    branchJitter: 0.24,
    branchLift: 0.026,
    // 🔴 WO-28b ②：垂枝（**可选**，柿子树的 spec 里没有这个字段 ⇒ 那边逐位不变）
    droop: DROOP,
    // ⚠️ depth === 0 时**不抽随机数**（固定 3 条）
    childCount: (depth, rand) => (depth === 0 ? 3 : 2 + (rand() < 0.45 ? 1 : 0)),
};

/* ------------------------------------------------------------------ */
/* 花簇                                                                */
/* ------------------------------------------------------------------ */

/**
 * 一朵花的半径（世界单位）。
 *
 * 取值是**算过**的：整棵树 4.75 高（WO-28b 降矮之后），镜头通常站在 3~8 单位外。
 * 一朵花直径 2×0.052 = 0.104 ⇒ 站在 5 单位处、900 px 高的画面上约
 * `0.104 / 5 × (900/2/tan30°) ≈ 16 px` —— 五片花瓣在这个尺寸上读得出来。
 * 再小就退化成"粉色噪点"，再大就不像樱花了（真花直径约 3 cm，
 * 换算到本场景的尺度正好是这个量级）。
 * ⚠️ 花簇的**观感大小**还要乘每团的 `scales`（WO-28b ③ 收到 0.56~0.98），
 *    所以实际一朵花在画面上比上面算的更小一档 —— 这正是"细碎"要的效果。
 */
const FLOWER_R = 0.052;
/** 每团几朵花。3 朵 × 5 瓣 = 15 个四边形 = 30 个三角。 */
const BLOSSOM_ROT = [
    [0.42, 0.00, 0.30],
    [-0.95, 2.60, -0.55],
    [1.30, 4.70, 0.90],
];
const BLOSSOM_OFF = [
    [0.00, 0.00, 0.00],
    [0.055, 0.035, -0.045],
    [-0.05, 0.055, 0.05],
];
/** 花簇里"花心之外"的那一截（= `BLOSSOM_OFF` 里最大那个偏移，≈0.088）。 */
const BLOSSOM_PAD = 0.088;
/** 一团花从自己的原点往外能探多远（世界单位）。 */
export const BLOSSOM_EXTENT = FLOWER_R * 1.06 + BLOSSOM_PAD;

/* ------------------------------------------------------------------ */
/* 叶冠（夏 / 秋）                                                     */
/* ------------------------------------------------------------------ */

/** 樱花叶：**比柿子叶长而窄**（真樱花叶就是长卵形、有锯齿）。 */
export const SAKURA_LEAF_LEN = 0.255;
export const SAKURA_LEAF_WID = 0.132;
const SAKURA_LEAF_LEN_JIT = [0.84, 1.16];
const SAKURA_LEAF_WID_JIT = [0.82, 1.20];

const LEAF_PIECE = {
    len: SAKURA_LEAF_LEN,
    wid: SAKURA_LEAF_WID,
    lenJit: SAKURA_LEAF_LEN_JIT,
    widJit: SAKURA_LEAF_WID_JIT,
    ridgeJit: [0.030, 0.070],
    asymJit: [-0.13, 0.13],
    curlJit: [-0.30, 0.60],
};

const LEAF_ROT = [
    [0.88, 0.20, 0.62],
    [-0.66, 2.30, -0.48],
    [0.44, 4.15, 0.78],
    [-0.56, 5.45, -0.60],
    [1.18, 1.25, -0.30],
    [-1.10, 3.50, 0.24],
];
const LEAF_OFF = [
    [-0.045, 0.005, 0.045],
    [0.055, 0.045, -0.035],
    [-0.035, 0.095, -0.055],
    [0.045, 0.135, 0.045],
    [0.075, 0.075, 0.055],
    [-0.065, 0.115, -0.025],
];
/** 叶团从自己的原点往外能探多远。`0.15` = `LEAF_OFF` 里最大偏移。 */
export const LEAF_EXTENT = clusterExtent(
    SAKURA_LEAF_LEN, SAKURA_LEAF_WID, SAKURA_LEAF_LEN_JIT, SAKURA_LEAF_WID_JIT, 0.15
);

/**
 * 归一化用的"一团能探多远" = 花簇和叶冠里**更大的那个**。
 * 🔴 必须取 max：归一化只跑一次，而两个冠共用同一批实例位置 ——
 *    按小的那个算，换季时冠顶会**跳一下**（花团小、叶团大）。
 */
export const CANOPY_EXTENT = Math.max(BLOSSOM_EXTENT, LEAF_EXTENT);

/* ------------------------------------------------------------------ */
/* 落樱                                                                */
/* ------------------------------------------------------------------ */

/**
 * 落樱的花瓣尺寸。
 * ⚠️ **是整朵花的大小**（0.052），不是"一朵花的一片瓣"的 1/5 ——
 *    飘落时看到的是单片花瓣，单片花瓣本来就和整朵花差不多长
 *    （樱花单瓣长约 1.5 cm，整朵直径约 3 cm）。
 */
const PETAL_LEN = 0.056;
const PETAL_WID = 0.050;
/** 落樱的数量。稀疏是关键 —— 下成暴雪就不是樱花了。 */
const PETAL_COUNT = 240;

/* ------------------------------------------------------------------ */
/* 几何体                                                              */
/* ------------------------------------------------------------------ */

/** 一朵花 = 5 片花瓣（每片一个四边形 = 2 个三角）。 */
function emitFlower(mat, out, rand) {
    const R = FLOWER_R * randRange(rand, 0.86, 1.14);
    const a0 = randRange(rand, 0, Math.PI * 2);
    // 花瓣外缘上翘 ⇒ 花不是一张平片，侧看有厚度
    const tilt = randRange(rand, 0.10, 0.32);
    const PETALS = 5;
    const at = (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).applyMatrix4(mat);
        return { x: v.x, y: v.y, z: v.z };
    };
    // 逐面法线：花瓣之间要有硬边，不然五瓣糊成一个粉团
    const tri = (a, b, c) => {
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const p = (q) => ({ px: q.x, py: q.y, pz: q.z, nx, ny, nz });
        pushTri(out, p(a), p(b), p(c));
    };
    for (let j = 0; j < PETALS; j++) {
        const a = a0 + (j / PETALS) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // 花瓣的横向（垂直于它自己的伸展方向）
        const px = -sa;
        const pz = ca;
        // 花瓣是**扇形**：内缘窄（贴着花心）、外缘宽
        const wIn = R * 0.19;
        const wOut = R * 0.42;
        const inX = ca * R * 0.16;
        const inZ = sa * R * 0.16;
        const outX = ca * R * 1.00;
        const outZ = sa * R * 1.00;
        const innerL = at(inX - px * wIn, 0, inZ - pz * wIn);
        const innerR = at(inX + px * wIn, 0, inZ + pz * wIn);
        const outerR = at(outX + px * wOut, R * tilt, outZ + pz * wOut);
        const outerL = at(outX - px * wOut, R * tilt, outZ - pz * wOut);
        tri(innerL, innerR, outerR);
        tri(innerL, outerR, outerL);
    }
}

/** 一团花 = 3 朵朝向各异的花。 */
export function makeBlossomGeometry() {
    return makeClusterGeometry({
        rot: BLOSSOM_ROT,
        off: BLOSSOM_OFF,
        rand: seededRand('sakura-blossom-flowers-v1'),
        emit: emitFlower,
        piece: null,
    });
}

/** 一团叶 = 6 片朝向各异的叶（樱花叶）。 */
export function makeSakuraLeafGeometry() {
    return makeClusterGeometry({
        rot: LEAF_ROT,
        off: LEAF_OFF,
        rand: seededRand('sakura-leaf-blades-v1'),
        emit: emitBlade,
        piece: LEAF_PIECE,
    });
}

/**
 * 一片飘落的花瓣：一个四边形（2 个三角），内窄外宽、外缘微微上翘。
 *
 * 🔴 为什么是 2 个三角而不是 1 个：三角形花瓣的尖角在翻飞时会读成"碎纸屑"，
 *    四边形有个圆钝的外缘，转起来才像花瓣。
 */
export function makePetalGeometry() {
    const acc = makeAcc();
    const L = PETAL_LEN;
    const W = PETAL_WID;
    const lift = -L * 0.10;   // 外缘往后仰一点 ⇒ 有弧面
    const v = [
        { px: -W * 0.22, py: 0, pz: 0 },
        { px: W * 0.22, py: 0, pz: 0 },
        { px: W * 0.50, py: L, pz: lift },
        { px: -W * 0.50, py: L, pz: lift },
    ];
    const tri = (a, b, c) => {
        const ux = b.px - a.px, uy = b.py - a.py, uz = b.pz - a.pz;
        const vx = c.px - a.px, vy = c.py - a.py, vz = c.pz - a.pz;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const p = (q) => ({ px: q.px, py: q.py, pz: q.pz, nx, ny, nz });
        pushTri(acc, p(a), p(b), p(c));
    };
    tri(v[0], v[1], v[2]);
    tri(v[0], v[2], v[3]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nrm, 3));
    return geo;
}

/* ------------------------------------------------------------------ */
/* 主构建                                                              */
/* ------------------------------------------------------------------ */

let cached = null;

/**
 * 把一棵**已经长好**的树绕 y 轴转一下，让"冠往哪边歪"指向 **+z**。
 *
 * 🔴 为什么必须有这一步（不是审美，是结构）
 * -----------------------------------------
 * `treeSkeleton` 的 `grow()` 在 depth 0 给**三条一级枝共用同一个** `outward`
 * 方向（那是从 demo 搬来的做法），而那个方向是**一次随机抽取**。于是整棵树的
 * 枝全部朝**同一个方位**扇开 —— 抽到哪个方位就是哪个方位，树冠整体偏出去
 * 半个冠半径。实测第一版：末梢包围盒中心在 `z = −1.12`（树**本地 −z 朝墙**）
 * ⇒ 冠心落在 `z = −0.648`，而冠自己的 z 半径只有 1.25 ——
 * **冠有一半扎在墙里**，另一半才在外面。
 *
 * `FWD_BIAS` 本来就是为这件事准备的（"让冠朝外长"），但它每层只有 0.02~0.14，
 * 压不过 `branchJitter = 0.24` 的随机游走 ⇒ 冠偏哪边基本是掷硬币。
 * 靠"改一个 seed 试到不歪"是不行的：种子一换就翻面，而且**不报错**。
 *
 * 所以：**先把歪的方向量出来，再把它转到 +z**。
 *   · 树根仍在原点（绕 y 轴转，原点不动）⇒ 栽种点不变；
 *   · 整体刚性旋转 ⇒ 枝、关节、末梢的相对关系逐位不变（不是重新长一遍）；
 *   · 旋转角由几何算出来，不是常数 ⇒ 换 seed 也照样朝外。
 *
 * ⚠️ 这一步把"冠朝哪边"**烤进几何**了，所以组件**不要再给 yaw**
 *    （再转就把这一步白做了）。前院那面墙的法线就是 +z，正对。
 *
 * @param {*} state `growSkeleton` 的产物（**就地**改）
 * @returns {number} 用掉的旋转角（报数用）
 */
function leanCrownForward(state) {
    const tipBox = boxOfPoints(state.tips.map((t) => t.p));
    const offX = (tipBox.x0 + tipBox.x1) / 2;
    const offZ = (tipBox.z0 + tipBox.z1) / 2;
    if (Math.hypot(offX, offZ) < 1e-4) return 0;
    // 绕 y 转 θ 把 (offX, offZ) 送到 (0, +R)：x' = x·cosθ + z·sinθ ⇒ θ = atan2(−offX, offZ)
    const theta = Math.atan2(-offX, offZ);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const rot = (v) => {
        const x = v.x * c + v.z * s;
        v.z = -v.x * s + v.z * c;
        v.x = x;
    };
    for (let i = 0; i < state.acc.pos.length; i += 3) {
        const x = state.acc.pos[i] * c + state.acc.pos[i + 2] * s;
        state.acc.pos[i + 2] = -state.acc.pos[i] * s + state.acc.pos[i + 2] * c;
        state.acc.pos[i] = x;
    }
    for (const t of state.tips) { rot(t.p); rot(t.d); }
    // 挂件候选（樱花树用不到，但**不能留着不转** —— 那是一个"位置对不上"的陷阱）
    for (const h of state.hangCandidates) { rot(h.p); rot(h.dir); }
    // 🔴 垂枝的折线（WO-28b）**必须一起转**：它和 `tips` 是同一类东西
    //    （"从几何里挑出来、留档给判据用"的点）。漏了它，`probe-tree-droop.mjs`
    //    量的就是**转之前**的坐标 —— 判据仍然绿，但它量的不是场景里那棵树。
    for (const dr of state.droops) { for (const q of dr.pts) rot(q); }
    return theta;
}

/**
 * 建树。**确定性**：同一个 key 永远长同一棵树（契约 1）。
 *
 * @returns {{
 *   bark: import('three').BufferGeometry,
 *   canopy: { matrices, phase, tint, accent, shade, count },
 *   petal: { origins: Float32Array, seeds: Float32Array, tints: Float32Array,
 *            count: number, topY: number, fallH: number },
 *   crown: { c, r },
 * }}
 */
export function buildSakuraTree() {
    if (cached) return cached;

    const rand = seededRand(KEY);

    // 1. 骨架（树内部单位）—— 机器在 `treeSkeleton`，这里只给形态参数。
    const state = growSkeleton({ ...SPEC, rand });
    const rawBox = boxOfPositions(state.acc.pos);

    // 1b. 🔴 把"冠歪向哪边"转到 +z（朝镜头 / 背墙）—— 见 `leanCrownForward`
    leanCrownForward(state);

    // ---- 2. 冠：先全在 raw 空间里摆，尺度最后一步再定 ----------------
    const tipsRaw = state.tips.map((t) => ({ p: t.p.clone(), d: t.d.clone().normalize(), droop: !!t.droop }));
    // 🔴 冠体积只由**非垂枝**的末梢决定（WO-28b ②）。
    //
    // 垂枝是装饰性的外延：几根梢头一垂，"末梢包围盒"的**上下左右**会同时被
    // 拉大 —— 冠心被拽低、冠半径被撑开，而冠半径还要再乘 `CROWN_PAD_*`
    // 和归一化尺度 `k`（k 又随冠顶降低而变大）⇒ **正反馈**。
    // 实测不排除时：冠宽 6.1 → **24.4**，冠底下探到 y = −0.73（**树根以下**）。
    // 排除之后冠体积仍由主冠决定，垂枝照常带着自己的叶团挂在外面 ——
    // 那正是"枝条垂出冠沿"的样子。
    const coreTips = tipsRaw.filter((t) => !t.droop);
    const rawTipBox = boxOfPoints((coreTips.length ? coreTips : tipsRaw).map((t) => t.p));
    const { c: crownC, r: crownR } = crownFromTips(rawTipBox, CROWN_PAD_X, CROWN_PAD_Y, CROWN_PAD_Z);
    const rhoOf = makeRhoOf(crownC, crownR);

    const spotsRaw = scatterCluster({
        // ⚠️ 撒团用**全部**末梢（垂枝的梢头也要长叶子），只有冠体积排除它们
        tips: tipsRaw,
        crownC,
        crownR,
        rand,
        perTip: TUFTS_PER_TIP,
        tipBall: TIP_BALL,
        tipBallYSquash: 0.85,
        fill: FILL_TUFTS,
        // ⚠️ WO-33b ② 试过把这两个数改成 `0.50` / `[0.90, 1.0]`（想让冠壳更连续，
        //    好把用户指的那"一小撮"并进主体）—— **量不出效果，已回退**：
        //    同机位逐像素比，冠区琥珀像素只从 54144 涨到 54393（**+0.5%**），
        //    低于本仓截图 A/B 的噪声底 7.8%（hard-rules §26）。
        //    原因：`shellChance` 加的是**壳层内部**的团，它们在相机方向上都落在
        //    已有团后面，撑不动**剪影**。要动剪影得动团的大小或最外圈 ρ。
        shellChance: 0.30,
        shellRange: [0.86, 1.0],
    });

    // 每团的缩放**先定下来**（冠顶要用它，且必须在后面所有抽数之前）
    // 🔴 WO-28b ③：范围从 0.74~1.30 收到 **0.56~0.98** —— 每团更小 ⇒ 花簇
    //    细碎，和柿子叶团那种"大块头"读起来不是一个质感。配合上面的
    //    `TUFTS_PER_TIP` / `FILL_TUFTS` 加密，覆盖度不掉。
    const scales = new Float32Array(spotsRaw.length);
    for (let i = 0; i < spotsRaw.length; i++) scales[i] = randRange(rand, 0.56, 0.98);

    // ---- 3b. 哪些团是"垂枝梢头那一撮"（判据 C2 要排除它们）------------
    //
    // 🔴 `scatterCluster` 的**产序**是契约：先按 `tips` 顺序给每根梢头铺
    //    `perTip` 团，再铺 `fill` 团（见它的实现）。这里就靠这个产序把
    //    "属于垂枝梢头的团"标出来。
    //
    // 为什么需要：垂枝的**定义**就是把花/叶吊到冠下面去 —— 那是**特性**。
    // 而 C2 问的是"冠是不是伞形（比高更宽）"，拿**含垂枝的全包围盒**去量，
    // 会把"垂枝垂得低"读成"冠塌成球"（实测 aspect 2.29 → 1.34，一条**假红**）。
    // 所以 C2 量主冠（非垂枝 + fill 团），全包围盒仍然照报，只是不当判据。
    //
    // ⚠️ 产序一变这里就错，所以下面**断言**总数对得上 —— 对不上直接抛，
    //    不要让它静默地标错（判据标错比判据变红更坏）。
    const droopSpotMask = new Uint8Array(spotsRaw.length);
    {
        let si = 0;
        for (const t of tipsRaw) {
            for (let k = 0; k < TUFTS_PER_TIP; k++) droopSpotMask[si++] = t.droop ? 1 : 0;
        }
        if (si !== tipsRaw.length * TUFTS_PER_TIP || spotsRaw.length !== si + FILL_TUFTS) {
            throw new Error(
                `scatterCluster 的产序变了：perTip 铺了 ${si}（期望 ${tipsRaw.length * TUFTS_PER_TIP}）、` +
                `fill 铺了 ${spotsRaw.length - si}（期望 ${FILL_TUFTS}）—— ` +
                `见 buildSakuraTree 里 droopSpotMask 那段`
            );
        }
    }

    // ---- 3. 归一化：按"连花带冠的高度"定尺度 -------------------------
    let topRaw = rawTipBox.y0;
    for (let i = 0; i < spotsRaw.length; i++) {
        const t = spotsRaw[i].y + CANOPY_EXTENT * scales[i];
        if (t > topRaw) topRaw = t;
    }
    const k = SAKURA_H / (topRaw - rawBox.y0);

    const toFinal = (p) => new THREE.Vector3(p.x * k, (p.y - rawBox.y0) * k, p.z * k * DEPTH_SQUASH);

    for (let i = 0; i < state.acc.pos.length; i += 3) {
        state.acc.pos[i] = state.acc.pos[i] * k;
        state.acc.pos[i + 1] = (state.acc.pos[i + 1] - rawBox.y0) * k;
        state.acc.pos[i + 2] = state.acc.pos[i + 2] * k * DEPTH_SQUASH;
    }

    // ---- 4. 花 / 叶共用的实例矩阵（同一批位置，一次只显示一种）--------
    const shade = shadeOf(spotsRaw, rhoOf);
    const spots = spotsRaw.map(toFinal);
    const canopy = packInstances({ spots, rand, scales, shade });

    // ---- 5. 落樱的起点：撒在冠里（外圈偏多，花是从外圈掉下来的）--------
    const origins = new Float32Array(PETAL_COUNT * 3);
    const seeds = new Float32Array(PETAL_COUNT * 2);
    const tints = new Float32Array(PETAL_COUNT);
    const topY = SAKURA_H;
    // 落到草地**以下**再回卷 ⇒ 回卷那一刻花瓣已经在草下面，看不见跳变。
    const fallH = topY + 0.5;
    for (let i = 0; i < PETAL_COUNT; i++) {
        const h = spots[Math.floor(rand() * spots.length)];
        origins[i * 3] = h.x;
        origins[i * 3 + 1] = topY;
        origins[i * 3 + 2] = h.z;
        seeds[i * 2] = rand();
        seeds[i * 2 + 1] = rand();
        tints[i] = rand();
    }

    const bark = new THREE.BufferGeometry();
    bark.setAttribute('position', new THREE.Float32BufferAttribute(state.acc.pos, 3));
    bark.setAttribute('normal', new THREE.Float32BufferAttribute(state.acc.nrm, 3));
    bark.computeBoundingSphere();

    cached = {
        bark,
        canopy,
        petal: { origins, seeds, tints, count: PETAL_COUNT, topY, fallH },
        crown: { c: toFinal(crownC), r: new THREE.Vector3(crownR.x * k, crownR.y * k, crownR.z * k * DEPTH_SQUASH) },
        // WO-28b ②：垂枝的折线（**树内部单位**，未归一化）。
        // `leanCrownForward` 已经就地转过它们 ⇒ 与场景里那棵树一致。
        // 只给判据用（`harness/probe-tree-droop.mjs`），组件不读它。
        droops: state.droops,
        // 归一化的**中间量** —— 只给判据/排查用（`harness/probe-sakura.mjs`）。
        // 🔴 为什么值得留在产物里：`SAKURA_H` 只约束**高度**，横向尺寸完全由
        //    「末梢包围盒 × `CROWN_PAD_*` × `k`」决定，而 `k` 又反过来随冠顶
        //    变化 ⇒ 一个**正反馈**。没有这几个数，冠宽离谱时只能靠猜
        //    （本仓刚为这件事绕了两圈：骨架 2.5 → 8.8 宽，冠 6.1 → 24.4）。
        layout: {
            k,
            rawBoxY0: rawBox.y0,
            topRaw,
            // 🔴 这两个盒子**必须分开**，别图省事合成一个：
            //    `coreTipBoxRaw`（= 上面那个 `rawTipBox`）才是驱动冠体积的盒子；
            //    `allTipBoxRaw` 是**含垂枝**的全包围盒。
            //    曾经这里把 `rawTipBox` 也导成 `tipBoxRaw`、探针里标成"全部"，
            //    于是"全部 63 梢"和"非垂枝 21 梢"印出**一模一样的数字** ——
            //    判据没红，但读数在骗人（比判据变红更坏，hard-rules §28 家族）。
            coreTipBoxRaw: rawTipBox,
            allTipBoxRaw: boxOfPoints(tipsRaw.map((t) => t.p)),
            tipCount: tipsRaw.length,
            coreTipCount: coreTips.length,
            crownC,
            crownR,
            // 判据 C2 用：1 = 这一团是垂枝梢头的（不算进"主冠"）
            droopSpotMask,
        },
    };
    return cached;
}

/**
 * 判据用的调试口（`harness/probe-tree-droop.mjs`）。
 * 返回垂枝的折线（树内部单位）。柿子树那边同名函数返回**空数组** ——
 * 这个对照本身就是判据 D5："垂枝是樱花独有的行为"。
 */
export function debugDroops() {
    return buildSakuraTree().droops;
}

/** 判据用的调试口（`harness/probe-sakura.mjs`）：归一化的中间量。 */
export function debugLayout() {
    return buildSakuraTree().layout;
}
