import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import SpatialSfx from '../audio/SpatialSfx';
import * as THREE from 'three';
import gsap from 'gsap';
import RoomInterior from './RoomInterior';
import '../shaders/RevealMaterial'; // Registers alpha-discard reveal shader
import { useScene } from '../../../context/SceneContext';
import { useSitePreferences } from '../../../context/SitePreferences';
import { SCENE_FONTS, TEXT } from '../../../config/theme';
import { useAchievements } from '../../../context/AchievementsContext';
import { useAudio } from '../../../context/AudioManager';
import { isTouchDevice } from '../../../utils/deviceDetect';
import { setGuitarCursor } from '../../../utils/guitarCursor';
import { showToast } from '../../../utils/toast';
import {
    makeRoomDoorTexture,
    makeRoomDoorFrameTexture,
    makeRoomDoorBackTexture,
    seedFromString,
} from '../../../utils/doorArt';
import {
    makeRoomDoorHandleTexture,
    makeDoorArrowTexture,
    makeWoodenSignTexture,
    SIGN_BOARD_W,
    SIGN_BOARD_H,
} from '../../../utils/corridorArt';
import { trimTexture } from '../../../utils/proceduralTextures';
import { INK_WALL_FRAG, makeRoomMaterial, WORLD_UV_VERT } from '../../../shaders/roomSurfaces';
import { reducedMotion } from '../../../hooks/useReducedMotion';
import { settleLerp, SETTLE_ANGLE } from '../../../utils/settle';
import { sharedGeometry } from '../../../engine/resources';

/**
 * prefers-reduced-motion 下所有门/镜头过场动画的时长倍率。
 *
 * 为什么不是 0：进门这条链上每一步都靠 gsap 的 `onComplete` 推进
 * （开门 → 相机飞入 → setTimeout → enterRoom），把时长设成 0 会让整条链
 * 在一帧里跑完 —— 状态机也许还能走通，但 `camera.position` / `camera.rotation`
 * 的多次写入被压进同一帧，非常容易出竞态（而且 three 的矩阵更新时机不可控）。
 * 0.12 大约等于两帧：观感上就是一次硬切，而每个 onComplete 仍然按顺序、
 * 分帧触发。
 */
const TRANSITION_SCALE = 0.12;

/** 按当前动态偏好缩放一个 gsap 时长。 */
const dur = (base) => (reducedMotion() ? base * TRANSITION_SCALE : base);

/**
 * The ink wash that covers the corridor walls (shaders/roomSurfaces.js).
 *
 * Every door bay wears the SAME material — the variation between them lives in
 * the baked UVs of each wall geometry, not in the shader — so one instance
 * serves all eight doors instead of eight identical programs.
 */
let inkWallMaterial = null;
const getInkWallMaterial = () => {
    if (!inkWallMaterial) {
        inkWallMaterial = makeRoomMaterial(INK_WALL_FRAG, DOOR_Z_SPAN, CORRIDOR_HEIGHT, {}, WORLD_UV_VERT);
    }
    return inkWallMaterial;
};

/**
 * Feedback for a door click that arrives while the door is mid-animation.
 * Room names are not used here on purpose: the message is about the door being
 * busy, which is independent of which door it is.
 */
const DOOR_TOAST = {
    busy: { zh: '门还在动，稍等一下', en: 'Still opening — one moment' },
};

/**
 * The three taped paper notes (music / AI / code) that used to sit on every
 * room door leaf were removed on 2026-10-08 at the user's request
 * ("房门上的贴纸去掉"). `makeTapedNoteTexture` is still exported by doorArt.js
 * for the entrance door's taped-note variant, so nothing there changes.
 */

// Constants from CorridorSegment
const WALL_X_OUTER = 3.5;
const WALL_X_INNER = 1.7;
const DOOR_Z_SPAN = 4;
const CORRIDOR_HEIGHT = 3.5;

const DOOR_AUDIO_SETTINGS = {
    hoverVolume: 0.8, // Volume for "uchyleniedrzwi" (hovering the door)
    openVolume: 0.2,  // Volume for "otwarciedrzwi" (opening the door fully)
    closeVolume: 0.35, // Volume when the door closes. Raised above openVolume on purpose:
    // the close cue fires 0.5s later and further away, so the exponential rolloff
    // (refDistance 3, rolloff 2) had been burying it under the open/hover cues.
    distance: 3,      // Reference distance for spatial audio before it starts dropping off
    rolloff: 2,       // How fast the sound fades away (exponential)
    closeDelay: 0.5   // Seconds to wait before playing the close door sound
};

// Calculate sawtooth wall geometry
const WALL_DX = WALL_X_OUTER - WALL_X_INNER; // 1.8
const WALL_DZ = DOOR_Z_SPAN; // 4
const WALL_LENGTH = Math.sqrt(WALL_DX * WALL_DX + WALL_DZ * WALL_DZ);
const BASE_WALL_ANGLE = Math.atan2(WALL_DX, WALL_DZ); // Sawtooth angle (~24 degrees)

// Camera look-at angle when aligning with door (adjust this to fix alignment)
// Math.PI * 0.33 is ~60 degrees
const DOOR_LOOK_ANGLE = Math.PI * 0.334;

// Camera X offset when aligning with door (adjust this to move camera left/right relative to door)
// Higher value = further from door center horizontally
const DOOR_ALIGN_X = 1.2;

// Room doors are procedural now (utils/doorArt.js). The per-room door bitmaps
// (`drzwi*_painted.webp`) and their baked-in icon notes are gone; every door
// shares the same code-drawn leaf plus the three taped notes below.


/**
 * DoorSection Component
 * 
 * Groups the angled wall + door + label as one unit.
 * Uses 2D textures for door, frame, and handle (like entrance doors).
 * Pivots from the OUTER edge (where wall connects to corridor).
 * Dynamic tilt: starts nearly flat, tilts more when camera approaches.
 */
