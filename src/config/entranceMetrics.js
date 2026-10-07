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

/* ---- the 青砖黑瓦 facade --------------------------------------------- */
// Sized against the GATE, not against the corridor. The tunnel behind is
// only 7 x 3.5 (see CorridorWalls), so these walls were never its walls.
export const FACADE_W = 10;
export const FACADE_H = 6;
export const FACADE_CENTER_Y = FLOOR_Y + FACADE_H / 2;
export const FACADE_TOP_Y = FLOOR_Y + FACADE_H;

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
 * the lawn (EmptyCorridor's GROUND_DROP), the 甬路, the planter and the dog.
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

/* ---- 台基 (the plinth the whole facade stands on) -------------------- */
/**
 * The plinth is exactly the outdoor drop tall, so its top edge meets the
 * facade's bottom edge (FLOOR_Y) with nothing to reconcile. It carries its
 * own SONG_WALL_FRAG with `uCapFrac: 2`, i.e. "this wall has no 黑瓦 coping" —
 * without that the coping's smoothstep lands inside the stone and caps the
 * plinth with a band of roof tile.
 */
export const PLINTH_W = FACADE_W;
export const PLINTH_H = OUTDOOR_DROP;
/** Facade plane sits at z=0.15; the plinth is a hair behind so the brick always wins. */
export const PLINTH_Z = 0.10;
