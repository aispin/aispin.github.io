import { useCallback, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import InfiniteCorridorManager from './corridor/InfiniteCorridorManager';
import EntranceDoors from './entrance/EntranceDoors';
import WeatherLayer from './entrance/WeatherLayer';
import TeleportRoom from './corridor/TeleportRoom';
import HouseExit from './corridor/HouseExit';
import RoomWarmup from './corridor/RoomWarmup';
import { SpatialAudioListener } from './audio/SpatialSfx';
import CourtyardAmbience from './audio/CourtyardAmbience';
import useInfiniteCamera from '../../hooks/useInfiniteCamera';
import useOrbitCamera from '../../hooks/useOrbitCamera';
import SignSystem from './entrance/SignSystem';
import { useScene } from '../../context/SceneContext';

// —— 孤岛院子（v1.2）——
// 地面 / 院墙 / 竹林取代了原来的 `EmptyCorridor`（它名字叫 corridor，
// 实际只画了一块 25×40 的草坪瓦片）。地面只能有一个主人：两张共面的
// 地面会 z-fight，且新地面是整张 120×120、按真实世界 XZ 取噪声，
// 绕着看时草不会"跟着相机流"。
import IslandGround from './entrance/IslandGround';
import CourtyardWalls from './entrance/CourtyardWalls';
import CorridorShell from './entrance/CorridorShell';
import BambooGrove from './entrance/BambooGrove';
import DebugFlyCamera from './entrance/DebugFlyCamera';
import { resolveCameraMode, CAMERA_MODE, isFlyEnabled } from '../../config/cameraMode';

// Positioning:
// - Segment -1's SegmentDoors are at Z=15
// - Entrance doors at Z=22 (in front of segment doors)
// - ZEO/Avatar at Z≈5.5
// - Camera starts at Z=28, ends at Z=8 (in front of avatar)
const ENTRANCE_DOORS_Z = 22;

// ⚠️ 提成模块常量，**不要**在 JSX 里写内联的 `[0, 0, ENTRANCE_DOORS_Z]`：
// 内联数组每次渲染都是新引用，会一路传进子组件的 `useMemo` deps（EntranceDoors
// 的甬路 uniform 就吃过这个亏 —— 对象被反复重建，换季时画面冻在首季）。
const ENTRANCE_POSITION = [0, 0, ENTRANCE_DOORS_Z];

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

    // === 相机模式状态机（见 config/cameraMode.js）=====================
    // 先算出"这一帧谁拥有相机"，再把结论分发给各个控制器。控制器自己
    // 不判断场景状态 —— 否则同一个条件要写五遍，且改一处就漏四处。
    const flyEnabled = useMemo(() => isFlyEnabled(), []);
    const cameraMode = resolveCameraMode({
        hasEntered,
        isTeleporting,
        isInRoom,
        houseExitRequested,
        flyEnabled,
    });

    // 环绕相机只在 COURTYARD 模式下接管。
    // ⚠️ 它内部还会再让一次 GSAP（入场 timeline 正在跑时一帧都不写相机），
    //    所以这里不用额外判断"入场是否结束"。
    const orbit = useOrbitCamera({ enabled: cameraMode === CAMERA_MODE.COURTYARD });

    // 把环绕姿态接口交给截图脚本。没有它，每个机位都要整页 reload
    // （4 季 × 5 机位 × 2 视口 = 40 次冷启动，一次冷启动 ~22s）。
    //
    // ⚠️ 为什么不设 `import.meta.env.DEV` 门槛：本文件**已经无条件**暴露了
    //    `window.__cam` / `__scene` / `__THREE`（见上面那个 effect）—— 那个
    //    `__cam` 拿到手就能直接改相机，比 `setPose()` 更能为所欲为。而
    //    `?yaw=&r=&elev=` 本来就是公开的 URL 参数。所以这里收紧成 DEV-only
    //    是**假的安全**，反而让截图只能跑 dev（dev 冷启动慢得多）。
    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.__orbit = orbit;
    }, [orbit]);

    // ?fly 是 debug 后门。留一句控制台提示，免得有人开着它截图/上线。
    useEffect(() => {
        if (!flyEnabled) return;
        console.info('[camera] ?fly — 自由飞行调试相机已接管（不该出现在生产截图里）');
    }, [flyEnabled]);

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

            {/* === 孤岛院子：地面 / 院墙 / 竹林 ===
                三样共用同一个 `!hasEntered` 边界，和下面的门楼、匾额、天象一致。
                它们只在院子里存在 —— 走廊是室内的，从走廊里不该看见沙滩。 */}
            {!hasEntered && (
                <IslandGround />
            )}
            {!hasEntered && (
                <CourtyardWalls />
            )}
            {/* 走廊的外壳（青砖墙 + 黑瓦顶）。走廊自己每一面都是 DoubleSide，
                从外面看是一大片没细节的白板 —— 这是 L1「背面清单」抓到的
                头号洞。见 entrance/CorridorShell.jsx。
                ⚠️ 条件比邻居多一个 `houseExitRequested`：退出动画是**从走廊里
                   滑到院门外**，那一刻 hasEntered 还是 true，卸掉壳就会在滑
                   出去的过程中看见白板。 */}
            {(!hasEntered || houseExitRequested) && (
                <CorridorShell />
            )}
            {!hasEntered && (
                <BambooGrove lowTier={isLowTier} />
            )}

            {/* === 自由飞行调试相机（?fly 才开）===
                挂在最后：它只在 URL 带 ?fly 时写相机，其余时候整个 hook 空转。 */}
            <DebugFlyCamera />

            {/* === COURTYARD SEASON BED (四季声床) ===
                与下面的 EntranceDoors 共用同一个 `!hasEntered` 边界 ——
                进走廊 / 房间它自然卸载，不需要任何额外条件。
                详见 audio/CourtyardAmbience.jsx 的注释。 */}
            {!hasEntered && (
                <CourtyardAmbience />
            )}

            {/* === ENTRANCE DOORS (visible until entered) === */}
            {!hasEntered && (
                <EntranceDoors
                    position={ENTRANCE_POSITION}
                    onComplete={handleEntranceComplete}
                />
            )}

            {/* Separate SignSystem to avoid fragment nesting issues if any */}
            {!hasEntered && (
                <SignSystem position={ENTRANCE_POSITION} />
            )}

            {/* === 季生天象（雨幕 / 落雪）=== §6.4，WO-3，C 档。
                和上面几个共用同一个 `!hasEntered` 边界：它是**院子**的天象，
                进了走廊 / 房间自然卸载 —— 在室内看到雨丝才是 bug。
                挂在这里而不是 EntranceDoors 里：那一层带着 ENTRANCE_POSITION
                的位移，而天象是**挂在相机上**的，坐标系必须干净。 */}
            {!hasEntered && (
                <WeatherLayer />
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

