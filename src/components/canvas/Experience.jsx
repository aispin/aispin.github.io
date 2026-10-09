import { useCallback, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import InfiniteCorridorManager from './corridor/InfiniteCorridorManager';
import EntranceDoors from './entrance/EntranceDoors';
import EmptyCorridor from './entrance/EmptyCorridor';
import TeleportRoom from './corridor/TeleportRoom';
import HouseExit from './corridor/HouseExit';
import RoomWarmup from './corridor/RoomWarmup';
import { SpatialAudioListener } from './audio/SpatialSfx';
import useInfiniteCamera from '../../hooks/useInfiniteCamera';
import SignSystem from './entrance/SignSystem';
import { useScene } from '../../context/SceneContext';

// Positioning:
// - Segment -1's SegmentDoors are at Z=15
// - Entrance doors at Z=22 (in front of segment doors)
// - ZEO/Avatar at Z≈5.5
// - Camera starts at Z=28, ends at Z=8 (in front of avatar)
const ENTRANCE_DOORS_Z = 22;

/**
 * Experience Component
 * 
 * Flow:
 * 1. Preloader fades out -> user sees 3D entrance doors
 * 2. Click doors -> they open + camera flies through
 * 3. Behind doors: infinite corridor with ZEO
 */
const Experience = ({ onSceneReady, performanceTier }) => {
    // Use SceneContext for room state
    const { hasEntered, markEntered, enterRoom, isTeleporting, isInRoom, houseExitRequested } = useScene();

    const { camera } = useThree();

    // Debug hook: allows tests/screenshots to reposition the camera (window.__cam)
    const scene = useThree((state) => state.scene);

    // ⚠️ 这三个赋值必须在 effect 里，**不能写在 render 里**（原来就写在 render
    //    里）—— 渲染阶段写全局是副作用，`react-hooks/immutability` 会拦下来。
    //    放 effect 语义完全一样：harness 是等场景稳定后才轮询 `window.__scene`
    //    的，那时 effect 早就跑过了。
    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.__cam = camera;
        window.__scene = scene;
        // `window.__THREE` exists so a harness can raycast from the page
        // (see .workbuddy-ai/harness/probe-pixel.mjs). Without it, working out
        // *what* a stray 5 px bright line on screen actually is degenerates
        // into hiding objects one at a time and guessing from the diff.
        window.__THREE = THREE;
    }, [camera, scene]);

    // Camera control - both scroll and parallax only work after entering
    // Disable during teleporting to prevent scroll interference
    const { setCameraOverride } = useInfiniteCamera({
        segmentLength: 80,
        scrollSpeed: 0.025,
        parallaxIntensity: 0.4,
        smoothing: 0.06,
        scrollEnabled: hasEntered && !isTeleporting && !isInRoom && !houseExitRequested,
        parallaxEnabled: hasEntered && !isTeleporting && !isInRoom && !houseExitRequested
    });

    // NOTE: Camera override is now managed directly by DoorSection.jsx
    // We removed the useEffect that was calling setCameraOverride here because
    // it conflicted with DoorSection's direct control and caused camera jumps.
    // The scrollEnabled/parallaxEnabled props already handle disabling scroll when in room.


    // Handle entrance complete
    const handleEntranceComplete = useCallback(() => {
        markEntered();
    }, [markEntered]);

    // Handle door enter from inside corridor
    const handleDoorEnter = useCallback((doorId) => {
        enterRoom(doorId);
        // console.log('Entering:', doorId);
    }, [enterRoom]);

    // Optimization: Low tier has simpler lighting
    const isLowTier = performanceTier === 'LOW';

    return (
        <>
            {/* === ONE AUDIO LISTENER FOR THE WHOLE SITE === */}
            {/* 位置音效靠 listener 的世界矩阵同步听者坐标。drei 的
                <PositionalAudio> 每个实例都自己 new 一个 AudioListener 并挂到
                相机下 —— 42 个音效节点就是 42 个 listener、42 个直连
                destination 的 GainNode、42 个相机子对象。这里挂一次，所有
                SpatialSfx 共用。见 engine/audioBus.js。 */}
            <SpatialAudioListener />

            {/* === ROOM WARM-UP (pre-renders all rooms off-screen during preloader) === */}
            {/* RoomWarmup mounts all 4 rooms 500 units below, compiles shaders via gl.compile(), 
                then self-destructs and signals onSceneReady. This ensures both corridor segments
                AND room shaders are pre-compiled before the user starts interacting. */}
            <RoomWarmup onWarmupComplete={onSceneReady} isLowTier={isLowTier} />

            {/* === GLOBAL LIGHTING === */}
            {/* Moved out to canvas/SceneLighting.jsx, which App.jsx mounts
                OUTSIDE this lazy chunk. The rig has to sit next to the fog and
                the background, because night cross-fades all four together —
                and it must exist before this chunk resolves, or the first
                frames would run unfogged with three's default lighting rig. */}

            {/* === EMPTY CORRIDOR (provides context during entrance) === */}
            {!hasEntered && (
                <EmptyCorridor camera={camera} />
            )}

            {/* === ENTRANCE DOORS (visible until entered) === */}
            {!hasEntered && (
                <EntranceDoors
                    position={[0, 0, ENTRANCE_DOORS_Z]}
                    onComplete={handleEntranceComplete}
                />
            )}

            {/* Separate SignSystem to avoid fragment nesting issues if any */}
            {!hasEntered && (
                <SignSystem position={[0, 0, ENTRANCE_DOORS_Z]} />
            )}

            {/* === INFINITE CORRIDOR (segment -1 SegmentDoors hidden during entrance) === */}
            <InfiniteCorridorManager
                onDoorEnter={handleDoorEnter}
                hideDoorsForSegments={hasEntered ? [] : [-1]} // Hide segment -1's doors until entered
                clipSegmentNeg1={!hasEntered} // Clip segment -1 visualization until entered
                setCameraOverride={setCameraOverride}
            />

            {/* === TELEPORT ROOM (renders room directly during teleportation) === */}
            <TeleportRoom />

            {/* === HOUSE EXIT (glides the camera back out of the front door) === */}
            <HouseExit />
        </>
    );
};

export default Experience;

