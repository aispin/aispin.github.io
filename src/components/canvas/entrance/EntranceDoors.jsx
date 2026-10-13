import { useRef, useState, useEffect, useLayoutEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import '../shaders/RevealMaterial'; // Registers alpha-discard reveal shader
import { playBackgroundMusic } from '../../../utils/audioManager';
import { useAudio } from '../../../context/AudioManager';
import { playInsectChirp, playRabbitSqueak } from '../../../audio/sfx';
import { useAchievements } from '../../../context/AchievementsContext';
import { isTouchDevice } from '../../../utils/deviceDetect';
import { setGuitarCursor } from '../../../utils/guitarCursor';
import { SURFACE_VERT, INK_OVERLAY_FRAG, STONE_FRAG, makeSurfaceUniforms, SEASON_INK_TINT } from '../../../shaders/entranceTextures';
import GateBase from './GateBase';
import { WhiteDog, WoodenPlanter, WoodenWindowFrame, WindowCurtain, SwallowNest } from './EntranceProps';
import StoneTable from './StoneTable';
import LotusVat from './LotusVat';
import FoxtailGrass from './FoxtailGrass';
import PersimmonTree from './PersimmonTree';
import SakuraTree from './SakuraTree';
import { SCENE_FONTS } from '../../../config/theme';
// 季节：门联与院子共用同一张月份表（config/seasons.js），所以门口挂秋联时
// 院子就是秋天 —— 这条一致性是免费的。
import { useSeason } from '../../../hooks/useSeason';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { useSitePreferences } from '../../../context/SitePreferences';
import {
    makeDoorFaceTexture,
    makeDoorFrameTexture,
    makeDoorBackTexture,
    makeDoorEdgeTexture,
    makeHandleTexture,
} from '../../../utils/doorArt';
import {
    makeWallInkTexture,
    makeLadybirdTexture,
    makeSpeechBubbleTexture,
    INK_TOP_FRAC,
} from '../../../utils/entranceArt';
import {
    makeDoorGodTexture,
    makeFuDiamondTexture,
    makeCoupletTexture,
    DOOR_GOD_ASPECT,
    COUPLET_STRIP_ASPECT,
} from '../../../utils/gateArt';
// 门联文案（39 副）与「今天挂哪一副」的解析器。
import { resolveCoupletSet, coupletOverride } from '../../../config/couplets';
import * as I from '../../../config/island';
import {
    FLOOR_Y,
    DOOR_WIDTH,
    DOOR_HEIGHT,
    DOOR_CENTER_Y,
    FRAME_W,
    FRAME_H,
    FRAME_ASPECT,
    WALL_INK_W,
    WALL_INK_H,
    WALL_INK_CENTER_X,
    BANNER_W,
    BANNER_H,
    BANNER_Y,
    OUTDOOR_Y,
    PATH_Y,
    GRASS_Y,
    STEP_FRONT_Z,
    WINDOW_X,
    WINDOW_X_LEFT,
} from '../../../config/entranceMetrics';
import { sharedGeometry } from '../../../engine/resources';

/* ------------------------------------------------------------------ */
/* Ornament placement on a leaf                                         */
/* ------------------------------------------------------------------ */
/*
 * makeDoorFaceTexture authors the leaf on a 512 x 1310 canvas with two recessed
 * panels at y 109..682 and y 775..1228. Against the 2.55-unit-tall leaf that
 * puts their centres at +0.475 and -0.635, so the 年画 drops into the upper
 * panel and the 倒福 into the lower one.
 *
 * NO 门环 (removed 2026-10-08)
 * ---------------------------
 * A 铺首衔环 used to hang on the rail between the two panels — a round bronze
 * plate with a ring, on the leaf's centre line. The user asked for it to go
 * ("门板上的圆形物件去掉"). It was also the one ornament that made no sense on
 * this gate: the leaves already have lever handles, so the ring was a second,
 * decorative handle that could not be pulled. The two stacked panels now carry
 * 门神 over 倒福 and nothing else.
 */
const ORNAMENT_Z = 0.098;

const GOD_W = 0.68;
const GOD_H = GOD_W / DOOR_GOD_ASPECT;
const GOD_Y = 0.4754;

const FU_SIZE = 0.50;
const FU_Y = -0.6348;

/**
 * 门神 (年画) + 倒福 for one leaf, stacked down the leaf's centre line.
 *
 * @param {'guanyu'|'zhangfei'} god   which god is painted on this leaf
 * @param {number} leafX              local X of the leaf centre (±0.47)
 */
const DoorOrnaments = ({ god, leafX }) => {
    const godTexture = makeDoorGodTexture(god);
    const fuTexture = makeFuDiamondTexture();

    return (
        <>
            {/* 门神 年画 — upper panel */}
            <mesh position={[leafX, GOD_Y, ORNAMENT_Z]} renderOrder={5}>
                <primitive object={sharedGeometry('plane', GOD_W, GOD_H)} attach="geometry" />
                <meshBasicMaterial map={godTexture} toneMapped={false} />
            </mesh>

            {/* 倒福 — lower panel. The 福 is drawn rotated 180° on the sheet. */}
            <mesh position={[leafX, FU_Y, ORNAMENT_Z]} renderOrder={5}>
                <primitive object={sharedGeometry('plane', FU_SIZE, FU_SIZE)} attach="geometry" />
                <meshBasicMaterial map={fuTexture} toneMapped={false} alphaTest={0.5} />
            </mesh>
        </>
    );
};

/* ------------------------------------------------------------------ */
/* 春联 / 横批                                                           */
/* ------------------------------------------------------------------ */

const COUPLET_X = 1.28;
// A 春联 hangs the height of the gate it flanks, and its centre lines up with
// the gate's. Derived from the door so it follows the gate.
const COUPLET_H = 2.15;
const COUPLET_W = COUPLET_H * COUPLET_STRIP_ASPECT;
const COUPLET_Y = DOOR_CENTER_Y;

/* ---- 门扇的"开着"角度，与退场回关的时长 ---------------------------- */
/**
 * 两扇门**完全打开**时绕 y 的角度（左 −、右 +）。推门动画（`handleClick`
 * 里那条 gsap timeline）用的就是这个值，退场回关也从它起步 ——
 * 两处必须**同一个数**，否则退场的起点会和推门的终点差一点，看起来像卡了一下。
 */
const DOOR_OPEN_Y = Math.PI * 0.55;
/**
 * 退场时门**回关**用多久。抄 `corridor/HouseExit.jsx` 的 `GLIDE_SECONDS = 1.3`
 * —— 相机滑到院门外的同时门正好关上，到站那一帧不会"啪"一下。
 */
const EXIT_SWING_SEC = 1.3;

// BANNER_W / BANNER_H / BANNER_Y (the 横批 above the lintel) live in
// config/entranceMetrics, because SignSystem has to clear the banner and must
// not hardcode a lintel height of its own to do it.

const COUPLET_Z = 0.17;

/**
 * 入场落点在屋里的深度（从屋身前墙往里算）。
 *
 * 🔴 落点必须**在屋里**（z < INTERIOR_FRONT_Z）。原来停在 z = 11，那是
 *    院子正中间：入场动画一结束 `hasEntered` 翻转，地面 / 院墙 / 竹林 /
 *    门楼一起卸载，而相机正站在它们中间 —— 地面会在脚下凭空消失。
 *    落点挪进屋里之后，那次卸载全部发生在相机**背后**。
 *
 * ⚠️ 和 `CorridorSegment` 的 `HERO_INSET`（6.65）是一对：ZEO 落在
 *    `INTERIOR_FRONT_Z − HERO_INSET − 0.3`，这里要比它靠前 ~3.3 单位。
 *    改一个必须改另一个。
 *
 * ⚠️ x 也必须一起归零：入场之前用户可能已经拖到侧面看过（环绕相机），
 *    只 tween z 的话相机会从墙上穿过去。
 */
const ENTRANCE_LANDING_INSET = 3.65;

/* ---- the two yard animals' facing ------------------------------------ */
/**
 * 2026-10-09 user note: 「小狗兔子朝向调整：眼睛望往院子过道的方向，有点看着
 * 想要进屋的人的感觉」.
 *
 * Both animals used to face dead down +Z, i.e. straight out at the viewer, which
 * reads as "staring at nothing in particular". The 甬路 (the stone walkway that
 * leads in from the street) is centred on x = 0 and runs z ≈ 1.71…7.33 *inside*
 * this group, so in world terms it is z ≈ 23.7…29.3 — the dog and the rabbit
 * both sit beside it and neither was turned toward it.
 *
 * The angles are "look at the middle of the walkway, where a visitor stands":
 *   dog    at world x -1.5, z 22.8  ->  walkway centre (0, 26.5)  ->  +0.40 rad
 *   rabbit at world x  2.88, z 22.45 ->  walkway centre (0, 26.5)  ->  -0.55 rad
 * They are deliberately not aimed at the gate itself: someone who wants to come
 * in is still out on the path, and that is who the animals should be watching.
 */
const DOG_YAW = 0.40;

/**
 * 柿子树的落点与朝向（WO-13，2026-10-12）。
 *
 * ⚠️ 这三个数是**和旧贴图对位出来的**，不是随手摆的：
 *   · 旧版是一张 6×8 的**平面**停在局部 (−2.9, 0.95, 1)；3D 的冠有进深，
 *     所以 z 从 1 挪到 2.85 —— 让冠的后缘留在**出檐之外**（出檐前端在
 *     局部 0.9），否则冠会挑进屋檐 / 扎进前墙。
 *   · x 从 −2.9 挪到 −3.55：冠在 x 方向比旧贴图的墨迹宽，往外让开一点，
 *     **左侧那个窗**（`WINDOW_X_LEFT` = −5.0）才不会被树冠整个吃掉。
 *   · `yaw` 把生成器那条"朝外长"的偏置方向转到镜头这一侧（生成器有确定性，
 *     所以这个角度是稳定的）。
 * 🔴 这三个数改任何一个都要重拍正 / 侧定妆照：冠与檐、冠与左窗都只差零点几。
 */
// 🔴 y **必须**是 GRASS_Y —— 树长在草坪上。第一版把 y 写成 0、以为 `rootY`
//    会顺手把树放下去（它只喂给着色器做接地变暗），结果整棵树**浮空 2.09**：
//    冠顶冲到 5.95（檐口才 4.25），树干比门高两倍多。判据见 harness 的
//    `probe-tree-dump.mjs`（它量的是真实世界包围盒，一眼就能看出浮空）。
const PERSIMMON_POS = [-3.35, GRASS_Y, 2.85];
const PERSIMMON_YAW = 0.28;

/**
 * 第二棵柿子树（WO-27，2026-10-13）。
 * 需求：「**再多加一颗柿子树，在已有柿子树的右边**」；
 * 我把量出来的几何摆出来之后，你的确认是：**「就要紧邻、接受两冠融合」**。
 *
 * 🔴 为什么是 **−1.9**（这个数是量出来的，不是摆出来的）：
 *   · 左院草地的右边界就是甬路左缘 **−1.53**（甬路宽 3.06 居中）
 *     ⇒ 树干只能落在 x ≤ −1.53 这一侧；−1.9 留 0.37 余量，**不踩石板**。
 *   · 现有那棵的真实世界包围盒（`probe-tree-dump.mjs`，autumn）是
 *     `x ∈ [−6.34, +0.203]`、树干在 −3.35 ⇒ **冠的横向半径约 3.2**
 *     （不是我一开始估的 2.55 —— 那是 `CROWN_PAD` 常量，不是半径）。
 *   · 两冠要**不糊在一起**，树干间距得有 ≈ **6.4**；而左院从 −3.35 往右
 *     只剩 **1.82** ⇒ 「紧邻」在数字上**必然融合**。这一点当时已经摊开讲清，
 *     你要的正是"一片更茂盛的冠"（读起来像**一棵双干的大柿子树**）。
 *
 * ⚠️ 顺带纠正一条我先前说错的判断：我说"紧邻会压甬路"是缺点 ——
 *    其实现有那棵的冠右缘**已经在 x = +0.203**，本来就压着甬路 1.73，
 *    而且看着挺自然（春/秋定妆照里垂到路上的那一团就是它）。⇒ 不算问题。
 *
 * ⚠️ 两棵是**同品种不同个体**：`seed` 不同 ⇒ 骨架与叶团都不重样；
 *    `yaw` 取**镜像**（−0.28）⇒ 生成器那条"朝外长"的偏置各朝一边。
 * ⚠️ 第二棵 **不挂风铃** —— "这一进院子有一串风铃"是**单数**的道具。
 */
const PERSIMMON2_POS = [-1.9, GRASS_Y, 2.85];
const PERSIMMON2_YAW = -0.28;
/** 第二棵的种子。⚠️ **不要**给第一棵传 seed —— 那是秋天的回归锚点。 */
const PERSIMMON2_SEED = 'persimmon-tree-3d-v2';

const RABBIT_YAW = -0.55;

/**
 * 樱花树的落点（WO-17，2026-10-12；当天晚上**改过一次**）。
 *
 * 🔴 用户先给的是「放**花箱前面草地的中间**」，我照做放在
 *    `[WINDOW_X, GRASS_Y, 2.60]` —— 紧贴右窗，花箱就在树脚下。
 *    用户看后纠正：**「位置不对，需放在右边院子（绿色草地）的中间位置，
 *    现在是在窗口前了」** ⇒ "院子"指的是**整个前院**，不是"窗下那一小条"，
 *    树要**出到草地中间去**。这条注释就是那次纠正的记录。
 *
 * 前院边界（唯一真源 `config/island.js`，别在这儿重写一遍）：
 *   · x ∈ [−11, 11]  —— `FORECOURT_HALF_W = HOUSE_HALF_W`
 *   · z ∈ [22.15, 38.15] —— `HOUSE_FRONT_Z` → `FORECOURT_BACK_Z`，16 深
 *   · 篱笆只围**外三面**，内面就是屋身前墙（所以"院子"是从墙到篱笆整块）
 *
 * 甬路是**石板不是草地**，宽 ≈ 3.06 居中 ⇒ 右半边**草地**是 x ∈ [1.53, 11]。
 * ⇒ 右院草地的几何中心 = ((1.53+11)/2, (22.15+38.15)/2) = (**6.27, 30.15**)。
 * 本组件是 `EntranceDoors` 的局部坐标：x = 世界 x，z = 世界 z − 22
 * （`ENTRANCE_DOORS_Z`，柿子树的 2.85 ⇒ 世界 24.85 就是这么来的）。
 *
 * ⚠️ **不给 yaw**：生成器的 `leanCrownForward()` 已经把"冠朝哪边"烤进几何
 *    （冠朝 +z、背着前墙）。再转一次就把那一步白做了。
 * ⚠️ y **必须**是 GRASS_Y（与柿子树同一条教训，见上面那段注释）。
 *
 * ⚠️ **已知副作用（不是 bug）**：默认院子机位在 z ≈ 28.15，**本来就在院子
 *    中间** —— 树搬到 z = 30.15 之后落在机位的**右后方**，默认静止视角里
 *    看不见它。这是"放在院子中间"这个要求的必然结果。
 *    🔴 改这个落点要**重拍同机位定妆照**并**重跑 `probe-tree-fit.mjs`**。
 */
const SAKURA_POS = [6.27, GRASS_Y, 8.15];

/* ---- the creeper ink layer ------------------------------------------- */
/**
 * How strongly the vine reads against the plaster. Tuned as
 * `uInkStrength` on the wall shader; it now drives the separate ink overlay
 * (see INK_OVERLAY_FRAG) because the vine has to draw in front of the 春联.
 * Keep the number and the reasoning together — they were tuned as a pair with
 * the stroke alphas in `makeWallInkTexture`.
 */
const WALL_INK_STRENGTH = 0.96;
/** In front of the couplets (0.17); the tree is at 1, far in front of both. */
const INK_OVERLAY_Z = 0.18;

/**
 * 春联 pasted on the brick either side of the door, plus the 横批 above the
 * lintel.
 *
 * WHICH SET IS UP
 * ---------------
 * The date decides. resolveCoupletSet() maps today onto one of 39 sets
 * (24 节气 + 11 传统节日 + 3 法定假期 + 兜底), honouring the multi-day windows
 * for 春节 / 国庆 / 劳动节 / 清明.
 *
 * NO HOVER SWAP (removed 2026-10-08)
 * ----------------------------------
 * Hovering any piece used to cross-fade to the 搞笑 easter egg. The user asked
 * for that to go: the gate should carry today's couplet and nothing else, and
 * a poem that rewrites itself under the cursor undercuts the one thing the
 * 春联 is for. The easter egg survives as `?couplet=funny` (data only).
 *
 * ?couplet=<id|中文名> forces a set (see config/couplets.js) so the other 38
 * are reachable without changing the system clock.
 *
 * WHY ONLY ONE SET IS EVER BAKED
 * ------------------------------
 * This used to be `COUPLET_SETS.map(...)`: EVERY set baked and EVERY set left
 * mounted, stacked on 0.002 z steps with opacity doing the cross-fade. At two
 * sets that was 6 textures and 6 meshes — free. At 39 it would be 117 textures
 * of 200x1420 (≈95 MB of VRAM) and 117 extra meshes, which would both blow up
 * a phone and break the scene's mesh budget.
 *
 * So only the active set is baked. Re-baking is cheap because the red paper
 * is cached separately in gateArt (see paperCanvas) — a rollover costs one
 * drawImage plus seven fillText per piece, not a fresh gradient/fibre/age-spot
 * pass.
 *
 * Resolved once per mount rather than on a midnight timer: re-baking the gate
 * mid-session would be a visible pop, and a tab left open across midnight is
 * not worth a pop for. Reload and it is correct.
 *
 * 2026-10-09：设置面板能选季节，所以这里也**跟着季节偏好重算** —— 否则会
 * 重演「春天的院子挂着秋天的门联」（用户在四季定妆照里抓到过）。
 * 传的是**偏好**而不是 `useSeason()` 的结果：后者在「自动」档下返回的是按
 * 月份算出来的那一季，当成显式指定传进去，节气联/节日联就永远不出现了。
 */
const CoupletWall = () => {
    const { season: seasonPref } = useSitePreferences();

    // The date-driven set, or whatever ?couplet= / the season picker forced.
    const activeId = useMemo(
        () => (coupletOverride() || resolveCoupletSet(new Date(), seasonPref)).set.id,
        [seasonPref]
    );

    const textures = useMemo(() => ({
        upper: makeCoupletTexture(activeId, 'upper'),
        lower: makeCoupletTexture(activeId, 'lower'),
        banner: makeCoupletTexture(activeId, 'banner'),
    }), [activeId]);

    const pieces = [
        { key: 'upper', x: COUPLET_X, y: COUPLET_Y, w: COUPLET_W, h: COUPLET_H },
        { key: 'lower', x: -COUPLET_X, y: COUPLET_Y, w: COUPLET_W, h: COUPLET_H },
        { key: 'banner', x: 0, y: BANNER_Y, w: BANNER_W, h: BANNER_H },
    ];

    return (
        <group>
            {pieces.map((p) => (
                <mesh
                    key={p.key}
                    position={[p.x, p.y, COUPLET_Z]}
                    renderOrder={6}
                >
                    <primitive object={sharedGeometry('plane', p.w, p.h)} attach="geometry" />
                    <meshBasicMaterial
                        map={textures[p.key]}
                        transparent
                        depthWrite={false}
                        toneMapped={false}
                    />
                </mesh>
            ))}
        </group>
    );
};

// Maple is the only scene face left — local file, no external dependency
// (PWA offline + headless-safe). See config/theme.js.
const FONT_URL = SCENE_FONTS.maple;



/**
 * EntranceDoors Component - 3D Entrance to the Corridor
 *
 * Doors that open and camera flies through.
 *
 * 🔴 2026-10-11：**门脸（那面 10×6 的青砖墙）已经不在这里了** —— 它就是
 * 屋身的**前墙**（见 `HouseShell`，门洞与窗洞都开在那面墙上）。这里只剩
 * "挂在墙上的东西"：门扇 / 门框 / 门神 / 对联 / 匾额 / 窗 / 柿子树 /
 * 花箱 / 缸 / 狗 / 石桌。所以本组件**自己不再是一堵墙**，它必须挂在
 * `HOUSE_FRONT_Z` 那个平面上（`position.z = 22` ⇒ 局部 z = 0.15 就是墙）。
 *
 * 这条约束的判据：本文件里所有 mesh 的局部 z 都 ≥ 0.06（门扇），也就是
 * 全部落在墙的**前面**；凡是需要"墙"的地方（洞口、砖缝、压顶、藤蔓底色）
 * 一律由 `HouseShell` 提供。
 */
const EntranceDoors = ({
    position = [0, 0, 22],
    onComplete,
    onStart,
    swingShut = false,
}) => {
    // 门脸的竖向尺寸（10 × 6）只剩一个用处：藤蔓 overlay 那块四边形
    // （`WALL_INK_W/H`，见 config/entranceMetrics 里的说明）。
    // 它的位置由屋身前墙的**压顶下沿**反推（见下面的 inkCenterY）。
    const leftDoorRef = useRef();
    const rightDoorRef = useRef();
    const leftHandleRef = useRef();
    const rightHandleRef = useRef();
    const rightDoorMaterialRef = useRef(); // GSAP shader control
    const leftDoorMaterialRef = useRef(); // Left door reveal control
    const leftHandleMaterialRef = useRef(); // Left handle reveal control
    const rightHandleMaterialRef = useRef(); // Right handle reveal control
    const leftHandlePaintedRef = useRef(); // Painted handle mesh visibility
    const rightHandlePaintedRef = useRef(); // Painted handle mesh visibility
    const groupRef = useRef();
    const [isOpen, setIsOpen] = useState(false);
    const [, setIsHovered] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const [, setIsWindowHovered] = useState(false);
    // 两个窗，各一个小人（WO-10：右窗是原有的，左窗是新增的对称窗）。
    const windowAvatarRef = useRef();
    const windowAvatarRefL = useRef();

    /**
     * 🔴 退场：门是**从这个"开着"的姿势往回关**的（2026-10-11）。
     *
     * 为什么需要这一条
     * ----------------
     * 退场滑行（`HouseExit`，1.3 s，z 21.55 → 28）是**从门洞里退出去**的 ——
     * 相机一定会穿过门扇所在的平面。而 `EntranceDoors` 在退场那一刻是**新挂上**
     * 的（见 `Experience` 的 `outdoorVisible`：退场前它被卸掉了），`isOpen`
     * 从 false 起步 ⇒ 两扇门是**关着**的 ⇒ 相机穿过**关着的门板**，那 0.2~0.3 s
     * 整屏都是门神年画。（这是把 `outdoorVisible` 修好之后才露出来的第二个
     * 问题 —— 修之前门整组都不在，所以看不到它。）
     *
     * 做法：挂上时把两扇**立刻摆到"开着"的角度**（不补间 —— 用户看不到"开"
     * 的过程，一秒前它本来就是开着的），然后用与滑行等长的时间**关回去**。
     * 于是：① 相机穿过的是**门洞**，不是门板；② 滑行结束时门正好关上，
     * 到站那一帧不会"啪"一下变。
     *
     * ⚠️ 门开后**不要**去置 `isOpen`：那个标志一旦置位，`handleClick` 第一行就
     *    返回，退出之后就再也点不进来了 —— 而退出后是要能再进去的。
     *    所以退场期间的"别再碰这扇门"由 `swingShut` 这个 prop 直接兜
     *    （`handleClick` 与两个 hover 开场各加一条 `|| swingShut`），
     *    而不是在这里 setState —— 在 effect 里同步 setState 会多出一条
     *    `react-hooks/set-state-in-effect` 警告，而本项目的质量门是**零新增**。
     */
    useLayoutEffect(() => {
        if (!swingShut) return;
        const L = leftDoorRef.current;
        const R = rightDoorRef.current;
        if (!L || !R) return;
        // 立刻摆到"开着"（不补间 —— 用户看不到"开"的过程，一秒前本来就在开着）
        L.rotation.y = -DOOR_OPEN_Y;
        R.rotation.y = DOOR_OPEN_Y;
        const tl = gsap.timeline();
        tl.to(L.rotation, { y: 0, duration: EXIT_SWING_SEC, ease: 'power2.inOut' }, 0);
        tl.to(R.rotation, { y: 0, duration: EXIT_SWING_SEC, ease: 'power2.inOut' }, 0);
        return () => tl.kill();
    }, [swingShut]);
    const { camera } = useThree();
    const { unlockAchievement } = useAchievements();
    // 推门是音乐的**起播点**之一（另一个是音频面板）—— 见 handleClick。
    const { isMuted, toggleMute } = useAudio();
    // 一次会话内恒定 —— 默认按月份，`?season=冬` 可覆盖。见 config/seasons.js。
    const season = useSeason();

    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        setIsMobile(isTouchDevice() || window.innerWidth < 1000);
    }, []);

    // Dla hooków tekstur musimy obliczyć to raz na starcie
    const isMobileDevice = typeof window !== 'undefined' && (isTouchDevice() || window.innerWidth < 1000);

    // --- Doors: 100% procedural canvas art (see utils/doorArt.js) ---
    // The wood grain, stiles, recessed panels, architrave, hinges and the
    // lock plate are all drawn in code; the tech stickers that used to be
    // baked into the door bitmap are gone and replaced by DoorStickers below.
    // `sketch` is the light line-art variant used on touch devices, `painted`
    // the saturated one desktop reveals on hover.
    const doorVariant = isMobileDevice ? 'sketch' : 'painted';
    // The frame texture is built further down, once the door dimensions that
    // decide its aspect are known.
    const doorLeftTexture = makeDoorFaceTexture('left', 'sketch');
    const doorRightTexture = makeDoorFaceTexture('right', 'sketch');
    const doorRightPaintedTexture = makeDoorFaceTexture('right', 'painted');
    const doorLeftPaintedTexture = makeDoorFaceTexture('left', 'painted');
    const doorBackTexture = makeDoorBackTexture(doorVariant);
    const edgeTexture = makeDoorEdgeTexture(doorVariant);

    // Lever handles — drawn in code too (utils/doorArt.js). They ride on a
    // plane the size of the leaf so the rose lands where the old bitmaps put
    // it; `sketch` is the layer hover wipes away to show the brass beneath.
    const handleLeftTexture = makeHandleTexture('left', false);
    const handleLeftPaintedTexture = makeHandleTexture('left', true);
    const handleRightTexture = makeHandleTexture('right', false);
    const handleRightPaintedTexture = makeHandleTexture('right', true);

    // Bricks + stone path are now procedural GPU shaders (see shaders/entranceTextures.js)
    // Window / pot / mouse / cat pictures replaced by 3D props (see EntranceProps.jsx)
    // The tree, ladybird, speech bubble and bug-click ink splash are procedural
    // canvas art — see utils/entranceArt.js.
    //
    // The window character is the ONE bitmap in the entrance. It was procedural
    // until 2026-10-07; it is now a generated illustration so it matches the
    // corridor IP sprite (public/textures/corridor/avatar_zeo.webp) — the two
    // are the same person and used to look nothing alike. Path is in
    // ENTRANCE_TEXTURES, so App.jsx has already warmed it behind the loader.
    // colourSpace is set through useTexture's onLoad callback (drei's supported
    // hook for exactly this) instead of assigning to the returned texture during
    // render: mutating a hook's return value in the render body is what
    // react-hooks/immutability flags, and it would also re-tag the shared,
    // cached texture on every single render.
    const avatarWindowTexture = useTexture(
        '/textures/entrance/avatar-window.webp',
        (texture) => { texture.colorSpace = THREE.SRGBColorSpace; }
    );

    const bugTexture = makeLadybirdTexture();
    const speechBubbleTexture = makeSpeechBubbleTexture();

    // Bug Ref
    const bugRef = useRef();

    /* --- Ladybird dodge (2026-10-08) -------------------------------------
       The old interaction was click -> ink splash + a "BUG FIXED!" caption
       wiped on with a clip rect. Removed at the user's request; the bug now
       *dodges* the click instead, and chirps.

       The dodge is an offset ADDED to the idle wander in useFrame rather than
       a tween on position, because useFrame overwrites position.x/y every
       frame — a tween on the mesh would be erased on the next frame. Tweening
       a plain object and reading it inside useFrame is the only thing that
       survives. */
    const bugDodge = useRef({ x: 0, y: 0 });
    const bugDodgeTl = useRef(null);
    const handleHideDelayRef = useRef(); // Track pending gsap.delayedCall for handle visibility

    const handleBugDodge = (e) => {
        e.stopPropagation();
        const b = bugRef.current;
        if (!b) return;

        // Push away from wherever the pointer landed on the bug's plane, so a
        // click on the left flank sends it right. Fall back to "straight up"
        // if the click is dead centre (no usable direction).
        const p = e.point;
        let dx = p ? b.position.x - p.x : 0;
        let dy = p ? b.position.y - p.y : 1;
        const len = Math.hypot(dx, dy);
        if (len < 0.04) { dx = Math.random() < 0.5 ? -1 : 1; dy = 0.7; }
        else { dx /= len; dy /= len; }

        const dist = 0.5 + Math.random() * 0.35;
        // Clamped so a few dodges in a row cannot walk it off the facade.
        const tx = Math.max(-0.62, Math.min(0.62, bugDodge.current.x + dx * dist));
        const ty = Math.max(-0.45, Math.min(0.62, bugDodge.current.y + dy * dist * 0.7 + 0.14));

        bugDodgeTl.current?.kill();
        bugDodgeTl.current = gsap.timeline()
            .to(bugDodge.current, { x: tx, y: ty, duration: 0.36, ease: 'back.out(2.4)' })
            .to(bugDodge.current, { x: 0, y: 0, duration: 1.5, ease: 'power2.inOut' }, '+=0.30');

        // A startled flinch: quick squash, back to 1.
        gsap.fromTo(b.scale,
            { x: 1, y: 1 },
            { x: 1.16, y: 0.84, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out' });

        playInsectChirp(1);
    };

    // Duck Speech Bubble State (Rubber Duck Debugging)
    const [isDuckSpeaking, setIsDuckSpeaking] = useState(false);
    const [duckQuote, setDuckQuote] = useState('');
    const speechBubbleRef = useRef();

    // Rubber Duck Debugging Quotes
    const duckQuotes = [
        "Have you tried console.log()?",
        "Did you clear the cache?",
        "It works on my machine!",
        "Have you turned it off and on again?",
        "Maybe it's a CSS issue?",
        "Check for missing semicolons!",
        "Did you read the error message?",
        "Have you tried Stack Overflow?",
        "Is it plugged in?",
        "Works in production!",
    ];

    // Duck Click Handler (Rubber Duck Debugging)
    // 注：这里的「duck」就是花盆里那只**兔子**（WoodenPlanter 的 easter egg，
    // 名字沿用了它替换掉的橡皮鸭）。点它要出声 —— 见下。
    const handleDuckClick = (e) => {
        e.stopPropagation();

        // 先出声，再判「已经在说」。放在守卫之前，连点第二下也有反馈，
        // 否则听起来像坏了。音效与音乐播放无关（audio/sfx.js 的 sfxVolume）。
        playRabbitSqueak(1);

        if (isDuckSpeaking) return; // Already speaking

        // Pick random quote
        const randomQuote = duckQuotes[Math.floor(Math.random() * duckQuotes.length)];
        setDuckQuote(randomQuote);
        setIsDuckSpeaking(true);

        // Scale in animation for speech bubble
        if (speechBubbleRef.current) {
            speechBubbleRef.current.scale.set(0, 0, 0);
            gsap.to(speechBubbleRef.current.scale, {
                x: 1,
                y: 1,
                z: 1,
                duration: 0.3,
                ease: 'back.out(1.7)'
            });
        }

        // Hide after 3 seconds
        setTimeout(() => {
            if (speechBubbleRef.current) {
                gsap.to(speechBubbleRef.current.scale, {
                    x: 0,
                    y: 0,
                    z: 0,
                    duration: 0.2,
                    ease: 'power2.in',
                    onComplete: () => setIsDuckSpeaking(false)
                });
            } else {
                setIsDuckSpeaking(false);
            }
        }, 3000);
    };

    // ... (lines omitted)



    // Door dimensions.
    //
    // The leaf art is authored at 512 x 1310 (DOOR_FACE_ASPECT ≈ 0.391) and is
    // mapped onto a 0.90 x 2.55 plane, so it is stretched ~11% vertically.
    // That is deliberate and cheap: 11% is under the threshold where the
    // handle's brass rose stops reading as a circle, and it buys a leaf at
    // 1:2.83 instead of 1:2.55. A traditional 大门 leaf is 1:3 or narrower —
    // the old 0.94 x 2.4 opening came out at 1:1.28 across both leaves, which
    // is a shop front, not a gate. This is 1:1.42.
    const doorWidth = DOOR_WIDTH;
    const doorHeight = DOOR_HEIGHT;

    // Frame dimensions.
    //
    // The architrave must be TALLER than the leaves it surrounds, or the leaves
    // poke out over its head rail. Sizing it from the old bitmap's aspect
    // (718/877) pinned frameHeight to 1.22 * frameWidth, which quietly made the
    // frame 2.39 against a 2.55-tall door — the leaves overshot it by 0.16 and
    // the 匾额 ended up covering the overhang. Size it from the door instead and
    // hand the resulting aspect to the drawing, which is all fractions anyway.
    const frameWidth = FRAME_W;
    const frameHeight = FRAME_H;      // 0.30 taller than the leaves, ALL of it above them
    const frameAspect = FRAME_ASPECT;
    // The 上槛 has to span the whole distance from the top of the leaves to the
    // top of the frame. The frame's bottom edge sits ON the floor with the
    // leaves, so that distance is the entire 0.30 of extra height — not the thin
    // 2.4% moulding the other three rails use.
    //
    // Left as a moulding it filled only the top sliver of the canvas, and the
    // brick's door cut-out (half-height doorHeight/2 + 0.06, so it reaches 6 cm
    // above the leaves) had nothing behind it: you saw straight through into the
    // corridor, whose walls are warm white. That was the bright band across the
    // top of the gate — worst right over the 门楣, which is where the eye goes.
    const frameHeadFrac = (frameHeight - doorHeight) / frameHeight;
    const frameTexture = makeDoorFrameTexture(doorVariant, frameAspect, frameHeadFrac);

    // Floor Y must remain at standard level regardless of wall height
    const floorY = FLOOR_Y;
    const doorBottomY = floorY;
    const doorCenterY = doorBottomY + doorHeight / 2;

    // The lever's rose sits at (0.8795, 0.5413) of the leaf — HANDLE_PIVOT in
    // utils/doorArt.js — so the handle group is parked that far off the leaf
    // centre. Derived rather than written as literals: the old 0.357 / 0.099
    // were those same fractions evaluated for a 0.94 x 2.4 leaf, and they go
    // silently stale the moment the leaf changes.
    const handleDx = 0.3795 * doorWidth;
    const handleDy = -0.0413 * doorHeight;



    // Cat Interaction State


    // Handle click
    const handleClick = (e) => {
        e.stopPropagation();
        if (isOpen || isAnimating || swingShut) return;   // swingShut：退场回关期间别再推门

        // Reset cursor immediately on transition start
        setGuitarCursor('auto');

        setIsOpen(true);
        setIsAnimating(true);
        // 走廊只在这个时刻之后才需要被画出来（"门前那一眼"）—— 见
        // `Experience` 的 `corridorVisible` 与 `InfiniteCorridorManager` 的封口②。
        onStart?.();

        /* 推门起播 BGM。
         *
         * 🔴 光调 `playBackgroundMusic()` 是**不够**的 —— 用户 2026-10-09 报的
         * 「点大门开门没有音乐」就是这条。
         *
         * `audio_muted` 是**持久化**的偏好位，而 `playBackgroundMusic()` 是
         * **尊重**它的：静音位是 true 时，它照样把元素 `play()` 起来，只是
         * `muted = true`。于是元素**在"播放"**（`paused === false`、`currentTime`
         * 一直在走）**却一点声音都没有**。之前一直没被发现，正是因为只看 `paused`
         * 会把"静音播放"判成"在响"。
         *
         * 面板那条路没这个毛病：它走 `toggleMute()` → `syncMuteState(false)`，
         * 而 `syncMuteState` 认得「静音位 true→false」是**用户主动要听**，
         * 会顺手把静音位清掉。推门在文档里和它并列，都是起播点（见
         * WO-09 / `SiteControls.jsx` 的注释），所以这里按**同构**处理：
         * 静音位开着 → 清掉（这一次点击就是"我要听"）；否则直接起播。
         *
         * ⚠️ 别写成无条件 `toggleMute()`：那样在"本来没静音"时会把它**静掉**，
         * 与动作的意思正好相反 —— 面板那边踩过同一个坑（见 NavigationUI）。
         */
        if (isMuted) toggleMute();
        else playBackgroundMusic();
        unlockAchievement('corridor_enter');

        const tl = gsap.timeline({
            onComplete: () => {
                onComplete?.();
            }
        });

        // Press handles down fully (like really opening)
        if (leftHandleRef.current) {
            tl.to(leftHandleRef.current.rotation, {
                z: 0.4,
                duration: 0.15,
                ease: 'power2.out'
            }, 0);
        }
        if (rightHandleRef.current) {
            tl.to(rightHandleRef.current.rotation, {
                z: -0.4,
                duration: 0.15,
                ease: 'power2.out'
            }, 0);
        }

        // Open doors - smoother angle (matches SegmentDoors)
        // ⚠️ 角度用 `DOOR_OPEN_Y` —— 退场回关（`swingShut`）也从它起步，
        //    两处写死两个数就会差一点，看起来像卡了一下。
        tl.to(leftDoorRef.current.rotation, {
            y: -DOOR_OPEN_Y,
            duration: 0.9,
            ease: 'power2.out'
        }, 0.1);

        tl.to(rightDoorRef.current.rotation, {
            y: DOOR_OPEN_Y,
            duration: 0.9,
            ease: 'power2.out'
        }, 0.1);

        // Camera flies through — across the open forecourt, through the front
        // door, and stops inside the corridor in front of ZEO.
        // 落点深度与 x 归零的理由见 ENTRANCE_LANDING_INSET 的注释。
        tl.to(camera.position, {
            x: 0,
            z: I.INTERIOR_FRONT_Z - ENTRANCE_LANDING_INSET,
            y: 0.2, // Match hook's base Y position
            duration: 2.4,
            ease: 'power2.inOut'
        }, 0.3);
    };

    // Handle hover - doors slightly open to indicate interactivity
    const handlePointerEnter = () => {
        if (isOpen || isAnimating || isMobile || swingShut) return;   // swingShut：退场回关期间别再开场
        setIsHovered(true);
        setGuitarCursor('pointer');

        // Slightly open doors on hover
        gsap.to(leftDoorRef.current.rotation, {
            y: -0.08,
            duration: 0.3,
            ease: 'power2.out',
            overwrite: true
        });
        gsap.to(rightDoorRef.current.rotation, {
            y: 0.08,
            duration: 0.3,
            ease: 'power2.out',
            overwrite: true
        });

        // Rotate handles down slightly (hint effect)
        if (leftHandleRef.current) {
            gsap.to(leftHandleRef.current.rotation, {
                z: 0.1,
                duration: 0.2,
                ease: 'power2.out',
                overwrite: true
            });
        }
        if (rightHandleRef.current) {
            gsap.to(rightHandleRef.current.rotation, {
                z: -0.1,
                duration: 0.2,
                ease: 'power2.out',
                overwrite: true
            });
        }

        // Brush-stroke reveal: discard sketch pixels to show painted door beneath
        if (rightDoorMaterialRef.current) {
            gsap.to(rightDoorMaterialRef.current, {
                uProgress: 1.0,
                duration: 0.8,
                ease: 'power2.out',
                overwrite: true
            });
        }
        if (leftDoorMaterialRef.current) {
            gsap.to(leftDoorMaterialRef.current, {
                uProgress: 1.0,
                duration: 0.8,
                ease: 'power2.out',
                overwrite: true
            });
        }
        if (leftHandleMaterialRef.current) {
            gsap.to(leftHandleMaterialRef.current, {
                uProgress: 1.0,
                duration: 0.8,
                ease: 'power2.out',
                overwrite: true
            });
        }
        if (rightHandleMaterialRef.current) {
            gsap.to(rightHandleMaterialRef.current, {
                uProgress: 1.0,
                duration: 0.8,
                ease: 'power2.out',
                overwrite: true
            });
        }
        // Show painted handles (kill any pending hide from previous leave)
        if (handleHideDelayRef.current) handleHideDelayRef.current.kill();
        if (leftHandlePaintedRef.current) leftHandlePaintedRef.current.visible = true;
        if (rightHandlePaintedRef.current) rightHandlePaintedRef.current.visible = true;
    };

    const handlePointerLeave = () => {
        if (isOpen || isAnimating || isMobile || swingShut) return;   // swingShut：退场回关期间别再开场
        setIsHovered(false);
        setGuitarCursor('auto');

        // Close doors back
        gsap.to(leftDoorRef.current.rotation, {
            y: 0,
            duration: 0.3,
            ease: 'power2.out',
            overwrite: true
        });
        gsap.to(rightDoorRef.current.rotation, {
            y: 0,
            duration: 0.3,
            ease: 'power2.out',
            overwrite: true
        });

        // Reset handles
        if (leftHandleRef.current) {
            gsap.to(leftHandleRef.current.rotation, {
                z: 0,
                duration: 0.2,
                ease: 'power2.out',
                overwrite: true
            });
        }
        if (rightHandleRef.current) {
            gsap.to(rightHandleRef.current.rotation, {
                z: 0,
                duration: 0.2,
                ease: 'power2.out',
                overwrite: true
            });
        }

        // Doors stay painted by default now — no reverse reveal needed
    };



    // --- Bug Wandering Animation ---
    useFrame(({ clock }) => {
        // --- Bug Animation ---
        if (bugRef.current) {
            const time = clock.elapsedTime;
            // Wandering logic: slightly complex sine waves for "random" walking felt
            // Initial Pos: [2.5, floorY + 3.0, 0.16] (Above window)
            // Range: +/- 0.3 in X, +/- 0.3 in Y
            //
            // `bugDodge` is the startled offset from the click handler; it is
            // added here rather than tweened onto the mesh, because this line
            // rewrites position every frame (see the note on bugDodge).
            const dodge = bugDodge.current;
            const xOffset = Math.sin(time * 0.8) * 0.3 + Math.sin(time * 1.5) * 0.1 + dodge.x;
            const yOffset = Math.cos(time * 0.6) * 0.2 + Math.cos(time * 1.1) * 0.1 + dodge.y;

            bugRef.current.position.x = 3 + xOffset;
            bugRef.current.position.y = (floorY + 3.8) + yOffset;

            // Random rotation jitter
            bugRef.current.rotation.z = Math.sin(time * 5) * 0.1 + Math.atan2(yOffset, xOffset) * 0.2;
        }
    });



    /* ---- 那三块"门洞周围的墙"（tunnel wall panels）已经不在了 ----------
     *
     * 它们原本是门脸的补丁：门脸的洞口是**柔边**（`SONG_WALL_FRAG` 的
     * `rectHole` 有 0.06 的 smoothstep），洞口四周那圈半透明带子后面正是
     * 这三块涂成 #e0e0e0 的板子 —— 用户 2026-10-08 报的「大门两边的白色
     * 竖条」就是它们；后来涂成 `#585c5b`（青砖的实测值）才消掉。
     *
     * 门楼合进屋身前墙之后，**洞是屋身墙上硬切的**（`GATE_HOLE`，不透明，
     * 没有柔边），四周由门框从内洞口往外压住，所以既没有半透明带子、
     * 也没有"板子"要补 —— 它们和门脸一起删了。
     */

    // --- Window hover ---------------------------------------------------
    // 洞口 1.4 宽（`WINDOW_HOLE` 的半宽 0.7），小人平面 1.5 宽。
    // 小人的墨迹不居中：它是一个**侧身招手**的姿势，手贴在画布左缘 ——
    // 墨迹从画布 10.6% 处开始（= 平面中心往左 0.16 世界单位），宽 1.28。
    // 于是「静止位」要满足：墨迹整体落在洞口**之外**（这样它被前墙挡住，
    // 看不见）；「探头位」要满足：墨迹整体落在洞口**之内**。
    //
    //   墨迹横向 = [中心 − 0.59, 中心 + 0.69]
    //   静止位：中心 − 0.59 ≥ 洞口右缘 + 0.11  ⇒ 中心 = 窗心 + 1.40
    //   探头位：中心 = 窗心（墨迹 [−0.59, +0.69] ⊂ 洞口 [−0.70, +0.70]）
    //
    // ⚠️ 探头位**不能**为了"把人摆正"而右移：墨迹 1.28 对洞口 1.40，
    // 窗心已经是"再往左 0.02 就会切到左手"的位置。
    //
    // ⚠️ 2026-10-11：`WINDOW_X` 搬到 `config/entranceMetrics` 了 —— 窗看的那个
    // 洞是屋身前墙挖的（`WINDOW_HOLE`），"窗"和"洞"分在两个文件里，
    // 数字必须只有一个来源。
    //
    // 🔴 WO-10：现在有**两个**窗，所以上面这套数要按窗心参数化。
    // 左窗沿用同一套（静止位在它**右边** 1.40 处、也躲在墙后），
    // 于是两个窗的小人都是从右侧探头 —— 镜像一套反而要翻转贴图，不值得。
    const AVATAR_REST_DX = 1.40;
    const avatarRestX = (windowX) => windowX + AVATAR_REST_DX;

    /** 通用：把某个窗的小人推到 `toX`，并给一点倾斜。 */
    const slideAvatar = (ref, toX, tilt, duration, ease) => {
        const node = ref.current;
        if (!node) return;
        gsap.to(node.position, { x: toX, duration, ease, overwrite: true });
        gsap.to(node.rotation, { z: tilt, duration, ease, overwrite: true });
    };

    const handleWindowEnter = (e, ref, windowX) => {
        e.stopPropagation();
        setIsWindowHovered(true);
        setGuitarCursor('pointer');
        slideAvatar(ref, windowX, 0.1, 0.5, 'back.out(1.7)');
    };

    const handleWindowLeave = (e, ref, windowX) => {
        e.stopPropagation();
        setIsWindowHovered(false);
        setGuitarCursor('auto');
        slideAvatar(ref, avatarRestX(windowX), 0, 0.4, 'power2.in');
    };

    // Frame center Y - aligned with doors
    const frameCenterY = doorBottomY + frameHeight / 2;

    // Walkway (甬路). Wider than the door frame so the stone band the shader
    // actually shows (the middle 60% — the rest is verge grass) lands at
    // ~1.84, i.e. the width of the gate opening. At +0.4 the visible slabs
    // were only 1.46 wide, so the path was visibly narrower than the gate it
    // leads to. The extra width is grass, not stone, so nothing else moves.
    const pathWidth = frameWidth + 1.1;
    // 甬路从踏跺前缘一直铺到**篱笆门口**（`FORECOURT_BACK_Z`），不再只铺
    // 门口那一小段 —— 门前现在是一条 16 深的院子，铺装得走到底，否则路
    // 在半路断在草地上，而篱笆正前方那个开口就通向一片草。
    // 石板的纹理是**世界坐标程序化**的（STONE_FRAG 用 uOrigin/uSize 算板缝），
    // 所以拉长只是多铺几块石板，不会被拉伸。
    const pathLength = (I.FORECOURT_BACK_Z - position[2]) - STEP_FRONT_Z;
    // 甬路从踏跺前缘开始，不再从门平面开始 —— 门前那 1.7 米现在是抬高的
    // 台明和踏跺（见 GateBase），铺装接着它们往外走。
    const pathCenterZ = STEP_FRONT_Z + pathLength / 2;

    const wallInk = makeWallInkTexture(WALL_INK_W, WALL_INK_H);

    /* 藤蔓 overlay 的竖向锚点。
     *
     * 贴图里的藤是从「画布顶往下 8%」开始挂的（`makeWallInkTexture` 的
     * `TOP = worldH * INK_TOP_FRAC`），而门脸没了之后这块 overlay 得自己
     * 决定挂在哪一行 —— 判据只有一个：**让 TOP 落在屋身前墙的压顶下沿**，
     * 藤才像是从黑瓦后面钻出来的。
     *
     * 反推出来的底边落在地面以下（≈ −2.78 < GRASS_Y），这是无害的：藤最长
     * 的一缕也只到 0.29 × 画布高，下半张画布本来就是全透明的，而地面以下
     * 那一段被不透明的地面挡掉。
     *
     * 🔴 WO-9（2026-10-11 用户：「让它长宽点，最好和右侧外墙一样宽」）：
     * 这块 overlay 从"跨大门两侧、只有一缕藤"改成**只铺右半面墙** ——
     * 横向中心从 x = 0 挪到 `WALL_INK_CENTER_X` = 6.0，宽仍是 `WALL_INK_W` = 10
     * ⇒ 覆盖 world x ∈ [1.0, 11.0]（大门右边 → 前墙右边缘）。
     * 左半边**不放藤**：那是柿子树的位子，本来就满了。
     * ⚠️ 右窗（x = 5.0）落在这块 overlay 里，藤在贴图层**绕开**了它 ——
     * 见 `makeWallInkTexture` 的 `inWindow`。
     */
    const inkCenterY = I.HOUSE_COPING_Y - WALL_INK_H * INK_TOP_FRAC + WALL_INK_H / 2;

    /* The creeper, as its own layer in front of the couplets.
     *
     * 🔴 走 `useSeasonUniforms` 而不是 `useMemo`（2026-10-10 · WO-10）：藤蔓现在
     * 要跟着季节改叶色深浅，而**换季只能就地改 `.value`** —— 换掉 uniforms 对象
     * 会让 three 缓存的 `uniformsList` 还指着旧对象，画面**静默冻在首季**
     * （WO-8 就是栽在这上面，见 hooks/useSeasonUniforms.js 的长注释）。
     * 这个 hook 把对象身份用 ref 锁死，所以这里安全。
     * `uInkTint` 只乘 rgb、不动 alpha ⇒ 藤蔓的枝形/轮廓逐季逐位不变。 */
    const inkOverlayUniforms = useSeasonUniforms((season) => ({
        uInk: { value: wallInk },
        uInkStrength: { value: WALL_INK_STRENGTH },
        uInkTint: { value: SEASON_INK_TINT[season] || SEASON_INK_TINT.summer }
    }), [wallInk]);
    // vUv=(0,0) of the rotated walkway plane lands at world z = the plane's
    // centre + half its length (its v axis runs against world +Z). Same frame
    // as the grass field, so the two surfaces are continuous at the seam.
    // ⚠️ 甬路的**草边**走的是共享的 grassSurface()，所以必须跟着季节走 ——
    // 否则草地换了春绿而路边的草边还是秋绿，石路矩形那条直边会重新裂出接缝，
    // 也就是这个项目早就修过一次的「生硬」。
    const stoneUniforms = useSeasonUniforms(
        (season) => makeSurfaceUniforms(
            pathWidth, pathLength, [-pathWidth / 2, position[2] + pathCenterZ + pathLength / 2], season
        ),
        // 🔴 2026-10-10：deps 里**不能放 `position` 本身**。它是父组件内联的
        //    `position={[0, 0, 22]}`，每次渲染都是**新数组** ⇒ useMemo 重建
        //    uniforms 对象 ⇒ three 的 uniformsList 还指着第一个 ⇒ 甬路**静默冻在
        //    首季**（用户报的「石板永远停在首次进入的那个季节」）。
        //    `useSeasonUniforms` 现在已用 ref 锁死身份兜底，但这里仍然只依赖**原始值**，
        //    免得每次渲染白跑一遍 factory。
        [pathWidth, pathLength, pathCenterZ, position[0], position[2]]
    );

    return (
        // `name` 是给 harness 用的（与 `house-shell` / `bamboo-grove` 同一套）：
        // 用户报的「退出门口时的 BUG」根因就是这一整组在退场时**被卸掉了**
        // （`Experience` 的边界写成了 `!hasEntered`），而屋身的前墙还画着
        // ⇒ 一面青砖墙 + 一个光洞。判据 `probe-transition-leak.mjs` 断言
        // 「`houseExitRequested` 期间 `entrance-doors` 必须在场」。
        <group ref={groupRef} name="entrance-doors" position={[position[0], 0, position[2]]}>

            {/* === STONE PATH FLOOR (甬路 — from the 踏跺 outwards) === */}
            <mesh
                position={[0, PATH_Y, pathCenterZ]}
                rotation={[-Math.PI / 2, 0, 0]}
            >
                <primitive object={sharedGeometry('plane', pathWidth, pathLength)} attach="geometry" />
                <shaderMaterial
                    vertexShader={SURFACE_VERT}
                    fragmentShader={STONE_FRAG}
                    uniforms={stoneUniforms}
                />
            </mesh>

            {/* === GATE BASE (台基 / 台明 / 踏跺 / 门槛 / 门枕石) ===
                标高全部由 config/entranceMetrics 派生，见 GateBase 的注释。 */}
            <GateBase worldZ={position[2]} />


            {/* === CREEPER INK (its own layer, in front of the 春联) ===
                那块 10×6 的青砖门脸没了 —— 它就是屋身的前墙（见 `HouseShell`），
                砖缝 / 压顶 / 洞口都由那边出。但**藤蔓留在这一层**：它必须画在
                对联**前面**，而对联是本组件挂的。所以它现在是一块"只有藤"的
                透明四边形，贴在屋身前墙之前 0.03（局部 0.18，墙在 0.15）。

                ⚠️ 它的竖向位置由**压顶下沿**反推（见 `inkCenterY` 的注释）——
                门脸还在的时候它跟门脸共用一个中心，现在得自己算，算错藤就挂到
                屋面以上、浮在屋顶外面。

                renderOrder 7 让它压在对联（6）之上、柿子树（8）之下；因为它
                不写深度，树在它不透明的地方仍然赢。见 INK_OVERLAY_FRAG。 */}
            <mesh position={[WALL_INK_CENTER_X, inkCenterY, INK_OVERLAY_Z]} renderOrder={7}>
                <primitive object={sharedGeometry('plane', WALL_INK_W, WALL_INK_H)} attach="geometry" />
                <shaderMaterial
                    vertexShader={SURFACE_VERT}
                    fragmentShader={INK_OVERLAY_FRAG}
                    uniforms={inkOverlayUniforms}
                    transparent={true}
                    depthWrite={false}
                />
            </mesh>

            {/* === TEXTURED FRAME === */}
            <mesh position={[0, frameCenterY, 0.12]}>
                <primitive object={sharedGeometry('plane', frameWidth, frameHeight)} attach="geometry" />
                <meshBasicMaterial color="#e0e0e0"
                    map={frameTexture}
                    alphaTest={0.1}
                    roughness={0.9}
                />
            </mesh>

            {/* LEFT DOOR */}
            <group ref={leftDoorRef} position={[-doorWidth, doorCenterY, 0]}>
                {/* Solid 3D Door Body with edge texture */}
                <mesh
                    position={[doorWidth / 2, 0, 0.06]}
                    onClick={handleClick}
                    onPointerEnter={handlePointerEnter}
                    onPointerLeave={handlePointerLeave}
                >
                    <primitive object={sharedGeometry('box', doorWidth, doorHeight, 0.04)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0" map={edgeTexture} roughness={0.9} />
                </mesh>

                {/* Painted layer (behind sketch) - left door */}
                {!isMobile && (
                    <mesh position={[doorWidth / 2, 0, 0.088]}>
                        <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                        <meshBasicMaterial color="#e0e0e0"
                            map={doorLeftPaintedTexture}
                            alphaTest={0.5}
                            roughness={0.8}
                        />
                    </mesh>
                )}

                {/* Sketch overlay (front) - left door brush-stroke reveal */}
                <mesh position={[doorWidth / 2, 0, 0.09]}>
                    <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                    <revealMaterial color="#e0e0e0"
                        ref={leftDoorMaterialRef}
                        map={doorLeftTexture}
                        alphaTest={0.5}
                        roughness={0.8}
                        uProgress={isMobileDevice ? 0.0 : 1.0}
                    />
                </mesh>

                {/* Back Texture Face (mirrored) */}
                <mesh position={[doorWidth / 2, 0, 0.03]} rotation={[0, Math.PI, 0]} scale={[-1, 1, 1]}>
                    <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0"
                        map={doorBackTexture}
                        alphaTest={0.5}
                        roughness={0.8}
                        side={2}
                    />
                </mesh>

                {/* Handle Layer (animated) - pivot at screw center (292,459 on 332x848 texture) */}
                <group ref={leftHandleRef} position={[doorWidth / 2 + handleDx, handleDy, 0.10]}>
                    {/* Painted handle (behind) - hidden until hover */}
                    {!isMobile && (
                        <mesh ref={leftHandlePaintedRef} position={[-handleDx, -handleDy - 0.009, -0.001]}>
                            <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                            <meshBasicMaterial color="#e0e0e0"
                                map={handleLeftPaintedTexture}
                                alphaTest={0.5}
                            />
                        </mesh>
                    )}
                    {/* Sketch handle overlay (front) */}
                    <mesh position={[-handleDx, -handleDy, 0]}>
                        <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                        <revealMaterial color="#e0e0e0"
                            ref={leftHandleMaterialRef}
                            map={handleLeftTexture}
                            alphaTest={0.5}
                            uProgress={isMobileDevice ? 0.0 : 1.0}
                        />
                    </mesh>
                </group>

                {/* 门神 关公 / 倒福 / 门环 */}
                <DoorOrnaments god="guanyu" leafX={doorWidth / 2} />
            </group>

            {/* RIGHT DOOR */}
            <group ref={rightDoorRef} position={[doorWidth, doorCenterY, 0]}>
                {/* Solid 3D Door Body with edge texture */}
                <mesh
                    position={[-doorWidth / 2, 0, 0.06]}
                    onClick={handleClick}
                    onPointerEnter={handlePointerEnter}
                    onPointerLeave={handlePointerLeave}
                >
                    <primitive object={sharedGeometry('box', doorWidth, doorHeight, 0.04)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0" map={edgeTexture} roughness={0.9} />
                </mesh>

                {/* Painted layer (behind sketch) - revealed when sketch fades out on hover */}
                {!isMobile && (
                    <mesh position={[-doorWidth / 2, 0, 0.088]}>
                        <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                        <meshBasicMaterial color="#e0e0e0"
                            map={doorRightPaintedTexture}
                            alphaTest={0.5}
                            roughness={0.8}
                        />
                    </mesh>
                )}

                {/* Sketch overlay (front) - brush-stroke discard reveals painted beneath */}
                <mesh position={[-doorWidth / 2, 0, 0.09]}>
                    <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                    <revealMaterial color="#e0e0e0"
                        ref={rightDoorMaterialRef}
                        map={doorRightTexture}
                        alphaTest={0.5}
                        roughness={0.8}
                        uProgress={isMobileDevice ? 0.0 : 1.0}
                    />
                </mesh>

                {/* Back Texture Face */}
                <mesh position={[-doorWidth / 2, 0, 0.03]} rotation={[0, Math.PI, 0]}>
                    <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0"
                        map={doorBackTexture}
                        alphaTest={0.5}
                        roughness={0.8}
                    />
                </mesh>

                {/* Handle Layer (animated) - pivot at screw center (40,459 on 332x848 texture) */}
                <group ref={rightHandleRef} position={[-doorWidth / 2 - handleDx, handleDy, 0.10]}>
                    {/* Painted handle (behind) - hidden until hover */}
                    {!isMobile && (
                        <mesh ref={rightHandlePaintedRef} position={[handleDx, -handleDy - 0.009, -0.001]}>
                            <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                            <meshBasicMaterial color="#e0e0e0"
                                map={handleRightPaintedTexture}
                                alphaTest={0.5}
                            />
                        </mesh>
                    )}
                    {/* Sketch handle overlay (front) */}
                    <mesh position={[handleDx, -handleDy, 0]}>
                        <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                        <revealMaterial color="#e0e0e0"
                            ref={rightHandleMaterialRef}
                            map={handleRightTexture}
                            alphaTest={0.5}
                            uProgress={isMobileDevice ? 0.0 : 1.0}
                        />
                    </mesh>
                </group>

                {/* 门神 张飞 / 倒福 / 门环 */}
                <DoorOrnaments god="zhangfei" leafX={-doorWidth / 2} />
            </group>

            {/* === 春联 + 横批 (date-driven; no hover swap) === */}
            <CoupletWall />

            {/* === 燕子窝 — perched above the right of the lintel === */}
            <SwallowNest position={[0.86, 1.14, 0.22]} />

            {/* Warm lighting - WYLACZONE */}
            {/* <pointLight
                position={[0, doorBottomY + doorHeight + 1, 1]}
                intensity={0.8}
                color="#fff8e8"
                distance={10}
            /> */}
            {/* ================= 两个窗（WO-10） =================
                🔴 右窗（`WINDOW_X`）是原有的；**左窗（`WINDOW_X_LEFT` = −WINDOW_X）
                是 2026-10-11 新加的对称窗**（用户：「窗户距离门口太近，调为现有
                距离的 2 倍。然后再另外一边多加一个对称的窗户。」）。

                两个窗共用同一套构件 —— 木框 / 窗帘 / hover 热区 / 探头小人 ——
                所以用一份循环生成，而不是把四块 JSX 复制两遍。
                ⚠️ 小人的静止位与探头位都是**按窗心参数化**的（见上面
                `avatarRestX` 那段推导），所以左窗不需要翻转贴图。

                ⚠️ 左窗会被柿子树挡掉一部分：树冠横向覆盖 world x ∈ [−5.24, −1.46]，
                而左窗占 x ∈ [−5.7, −4.3]。树冠是有空隙的叶簇，窗会从缝里透出来，
                但"对称"在视觉上会被这棵树打折 —— 这是用户明确要的，先做出来看。 */}
            {[
                { key: 'right', x: WINDOW_X, avatar: windowAvatarRef },
                { key: 'left', x: WINDOW_X_LEFT, avatar: windowAvatarRefL },
            ].map(({ key, x, avatar }) => (
                <group key={key}>
                    {/* AVATAR — parked behind the bricks.
                        `depthWrite={false}` stops its transparent margin from
                        punching a depth hole through the curtain behind it, and
                        z = 0.06 puts the figure in front of the curtain panels
                        (-0.01) while staying behind the brick facade (0.15) so
                        the wall hides it at rest.

                        ⚠️ y is NOT decorative. The illustration is a half-body
                        pose that is CROPPED AT ITS OWN BOTTOM EDGE — the ink runs
                        to y=1023 of a 1024px canvas (see the note in the texture
                        pipeline). At 0.04 the ink bottom landed exactly on the
                        window opening's bottom edge, so a good 0.29 world units of
                        trouser showed and read as a pair of severed legs sitting
                        on the sill. The user's report was exactly that:
                        "断腿露出来了". -0.16 pushes that hard cut behind the
                        frame's bottom rail and leaves only the hip, which reads as
                        a person standing at the window.
                        The head still clears the top rail comfortably at this
                        height — measured, not guessed: see
                        .workbuddy-ai/round2-2026-10-08/ avatar-y-*.png. */}
                    <mesh
                        ref={avatar}
                        name={`window-avatar-${key}`}
                        position={[avatarRestX(x), -0.16, 0.06]}
                        rotation={[0, 0, 0]}
                    >
                        <primitive object={sharedGeometry('plane', 1.5, 1.5)} attach="geometry" />
                        <meshBasicMaterial color="#e0e0e0"
                            map={avatarWindowTexture}
                            transparent={true}
                            depthWrite={false}
                        />
                    </mesh>

                    {/* WINDOW - rustic wooden frame */}
                    <WoodenWindowFrame position={[x, 0, 0.25]} />

                    {/* Stable hover target for the window.
                        The enter/leave handlers used to live on
                        WoodenWindowFrame's group, whose raycast target is only the
                        four planks plus the thin cross mullions. Crossing one of
                        the four open panes dropped the hit, fired onPointerLeave
                        and yanked the avatar straight back out — the "peeks out
                        for a split second then runs back" flicker. One invisible
                        plane covering the whole opening keeps the hover state rock
                        solid. */}
                    <mesh
                        name={`window-hover-${key}`}
                        position={[x, 0.06, 0.45]}
                        onPointerEnter={(e) => handleWindowEnter(e, avatar, x)}
                        onPointerLeave={(e) => handleWindowLeave(e, avatar, x)}
                    >
                        <primitive object={sharedGeometry('plane', 1.9, 1.9)} attach="geometry" />
                        <meshBasicMaterial color="#e0e0e0" transparent opacity={0} depthWrite={false} />
                    </mesh>

                    {/* Curtain + interior, seen through the window opening (behind
                        the brick plane). Pulled back to z = -0.03 so the character
                        can stand in front of the fabric panels instead of being
                        swallowed by them. */}
                    <WindowCurtain position={[x, 0, -0.03]} />
                </group>
            ))}

            {/* DUCK PLANTER (Right Side - Under Window) — rustic wood, green plant, 3D duck.
                Sits on the OUTDOOR grade (the lawn), not on the floor — the lawn
                is 0.30 below the floor now, so anything standing on it has to
                move with OUTDOOR_Y or it floats.
                ⚠️ WO-10：右窗从 2.5 挪到 5.0，花箱跟着走 —— 它存在的理由就是
                「窗下那丛绿植」，留在 2.5 就变成墙根下一盆没来由的花。 */}
            <group position={[WINDOW_X, OUTDOOR_Y, 0.4]}>
                <WoodenPlanter position={[0, 0, 0]} yaw={RABBIT_YAW} />

                {/* Invisible hitbox just for the duck (right side of planter) */}
                <mesh
                    position={[0.38, 0.6, 0.12]}
                    onClick={handleDuckClick}
                    onPointerEnter={() => { setGuitarCursor('pointer'); }}
                    onPointerLeave={() => { setGuitarCursor('auto'); }}
                >
                    <primitive object={sharedGeometry('plane', 0.55, 0.55)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0" transparent opacity={0} />
                </mesh>

                {/* Speech Bubble */}
                <group
                    ref={speechBubbleRef}
                    position={[0.95, 1.15, 0.1]}
                    scale={[0, 0, 0]}
                >
                    <mesh>
                        <primitive object={sharedGeometry('plane', 1.8, 1.2)} attach="geometry" />
                        <meshBasicMaterial color="#e0e0e0"
                            map={speechBubbleTexture}
                            transparent={true}
                            alphaTest={0.01}
                            depthWrite={false}
                        />
                    </mesh>

                    {/* Quote Text */}
                    {/* ROZMIAR TEKSTU: fontSize - mniejsza = mniejszy tekst */}
                    {/* ZAWIJANIE: maxWidth - mniejsza = wcześniejsze zawijanie */}
                    <Text
                        position={[0, 0.1, 0.01]}
                        fontSize={0.07}
                        color="#1a1a1a"
                        anchorX="center"
                        anchorY="middle"
                        font={FONT_URL}
                        maxWidth={1.4}
                        textAlign="center"
                        visible={isDuckSpeaking} // Toggle visibility instead of mounting/unmounting
                    >
                        {duckQuote || " "}
                    </Text>
                </group>
            </group>

            {/* FOXTAIL GRASS (二者之一替换了原来那道矮竹篱) —— 2026-10-11
                用户：「窗下的竹篱笆换成狗尾巴草看看效果，门口两边都要，
                和墙宽一样。注意不能和花箱穿透了。」

                所以这里不再是一道 3.65 长、只贴在门右边的矮篱，而是一条
                **沿整面前墙**铺开的草带（局部 x ∈ [−10.5, 10.5]）。

                🔴 它在哪儿长、在哪儿不长，**不是在这里决定的** ——
                能种草的区间由 `utils/foxtailGrass.js` 的 `FOXTAIL_SEGMENTS`
                给出，那里把实测的障碍物（台明 / 白狗 / 荷花缸 / **花箱**）
                从整面墙里挖掉了。所以"不和花箱穿透"是**结构上**成立的：
                那一段没有实例，不是画的时候躲一下。

                z 传 0：进深写在 `GRASS_Z0/GRASS_Z1`（局部 0.18…0.60），
                那是"贴着砖面但不埋进去"的唯一真源。 */}
            <FoxtailGrass position={[0, OUTDOOR_Y, 0]} />

            {/* LOTUS VAT (beside the planter) —— §6.1，WO-3。
                位置由用户 2026-10-09 定：「与花箱并列」。
                缸半径 0.305 取 x = 3.6 ⇒ 缸占 x ∈ [3.295, 3.905]。
                （花箱 2026-10-11 随窗户挪到了 x ∈ [4.425, 5.575]，所以缸现在
                在它**左边** 0.52 处 —— 「并列」这层关系没变。）

                🔴 z = 0.62 的来历（**别动**）：原来墙脚那道矮竹篱在 z = 0.24，
                而缸是**开口的车削体** —— 竹篱从它肚子里穿过去会**从缸口看见
                几根竹竿插在水面上**（用户 2026-10-10 报：「水缸往外挪一点，
                被竹篱笆穿透了」）。所以缸必须挪到 `0.24 + 0.305 = 0.545` 之外。
                竹篱 2026-10-11 已被换成狗尾巴草（`FoxtailGrass`），但 0.62 留着：
                草带的进深是 0.18…0.60，缸背在 0.615 之外 —— 两者仍然不相交，
                而且 `utils/foxtailGrass.js` 的避让表就是按这个实测位置写的。

                内容物按季**条件挂载**（见 LotusVat 的注释：四季全挂上会白吃
                约 20 个网格，而验收判据是 mesh ≤ 760）。 */}
            <LotusVat position={[3.6, OUTDOOR_Y, 0.62]} />

            {/* ANIMATED BUG (Right Side - Above Window) */}
            {/* Clicking it no longer splashes ink — it dodges (see
                handleBugDodge) and chirps.

                Size: the visible plane is 0.37. It had been enlarged to 0.74
                when the click interaction was added (a bigger target), which
                read on screen as a beetle the size of the door handle — the
                user asked for it halved. The *target* is not halved with it:
                the invisible child below is what takes the pointer.

                季节：瓢虫**冬季不出现**（见 docs/seasons.md §6.4）。
                成虫是越冬的，天冷就钻进墙缝枯叶里，不会在十一月的墙面上
                遛弯。挂在 `season !== 'winter'` 上 —— `season` 来自
                `useSeason()`，所以面板里换成冬天时它会当场消失，不用刷新。
                下面的 useFrame 里对 `bugRef.current` 有 null 守卫，卸载安全。 */}
            {season !== 'winter' && (
            <mesh
                ref={bugRef}
                position={[2.5, floorY + 2.8, 0.16]}
            >
                <primitive object={sharedGeometry('plane', 0.37, 0.37)} attach="geometry" />
                <meshBasicMaterial color="#e0e0e0"
                    map={bugTexture}
                    transparent={true}
                    alphaTest={0.01}
                    depthWrite={false}
                />
                {/* Hit pad — child of the bug, so it inherits the idle wander and
                    the dodge without any extra plumbing.
                    Halving the visible bug must not halve the target: "go for it
                    and it gets away" stops being a game if the target is 40 px.
                    0.46 gives ~10 px of slack around the drawn bug — generous
                    enough to land a swipe, tight enough that the bug does not
                    dodge clicks you aimed somewhere else.
                    opacity 0 + alphaTest 0.01: three bakes `opacity` into
                    diffuseColor.a *before* the alpha test, so every fragment is
                    discarded. It draws nothing and only ever raycasts. */}
                <mesh
                    position={[0, 0, 0.001]}
                    onPointerDown={handleBugDodge}
                    onPointerEnter={() => { setGuitarCursor('pointer'); }}
                    onPointerLeave={() => { setGuitarCursor('auto'); }}
                >
                    <primitive object={sharedGeometry('plane', 0.46, 0.46)} attach="geometry" />
                    <meshBasicMaterial color="#ffffff"
                        transparent={true}
                        opacity={0}
                        alphaTest={0.01}
                        depthWrite={false}
                    />
                </mesh>
            </mesh>
            )}





            {/* 柿子树（3D，WO-13，2026-10-12）。
                这里原来是一张 768×1024 的**画布贴图**贴在 6×8 的平面上
                （billboard）—— 画在 canvas 里、永远正对镜头。用户要求
                「柿子树完全重构，3D 版」，参考 `public/demos/web3d/tree/`。

                现在它是程序化长出来的真几何：骨架（枝 + 关节）1 个 mesh、
                叶 / 果各 1 个 InstancedMesh、地面投影 1 片 ⇒ **4 次 draw call**。
                ⚠️ 风铃**由 PersimmonTree 自己挂**在一条真实的一级枝上（挂点
                   由生成器挑出来，见 `utils/persimmonTree.js`），所以这里
                   不再有单独的 WindChime —— 之前那个位置是按**贴图**里
                   画的那根小臂反推的，3D 版的枝不在那儿了。
                ⚠️ `rootY = GRASS_Y`：树长在**草坪**上（不是甬路、也不是
                   室外地面）。旧版的贴图是从 y=0.95 那张 8 米高的平面底部
                   长上来的，树根位置是画出来的；3D 版必须给真值。
                ⚠️ `position` 的 z 比旧贴图（局部 1）更靠外：那是一个**没有
                   厚度**的平面，可以贴着墙；3D 的冠有进深，要让它站在出檐
                   之外（见 `utils/persimmonTree.js` 的 `FWD_BIAS` 注释）。 */}
            <PersimmonTree position={PERSIMMON_POS} rootY={GRASS_Y} yaw={PERSIMMON_YAW} />

            {/* ---- 第二棵柿子树（WO-27）----
                落点 / seed / 不挂风铃的理由全在 `PERSIMMON2_POS` 上面那段注释里。
                ⚠️ 第一棵**刻意不传 `seed`** ⇒ 走 `buildPersimmonTree` 的默认参数
                   ⇒ 逐位等于改动前那棵（秋天的回归锚点）。 */}
            <PersimmonTree
                position={PERSIMMON2_POS}
                rootY={GRASS_Y}
                yaw={PERSIMMON2_YAW}
                seed={PERSIMMON2_SEED}
                chime={false}
                name="persimmon-tree-2"
            />


            {/* 樱花树（3D，WO-17，2026-10-12）。
                用户：「参考 sakura-station-corner 在前院种两棵樱花树」
                → 追加：「做**一棵**看效果，落樱参考真实樱花树的季节」
                → 又追加（当天晚些，位置纠正）：「**放在右边院子（绿色草地）
                  的中间位置**，现在是在窗口前了」。

                骨架机器与柿子树**共用一份**（`utils/treeSkeleton.js`），
                樱花只提供自己那套形态参数 + 花 / 叶 / 落樱。
                花簇与叶冠是**两个** InstancedMesh，共用同一批实例矩阵
                （一次只显示一种）⇒ 加上骨架 / 影 / 落樱共 **5 个 mesh**，
                任一时刻最多 4 个可见；落樱**只在春天挂载**。

                ⚠️ 落点为什么是右院草地中心、以及"为什么不给 yaw"，
                   都写在上面 `SAKURA_POS` 的注释里。 */}
            <SakuraTree position={SAKURA_POS} rootY={GRASS_Y} />


            {/* STONE TABLE + TWO STOOLS —— 树下、树跟前（用户 2026-10-09 定）。
                树干在 local x ≈ -2.82（见 entranceArt 的 trunk 骨架：canvas 394
                按 128 px/单位 折回来，再加上树组自己的 -2.9）；树是一张 billboard
                平面停在 z = 1，所以摆在 z > 1 的一侧就是"树跟前"。
                脚下是**草坪**不是甬路 —— 用 GRASS_Y（比 OUTDOOR_Y 低 4 cm，
                见 entranceMetrics 的 GROUND_DROP）。 */}
            <StoneTable position={[-2.30, GRASS_Y, 4.20]} />

            {/* WHITE DOG (Front Facing) — 3D procedural, blinking eyes, wagging tail.
                On the lawn, clear of the 台明 (which is only APRON_W wide). */}
            <WhiteDog position={[-1.5, OUTDOOR_Y, 0.8]} yaw={DOG_YAW} />

        </group>
    );
};

export default EntranceDoors;
