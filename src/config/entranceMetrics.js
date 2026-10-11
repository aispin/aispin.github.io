/**
 * The entrance's vertical stack, in one place.
 *
 * WHY THIS EXISTS
 * ---------------
 * The gate's geometry was spread across three files that each hardcoded it:
 * EntranceDoors owned the door and the architrave, SignSystem (the hanging
 * "ZEO STUDIO" board) hardcoded `LINTEL_Y = 0.742` and a pixel gap measured
 * against it, and the 横批 banner sat in EntranceDoors as a bare `BANNER_Y`.
 * Nothing linked them, so when the gate was made taller the lintel moved to
 * 1.10 and the sign stayed where the old lintel had been — it landed on top
 * of the banner. The handle offsets drifted the same way one commit earlier.
 *
 * Every number here is derived, not typed twice. Change DOOR_HEIGHT and the
 * frame, the lintel, the banner and the hanging sign all follow.
 *
 * Every value is in WORLD units measured up from the ground (FLOOR_Y), which
 * is also the datum the wall shader measures its plinth and brick courses
 * from — see SONG_WALL_FRAG in shaders/entranceTextures.js.
 */
import { COUPLET_BANNER_ASPECT } from '../utils/gateArt';

export const FLOOR_Y = -1.75;

/* ---- the gate leaves ------------------------------------------------- */
export const DOOR_WIDTH = 0.90;
export const DOOR_HEIGHT = 2.55;
export const DOOR_OPENING_W = DOOR_WIDTH * 2; // both leaves together
export const DOOR_CENTER_Y = FLOOR_Y + DOOR_HEIGHT / 2;

/* ---- the architrave (门框) ------------------------------------------- */
// Taller than the leaves by 0.15 top and bottom, so the leaves can never
// overshoot the head rail — which is exactly what happened when the frame
// height was taken from a bitmap's aspect instead.
export const FRAME_W = DOOR_OPENING_W + 0.16;
export const FRAME_H = DOOR_HEIGHT + 0.30;
export const FRAME_ASPECT = FRAME_W / FRAME_H;
export const LINTEL_Y = FLOOR_Y + FRAME_H; // top edge of the architrave

/* ---- 藤蔓 ink overlay 那块四边形 ------------------------------------- */
/**
 * ⚠️ 2026-10-11：这两个数**不再是"门脸"的尺寸** —— 独立的门脸没有了，
 * 门楼并进了屋身前墙（`HouseShell` 的前墙就是那面砖墙）。它们现在只回答
 * 一个问题：**藤蔓 overlay 那块透明四边形多大**。
 *
 * 所以名字也跟着改了（原来是 `FACADE_W/H`，`FACADE_CENTER_Y/TOP_Y` 连同
 * 台基的 `PLINTH_*` 一起删掉）：留一个叫 "facade" 的常数指着一块藤蔓贴图，
 * 下一个人一定会以为那是墙的尺寸。
 *
 * 🔴 这两个数**不能跟着屋身宽度改**。藤蔓的位置是按 10 宽量出来的
 * （见 `makeWallInkTexture` 的 runners：全部落在 x ≥ 1.18，正好避开 2.5
 * 那个窗），改成 22 藤就爬到窗上了。也就是说藤只爬大门两侧这一片墙，
 * 而不是整面 22 宽的墙 —— 这是有意的，见 `EntranceDoors` 的 `inkCenterY`。
 *
 * 高度 6 只是画布比例（`makeWallInkTexture` 按 `worldW / worldH` 定画布
 * 宽高），藤本身最长的一缕只到画布高的 0.29。
 */
export const WALL_INK_W = 10;
export const WALL_INK_H = 6;

/* ---- the gate's opening in the house's front wall -------------------- */
/**
 * 前墙上那个洞 —— 尺寸是**大门的**，不是走廊的。
 *
 * 门后是 7 × 3.5 的走廊，而这里开的是 1.8 × 2.55 的门洞：从大门往里看
 * 看到的是走廊的一个切片，而不是整条管子。这正是"门楼与屋身合二为一"
 * 之后想要的效果。
 *
 * 0.02 的余量（每边）**不是装饰**，是防止两件事：
 *   · 洞与门扇边缘**逐位重合** —— 两个平行平面在同一条像素上谁赢是
 *     深度缓冲说了算，会闪；
 *   · 洞比门框外沿大 —— 那就从门框外面看进走廊了。
 * 门框（`FRAME_W × FRAME_H`，在墙前 0.12）从**内洞口往外**是不透明的，
 * 水平覆盖到 0.98、垂直覆盖到 1.10，所以 0.92 / 1.295 这个洞的四周
 * 全被门框压住，既露不出砖、也露不出走廊。
 */
export const GATE_HOLE_HALF_W = DOOR_OPENING_W / 2 + 0.02;
export const GATE_HOLE_HALF_H = DOOR_HEIGHT / 2 + 0.02;
export const GATE_HOLE = [0, DOOR_CENTER_Y, GATE_HOLE_HALF_W, GATE_HOLE_HALF_H];

