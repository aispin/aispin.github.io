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

/* ---- 廊屋（走廊的外壳）------------------------------------------- */

/**
 * 走廊是"无限"的：它从院子里（z ≈ 10）一路铺到 z = −70。人在里面时只看
 * 得见朝内的那几面（`CorridorWalls` 全是 DoubleSide 的墨墙 / 暖白顶），
 * **从外面看就是一大片没有细节的白板** —— 一旦能绕到侧面，它就是画面里
 * 最大的破绽。所以给它穿一层外壳：青砖墙 + 黑瓦顶，读成院子后面的一座
 * 廊屋（游廊）。从外面看是建筑，从里面看被走廊自己的墙挡着，两边都不露馅。
 *
 * ⚠️ 尺寸必须**包住**走廊（半宽 3.5 / 顶高 FLOOR_Y + 3.5 = 1.75）：
 *    半宽 3.9 留 0.4 余量，檐口 2.2 高出走廊顶 0.45。
 */
export const HALL_HALF_W = 3.9;
/** 外壳的进深：从院子的后罩墙（COURT_BACK_Z）往 −z 拉这么长。 */
export const HALL_BACK_Z = -14;
/** 檐口高度（墙顶）。 */
export const HALL_EAVE_Y = FLOOR_Y + 3.5 + 0.45;
/** 屋脊高度。 */
export const HALL_RIDGE_Y = HALL_EAVE_Y + 0.65;
/** 出檐（屋面比墙身多伸出去多少）。 */
export const HALL_OVERHANG = 0.7;

/**
 * 竹林要避开的走廊走廊带：|x| < 6.5 且 z < 6（比外壳再宽一点，
 * 免得竹叶从屋面上长出来）。见 `BambooGrove.buildGrove`。
 */
export const HALL_CLEAR_HALF_W = 6.5;
export const HALL_CLEAR_Z = 6;

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
