/**
 * 孤岛院子的全部尺寸，只写一遍。
 * ==================================================================
 *
 * 为什么单独一个文件（照抄 `config/entranceMetrics.js` 的规矩）
 * ----------------------------------------------------------
 * 院子要能绕着看，就多出一整圈东西：岛、沙滩、海、四面院墙、竹林。
 * 它们的尺寸互相咬合 —— 院墙的进深决定了岛心，岛心决定了相机绕的轴心，
 * 轴心又决定了轨道半径的下限（不能穿墙）。任何一个数写在某个组件里，
 * 另一个组件就会悄悄错位。所以：**派生，不重打**。
 *
 * 平面布局（俯视，+z 朝向访客进来的方向）
 * --------------------------------------
 *
 *                     z = 36      ← 沙滩 / 海
 *                        |
 *         ┌──────────────┼──────────────┐   x = ±11
 *         │              |              │
 *         │        岛心 (0, 13.15)      │
 *         │              |              │
 *         └──────────────┼──────────────┘
 *                        |  z = 22.15   ← 门楼（facade）在这一条线上
 *                        |  z = 4.15    ← 后罩墙
 *                     z = -13     ← 沙滩 / 海
 *
 * 相机绕**岛心**（= 院子中心）转。这样一圈 360° 里每一处都在院子外面，
 * 不会出现"转到某一侧突然站在屋里"。
 *
 * 🔴 雾就是世界边界（这条决定了下面所有半径）
 * ------------------------------------------
 * `config/seasonLight.js` 里 fogFar 只有 36（冬夜）~66（春）。也就是说
 * **离相机 36 单位外已经是纯雾色**。所以：
 *   · 岛做到半径 26 就够 —— 再远的地形、远山、远处的海**根本看不见**；
 *   · 海面铺到 60 收边（超出雾的范围，不会有"世界尽头"的硬边）；
 *   · 相机轨道半径上限 26 —— 再远院子就被雾吃掉（冬夜 fogFar 只有 36）。
 * 这三条一起，省掉了一整个天空盒 + 远景 LOD 系统。
 */

import { FLOOR_Y, GRASS_Y } from './entranceMetrics';

/* ---- 院墙围出来的那座院子 ---------------------------------------- */

/** 门楼 facade 所在的世界 z（ENTRANCE_POSITION.z 22 + facade 的局部 z 0.15）。 */
export const COURT_FRONT_Z = 22.15;
/** 院子进深。往前（+z）是门楼，往后（-z）是后罩墙。 */
export const COURT_DEPTH = 18;
/** 院子半宽。门楼 facade 只有 10 宽，它是"墙中间开的一个门"。 */
export const COURT_HALF_W = 11;

export const COURT_BACK_Z = COURT_FRONT_Z - COURT_DEPTH;
export const COURT_CENTER_Z = COURT_FRONT_Z - COURT_DEPTH / 2;

/**
 * 院墙高度 3.6。
 *
 * ⚠️ 必须**高过走廊顶**：走廊是 corridorHeight 3.5、地面 FLOOR_Y，顶在
 *    FLOOR_Y + 3.5 = 1.75。院墙矮一点，绕到后面就会从墙头看见走廊的外壳
 *    （那一段本来没有外墙 —— 室内只画了朝里的那一面）。
 * ⚠️ 同时必须**矮过门楼**（FACADE_H = 6）：门楼比院墙高，这是"门楼/院墙"
 *    的分工，也是院子正面认得出"门在哪"的唯一线索。
 */
export const COURT_WALL_H = 3.6;
export const COURT_WALL_TOP_Y = FLOOR_Y + COURT_WALL_H;

/** 院墙压顶（黑瓦）占墙高的比例 —— 与 SONG_WALL_FRAG 的 uCapFrac 同义。 */
export const COURT_WALL_CAP_FRAC = 0.905;

/* ---- 岛 ---------------------------------------------------------- */

/** 岛心 = 院子中心（同心，绕一圈看到的岸线距离才一致）。 */
export const ISLAND_CENTER = [0, COURT_CENTER_Z];

/** 草地半径。院子四角离岛心约 14.2，留到 20 是院子外围还有一圈草地。 */
export const ISLAND_GRASS_R = 20;
/** 岸线半径（含噪声摆动 ±5）。20~26 这一圈是沙滩。 */
export const ISLAND_SAND_R = 26;
/** 地面平面尺寸。半宽 60 足够盖住"相机在最外圈朝外看"的全部范围。 */
export const GROUND_SIZE = 120;