/* ---- the window opening in the front wall ---------------------------- */
/**
 * 窗（以及从窗里探头的那个小人）挂在 `EntranceDoors` 上，但它看的那个洞
 * 是 `HouseShell` 的前墙挖的 —— **一个洞、两个文件**，所以矩形写在这里，
 * 和门洞一个待遇。
 *
 * 以前它是 `EntranceDoors` 里的字面量 `[WINDOW_X, 0.02, 0.7, 0.73]`，
 * 门脸 uniforms 里还抄了一遍；门脸搬到屋身墙上之后就会变成三份拷贝。
 */
export const WINDOW_X = 2.5;
export const WINDOW_CENTER_Y = 0.02;
export const WINDOW_HALF_W = 0.7;
export const WINDOW_HALF_H = 0.73;
export const WINDOW_HOLE = [WINDOW_X, WINDOW_CENTER_Y, WINDOW_HALF_W, WINDOW_HALF_H];

/* ---- the 横批 above the lintel --------------------------------------- */
export const BANNER_W = 1.15;
export const BANNER_H = BANNER_W / COUPLET_BANNER_ASPECT;
export const BANNER_Y = LINTEL_Y + 0.02 + BANNER_H / 2;
export const BANNER_TOP_Y = BANNER_Y + BANNER_H / 2;

/* ---- the outdoor grade (台基 / 台明 / 踏跺) ---------------------------- */
/**
 * How far the ground OUTSIDE the gate sits below the floor INSIDE it.
 *
 * This number is the whole reason a 踏跺 can exist. Before it, the lawn sat
 * 2 cm under the floor — enough to stop the two coplanar planes z-fighting,
 * and nowhere near enough to draw a step. A real 宅门 is entered by stepping
 * UP off the street onto the 台明 and over the 门槛; with the street level
 * with the threshold there is nothing to step up, and the gate reads as a
 * wall with doors in it rather than as a house you enter.
 *
 * 0.30 is two risers of 0.15 — the riser height of an actual 踏跺, and also
 * tall enough to be unmistakable at the resting entrance camera.
 *
 * ⚠️ Anything standing on the OUTDOOR ground has to move with this:
 * the lawn (IslandGround / the old EmptyCorridor's GROUND_DROP), the 甬路,
 * the planter and the dog.
 * Anything mounted on the wall (window, curtain, bug, tree, 匾) does not.
 */
export const OUTDOOR_DROP = 0.30;
export const OUTDOOR_Y = FLOOR_Y - OUTDOOR_DROP;

/** Grass sits a hair under the paving so the two never z-fight. */
export const GRASS_Y = OUTDOOR_Y - 0.04;
/** Top of the 甬路 paving. */
export const PATH_Y = OUTDOOR_Y + 0.04;

/* ---- 台明 (the stone apron at the door) ------------------------------ */
/** Width of the raised stone terrace; wider than the gate, narrower than the facade. */
export const APRON_W = FRAME_W + 0.60;
export const APRON_DEPTH = 1.45;
export const APRON_FRONT_Z = 1.35;      // where the apron ends and the step begins
export const APRON_TOP_Y = FLOOR_Y;

/* ---- 踏跺 (the step) ------------------------------------------------- */
export const STEP_DEPTH = 0.36;
export const STEP_W = APRON_W + 0.16;
export const STEP_TOP_Y = FLOOR_Y - OUTDOOR_DROP / 2;   // half a drop per riser
export const STEP_FRONT_Z = APRON_FRONT_Z + STEP_DEPTH;

/* ---- 门槛 (the threshold beam) --------------------------------------- */
/**
 * The single most recognisable part of a Chinese gate after the doors
 * themselves, and the one that actually has to be modelled: it is what you
 * lift your foot over. It runs wider than the opening so its ends are
 * carried by the 门枕石 on either side.
 */
export const THRESHOLD_W = DOOR_OPENING_W + 0.14;
export const THRESHOLD_H = 0.17;
export const THRESHOLD_D = 0.16;
export const THRESHOLD_Z = 0.10;

/* ---- 门枕石 (the pivot stones the leaves hang on) -------------------- */
export const PIVOT_W = 0.26;
export const PIVOT_H = 0.24;
export const PIVOT_D = 0.36;
export const PIVOT_X = THRESHOLD_W / 2 + PIVOT_W / 2;

/* ---- 台基：已删除（2026-10-11） --------------------------------------- */
/**
 * 这里原来有 `PLINTH_W / PLINTH_H / PLINTH_Z` —— 门脸脚下那块 10 宽、
 * 0.30 高、停在砖面之前 0.05 的青石勒脚，用来填 `FLOOR_Y` 与 `OUTDOOR_Y`
 * 之间那个空档。
 *
 * 门脸并进屋身前墙之后空档不存在了：屋身前墙自己从 `GRASS_Y` 起画，而
 * `SONG_WALL_FRAG` 的勒脚段（`plinthTop = 0.62`，按**世界坐标**算石缝）
 * 已经给了它一条横贯整面墙的青石墙脚。留着那块 10 宽的旧台基只会在
 * 22 宽的墙上贴出一道宽度不对、石缝相位还差 0.04 的补丁。
 *
 * 详见 `components/canvas/entrance/GateBase.jsx` 顶部的说明。
 */
