import { useCallback, useEffect, useMemo, useState } from 'react';
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

// —— 孤岛（v1.2）——
// 地面 / 竹林取代了原来的 `EmptyCorridor`（它名字叫 corridor，
// 实际只画了一块 25×40 的草坪瓦片）。地面只能有一个主人：两张共面的
// 地面会 z-fight，且新地面是整张 120×120、按真实世界 XZ 取噪声，
// 绕着看时草不会"跟着相机流"。
//
// ⚠️ 2026-10-11（WO-6）：`CourtyardWalls` 已删除 —— 用户定案「删掉院子，
//    直接是老房子」，屋身的前墙就是那座门楼，不再有独立的四面院墙。
//    门外换成了竹篱笆围的开放小院（`ForecourtFence`）。
import IslandGround from './entrance/IslandGround';
import ForecourtFence from './entrance/ForecourtFence';
import HouseShell from './entrance/HouseShell';
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
    const { hasEntered, markEntered, enterRoom, isTeleporting, isInRoom, houseExitRequested, requestHouseExit } = useScene();

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

    /**
     * 🔴 WO-6 的**封口②**：走廊只在"人在里面"时渲染。
     * ================================================
     *
     * 走廊在世界 z 上无限，屋子有限 ⇒ 走廊必然从屋子的某一边穿出去。让
     * 「管子从外面被看见」这件事彻底不成立的办法不是加壳，而是**外面根本不画**：
     * 玩家永远在 7 宽的不透明管子里，看不出自己已经走出屋子 ⇒ 屋子的尺寸 /
     * 形状 / 位置与走廊完全无关（这就是「外观与内部解绑」）。
     *
     * 为什么不能直接用 `hasEntered`：入场飞行是**从院子里飞进门的**（z 28 → 18.5），
     * 那 2.4 秒里 `hasEntered` 还是 false，但门已经开了、相机正在穿过门洞 ——
     * 这时不画走廊，门洞里就是一片空的。所以要一个"从推门那一刻起"的开关。
     *
     * 两个条件的交接是**同一批 state**：`onComplete` 里 `setDoorOpening(false)`
     * 与 `markEntered()` 一起提交，`hasEntered` 变 true 的那一帧 `doorOpening`
     * 才变 false ⇒ 可见性不断档。
     *
     * 退出时不需要额外处理：`markExited()` 把 `hasEntered` 置回 false，而
     * `doorOpening` 早就是 false ⇒ 走廊自动消失（那时相机已经滑到 z = 28，
     * 走廊整条都在屋子的前墙后面）。
     */
    const [doorOpening, setDoorOpening] = useState(false);
    const corridorVisible = hasEntered || doorOpening;

    // Camera control - both scroll and parallax only work after entering
    // Disable during teleporting to prevent scroll interference
    const { setCameraOverride } = useInfiniteCamera({
        segmentLength: 80,
        scrollSpeed: 0.025,
        parallaxIntensity: 0.4,
        smoothing: 0.06,
        scrollEnabled: hasEntered && !isTeleporting && !isInRoom && !houseExitRequested,
        parallaxEnabled: hasEntered && !isTeleporting && !isInRoom && !houseExitRequested,
        // 封口③：退到前门 ⇒ 请求退出（相机滑出门、环绕视角重新挂上）。
        // 被拒（门正忙）时会走回走廊再退一次 —— 见 useInfiniteCamera 的注释。
        onBackOut: requestHouseExit
    });

    // NOTE: Camera override is now managed directly by DoorSection.jsx
    // We removed the useEffect that was calling setCameraOverride here because
    // it conflicted with DoorSection's direct control and caused camera jumps.
    // The scrollEnabled/parallaxEnabled props already handle disabling scroll when in room.


    // 推门那一刻：走廊开始渲染（见上面 corridorVisible 的说明）。
    const handleEntranceStart = useCallback(() => {
        setDoorOpening(true);
    }, []);

    // Handle entrance complete
    const handleEntranceComplete = useCallback(() => {
        setDoorOpening(false); // 与 markEntered() 同批提交 ⇒ 可见性不断档
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

            {/* === 孤岛：地面 / 屋身 / 篱笆 / 竹林 ===
                四样共用同一个 `!hasEntered` 边界，和下面的门楼、匾额、天象一致。
                它们只在屋子外面存在 —— 走廊是室内的，从走廊里不该看见沙滩。 */}
            {!hasEntered && (
                <IslandGround />
            )}
            {/* 屋身（"老房子"本体：青砖墙 + 黑瓦双坡顶 + 檐下椽头）。
                走廊自己每一面都是 DoubleSide，从外面看是一大片没细节的白板
                —— 这是 L1「背面清单」抓到的头号洞。见 entrance/HouseShell.jsx。
                ⚠️ 条件比邻居多一个 `houseExitRequested`：退出动画是**从走廊里
                   滑到院门外**，那一刻 hasEntered 还是 true，卸掉屋身就会在滑
                   出去的过程中看见白板。
                ⚠️ 屋身的**前墙就是那座门楼**（门洞 + 窗洞都开在它上面），
                   不再有独立的门脸，也没有四面院墙（`CourtyardWalls` 已删）。 */}
            {(!hasEntered || houseExitRequested) && (
                <HouseShell />
            )}
            {/* 门外竹篱笆围的开放小院（WO-6 第 ② 条）。只围外三面，
                正前方留口给甬路 —— 详见 entrance/ForecourtFence.jsx。
                条件和屋身一样多带 `houseExitRequested`：退出滑行的最后一段
                相机在院子里，虽然那时它朝屋里看、看不见篱笆，但让"院子里的
                东西"共用同一个边界比省这一帧划算。 */}
            {(!hasEntered || houseExitRequested) && (
                <ForecourtFence />
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

            {/* === ENTRANCE DOORS (visible until entered) ===
                `onStart` 在推门那一帧就开走廊（见 corridorVisible 的说明）：
                门一开，门洞里必须已经有一段廊，否则就是一片空。 */}
            {!hasEntered && (
                <EntranceDoors
                    position={ENTRANCE_POSITION}
                    onStart={handleEntranceStart}
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

            {/* === INFINITE CORRIDOR ===
                🔴 永远挂载、但只在"人在里面"时可见（WO-6 封口②）。
                挂载是必须的：`RoomWarmup` 靠 `gl.compile()` 预热它的 shader，
                而 `compile()` 走 `scene.traverse`（不认 `visible`）——
                卸载等于把预热成果扔掉，再进门时第一帧要现场编译。
                见 corridor/InfiniteCorridorManager.jsx 顶部的长注释。 */}
            <InfiniteCorridorManager
                onDoorEnter={handleDoorEnter}
                visible={corridorVisible}
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

