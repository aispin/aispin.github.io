import { useRef, useState, useEffect, useMemo } from 'react';
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
import { SURFACE_VERT, SONG_WALL_FRAG, INK_OVERLAY_FRAG, STONE_FRAG, makeSurfaceUniforms, SEASON_INK_TINT } from '../../../shaders/entranceTextures';
import GateBase from './GateBase';
import { WindChime, WhiteDog, WoodenPlanter, WoodenWindowFrame, WindowCurtain, SwallowNest } from './EntranceProps';
import StoneTable from './StoneTable';
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
    makeTreeTexture,
    makeWallInkTexture,
    makeLadybirdTexture,
    makeSpeechBubbleTexture,
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
import {
    FLOOR_Y,
    DOOR_WIDTH,
    DOOR_HEIGHT,
    DOOR_OPENING_W,
    DOOR_CENTER_Y,
    FRAME_W,
    FRAME_H,
    FRAME_ASPECT,
    FACADE_W,
    FACADE_H,
    FACADE_CENTER_Y,
    BANNER_W,
    BANNER_H,
    BANNER_Y,
    OUTDOOR_Y,
    PATH_Y,
    GRASS_Y,
    STEP_FRONT_Z,
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

// BANNER_W / BANNER_H / BANNER_Y (the 横批 above the lintel) live in
// config/entranceMetrics, because SignSystem has to clear the banner and must
// not hardcode a lintel height of its own to do it.

const COUPLET_Z = 0.17;

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
const RABBIT_YAW = -0.55;

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
 * EmptyCorridor provides the surrounding corridor context.
 */
const EntranceDoors = ({
    position = [0, 0, 22],
    onComplete
}) => {
    // The facade is sized against the GATE, not against the corridor — the
    // tunnel behind it is only 7 x 3.5 (see CorridorWalls), so these walls
    // were never the corridor's walls. All the vertical metrics come from
    // config/entranceMetrics so the architrave, the 横批 and the hanging sign
    // above them cannot drift apart again.
    const corridorWidth = FACADE_W;
    const corridorHeight = FACADE_H;
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
    const windowAvatarRef = useRef();
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

    // 四季：春新芽+花 / 夏浓荫 / 秋红果（= 现状）/ 冬秃枝。
    // 缓存键含季节，种子不含（见 makeTreeTexture 的说明）。
    const treeTexture = makeTreeTexture(season);
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
    const doorOpeningWidth = DOOR_OPENING_W; // Both doors together
    const wallThickness = 0.07;

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
    const wallCenterY = floorY + corridorHeight / 2;
    const topWallHeight = corridorHeight - doorHeight;
    const topWallCenterY = doorBottomY + doorHeight + topWallHeight / 2;
    const sideWallWidth = (corridorWidth - doorOpeningWidth) / 2;

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
        if (isOpen || isAnimating) return;

        // Reset cursor immediately on transition start
        setGuitarCursor('auto');

        setIsOpen(true);
        setIsAnimating(true);

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
        tl.to(leftDoorRef.current.rotation, {
            y: -Math.PI * 0.55,
            duration: 0.9,
            ease: 'power2.out'
        }, 0.1);

        tl.to(rightDoorRef.current.rotation, {
            y: Math.PI * 0.55,
            duration: 0.9,
            ease: 'power2.out'
        }, 0.1);

        // Camera flies through - STOP CLOSER to avatar/ZEO
        tl.to(camera.position, {
            z: 11,  // Closer stop point (was 11)
            y: 0.2, // Match hook's base Y position
            duration: 1.8,
            ease: 'power2.inOut'
        }, 0.3);
    };

    // Handle hover - doors slightly open to indicate interactivity
    const handlePointerEnter = () => {
        if (isOpen || isAnimating || isMobile) return;
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
        if (isOpen || isAnimating || isMobile) return;
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



    // The three tunnel wall panels (see the JSX below) sit behind this, so
    // they cannot occlude the window's interior or its curtains.
    const WALL_PANEL_Z = -0.5;

    /**
     * Colour of those legacy panels.
     *
     * Sampled off the facade: the 青砖 around the opening reads (88, 92, 91)
     * at the resting entrance camera. Painted #e0e0e0 they were the brightest
     * thing in the frame (measured 205,205,205) and the facade's soft cut-out
     * ramp turned them into a bright halo around the gate — see the long note
     * on the panels below.
     */
    const WALL_REVEAL = '#585c5b';

    // --- Window hover ---------------------------------------------------
    // The opening is centred on x = 2.5 and is 1.4 wide, so its right edge is
    // at 3.2. The avatar plane is 1.5 wide, so parking its CENTRE at 3.75 puts
    // its LEFT edge at 3.0 — 0.2 *inside* the opening. That used to be safe
    // because the old sprite's ink sat centred in its canvas, but the current
    // one is a leaning pose with the waving hand pressed against the canvas's
    // left edge (ink starts at 10.6% of the canvas = 0.16 world left of the
    // plane centre). At 3.75 the fingertips poked through the panes even at
    // rest. 3.90 clears the opening edge by 0.11 — enough for the pose, and
    // still a short hop in from the left.
    //
    // AVATAR_SHOWN_X cannot simply be nudged right to centre the figure: the
    // ink is 1.28 wide against a 1.4 opening, so 2.5 is already within 0.02 of
    // the position that would clip the hand on the left jamb.
    const WINDOW_X = 2.5;
    const AVATAR_REST_X = 3.90;
    const AVATAR_SHOWN_X = WINDOW_X;

    // Helper for window hover
    const handleWindowEnter = (e) => {
        e.stopPropagation();
        setIsWindowHovered(true);
        setGuitarCursor('pointer');

        if (windowAvatarRef.current) {
            gsap.to(windowAvatarRef.current.position, {
                x: AVATAR_SHOWN_X,
                duration: 0.5,
                ease: 'back.out(1.7)',
                overwrite: true
            });
            gsap.to(windowAvatarRef.current.rotation, {
                z: 0.1,
                duration: 0.5,
                ease: 'power2.out',
                overwrite: true
            });
        }
    };

    const handleWindowLeave = (e) => {
        e.stopPropagation();
        setIsWindowHovered(false);
        setGuitarCursor('auto');

        if (windowAvatarRef.current) {
            gsap.to(windowAvatarRef.current.position, {
                x: AVATAR_REST_X,
                duration: 0.4,
                ease: 'power2.in',
                overwrite: true
            });
            gsap.to(windowAvatarRef.current.rotation, {
                z: 0,
                duration: 0.4,
                ease: 'power2.in',
                overwrite: true
            });
        }
    };

    // Frame center Y - aligned with doors
    const frameCenterY = doorBottomY + frameHeight / 2;

    // Walkway (甬路). Wider than the door frame so the stone band the shader
    // actually shows (the middle 60% — the rest is verge grass) lands at
    // ~1.84, i.e. the width of the gate opening. At +0.4 the visible slabs
    // were only 1.46 wide, so the path was visibly narrower than the gate it
    // leads to. The extra width is grass, not stone, so nothing else moves.
    const pathWidth = frameWidth + 1.1;
    // New texture is 1005x2317 (approx 1:2.3 ratio). 
    // Width 3.06 * 2.3 = ~5.6 height.
    const pathLength = 5.62;
    // 甬路从踏跺前缘开始，不再从门平面开始 —— 门前那 1.7 米现在是抬高的
    // 台明和踏跺（见 GateBase），铺装接着它们往外走。
    const pathCenterZ = STEP_FRONT_Z + pathLength / 2;

    // Procedural GPU textures (zero image assets — replaces AI-generated webp)
    // The hole rects are authored in WORLD XY (same frame as the door group and
    // the [2.5, 0] window prop), so the facade shader needs its bottom-left
    // world corner to convert vUv -> world. Without it the openings never cut
    // and the brick plane (z=0.15) hides the doors (z=0.06) completely.
    // The facade's bottom edge sits ON the floor — that is the whole contract
    // with the wall shader, which measures every band (plinth, brick courses,
    // tile coping) upward from uOrigin.y. It used to be expressed as
    // `wallCenterY + facadeYOffset + 1.65`, where the -1.65 and +1.65 cancelled
    // and the result only equalled the floor because FACADE_H happened to be
    // exactly corridorHeight. Say it directly instead.
    const facadeCenterY = FACADE_CENTER_Y;
    const wallInk = makeWallInkTexture(FACADE_W, FACADE_H);
    // The cut-outs are the opening plus a small margin, so the doors and the
    // frame show through without the brick clipping their edges.
    const brickUniforms = useSeasonUniforms((season) => ({
        ...makeSurfaceUniforms(
            FACADE_W, FACADE_H,
            [-FACADE_W / 2, facadeCenterY - FACADE_H / 2],
            season
        ),
        uHoleDoor: { value: [0, doorCenterY, doorOpeningWidth / 2 + 0.07, doorHeight / 2 + 0.06] },
        uHoleWindow: { value: [WINDOW_X, 0.02, 0.7, 0.73] },
        uInk: { value: wallInk },
        // ⚠️ This is one half of a pair — the other half is the palette in
        // `makeWallInkTexture`. The effective mix is
        // `leafAlpha × uInkStrength`, and the value that matters is whether
        // the ink's G−R difference survives it. See the long note on the
        // creeper's palette in utils/entranceArt.js: the old near-black green
        // at 0.42 landed as 4/255 of chroma and read as a grey smudge. The
        // palette is now mid-tone greens; this is the strength that lets them
        // read. Lower it back towards 0.42 and the vine goes grey again.
        //
        // 0.86 → 0.96 on 2026-10-07 evening, together with the stroke alphas in
        // `makeWallInkTexture` (leaf fill 0.36..0.74 → 0.58..0.94). The user's
        // report was "有点半透明的模糊感": the ink layer is composited as
        // `mix(brick, ink, ink.a × uInkStrength)`, so *both* factors leak the
        // brick coursing through the foliage. Only the product matters, and it
        // went 0.31..0.64 → 0.56..0.92. Do not raise this to 1.0: the ink is
        // supposed to sit on plaster, and at full strength it competes with the
        // coursing for attention (see the note in entranceTextures.js).
        //
        // 🔴 2026-10-09: the strength is now 0 HERE and WALL_INK_STRENGTH below
        // lives on the ink overlay instead. The vine had to move in front of
        // the 春联 (see INK_OVERLAY_FRAG). `mix(col, x, 0.0)` is exactly `col`,
        // so the brick is bit-identical with the line left in place.
        uInkStrength: { value: 0 }
    }), [facadeCenterY, wallInk, doorCenterY, doorOpeningWidth, doorHeight]);

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
        <group ref={groupRef} position={[position[0], 0, position[2]]}>

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


            {/* === TUNNEL WALL PANELS (Z-BACKED) ===
                这三块板是"门洞周围那圈墙"，从入口还是一条纯走廊的时候就留在这里。
                现在 10×6 的青砖门脸（z = 0.15）把它们盖住 —— **但不是完全盖住**。

                ⚠️ 2026-10-08：用户报「大门两边的白色竖条」就是它们。
                门脸的洞口不是硬裁的：SONG_WALL_FRAG 里
                    float hole = max(rectHole(uHoleDoor), rectHole(uHoleWindow));
                    gl_FragColor = vec4(col, 1.0 - hole);
                而 rectHole 是 `1.0 - smoothstep(0.0, 0.06, ...)`，所以洞口**四周
                往外 0.06 世界单位**（在默认机位约 8 px）门脸是半透明的。那一条
                半透明带子后面正是这块板：涂成 #e0e0e0（无光照 → 224）的板子从
                青砖（实测 88,92,91）后面透出来，就是一道白边。

                修法：板子代表的是"洞口周围那圈墙"，就按墙的颜色画。它们在视觉上
                等于不存在了，而门脸那 0.06 的柔边无论透出多少都还是砖色。
                别再改回 #e0e0e0 —— 那正是这条 bug 的成因。 */}

            {/* LEFT WALL PANEL */}
            <mesh position={[-(doorOpeningWidth / 2 + sideWallWidth / 2), wallCenterY, WALL_PANEL_Z]}>
                <primitive object={sharedGeometry('box', sideWallWidth, corridorHeight, wallThickness)} attach="geometry" />
                <meshBasicMaterial color={WALL_REVEAL} roughness={0.95} />
            </mesh>

            {/* RIGHT WALL PANEL */}
            <mesh position={[(doorOpeningWidth / 2 + sideWallWidth / 2), wallCenterY, WALL_PANEL_Z]}>
                <primitive object={sharedGeometry('box', sideWallWidth, corridorHeight, wallThickness)} attach="geometry" />
                <meshBasicMaterial color={WALL_REVEAL} roughness={0.95} />
            </mesh>

            {/* TOP WALL PANEL */}
            <mesh position={[0, topWallCenterY, WALL_PANEL_Z]}>
                <primitive object={sharedGeometry('box', doorOpeningWidth, topWallHeight, wallThickness)} attach="geometry" />
                <meshBasicMaterial color={WALL_REVEAL} roughness={0.95} />
            </mesh>

            {/* === SONG-DYNASTY WALL FACADE === */}
            {/* 
                DOSTOSOWANIE OBRAZKA (TEXTURE ADJUSTMENT):
                1. args={[FACADE_W, FACADE_H]} - rozmiar elewacji; oba idą za
                   corridorWidth / corridorHeight, więc zmieniaj je tam.
                2. Pozycja pionowa NIE jest już osobna: `facadeCenterY` trzyma
                   dolną krawędź elewacji na podłodze, bo shader mierzy od niej
                   każdy pas (cokół, wątki cegły, gzyms). Przesunięcie jej w górę
                   wsunęłoby cokół pod ziemię.
                The surface itself (brick / plinth / tile coping / weathering)
                is authored in shaders/entranceTextures.js; the ink creeper it
                is overlaid with is drawn in utils/entranceArt.js.
            */}
            <mesh position={[0, facadeCenterY, 0.15]}>
                {/* args={[Szerokość, Wysokość]} - Zmieniaj te liczby (np. 7, 8) */}
                <primitive object={sharedGeometry('plane', FACADE_W, FACADE_H)} attach="geometry" />
                <shaderMaterial
                    vertexShader={SURFACE_VERT}
                    fragmentShader={SONG_WALL_FRAG}
                    uniforms={brickUniforms}
                    transparent={true}
                />
            </mesh>

            {/* === CREEPER INK (its own layer, in front of the 春联) ===
                Same quad as the facade, 0.03 in front of it, so the vine draws
                over anything mounted flat on the wall — which is the whole
                point: a real creeper stands proud of the plaster and a paper
                couplet does not. renderOrder 7 puts it above the couplets (6)
                and below the tree (8), and because it never writes depth the
                tree still wins wherever it is opaque.

                The wall shader is handed uInkStrength 0, so the ink is drawn
                exactly once — here. See INK_OVERLAY_FRAG for the reasoning. */}
            <mesh position={[0, facadeCenterY, INK_OVERLAY_Z]} renderOrder={7}>
                <primitive object={sharedGeometry('plane', FACADE_W, FACADE_H)} attach="geometry" />
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
            {/* AVATAR - separate from the window group, parked behind the bricks.
                `depthWrite={false}` stops its transparent margin from punching a
                depth hole through the curtain behind it, and z = 0.06 puts the
                figure in front of the curtain panels (-0.01) while staying
                behind the brick facade (0.15) so the wall hides it at rest.

                ⚠️ y is NOT decorative. The illustration is a half-body pose that
                is CROPPED AT ITS OWN BOTTOM EDGE — the ink runs to y=1023 of a
                1024px canvas (see the note in the texture pipeline). At 0.04 the
                ink bottom landed exactly on the window opening's bottom edge, so
                a good 0.29 world units of trouser showed and read as a pair of
                severed legs sitting on the sill. The user's report was exactly
                that: "断腿露出来了". -0.16 pushes that hard cut behind the
                frame's bottom rail and leaves only the hip, which reads as a
                person standing at the window.
                The head still clears the top rail comfortably at this height —
                measured, not guessed: see .workbuddy-ai/round2-2026-10-08/
                avatar-y-*.png. */}
            <mesh
                ref={windowAvatarRef}
                position={[AVATAR_REST_X, -0.16, 0.06]}
                rotation={[0, 0, 0]}
            >
                <primitive object={sharedGeometry('plane', 1.5, 1.5)} attach="geometry" />
                <meshBasicMaterial color="#e0e0e0"
                    map={avatarWindowTexture}
                    transparent={true}
                    depthWrite={false}
                />
            </mesh>

            {/* WINDOW - rustic wooden frame, positioned to the right of doors */}
            <WoodenWindowFrame position={[WINDOW_X, 0, 0.25]} />

            {/* Stable hover target for the window.
                The enter/leave handlers used to live on WoodenWindowFrame's
                group, whose raycast target is only the four planks plus the thin
                cross mullions. Crossing one of the four open panes dropped the
                hit, fired onPointerLeave and yanked the avatar straight back out
                — the "peeks out for a split second then runs back" flicker.
                One invisible plane covering the whole opening keeps the hover
                state rock solid. */}
            <mesh
                position={[WINDOW_X, 0.06, 0.45]}
                onPointerEnter={handleWindowEnter}
                onPointerLeave={handleWindowLeave}
            >
                <primitive object={sharedGeometry('plane', 1.9, 1.9)} attach="geometry" />
                <meshBasicMaterial color="#e0e0e0" transparent opacity={0} depthWrite={false} />
            </mesh>

            {/* Curtain + interior, seen through the window opening (behind the
                brick plane). Pulled back to z = -0.03 so the character can stand
                in front of the fabric panels instead of being swallowed by them. */}
            <WindowCurtain position={[WINDOW_X, 0, -0.03]} />

            {/* DUCK PLANTER (Right Side - Under Window) — rustic wood, green plant, 3D duck.
                Sits on the OUTDOOR grade (the lawn), not on the floor — the lawn
                is 0.30 below the floor now, so anything standing on it has to
                move with OUTDOOR_Y or it floats. */}
            <group position={[2.5, OUTDOOR_Y, 0.4]}>
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





            {/* TREE & WIND CHIME (Left Side) */}
            <group position={[-2.9, floorY + 2.7, 1]}>
                {/* Tree.

                    ⚠️ renderOrder 8 — deliberately ABOVE the couplets (6) and
                    the creeper ink layer (7).

                    The tree plane is a billboard parked at z = 1, i.e. a full
                    0.85 units in FRONT of the 10x6 facade at z = 0.15, so it
                    really is nearer the camera than the 春联 at z = 0.17. But
                    both materials are `transparent` with `depthWrite: false`,
                    and three sorts the transparent pass by renderOrder BEFORE
                    it sorts by depth — so with the tree at the default 0 the
                    couplets were painted on top of it and read as pasted over
                    the trunk. Giving the tree 8 puts the ordering back the
                    right way round. (2026-10-09 user note: 「对联：应该在树和藤
                    的后面」.)

                    Depth testing still applies inside the pass, so this cannot
                    make the tree paint over the chime or the dog: those are
                    opaque, drawn in the opaque pass, and they are nearer. */}
                <mesh position={[0, 0, 0]} renderOrder={8}>
                    <primitive object={sharedGeometry('plane', 6, 8)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0"
                        map={treeTexture}
                        transparent={true}
                        alphaTest={0.01}
                        depthWrite={false}
                    />
                </mesh>
                {/* Wind chime hanging from the right scaffold (replaces the mouse picture).

                    ⚠️ The string top is the group origin, so this position has
                    to land ON a branch — it is not a "roughly around here".

                    It used to be [0.45, 0.15], which is canvas (441.6, 492.8)
                    on the 768x1024 tree texture. That looks like it is on the
                    little arm authored for it (LIMBS[12], canvas 396,578 ->
                    450,486), and it is within a few pixels of the arm's centre
                    line — but the arm is *under the canopy*: probing the
                    texture at the arm's vertices gives bark at 12.0 and 12.2 and
                    leaf at 12.1 and 12.3. The chime was hanging from a branch
                    nobody can see, so it read as floating in the gap between the
                    trunk and the right scaffold.

                    [0.75, -0.4375] is canvas (480, 568) = vertex 4.2 of the
                    RIGHT SCAFFOLD (LIMBS[4]), which probes clean bark
                    rgb(94,61,32) at the vertex and at all four ring samples.
                    Its half-width there is 16.6 canvas px = 0.13 world units,
                    just wider than the chime's 0.11 cap — so the cap reads as
                    narrower than the branch it hangs from, which is the whole
                    point. (2026-10-09 user note: 「风铃：调整下挂的位置，让它挂到
                    树枝上」.) */}
                <WindChime position={[0.75, -0.4375, 0.05]} />
            </group>

            {/* STONE TABLE + TWO STOOLS —— 树下、树跟前（用户 2026-10-09 定）。
                树干在 local x ≈ -2.82（见 entranceArt 的 trunk 骨架：canvas 394
                按 128 px/单位 折回来，再加上树组自己的 -2.9）；树是一张 billboard
                平面停在 z = 1，所以摆在 z > 1 的一侧就是"树跟前"。
                脚下是**草坪**不是甬路 —— 用 GRASS_Y（比 OUTDOOR_Y 低 4 cm，
                见 entranceMetrics 的 GROUND_DROP）。 */}
            <StoneTable position={[-2.78, GRASS_Y, 1.62]} />

            {/* WHITE DOG (Front Facing) — 3D procedural, blinking eyes, wagging tail.
                On the lawn, clear of the 台明 (which is only APRON_W wide). */}
            <WhiteDog position={[-1.5, OUTDOOR_Y, 0.8]} yaw={DOG_YAW} />

        </group>
    );
};

export default EntranceDoors;