/** 地面世界高度 —— 与原来那块草坪同高（GRASS_Y = -2.09）。 */
export const GROUND_Y = GRASS_Y;

/* ---- 环绕相机（DR-B：B1 受限轨道 + B2 边界）---------------------- */

/**
 * 轴心 y = FLOOR_Y + 1.9 = 0.15 —— 与入场机位的 y（0.2）几乎同高，
 * 所以环绕模式接手时画面几乎不动。
 */
export const ORBIT_CENTER = [0, FLOOR_Y + 1.9, COURT_CENTER_Z];

/**
 * 轨道半径范围。
 *   · 下限 15：院子四角离岛心 14.2，再近就穿进院子（穿墙）。
 *     顺带：在正面（yaw = 0）时相机到门楼约 7 单位，和入场结束时的 5.85
 *     基本一致 —— 环绕接手不会"跳一下"。
 *   · 上限 26：再远院子进雾（冬夜 fogFar 只有 36）。
 */
export const ORBIT_MIN_R = 15;
export const ORBIT_MAX_R = 26;

/**
 * 仰角范围（弧度，0 = 与轴心同高）。
 *   · 下限 1°：不许钻到地面以下（那里什么都没建模）。
 *   · 上限 50°：再高就变成航拍，院子的细节全没了。
 */
export const ORBIT_MIN_ELEV = 0.017;
export const ORBIT_MAX_ELEV = 0.873;

/** 相机高度的硬地板。轨道算完再夹一次，双保险。 */
export const ORBIT_MIN_Y = GROUND_Y + 0.9;

/** 滚轮改半径的步长（倍率 / 格）。 */
export const ORBIT_ZOOM_STEP = 0.06;
/** 拖拽灵敏度（弧度 / 像素）。 */
export const ORBIT_DRAG_SPEED = 0.0045;
/** 超过这个像素位移算"拖拽"，否则算"点击" —— 保住"点门进屋"。 */
export const ORBIT_DRAG_THRESHOLD = 6;

/* ---- 室内（走廊）的前端面 ----------------------------------------- */

/**
 * 🔴 这是全项目**唯一**允许「外观 → 室内」的依赖，方向不能反过来。
 *
 * 走廊是无限循环的，它自己没有"起点"。但它的可见几何（暖白顶 / 墨墙 /
 * 地板）**不能露到露天的院子里** —— 一露出来，从上方看就是院子正中间
 * 一大片暖白顶（还带墨色远山剪影），而院子本该是露天的。这是 L1 背面
 * 清单 + 射线取证（`.workbuddy-ai/harness/probe-court-top.mjs`）抓到的
 * 头号洞：`|x| ≤ 3.5` 那条带上最上面一层永远是
 * `PlaneGeometry{7,10}` @ `y = FLOOR_Y + 3.5`、`side: 2`。
 *
 * 为什么是「院子定线、走廊服从」：物理上室内不能比房子更靠外。所以由院子
 * 定下这条线，走廊的**段相位**从这里往回排 ——
 * `zOffset = INTERIOR_FRONT_Z − segmentIndex × SEGMENT_LENGTH`。
 *
 * 🔴 这样排的额外好处：段 0 的前沿**正好**落在这条线上，于是未入场时
 * 只要把段号 < 0 的整段摘掉，走廊就一根线都不进院子，而且**不需要 zClip**
 * —— 裁剪面与段前沿重合，入场前后几何逐位一致，`hasEntered` 翻转时不会跳。
 * （旧做法是 `zClip = 22` 硬裁段 −1，但天花板瓦片按 10 单位网格对齐，
 * 照样铺满院子；而且裁剪面与段前沿不重合，翻转时会看见墙/顶的缝跳一下。）
 *
 * ⚠️ 改这个数 = 同时改**走廊段相位 + 屋身前墙 + 入场落点**。三处一起动。
 */
export const INTERIOR_FRONT_Z = COURT_BACK_Z;

/* ---- 屋身（"老房子"本体）------------------------------------------ */

