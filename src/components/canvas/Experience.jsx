import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import InfiniteCorridorManager from './corridor/InfiniteCorridorManager';
import EntranceDoors from './entrance/EntranceDoors';
import WeatherLayer from './entrance/WeatherLayer';
import SkyClouds from './entrance/SkyClouds';
import TeleportRoom from './corridor/TeleportRoom';
import HouseExit from './corridor/HouseExit';
import RoomWarmup from './corridor/RoomWarmup';
import { SpatialAudioListener } from './audio/SpatialSfx';
import CourtyardAmbience from './audio/CourtyardAmbience';
import useInfiniteCamera from '../../hooks/useInfiniteCamera';
import useOrbitCamera from '../../hooks/useOrbitCamera';
import SignSystem from './entrance/SignSystem';
import { useScene } from '../../context/SceneContext';
import { reducedMotion } from '../../hooks/useReducedMotion';

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
import DreamForest from './entrance/DreamForest';
import DebugFlyCamera from './entrance/DebugFlyCamera';
import Airplane from './entrance/Airplane';
import FlightCamera from './entrance/FlightCamera';
import FlightFinish from './entrance/FlightFinish';
import { resolveCameraMode, CAMERA_MODE, isFlyEnabled } from '../../config/cameraMode';
import { useFlightMode } from '../../config/flightMode';

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

/* 进场自动"滑到门前"的起跑延迟（ms）。
 *
 * 用户 2026-10-20：「页面进来后，自动给我往上滚一次，将用户拉到门前。
 * 目前需要人工去滚动一次鼠标。」—— 也就是把"第一次滚轮"这一步替用户做了。
 *
 * 420ms：纸幕淡出约 0.35s，等它彻底撤掉再动。太早会被纸幕盖住（等于没发生），
 * 太晚就成了"人已经站定了，画面突然自己动"。 */
const ENTER_ZOOM_DELAY = 420;

/**
 * Experience Component
 * 
 * Flow:
 * 1. Preloader fades out -> user sees 3D entrance doors
 * 2. Click doors -> they open + camera flies through
 * 3. Behind doors: infinite corridor with ZEO
 */