const DoorSection = ({
    position, // [x, y, z] - center of the wall segment
    side = 'left',
    label,
    roomId, // ID for context updates (gallery, studio, etc)
    icon,
    onEnter,
    autoCloseDelay = 3000,
    enterDistance = 8, // Default fly-through distance
    setCameraOverride, // Function to take control of camera from hook
    segmentIndex,
    segmentLength = 80 // Passed down so this door can work out where the camera is
}) => {
    const groupRef = useRef(); // Main group that tilts
    const doorRef = useRef();
    const handleRef = useRef();
    const doorMaterialRef = useRef(); // RevealMaterial ref for door sketch
    const handleMaterialRef = useRef(); // RevealMaterial ref for handle sketch
    const handlePaintedRef = useRef(); // Painted handle mesh visibility
    const doorPaintedRef = useRef(); // Painted door mesh visibility
    const handleHideDelayRef = useRef(); // Track pending gsap.delayedCall for handle visibility
    const [isHovered, setIsHovered] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const isNearRef = useRef(false);
    const [isInsideRoom, setIsInsideRoom] = useState(false);
    const [isTiltLocked, setIsTiltLocked] = useState(false); // Lock tilt when entering room
    const [shouldRenderRoom, setShouldRenderRoom] = useState(false); // Lazy loading state
    const [roomReady, setRoomReady] = useState(false); // Room signaled it's ready
    const { camera } = useThree();
    const { language } = useSitePreferences();
    const closeTimerRef = useRef(null);
    const loadTimeoutRef = useRef(null); // Ref for the room loading fallback timeout

    // Get exit request signal from context
    const {
        currentRoom, // We need to know if the global room changed (teleportation)
        exitRequested,
        clearExitRequest,
        exitRoom: contextExitRoom,
        enterRoom,
        pendingDoorClick,
        isTeleporting,
        isFastTeleport,
        signalRoomReady,
        teleportPhase, // We need this to delay reset until curtain is closed
        setDoorBusy
    } = useScene();

    const { unlockAchievement } = useAchievements();
    const { globalVolume, isMuted } = useAudio();

    // Audio Refs for 3D positional sound
    const hoverAudioRef = useRef();
    const openAudioRef = useRef();
    const closeAudioRef = useRef();

    // Map label to ID for teleport matching.
    // CorridorSegment always passes `roomId` (built from ROOMS in config/theme),
    // so the old label-based fallback below was unreachable dead code and has
    // been removed along with the CabinSketch font it referenced.
    const doorId = roomId ?? null;

    // Listen for pending door click (auto-click after teleport)
    useEffect(() => {
        // The same room is mounted more than once at a time: rooms repeat
        // around the corridor ring (see LOOP_SPACES in CorridorSegment), and
        // the manager keeps three segments alive, so e.g. `videos` exists in
        // both segment 1 and segment -1. Matching on a hardcoded segment
        // number would (a) miss every copy but that one and (b) fire on the
        // wrong copy whenever the camera happens to be further along the ring.
        //
        // The only copy that should react is the one the camera is standing
        // in. `camera.position.z` is read live here rather than tracked, which
        // is exactly right: this runs at the moment the teleport publishes its
        // pending click, after the camera has already been placed.
        const cameraSegment = Math.floor((10 - camera.position.z) / segmentLength);
        const isTargetDoor = segmentIndex === cameraSegment;

        if (pendingDoorClick && pendingDoorClick === doorId && isTargetDoor && !isOpen && !isAnimating) {
            handleClick({ stopPropagation: () => { }, isTeleport: true }); // Trigger click simulation with TELEPORT flag
        }
    }, [pendingDoorClick, doorId, segmentIndex, segmentLength, isOpen, isAnimating]);

    // --- SILENT RESET FOR TELEPORTATION ---
    // If a teleport starts (users clicks map), and we are inside THIS room,
    // we must silently reset our state so we are "outside" and "closed"
    // BUT only after the curtain is closed (phase === 'teleporting').
    useEffect(() => {
        // FIX: Added (currentRoom === doorId) check to ensure we only reset the OLD room
        // FIX: Added (teleportPhase === 'teleporting') to wait for curtain to close
        if (isTeleporting && teleportPhase === 'teleporting' && isInsideRoom && currentRoom === doorId) {
            // console.log(`[DoorSection ${label}] Silent Reset triggered by teleport (Old Room)`);

            // 1. Reset Internal State immediately
            setIsOpen(false);
            setIsInsideRoom(false);
            setIsAnimating(false);
            setShouldRenderRoom(false); // Unmount room content
            setIsTiltLocked(false);
            setRoomReady(false);
            roomReadyRef.current = false;

            // 2. Reset Door/Handle Rotation (Visuals)
            // We can do this instantly or very quickly since screen is covered
            if (doorRef.current) doorRef.current.rotation.y = 0;
            if (handleRef.current) handleRef.current.rotation.z = 0;

            // 3. Reset Camera Override 
            // Important: DO NOT RELEASE control here. 
            // Experience.jsx manages the override during "isTeleporting".
            // If we release it here, useInfiniteCamera takes over before the new room is ready.
            // setCameraOverride?.(false); <--- REMOVED

            // 4. Reset Timers
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        }
    }, [isTeleporting, teleportPhase, isInsideRoom, currentRoom, doorId, label, setCameraOverride]);

    // Save camera state before entering room (for ESC exit)
    // Save camera state before entering room (for ESC exit)
    // Now saving FULL rotation (x, y, z) to prevent snap on exit
    const savedCameraState = useRef({ x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0 });
    // Save position ALIGNED with door (intermediate step for exit)
    const doorAlignedState = useRef({ x: 0, y: 0, z: 0, rotationY: 0 });
    // Save position after flying through corridor (before final rotation) 
    const roomEntryState = useRef({ x: 0, y: 0, z: 0, rotationY: 0 });

    // Dynamic tilt state
    const currentTilt = useRef(0);

    // The wall these doors sit in carries the corridor's ink wash
    // (INK_WALL_FRAG, see shaders/roomSurfaces.js) rather than a flat colour,
    // so the mural runs unbroken from the flat panels across every door bay.
    // The wall geometry is what carries the variation, so the material itself
    // is shared by all eight doors — see getInkWallMaterial() above.

    // Load door textures - use the right texture based on label
    const isTouch = isTouchDevice();

    // Doors are 100% procedural canvas art now (utils/doorArt.js): the plank
    // leaf, architrave, hinges and the three taped notes are all drawn in
    // code, so no room-door bitmap is fetched any more.
    const doorVariant = isTouch ? 'sketch' : 'painted';
    const doorSeed = seedFromString(doorId);
    const doorTexture = makeRoomDoorTexture('sketch', doorSeed);
    const doorPaintedTexture = makeRoomDoorTexture('painted', doorSeed);
    const frameTexture = makeRoomDoorFrameTexture(doorVariant);
    const doorBackTexture = makeRoomDoorBackTexture(doorVariant);
    const dummyTex = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const handleTexture = makeRoomDoorHandleTexture('sketch');
    const handlePaintedTexture = isTouch ? dummyTex : makeRoomDoorHandleTexture('painted');
    const arrowTexture = makeDoorArrowTexture();

    // Baseboard texture for door sections — the same procedural trim strip the
    // corridor walls use (utils/proceduralTextures.js), so the profile lines
    // up where the two meet. Cloned before configuring: never mutate the
    // cached original.
    const baseboardTexture = useMemo(
        () => trimTexture('corridor-baseboard'),
        []
    );

    // Pre-create baseboard textures via useMemo (same pattern as legTexture above)
    const doorBoardWidth = (WALL_LENGTH - 1.1) / 2;
    const NATURAL_TILE_W = (1582 / 94) * 0.15; // = 2.524 units per natural tile
    const doorBbTexLeft = useMemo(() => {
        const tex = baseboardTexture.clone();
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.rotation = 0; // Reset rotation (shared texture may have PI/2 from threshold)
        tex.offset.set(0, 0);
        tex.needsUpdate = true;
        tex.repeat.set(doorBoardWidth / NATURAL_TILE_W, 1);
        return tex;
    }, [baseboardTexture]);

    const doorBbTexRight = useMemo(() => {
        const tex = baseboardTexture.clone();
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.rotation = 0; // Reset rotation (shared texture may have PI/2 from threshold)
        tex.offset.set(0, 0);
        tex.needsUpdate = true;
        tex.repeat.set(doorBoardWidth / NATURAL_TILE_W, 1);
        return tex;
    }, [baseboardTexture]);

    // Door dimensions - based on legacy texture aspect ratio (approx 0.376)
    const doorRatio = doorId === 'studio' ? 0.388 : 0.376;
    const doorHeight = 2.5;
    const doorWidth = doorHeight * doorRatio * 1.12;

    // Frame dimensions - based on legacy ratio 762/1759 (0.433)
    const frameHeight = 2.5;
    const frameWidth = frameHeight * 0.5;

    // Hole dimensions - MUST fit inside wall
    const holeWidth = doorWidth - 0.03;
    const holeHeight = doorHeight - 0.1;
    const holeOffsetY = -0.55; // Same as door group Y offset

    // Tilt parameters
    const BASE_ROTATION = Math.PI / 2; // 90 degrees - side wall orientation
    const BASE_TILT = 0.02;   // ~1 degree additional tilt towards camera
    const MAX_TILT = BASE_WALL_ANGLE + 0.1; // Sawtooth angle + extra (~27 degrees total tilt)
    const TILT_START = 15;    // Start tilting when camera is 15 units away
    const TILT_PEAK = 3;      // Max tilt at 3 units

    // Pivot offset - the group pivots from the OUTER edge
    const pivotX = side === 'left' ? -WALL_X_OUTER : WALL_X_OUTER;

    // Wall offset from pivot - wall extends FROM pivot INWARD
    const wallOffsetX = side === 'left'
        ? WALL_LENGTH / 2
        : -WALL_LENGTH / 2;

    // Create wall geometry with door hole
    //
    // NOTE the position: this block has to sit BELOW `wallOffsetX`. It bakes
    // that offset into the UVs, and `const` is hoisted but not initialised, so
    // reading it from a useMemo declared higher up throws
    // "Cannot access 'wallOffsetX' before initialization" and takes the whole
    // scene down with it. It used to live next to the door dimensions, where
    // the dependency looked local and the crash was invisible.
    //
    // The wall wears the same ink wash as the corridor's flat panels, and
    // ShapeGeometry hands us UVs already in shape-space METRES — so all that is
    // left is to slide them onto the corridor's world coordinates:
    //   uv.x -> world Z (metres along the corridor)
    //   uv.y -> metres above the floor
    //
    // The sawtooth group is rotated AND scaled so the wall's Z-projection is
    // always exactly DOOR_Z_SPAN (see the useFrame below). Because the scale is
    // derived from that, `scale * sin(angle)` is the constant
    // DOOR_Z_SPAN / WALL_LENGTH at every tilt — so world Z stays a fixed linear
    // function of the shape-space x, and the mural lines up with the flat
    // panels no matter how far the bay has tilted toward the camera.
    const wallWorldZ = position[2];
    const wallWithHoleGeometry = useMemo(() => {
        // Create wall shape
        const wallShape = new THREE.Shape();
        const halfW = WALL_LENGTH / 2;
        const halfH = CORRIDOR_HEIGHT / 2;

        wallShape.moveTo(-halfW, -halfH);
        wallShape.lineTo(halfW, -halfH);
        wallShape.lineTo(halfW, halfH);
        wallShape.lineTo(-halfW, halfH);
        wallShape.lineTo(-halfW, -halfH);

        // Create hole for door
        const holePath = new THREE.Path();
        const holeHalfW = holeWidth / 2;
        const holeHalfH = holeHeight / 2;
        const holeY = holeOffsetY; // Center of hole

        holePath.moveTo(-holeHalfW, holeY - holeHalfH);
        holePath.lineTo(holeHalfW, holeY - holeHalfH);
        holePath.lineTo(holeHalfW, holeY + holeHalfH);
        holePath.lineTo(-holeHalfW, holeY + holeHalfH);
        holePath.lineTo(-holeHalfW, holeY + holeHalfH);
        holePath.lineTo(-holeHalfW, holeY - holeHalfH);

        wallShape.holes.push(holePath);

        const geo = new THREE.ShapeGeometry(wallShape);

        const k = (DOOR_Z_SPAN - 0.01) / WALL_LENGTH;
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            const vx = uv.getX(i);       // shape-space metres, -WALL_LENGTH/2 .. +
            const vy = uv.getY(i);
            const worldZ = side === 'left'
                ? wallWorldZ - (wallOffsetX + vx) * k
                : wallWorldZ + (wallOffsetX + vx) * k;
            uv.setXY(i, worldZ, vy + CORRIDOR_HEIGHT / 2);
        }
        uv.needsUpdate = true;
        return geo;
    }, [holeWidth, holeHeight, holeOffsetY, wallWorldZ, side, wallOffsetX]);

    // Force shader compilation: let the painted versions render for 2 frames during preloader, then hide
    const compileFramesRef = useRef(0);
    useFrame(() => {
        // === SHADER COMPILE (first 2 frames only) ===
        if (compileFramesRef.current < 2) {
            compileFramesRef.current++;
            if (compileFramesRef.current === 2) {
                if (!isHovered && !isOpen) {
                    if (doorPaintedRef.current) doorPaintedRef.current.visible = false;
                    if (handlePaintedRef.current) handlePaintedRef.current.visible = false;
                }
            }
        }

        // === TILT ANIMATION ===
        if (!groupRef.current) return;

        let targetTilt = BASE_TILT;

        // If tilt is locked (clicked/entering), force it to MAX_TILT (fully facing user)
        if (isTiltLocked) {
            targetTilt = MAX_TILT;
        } else {
            // Normal proximity-based tilting
            const distance = Math.abs(camera.position.z - position[2]);
            isNearRef.current = distance < 8;

            if (distance < TILT_START && distance > TILT_PEAK) {
                const t = (TILT_START - distance) / (TILT_START - TILT_PEAK);
                const easedT = t * (2 - t); // easeOutQuad
                targetTilt = BASE_TILT + (MAX_TILT - BASE_TILT) * easedT;
            } else if (distance <= TILT_PEAK) {
                targetTilt = MAX_TILT;
            }
        }

        // Smooth interpolation.
        //
        // settleLerp 而不是裸 lerp：targetTilt 是相机距离的连续函数，而裸 lerp
        // 永远只是逼近 —— 相机站住之后这一整片门扇（89 个 mesh）还会以每帧
        // 1e-9 的量继续转下去，`prefers-reduced-motion` 下"场景应当静止"
        // 就永远不成立。见 utils/settle.js。
        //
        // prefers-reduced-motion 下**连缓动一起去掉**，直接取目标值：
        // 缓动本身就是"用户已经停手、画面还在动"的那一部分。去掉之后门开间
        // 的角度是相机距离的纯函数 —— 用户一停，它就停，没有任何尾巴。
        currentTilt.current = reducedMotion()
            ? targetTilt
            : settleLerp(currentTilt.current, targetTilt, 0.06, SETTLE_ANGLE);

        // Apply rotation: BASE_ROTATION (90°) + dynamic tilt
        const baseDir = side === 'left' ? 1 : -1;
        const tiltDir = side === 'left' ? -1 : 1;

        // Calculate the actual rotation angle
        const currentRotation = (BASE_ROTATION * baseDir) + (currentTilt.current * tiltDir);
        groupRef.current.rotation.y = currentRotation;

        // Trigonometric Scaling Fix:
        // We want the Z-projection of the wall to ALWAYS be exactly DOOR_Z_SPAN (4.0m).
        // Formula: Scale = DOOR_Z_SPAN / (WALL_LENGTH * sin(Angle))

        const absSinAngle = Math.abs(Math.sin(currentRotation));

        // Safety to prevent division by zero (angle is clamped ~60-90 deg)
        let exactScale = 1.0;
        if (absSinAngle > 0.1) {
            // -0.01 safety margin to prevent Z-fighting on the exact edge
            exactScale = (DOOR_Z_SPAN - 0.01) / (WALL_LENGTH * absSinAngle);
        }

        // Clamp scale to avoid explosion if math goes wrong, but allow gentle flex
        const currentScale = THREE.MathUtils.clamp(exactScale, 0.8, 1.1);

        groupRef.current.scale.set(currentScale, 1, 1);
    });

    useEffect(() => {
        return () => {
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
            if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
        };
    }, []);

    const handleClick = useCallback((e) => {
        // e might be null or synthetic from teleport
        e?.stopPropagation?.();
        const isTeleport = e?.isTeleport || false;
        if (isAnimating) {
            // A real click landing mid-animation was silently swallowed, which
            // reads as a dead door. Only speak up for genuine user input — the
            // teleport path calls this programmatically and must stay quiet.
            if (!isTeleport) {
                showToast(DOOR_TOAST.busy[language]);
            }
            return;
        }

        if (isOpen) {
            closeDoor();
            return;
        }

        // Reset cursor on transition
        setGuitarCursor('auto');

        setIsAnimating(true);

        // Take control of camera from hook
        setCameraOverride?.(true);

        // Lock tilt so the corridor doesn't rotate while we fly through
        setIsTiltLocked(true);

        // Save camera state BEFORE entering (for ESC exit)
        savedCameraState.current = {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            rotationX: camera.rotation.x,
            rotationY: camera.rotation.y,
            rotationZ: camera.rotation.z
        };

        // If this is a TELEPORT entry, overwrite the saved state with a "Safe Corridor Position"
        // This prevents the camera from jumping back to the OLD room position on exit.
        if (e && e.isTeleport) {
            // Use a NATURAL corridor glance angle (~8.5 degrees), NOT the intense door-aligned angle (60°)
            // This creates a visible head turn: from looking at door (60°) → subtle corridor glance (8.5°)
            // The angle is smaller because we end up 4m back from the door, not right next to it
            const corridorGlanceY = side === 'left' ? 0.15 : -0.15;

            savedCameraState.current = {
                x: 0,
                y: 0.2, // Correct height matching useInfiniteCamera
                z: position[2] + 4, // 4 meters back from the door Z
                rotationX: 0,
                rotationY: corridorGlanceY, // Natural corridor glance, not intense door stare
                rotationZ: 0
            };
        }

        // FAST TELEPORT: Use ultra-fast animation durations (almost instant)
        // The paper is closed so user won't see the fast motion
        const useFastMode = isTeleport && isFastTeleport;
        // `dur()` 在 prefers-reduced-motion 下把 1.0s 的对准镜头压成一次硬切 ——
        // 相机横向平移 1.2 单位再转 60° 是这个站最强烈的晕动诱因。
        const alignDuration = useFastMode ? 0.01 : dur(1.0);

        // Get door world position.
        // Everything from here on is unguarded arithmetic on the door group, so
        // bail out cleanly if it isn't mounted. isAnimating is already true at
        // this point, and abandoning the handler without clearing it would leave
        // this door unclickable for the rest of the session.
        if (!groupRef.current) {
            setIsAnimating(false);
            setIsTiltLocked(false);
            return;
        }
        const doorWorldPos = new THREE.Vector3();
        groupRef.current.getWorldPosition(doorWorldPos);

        // Camera moves to be at door's Z level (so door is centered when we look at it)
        // and slightly towards the door's side
        const cameraTargetZ = doorWorldPos.z;
        const cameraTargetX = side === 'left' ? DOOR_ALIGN_X : -DOOR_ALIGN_X;

        // Calculate the target rotation to look at the door
        // We need to account for the camera PARENT's rotation (sway), so we get a consistent WORLD angle
        // Current Sway (Parent Rotation) + Camera Rotation = World Rotation
        // World Rotation Target = DOOR_LOOK_ANGLE
        // Camera Target = World Target - Parent Rotation

        let parentRotationY = 0;
        if (camera.parent) {
            // Get parent's world rotation Y (approximate, assuming mostly Y rotation for sway)
            const parentWorldQuat = new THREE.Quaternion();
            camera.parent.getWorldQuaternion(parentWorldQuat);
            const parentEuler = new THREE.Euler().setFromQuaternion(parentWorldQuat, 'YXZ');
            parentRotationY = parentEuler.y;
        }

        const worldTargetRotationY = side === 'left'
            ? DOOR_LOOK_ANGLE   // Target WORLD angle
            : -DOOR_LOOK_ANGLE; // Target WORLD angle

        // Compensate for parent sway to get consistent local rotation
        const targetRotationY = worldTargetRotationY - parentRotationY;

        // Store initial rotation
        const startRotationY = camera.rotation.y;

        // Create a proxy object for the rotation animation
        const rotationProxy = { y: startRotationY };

        // Animate camera position and rotation simultaneously
        gsap.to(camera.position, {
            x: cameraTargetX,
            z: cameraTargetZ,
            duration: alignDuration,
            ease: useFastMode ? 'none' : 'power2.inOut'
        });

        gsap.to(rotationProxy, {
            y: targetRotationY,
            duration: alignDuration,
            ease: useFastMode ? 'none' : 'power2.inOut',
            onUpdate: () => {
                camera.rotation.y = rotationProxy.y;
            },
            onComplete: () => {
                // Save aligned state for reverse animation
                doorAlignedState.current = {
                    x: camera.position.x,
                    y: camera.position.y,
                    z: camera.position.z,
                    rotationY: camera.rotation.y
                };

                // Lazy Load Room:
                // 1. Camera is now aligned.
                // 2. Start rendering the room.
                // 3. Door will open when room signals ready via onReady callback
                //    OR after fallback timeout for rooms without onReady support
                setShouldRenderRoom(true);

                // During FAST teleport, we still want to WAIT for the room to be ready!
                // So we do NOT open immediately anymore. We let the onReady callback handle it.
                // But we still set the flag so handleRoomReady knows to use fast animation.

                // Fallback: If room doesn't call onReady within 8000ms, open door anyway
                // This ensures all rooms work even if they don't implement onReady
                loadTimeoutRef.current = setTimeout(() => {
                    if (!roomReadyRef.current) {
                        console.warn(`[DoorSection ${label}] Room load timeout - forcing open`);
                        roomReadyRef.current = true;
                        setRoomReady(true);
                        // If it timed out, we still use the current mode preference
                        openDoor(useFastMode);
                    }
                }, 8000);
            }
        });
    }, [camera, side, isOpen, isAnimating, setCameraOverride, isFastTeleport]);

    const openDoor = useCallback((fastMode = false) => {
        // If the door group isn't mounted we cannot run the fly-in, but we MUST
        // still release the entry lock. `handleClick` set isAnimating = true
        // before the room started loading, and this callback is the only place
        // that clears it. Bailing out here used to leave isAnimating stuck true
        // forever, which makes handleClick ignore every later click on this door
        // — the room becomes permanently unenterable.
        if (!doorRef.current) {
            setIsAnimating(false);
            setIsTiltLocked(false);
            return;
        }

        setIsOpen(true);
        const openAngle = side === 'left' ? Math.PI * 0.6 : -Math.PI * 0.6;

        if (!fastMode && openAudioRef.current) {
            const vol = isMuted ? 0 : DOOR_AUDIO_SETTINGS.openVolume * globalVolume;
            openAudioRef.current.setVolume(vol);
            if (openAudioRef.current.isPlaying) openAudioRef.current.stop();
            openAudioRef.current.play();
        }

        // FAST MODE: Ultra-fast durations for teleport entry
        const handleDuration = fastMode ? 0.01 : dur(0.15);
        const doorDuration = fastMode ? 0.01 : dur(0.7);
        const flyDuration = fastMode ? 0.01 : dur(1.5);

        // Animate handle down first
        if (handleRef.current) {
            gsap.to(handleRef.current.rotation, {
                z: side === 'left' ? 0.4 : -0.4,
                duration: handleDuration,
                ease: fastMode ? 'none' : 'power2.out'
            });
        }

        gsap.to(doorRef.current.rotation, {
            y: openAngle,
            duration: doorDuration,
            ease: fastMode ? 'none' : 'power2.out',
            onComplete: () => {
                // Door is open, now fly camera through the door
                // Get the direction the camera is looking AT THE START
                const direction = new THREE.Vector3();
                camera.getWorldDirection(direction);

                const flyDistance = enterDistance; // Fly through short vestibule (3) + into room

                // Calculate TARGET position BEFORE animating (so flight path is straight)
                const targetX = camera.position.x + direction.x * flyDistance;
                const targetZ = camera.position.z + direction.z * flyDistance;

                // STEP 1: Fly camera forward in a STRAIGHT LINE
                gsap.to(camera.position, {
                    x: targetX,
                    z: targetZ,
                    duration: flyDuration,
                    ease: fastMode ? 'none' : 'power2.inOut',
                    onComplete: () => {
                        // Save position AFTER flight
                        roomEntryState.current = {
                            x: camera.position.x,
                            y: camera.position.y,
                            z: camera.position.z,
                            rotationY: camera.rotation.y
                        };

                        // NO ROTATION needed - we are already looking perpendicular to corridor
                        // Just mark as inside
                        setIsAnimating(false);
                        setIsInsideRoom(true);

                        // Defer context update exactly 250ms to strictly avoid any
                        // stutter during the very last frames of the GSAP animation loop.
                        setTimeout(() => {
                            enterRoom(doorId); // Use ID ('gallery') not label ('THE GALLERY')
                            onEnter?.();

                            // FAST TELEPORT: Signal that room is ready - this opens the paper
                            if (fastMode) {
                                signalRoomReady();
                            }
                        }, 250);
                    }
                });
            }
        });
    }, [side, onEnter, camera, enterRoom, doorId, signalRoomReady]);

    // Handle room ready callback - open door when room is fully loaded
    // Use ref to prevent multiple calls (state might not update fast enough)
    const roomReadyRef = useRef(false);

    const handleRoomReady = useCallback(() => {
        // Guard: only call openDoor once
        if (roomReadyRef.current) return;

        // Clear the fallback timeout since we are ready
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);

        roomReadyRef.current = true;
        setRoomReady(true);
        // Use the current context state to decide if we should do a fast open
        openDoor(isFastTeleport);
    }, [openDoor, isFastTeleport]);

    // Exit room function - TRUE REVERSE animation (like rewinding video)
    const exitRoom = useCallback(() => {
        if (!isInsideRoom || isAnimating) return;

        setIsAnimating(true);

        const saved = savedCameraState.current;
        const aligned = doorAlignedState.current;

        // Store current rotation as starting point for exit
        // This captures the "tilted" state if coming from About/Flight
        const startRotation = {
            x: camera.rotation.x,
            y: camera.rotation.y,
            z: camera.rotation.z
        };

        // REVERSE STEP 1: Walk backwards through corridor to ALIGNED position (in front of door)
        // AND smoothly rotate to "aligned" state (level horizon)

        // Proxy for Step 1 rotation
        const step1RotationProxy = { ...startRotation };

        // Target for Step 1: Position = aligned position (in front of door)
        // Rotation = 0 pitch/bank, Y facing the door (approx same as aligned.rotationY)
        // We assume 'aligned.rotationY' is the correct facing for the door

        gsap.to(camera.position, {
            x: aligned.x,
            y: aligned.y,
            z: aligned.z,
            duration: dur(1.5),
            ease: 'power2.inOut'
        });

        // Simultaneously animate rotation to level out
        gsap.to(step1RotationProxy, {
            x: 0, // Level pitch
            y: aligned.rotationY, // Face door
            z: 0, // Level bank
            duration: dur(1.5),
            ease: 'power2.inOut',
            onUpdate: () => {
                camera.rotation.set(step1RotationProxy.x, step1RotationProxy.y, step1RotationProxy.z);
            },
            onComplete: () => {
                // REVERSE STEP 2: Move back to original center position & rotate to original view
                // This is the reverse of the "align to door" animation

                // 2a. Position
                gsap.to(camera.position, {
                    x: saved.x,
                    y: saved.y,
                    z: saved.z,
                    duration: dur(1.0),
                    ease: 'power2.inOut'
                });

                // 2b. Rotation
                // Animate ALL axes to saved state
                const step2RotationProxy = {
                    x: camera.rotation.x,
                    y: camera.rotation.y,
                    z: camera.rotation.z
                };

                gsap.to(step2RotationProxy, {
                    x: saved.rotationX,
                    y: saved.rotationY,
                    z: saved.rotationZ,
                    duration: dur(1.0),
                    ease: 'power2.inOut',
                    onUpdate: () => {
                        camera.rotation.set(step2RotationProxy.x, step2RotationProxy.y, step2RotationProxy.z);
                    },
                    onComplete: () => {
                        // Restore precise full rotation (just in case)
                        camera.rotation.set(saved.rotationX, saved.rotationY, saved.rotationZ);

                        // Spread state updates across frames to prevent jank
                        // Frame 1: ANIMATION FINISHED BUT STATE STILL "INSIDE" TO PREVENT ROOM WAKEUP
                        // We keep isInsideRoom=true and isAnimating=true (or effectively "exiting")
                        // so that the mounted room (ContentRoom for every room id) sees
                        // "isExiting" as true until it's unmounted.

                        requestAnimationFrame(() => {
                            // Frame 2: Close door FIRST
                            // Room logic is still "held" in exit state

                            // Close door, THEN hide room and reset state
                            closeDoor(() => {
                                // Door is now closed. NOW we are officially "out"
                                setIsInsideRoom(false);
                                setIsAnimating(false);
                                setIsTiltLocked(false);
                                setRoomReady(false);
                                roomReadyRef.current = false;

                                setShouldRenderRoom(false);
                                contextExitRoom();
                                setCameraOverride?.(false);
                            });
                        });
                    }
                });
            }
        });
    }, [isInsideRoom, isAnimating, camera, setCameraOverride, contextExitRoom]);

    // --- PUBLISH "A DOOR IS DRIVING THE CAMERA" ---------------------------------
    //
    // While this is true nothing else may touch `camera.position`. In particular
    // the house-exit glide must not start, because killing the door's tween also
    // discards its onComplete and strands every piece of state that completion
    // clears (see the watchdog above). SceneContext refuses house exits while
    // this flag is set, and the back button renders itself disabled so the user
    // is not left clicking something that cannot act.
    useEffect(() => {
        setDoorBusy(isAnimating);
        return () => setDoorBusy(false);
    }, [isAnimating, setDoorBusy]);

    // --- ANIMATION WATCHDOG -------------------------------------------------
    //
    // `isAnimating` is the entry lock: handleClick bails while it is true, and so
    // does exitRoom. Every normal path clears it, but if any single tween loses
    // its onComplete (a killed tween, an unmounted door, a browser that drops a
    // frame) the lock sticks and THIS DOOR IS DEAD FOR THE REST OF THE SESSION —
    // clicking it does nothing at all, which is exactly what "the back button
    // stopped working" looks like from the outside.
    //
    // A full enter or exit is ~1.5-3.5s, so anything still locked after 9s is
    // wedged rather than slow. Releasing it is always safe: the worst case is
    // that a very slow animation gets cut short, versus a permanently dead door.
    useEffect(() => {
        if (!isAnimating) return undefined;
        const timer = setTimeout(() => {
            console.warn(`[DoorSection ${label}] Animation watchdog fired - releasing the entry lock`);
            setIsAnimating(false);
            setIsTiltLocked(false);
            // Hand the camera back too: a stranded override is what freezes the
            // corridor scroll, and it is released on the same completion path.
            setCameraOverride?.(false);
        }, 9000);
        return () => clearTimeout(timer);
    }, [isAnimating, label, setCameraOverride]);

    // ESC key listener for exiting room
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isInsideRoom && !isAnimating) {
                exitRoom();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isInsideRoom, isAnimating, exitRoom]);

    // Listen for exit request from UI back button
    useEffect(() => {
        if (exitRequested && isInsideRoom && !isAnimating) {
            // Note: We deliberately do NOT call clearExitRequest() here.
            // Calling it triggers an immediate global React Context update exactly
            // when we want to start a 60 FPS GSAP animation. 
            // setExitRequested(false) will be handled safely at the end of the 
            // animation by contextExitRoom().
            exitRoom(); // Trigger the exit animation
        }
    }, [exitRequested, isInsideRoom, isAnimating, exitRoom]);

    const closeDoor = useCallback((onDoorClosed) => {
        // Completion path, defined FIRST and used by every exit below.
        //
        // This used to be reachable only from the closing tween's onComplete,
        // while the guard below returned silently when the door was already shut
        // or unmounted. `exitRoom` passes its ENTIRE cleanup as this callback
        // (isAnimating, isInsideRoom, shouldRenderRoom, contextExitRoom and the
        // camera override), so dropping it stranded all five: the door stayed
        // locked, the corridor scroll stayed suspended on the override, and the
        // back button became a no-op because exitRoom's own guard then saw
        // isAnimating === true forever.
        const settle = () => {
            setIsOpen(false);
            setIsAnimating(false);
            onDoorClosed?.();
        };

        if (!doorRef.current || !isOpen) {
            // Nothing to animate — but the caller is still waiting on us.
            settle();
            return;
        }
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);

        setIsAnimating(true);

        if (closeAudioRef.current) {
            setTimeout(() => {
                const vol = isMuted ? 0 : DOOR_AUDIO_SETTINGS.closeVolume * globalVolume;
                if (closeAudioRef.current) {
                    closeAudioRef.current.setVolume(vol);
                    if (closeAudioRef.current.isPlaying) closeAudioRef.current.stop();
                    closeAudioRef.current.play();
                }
            }, DOOR_AUDIO_SETTINGS.closeDelay * 1000);
        }

        // Reset handle
        if (handleRef.current) {
            gsap.to(handleRef.current.rotation, {
                z: 0,
                duration: dur(0.2),
                ease: 'power2.out'
            });
        }

        // Reverse brush-stroke reveal (un-paint the door)
        if (doorMaterialRef.current) {
            gsap.to(doorMaterialRef.current, {
                uProgress: 0.0,
                duration: 0.6,
                ease: 'power2.out',
                overwrite: true
            });
        }
        if (handleMaterialRef.current) {
            gsap.to(handleMaterialRef.current, {
                uProgress: 0.0,
                duration: 0.6,
                ease: 'power2.out',
                overwrite: true
            });
        }
        // Hide painted layers after animation
        if (handleHideDelayRef.current) handleHideDelayRef.current.kill();
        handleHideDelayRef.current = gsap.delayedCall(0.65, () => {
            if (handlePaintedRef.current) handlePaintedRef.current.visible = false;
            if (doorPaintedRef.current) doorPaintedRef.current.visible = false;
        });

        gsap.to(doorRef.current.rotation, {
            y: 0,
            duration: dur(0.6),
            ease: 'power2.in',
            onComplete: settle
        });
    }, [isOpen]);

    // Handle hover effects
    const handlePointerEnter = () => {
        if (isOpen || isAnimating) return;
        setIsHovered(true);
        setGuitarCursor('pointer');

        if (hoverAudioRef.current && !isHovered) {
            const vol = isMuted ? 0 : DOOR_AUDIO_SETTINGS.hoverVolume * globalVolume;
            hoverAudioRef.current.setVolume(vol);
            
            // Only play if AudioContext is already running to avoid console warnings
            // Browsers block audio until a user click, and hover is not always enough.
            if (hoverAudioRef.current.isPlaying) hoverAudioRef.current.stop();
            if (hoverAudioRef.current.context.state === 'running') {
                hoverAudioRef.current.play();
            }
        }

        // Slightly open door on hover.
        //
        // prefers-reduced-motion：**门缝预开**和**把手下压**都停掉 —— 它们
        // 是纯装饰的"门要开了"预告，指针划过走廊时整排门一起抽动，是这个
        // 站最容易被忽略、却最吵的一处运动。留下的是笔触显色（uProgress
        // 交叉淡入，不是位移）和光标变化，反馈并没有丢。
        if (!reducedMotion()) {
            // Slightly open door on hover
            if (doorRef.current) {
                gsap.to(doorRef.current.rotation, {
                    y: side === 'left' ? 0.15 : -0.15,
                    duration: 0.3,
                    ease: 'power2.out'
                });
            }

            // Slightly rotate handle on hover
            if (handleRef.current) {
                gsap.to(handleRef.current.rotation, {
                    z: side === 'left' ? 0.1 : -0.1,
                    duration: 0.2,
                    ease: 'power2.out'
                });
            }
        }

        // Brush-stroke reveal: discard sketch pixels to show painted door beneath
        if (doorMaterialRef.current) {
            gsap.to(doorMaterialRef.current, {
                uProgress: 1.0,
                duration: 0.8,
                ease: 'power2.out',
                overwrite: true
            });
        }
        if (handleMaterialRef.current) {
            gsap.to(handleMaterialRef.current, {
                uProgress: 1.0,
                duration: 0.8,
                ease: 'power2.out',
                overwrite: true
            });
        }
        // Show painted layers (kill any pending hide from previous leave)
        if (handleHideDelayRef.current) handleHideDelayRef.current.kill();
        if (handlePaintedRef.current) handlePaintedRef.current.visible = true;
        if (doorPaintedRef.current) doorPaintedRef.current.visible = true;
    };

    const handlePointerLeave = () => {
        if (isOpen || isAnimating) return;
        setIsHovered(false);
        setGuitarCursor('auto');

        if (hoverAudioRef.current && hoverAudioRef.current.isPlaying) {
            hoverAudioRef.current.stop();
        }

        // Close door
        if (doorRef.current) {
            gsap.to(doorRef.current.rotation, {
                y: 0,
                duration: 0.3,
                ease: 'power2.out'
            });
        }

        // Reset handle
        if (handleRef.current) {
            gsap.to(handleRef.current.rotation, {
                z: 0,
                duration: 0.2,
                ease: 'power2.out'
            });
        }

        // Reverse brush-stroke reveal
        if (doorMaterialRef.current) {
            gsap.to(doorMaterialRef.current, {
                uProgress: 0.0,
                duration: 0.5,
                ease: 'power2.out',
                overwrite: true
            });
        }
        if (handleMaterialRef.current) {
            gsap.to(handleMaterialRef.current, {
                uProgress: 0.0,
                duration: 0.5,
                ease: 'power2.out',
                overwrite: true
            });
        }

        // Hide painted layers after reverse animation completes
        handleHideDelayRef.current = gsap.delayedCall(0.55, () => {
            if (handlePaintedRef.current) handlePaintedRef.current.visible = false;
            if (doorPaintedRef.current) doorPaintedRef.current.visible = false;
        });
    };

    // Door pivot position - hinges on the side
    const doorPivotX = side === 'left' ? -doorWidth / 2 : doorWidth / 2;
    const doorMeshX = side === 'left' ? doorWidth / 2 : -doorWidth / 2;

    // Handle position on door (based on texture - handle is on the right side for left doors)
    const handlePivotX = side === 'left' ? doorWidth * 0.25 : -doorWidth * 0.25;

    // Sign board — procedural canvas art (utils/corridorArt.js). The room name
    // is drawn on top of it by <Text>, so the board itself is blank.
    const signTexture = makeWoodenSignTexture();

    return (
        // Outer group at pivot position (outer edge of wall)
        <group position={[pivotX, position[1], position[2]]}>
            {/* Inner group that rotates - contains wall + door */}
            <group ref={groupRef}>
                {/* Wall segment with door hole — same ink wash as the corridor panels */}
                <mesh position={[wallOffsetX, 0, 0]} geometry={wallWithHoleGeometry} material={getInkWallMaterial()} />

                {/* === ARROW DECORATION === */}
                {/* Pointing to door. Left arrow. */}
                {/* ===================================================
                    REGULACJA STRZAŁKI LEWEJ:
                    position={[wallOffsetX - 0.9, 0, 0.02]}
                      - wallOffsetX - 0.9 → odległość od środka drzwi (zwiększ 0.9 = dalej od drzwi)
                      - Y = 0             → wysokość (0 = środek ściany, + = wyżej, - = niżej)
                    scale={[0.5, 0.5, 1]} → rozmiar strzałki
                    =================================================== */}
                <mesh
                    position={[wallOffsetX - 1.1, 0, 0.02]}
                    rotation={[0, 0, 0]}
                    scale={[0.5, 0.5, 1]}
                >
                    <primitive object={sharedGeometry('plane', 1, 0.5)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0"
                        map={arrowTexture}
                        alphaTest={0.1}
                        side={THREE.DoubleSide}
                        roughness={0.8}
                    />
                </mesh>

                {/* === ARROW DECORATION (RIGHT, MIRRORED) === */}
                {/* ===================================================
                    REGULACJA STRZAŁKI PRAWEJ:
                    position={[wallOffsetX + 0.9, -0.3, 0.02]}
                      - wallOffsetX + 0.9 → odległość od środka drzwi (prawa strona)
                      - Y = -0.3          → trochę niżej niż lewa strzałka
                    scale={[-0.5, 0.5, 1]} → ujemny X = lustrzane odbicie
                    =================================================== */}
                <mesh
                    position={[wallOffsetX + 1.1, -0.3, 0.02]}
                    rotation={[0, 0, 0]}
                    scale={[-0.5, 0.5, 1]}
                >
                    <primitive object={sharedGeometry('plane', 1, 0.5)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0"
                        map={arrowTexture}
                        alphaTest={0.1}
                        side={THREE.DoubleSide}
                        roughness={0.8}
                    />
                </mesh>

                {/* Baseboard (Listwa) Left side of door */}
                <mesh position={[wallOffsetX - 1.4, -CORRIDOR_HEIGHT / 2 + 0.075, 0.02]}>
                    <primitive object={sharedGeometry('plane', doorBoardWidth, 0.15)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0"
                        map={doorBbTexLeft}
                        roughness={0.8}
                        side={THREE.DoubleSide}
                    />
                </mesh>

                {/* Baseboard (Listwa) Right side of door */}
                <mesh position={[wallOffsetX + 1.4, -CORRIDOR_HEIGHT / 2 + 0.075, 0.02]}>
                    <primitive object={sharedGeometry('plane', doorBoardWidth, 0.15)} attach="geometry" />
                    <meshBasicMaterial color="#e0e0e0"
                        map={doorBbTexRight}
                        roughness={0.8}
                        side={THREE.DoubleSide}
                    />
                </mesh>

                {/* === THRESHOLD STRIPE (Próg przy drzwiach bocznych) === */}
                {(() => {
                    // Próg leży na podłodze, prostopadle do ściany bocznej
                    // Szerokość progu = szerokość otworu drzwiowego (~1.1)
                    const THRESH_W = 1.1;   // Szerokość (wzdłuż X lokalnego = wzdłuż ściany)
                    const THRESH_D = 0.15;  // Głębokość (wzdłuż Z lokalnego = w głąb korytarza)
                    const threshTex = baseboardTexture.clone();
                    threshTex.needsUpdate = true;
                    threshTex.wrapS = threshTex.wrapT = THREE.RepeatWrapping;
                    threshTex.rotation = 0;
                    threshTex.offset.set(0, 0);
                    threshTex.repeat.set(THRESH_W / NATURAL_TILE_W, 1);
                    return (
                        <mesh
                            position={[wallOffsetX, -CORRIDOR_HEIGHT / 2 + 0.005, 0.02]}
                            rotation={[-Math.PI / 2, 0, 0]}
                        >
                            <primitive object={sharedGeometry('plane', THRESH_W, THRESH_D)} attach="geometry" />
                            <meshBasicMaterial color="#e0e0e0"
                                map={threshTex}
                                roughness={0.9}
                                metalness={0}
                                side={THREE.DoubleSide}
                            />
                        </mesh>
                    );
                })()}

                {/* Door and frame - centered on wall */}
                <group position={[wallOffsetX, -0.4, 0]}>
                    {/* === 古韵木板招牌 ===
                        Board size comes from corridorArt (SIGN_BOARD_W/H), so
                        the plane and the canvas share an aspect and the grain
                        never stretches. It hangs 0.45 above the leaf; the old
                        0.65-tall plate used the same anchor, so shrinking the
                        board to 0.42 simply opens the gap up a little.

                        The label is CENTRED — both anchors are 'middle' and
                        offsetY is 0. The -0.11 that used to be here existed
                        only to dodge the lantern the old plate had painted into
                        its top 32px; the wooden board has none. */}
                    <group position={[0, doorHeight / 2 + 0.45, 0.08]}>
                        <mesh>
                            <primitive object={sharedGeometry('plane', SIGN_BOARD_W, SIGN_BOARD_H)} attach="geometry" />
                            <meshBasicMaterial color="#e0e0e0"
                                map={signTexture}
                                alphaTest={0.1}
                                roughness={0.8}
                            />
                        </mesh>

                        <Text
                            font={TEXT.font3d}
                            fontSize={language === 'en'
                                ? Math.min(0.2, 1.05 / Math.max(label.length, 1))
                                : 0.2}
                            color={TEXT.plaque.ink}
                            anchorX="center"
                            anchorY="middle"
                            maxWidth={SIGN_BOARD_W * 0.86}
                            textAlign="center"
                            position={[0, TEXT.plaque.offsetY, 0.01]}
                        >
                            {label}
                        </Text>
                    </group>

                    {/* The four "legacy sign variant" blocks that used to live
                        here (THE GALLERY / THE STUDIO / THE ABOUT / LET'S
                        CONNECT) were unreachable: `label` is always
                        `ROOMS[n][language]`, i.e. 档案/ABOUT, 摄影/GALLERY…,
                        never the old "THE …" strings. They were also the
                        last CabinSketch users, so they went with the font. */}

                    {/* === DOOR FRAME (textured) === */}
                    {/* Moved to Z = 0.04 to sit in front of baseboards (Z=0.02), hiding the hole edges */}
                    <mesh position={[0, -0.1, 0.04]} scale={[side === 'right' ? -1 : 1, 1, 1]}>
                        <primitive object={sharedGeometry('plane', frameWidth, frameHeight)} attach="geometry" />
                        <meshBasicMaterial color="#e0e0e0"
                            map={frameTexture}
                            alphaTest={0.1}
                            roughness={0.9}
                        />
                    </mesh>

                    {/* === DOOR INTERIOR CORRIDOR + ROOM === */}
                    {/* Always render, but pass showRoom prop for lazy loading giant room */}
                    <RoomInterior
                        label={label}
                        roomId={doorId}
                        showRoom={shouldRenderRoom}
                        onReady={handleRoomReady}
                        isExiting={isInsideRoom && isAnimating}
                    />

                    {/* === DOOR PANEL (pivots for opening) === */}
                    {/* Pivot Z at 0.01 to be slightly behind frame but in front of wall if needed, or just flush */}
                    <group ref={doorRef} position={[doorPivotX, 0, 0.01]}>
                        {/* Clickable hitbox (invisible) for pointer events */}
                        <mesh
                            position={[doorMeshX, -0.2, 0.005]}
                            onClick={handleClick}
                            onPointerEnter={handlePointerEnter}
                            onPointerLeave={handlePointerLeave}
                        >
                            <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                            <meshBasicMaterial color="#e0e0e0" transparent={true} opacity={0} depthWrite={false} />
                        </mesh>

                        {/* Painted layer (behind sketch) - hidden after 2 frames to precompile shader */}
                        <mesh
                            ref={doorPaintedRef}
                            position={[doorMeshX, -0.2, -0.001]}
                            scale={[(side === 'right' && label !== 'THE STUDIO') ? -1 : 1, 1, 1]}
                        >
                            <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                            <meshBasicMaterial color="#e0e0e0"
                                map={doorPaintedTexture}
                                alphaTest={0.5}
                                roughness={0.8}
                            />
                        </mesh>

                        {/* Sketch overlay (front) - brush-stroke discard reveals painted beneath */}
                        <mesh
                            position={[doorMeshX, -0.2, 0]}
                            scale={[(side === 'right' && label !== 'THE STUDIO') ? -1 : 1, 1, 1]}
                        >
                            <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                            <revealMaterial color="#e0e0e0"
                                ref={doorMaterialRef}
                                map={doorTexture}
                                alphaTest={0.1}
                                roughness={0.8}
                                uProgress={0.0}
                            />
                        </mesh>

                        {/* Door Back Texture */}
                        <mesh
                            position={[doorMeshX, -0.2, -0.01]}
                            rotation={[0, Math.PI, 0]}
                            scale={[side === 'right' ? -1 : 1, 1, 1]}
                        >
                            <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                            <meshBasicMaterial color="#e0e0e0"
                                map={doorBackTexture}
                                alphaTest={0.1}
                                roughness={0.8}
                                side={THREE.DoubleSide}
                            />
                        </mesh>

                        {/* (The taped identity notes that used to sit here were
                            removed on 2026-10-08 — see the note above.) */}

                        {/* Handle Layer - pivot at screw position */}
                        <group ref={handleRef} position={[doorMeshX + (side === 'left' ? 0.45 : -0.45), -0.29, 0.03]}>
                            {/* Painted handle (behind) - hidden after 2 frames */}
                            <mesh ref={handlePaintedRef} position={[side === 'left' ? -0.50 : 0.50, 0.14, -0.001]} scale={[side === 'right' ? -1 : 1, 1, 1]}>
                                <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                                <meshBasicMaterial color="#e0e0e0"
                                    map={handlePaintedTexture}
                                    alphaTest={0.5}
                                />
                            </mesh>
                            {/* Sketch handle overlay (front) */}
                            <mesh position={[side === 'left' ? -0.50 : 0.50, 0.14, 0]} scale={[side === 'right' ? -1 : 1, 1, 1]}>
                                <primitive object={sharedGeometry('plane', doorWidth, doorHeight)} attach="geometry" />
                                <revealMaterial color="#e0e0e0"
                                    ref={handleMaterialRef}
                                    map={handleTexture}
                                    alphaTest={0.1}
                                    uProgress={0.0}
                                />
                            </mesh>
                        </group>
                    </group>
                </group>

                {/* SPATIAL AUDIO NODES (Attached slightly in front of the door) */}
                <SpatialSfx
                    ref={hoverAudioRef}
                    url="/sounds/uchyleniedrzwi.mp3"
                    distanceModel="exponential"
                    rolloffFactor={DOOR_AUDIO_SETTINGS.rolloff}
                    refDistance={DOOR_AUDIO_SETTINGS.distance}
                    loop={false}
                />
                <SpatialSfx
                    ref={openAudioRef}
                    url="/sounds/otwarciedrzwi.mp3"
                    distanceModel="exponential"
                    rolloffFactor={DOOR_AUDIO_SETTINGS.rolloff}
                    refDistance={DOOR_AUDIO_SETTINGS.distance}
                    loop={false}
                />
                <SpatialSfx
                    ref={closeAudioRef}
                    url="/sounds/zamknieciedrzwi.mp3"
                    distanceModel="exponential"
                    rolloffFactor={DOOR_AUDIO_SETTINGS.rolloff}
                    refDistance={DOOR_AUDIO_SETTINGS.distance}
                    loop={false}
                />
            </group>
        </group >
    );
};

export default DoorSection;