/**
 * 屋身**不是**照走廊尺寸反推出来的壳 —— 那正是 v1.2 的老做法
 * （`HALL_HALF_W = 3.5 + 0.4`、`HALL_EAVE_Y = FLOOR_Y + 3.5 + 0.45`），
 * 用户明确否掉了：
 *
 *   「只需做一个老房子3D模型，不需要依据内部通道去还原。意思是房子的外观
 *     和房间内部的通道不绑定。因为我们内部实际上是无限循环的。」
 *
 * 所以这里的每个数都按**建筑本身**定，走廊只是恰好从它里面穿过去。
 * 只有一条硬约束留着：屋身必须**包住**走廊的横截面（半宽 3.5 / 顶高
 * FLOOR_Y + 3.5 = 1.75），否则走廊会从屋面里穿出来。
 *
 * 形制照用户给的参考图（`参考屋形即可`）：**双坡顶，屋脊与院子边界平行
 * （沿 x）**，两坡分别朝院子（+z）和背院（−z）；檐口向院子出挑、压在院子
 * 上方，檐下露椽头。侧面看是一条带瓦顶的老屋，正面看被门楼挡住大半。
 */
export const HOUSE_HALF_W = COURT_HALF_W;
/**
 * 屋身后端。
 * ⚠️ 越深越能把走廊藏进雾里 —— 走廊从 INTERIOR_FRONT_Z 一路铺到 z = −70，
 *    屋身只是它的**前景遮罩**，不是容器。见 DR-E：春雾 far = 66。
 */
export const HOUSE_BACK_Z = -17;
/** 檐口高度（墙顶）。比走廊顶（FLOOR_Y + 3.5 = 1.75）高 0.4，走廊藏得进去。 */
export const HOUSE_EAVE_Y = FLOOR_Y + 3.9;
/** 出檐：屋面比墙身多伸出去多少。朝院那一侧就是参考图里压在院子上面的檐。 */
export const HOUSE_OVERHANG = 0.9;
/**
 * 屋面坡度（弧度）。参考图那坡看着更陡，但屋身有 22 宽 × 21 深，
 * 坡一陡屋脊就高过门楼（门楼顶 = FLOOR_Y + 6 = 4.25），把院子压没了。
 */
export const HOUSE_PITCH = 0.27;

/** 屋身进深（前墙 → 后端）。 */
export const HOUSE_LEN = INTERIOR_FRONT_Z - HOUSE_BACK_Z;
/**
 * 屋脊高度。
 * 🔴 只由**墙长的一半**推出来，不含出檐 —— 屋面在墙平面上的高度就是檐口，
 * 出檐是**往墙外**继续往下走的（屋脊 → 墙顶 → 出檐端，一条直线）。
 * 把出檐算进升幅会让屋面在墙头处高出一截，山墙就接不上了。
 */
export const HOUSE_RIDGE_Y = HOUSE_EAVE_Y + Math.tan(HOUSE_PITCH) * (HOUSE_LEN / 2);
/** 出檐端的高度（比檐口低，因为屋面往墙外继续下坡）。 */
export const HOUSE_EAVE_TIP_Y = HOUSE_EAVE_Y - Math.tan(HOUSE_PITCH) * HOUSE_OVERHANG;

/**
 * 竹林要避开的屋身带：|x| < HOUSE_HALF_W + 1 且 z < 6。
 * 屋身有 22 宽，带子窄了竹叶会从屋里长出来。见 `BambooGrove.buildGrove`。
 */
export const HOUSE_CLEAR_HALF_W = HOUSE_HALF_W + 1;
export const HOUSE_CLEAR_Z = 6;

/* ---- 竹林 -------------------------------------------------------- */

/** 竹子根数（低画质档砍到 40%）。 */
export const BAMBOO_COUNT_HIGH = 420;
export const BAMBOO_COUNT_LOW = 160;
/** 竹林的环带：离岛心 16~25（院子外、沙滩内）。 */
export const BAMBOO_R_MIN = 16;
export const BAMBOO_R_MAX = 25;
/** 竹竿高度范围（世界单位）。 */
export const BAMBOO_H_MIN = 4.2;
export const BAMBOO_H_MAX = 7.6;
/** 风摆幅度（世界单位，顶端最大位移）。 */
export const BAMBOO_WIND = 0.34;
/** 每根竹子的叶片数。 */
export const BAMBOO_BLADES_PER_CULM = 3;