const Experience = ({ onSceneReady, performanceTier, enterFlourish = false }) => {
    // Use SceneContext for room state
    const { hasEntered, markEntered, enterRoom, isTeleporting, isInRoom, houseExitRequested, requestHouseExit } = useScene();

    const { camera, gl } = useThree();

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
        // 🔴 `window.__renderer` —— WO-18 的 DR-M 要求一份"**绘制开销**增量报告"
        //    （mesh / draw call / 体积）。`renderer.info` 只有 renderer 上有，
        //    而 `draw calls` 是**每帧实际发生的事**，从 scene 图里推不出来
        //    （可见性、视锥剔除、实例化都参与）。
        //    与 `__cam` / `__scene` 同一套 DEV 钩子，生产构建里被摇掉。
        window.__renderer = gl;
    }, [camera, scene, gl]);

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

    /**
     * 🔴 屋外那一整套东西的**唯一**边界（2026-10-11）。
     *
     * 用户报的：「退出门口时的 BUG」—— 退场滑行到一半，整屏是一堵青砖墙，
     * 中间只有一个**光秃秃的门洞**（门框 / 门扇 / 对联 / 匾额全没了）。
     *
     * 根因：**边界不统一**。退场滑行的 1.3 s 里 `hasEntered` 还是 true
     * （`markExited()` 要等相机到 z = 28 才调），所以：
     *   · `HouseShell`    挂了 `|| houseExitRequested` ⇒ 在（对：不然是一片白板）
     *   · `ForecourtFence` 同上                          ⇒ 在
     *   · **`EntranceDoors` 只写了 `!hasEntered`**       ⇒ **不在**
     *     ⇒ 前墙上留下一个没有门框、没有门扇的**洞**。
     *   · `IslandGround` / `SignSystem` / `DreamForest` / `WeatherLayer` 同理。
     *
     * ⇒ 于是"一面墙 + 一个洞"就成了用户看到的东西。
     *
     * 教训与 WO-6 的"三处封口"是同一条：**一套东西必须共用同一个开关**。
     * 上一轮给 HouseShell 单独补条件，等于把这条规则又破坏了一次 ——
     * 补一个就会漏一个。所以现在提成一个谓词，**全部**走它。
     *
     * ⚠️ 退场时走廊**同时**画着（`corridorVisible` 那一套），这是有意的：
     *    相机在门口那一段两种几何都在画面里，门洞后面必须已经有一段廊。
     */
    const outdoorVisible = !hasEntered || houseExitRequested;

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
    // 飞行模式（点小飞机 / `?flight`）。状态在 `config/flightMode.js` ——
    // 模块级 store，因为飞机 / 相机 / 这个状态机三处都要读它（见那个文件）。
    const flight = useFlightMode();
    const cameraMode = resolveCameraMode({
        hasEntered,
        isTeleporting,
        isInRoom,
        houseExitRequested,
        flyEnabled,
        flightActive: flight.active,
    });

    // 环绕相机只在 COURTYARD 模式下接管。
    // ⚠️ 它内部还会再让一次 GSAP（入场 timeline 正在跑时一帧都不写相机），
    //    所以这里不用额外判断"入场是否结束"。
    const orbit = useOrbitCamera({ enabled: cameraMode === CAMERA_MODE.COURTYARD });

    /* ── 进场自动"滑到门前"，把用户直接送到门口 ──────────────────────────
       走的是 `orbit.approachDoor()` —— 终点就是**手动一直往前滚最后停住的那个
       机位**（轨道最近点 `ORBIT_MIN_R`，实测 z=28.147，与用户截图的取景一致），
       中途用一条 ease-in-out 的 tween 改 `targetR`，所以是"缓冲"过去的。

       四条约束，缺一条就会出怪事：
       ① `enterFlourish` 只由 App 在**真跑过 Preloader**时置真。`?noloader=1`
          下 `isLoaded` 初值就是 true，若直接看它，首帧就滑 —— 所有靠
          REST_POSE 的截图/判据会集体漂移。
       ② 只在 COURTYARD 滑。已经进门/传送/退场时相机有别的所有者，滑一下
          会和 GSAP 抢方向盘。
       ③ 只滑一次（ref 闸门）。进出房间会反复回到 COURTYARD，不加闸门就
          变成"每次回到院子都被拽一下"。另外起跑前再看一眼 `isActive()` ——
          用户在这 420ms 里已经自己滚过/拖过，就别再抢方向盘。
       ④ `prefers-reduced-motion`：**不做动画，但照样到位**（`immediate`）。
          这条是站主明确要的功能，停掉滑行已经足够，不该让功能整个消失 ——
          之前那版直接 `return`，开着"减少动态效果"的机器上就等于没做。 */
    const enterZoomed = useRef(false);
    useEffect(() => {
        if (!enterFlourish || enterZoomed.current) return;
        if (cameraMode !== CAMERA_MODE.COURTYARD) return;
        enterZoomed.current = true;
        const immediate = reducedMotion();
        const t = setTimeout(() => {
            if (orbit.isActive()) return;
            orbit.approachDoor({ immediate });
        }, ENTER_ZOOM_DELAY);
        return () => clearTimeout(t);
    }, [enterFlourish, cameraMode, orbit]);

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
                这些东西共用**一个**边界 `outdoorVisible`（见它的注释）——
                它们只在屋子外面存在，走廊是室内的，从走廊里不该看见沙滩。
                ⚠️ 边界里那个 `|| houseExitRequested` 不是可选项：退场滑行的
                   1.3 s 里 `hasEntered` 仍然是 true，少了它整段退场就没有地面。 */}
            {outdoorVisible && (
                <IslandGround />
            )}
            {/* 屋身（"老房子"本体：青砖墙 + 黑瓦双坡顶 + 檐下椽头）。
                走廊自己每一面都是 DoubleSide，从外面看是一大片没细节的白板
                —— 这是 L1「背面清单」抓到的头号洞。见 entrance/HouseShell.jsx。
                ⚠️ 条件比邻居多一个 `houseExitRequested`：退出动画是**从走廊里
                   滑到院门外**，那一刻 hasEntered 还是 true，卸掉屋身就会在滑
                   出去的过程中看见白板。
                ⚠️ 屋身的**前墙就是那座门楼**（门洞 + 窗洞都开在它上面），
                   不再有独立的门脸，也没有四面院墙（`CourtyardWalls` 已删）。
                ⚠️ 还要把 `corridorVisible` 传下去：屋身的**后端封口**是一堵
                   22 宽的墙，而走廊只有 7 宽 —— 只要走廊画出来，那堵墙就横在
                   走廊里（用户报的「进门时身后一堵黑墙，2 秒后消失」）。
                   见 `HouseShell` 里那段注释。 */}
            {outdoorVisible && (
                <HouseShell corridorVisible={corridorVisible} />
            )}
            {/* 门外竹篱笆围的开放小院（WO-6 第 ② 条）。只围外三面，
                正前方留口给甬路 —— 详见 entrance/ForecourtFence.jsx。 */}
            {outdoorVisible && (
                <ForecourtFence />
            )}
            {outdoorVisible && (
                <DreamForest lowTier={isLowTier} />
            )}

            {/* === 前院的小飞机（WO-18）===
                停机位在左院草地中心（`utils/flightPath.js` 的 `PARKED`），
                点它进飞行模式。边界是 `outdoorVisible || flight.active`：
                飞行中它必须**一直画着**（相机在它身上），哪怕场景状态
                因为别的原因翻成了"屋里"。 */}
            {(outdoorVisible || flight.active) && (
                <Airplane />
            )}

            {/* === 自由飞行调试相机（?fly 才开）===
                挂在最后：它只在 URL 带 ?fly 时写相机，其余时候整个 hook 空转。 */}
            <DebugFlyCamera />

            {/* === 飞行模式的相机所有者（点飞机 / ?flight）===
                它在 `cameraMode === FLIGHT` 时每帧写相机，其余时候空转。
                退出时只把 `position` / `quaternion` 写回 —— **`fov` 根本不用
                存**，因为这套镜头把"长焦"换算成了推拉距离，投影矩阵从头到尾
                没被碰过（⇒ 残留结构上不存在）。见 FlightCamera 的文件头。 */}
            <FlightCamera enabled={cameraMode === CAMERA_MODE.FLIGHT} />

            {/* === 飞行视图的「单趟电影后期」（WO-29）===
                颗粒 + 辉光 + 饱和度。它**接管这一帧的渲染**：场景先渲进一张
                render target，再渲一趟全屏 quad 加后期。

                🔴 挂载条件与 `FlightCamera` **同一条** —— 而且这里用
                   「挂不挂载」而不是「挂上之后内部 return」，是为了让
                   "不飞行时零影响"成为**结构性**的事实：组件不在场 ⇒
                   R3F 的 `internal.priority` 是 0 ⇒ 它自己那一句渲染照常跑，
                   管线与改动前逐位相同。详见 FlightFinish.jsx 的文件头。 */}
            {cameraMode === CAMERA_MODE.FLIGHT && (
                <FlightFinish />
            )}

            {/* === COURTYARD SEASON BED (四季声床) ===
                🔴 边界**故意**是 `!hasEntered`，**不是** `outdoorVisible` ——
                视觉那一套可以（而且必须）在退场滑行时留着，声音不行：
                退场那 1.3 s 里 `hasEntered` 仍是 true、走廊声床还在响，
                这一层要是在此时挂上就变成**两个声床同时响**，而
                「院子声床与走廊 / 房间互斥」是写在结构上的硬约束
                （见 hard-rules 的音频一节 + `audio/CourtyardAmbience.jsx`）。
                退场结束后 `markExited()` 把 `hasEntered` 置回 false，
                这一层自然回来 —— 1.3 s 的静默换掉一次双声床，值。
                详见 audio/CourtyardAmbience.jsx 的注释。 */}
            {!hasEntered && (
                <CourtyardAmbience />
            )}

            {/* === ENTRANCE DOORS (visible until entered) ===
                `onStart` 在推门那一帧就开走廊（见 corridorVisible 的说明）：
                门一开，门洞里必须已经有一段廊，否则就是一片空。 */}
            {/* === ENTRANCE DOORS ===
                `onStart` 在推门那一帧就开走廊（见 corridorVisible 的说明）：
                门一开，门洞里必须已经有一段廊，否则就是一片空。
                🔴 边界是 `outdoorVisible`（不是 `!hasEntered`）—— 这一条就是
                   「退出门口时的 BUG」的根：退场滑行时 `hasEntered` 还是 true，
                   用 `!hasEntered` 会让门框 / 门扇 / 对联 / 匾额**整组消失**，
                   而屋身的前墙还画着 ⇒ 用户看到"一堵青砖墙 + 一个光洞"。 */}
            {outdoorVisible && (
                <EntranceDoors
                    position={ENTRANCE_POSITION}
                    onStart={handleEntranceStart}
                    onComplete={handleEntranceComplete}
                    /* 退场：门从"开着"往回关（1.3 s，与滑行等长）。
                       不传这个的话，退场那一刻 EntranceDoors 是**新挂上**的、
                       门是关的，而相机要从门洞里退出去 ⇒ 穿过关着的门板，
                       整屏门神年画闪 0.2~0.3 s。见 EntranceDoors 的 swingShut。 */
                    swingShut={houseExitRequested}
                />
            )}

            {/* Separate SignSystem to avoid fragment nesting issues if any */}
            {outdoorVisible && (
                <SignSystem position={ENTRANCE_POSITION} />
            )}

            {/* === 季生天象（雨幕 / 落雪）=== §6.4，WO-3，C 档。
                它是**院子**的天象，进了走廊 / 房间自然卸载 —— 在室内看到雨丝
                才是 bug。边界跟 `outdoorVisible`（退场那 1.3 s 相机在院子里，
                没有它就会"出了门却没有雨"）。
                挂在这里而不是 EntranceDoors 里：那一层带着 ENTRANCE_POSITION
                的位移，而天象是**挂在相机上**的，坐标系必须干净。 */}
            {outdoorVisible && (
                <WeatherLayer />
            )}

            {/* === 天上的云（WO-20 摆位 / WO-30 形体）===
                用户：「飞机飞行的效果没有案例好，能尽量对齐吗？包括天空、
                **云彩**这些。」形状沿用 `utils/cloudArt.js` 的水墨云素描，
                颜色每帧从**天空穹顶的 uniform** 派生（见 SkyClouds 的文件头）。

                ⚠️ 边界与 `Airplane` 同一条（`outdoorVisible || flight.active`）：
                   飞行中相机在天上，云必须一直画着，哪怕场景状态因为别的原因
                   翻成了"屋里"。

                ⚠️ WO-30 起多传一个 `lowTier`：片元里的 fbm 阶数跟着性能分级走
                   （低端机少算两级噪声）。**不是**开关式的挂载/卸载 ——
                   云的几何与 draw 数在任何档位都一样，只有片元贵贱不同。 */}
            {(outdoorVisible || flight.active) && (
                <SkyClouds lowTier={isLowTier} />
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

