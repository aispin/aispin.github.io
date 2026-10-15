import { useState, useCallback, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

import CorridorSegment, { SEGMENT_LENGTH, CORRIDOR_FRONT_Z } from './CorridorSegment';
import { uTimeUniform } from '../../../shaders/roomSurfaces';
import { reducedMotion } from '../../../hooks/useReducedMotion';

/**
 * Wrapper to toggle segment visibility based on camera position.
 *
 * Hiding a segment you have already walked past is what keeps the draw-call
 * count flat across an endless corridor — but getting the bounds wrong here is
 * catastrophic, because a hidden segment takes its doors with it.
 *
 * (The rooms are no longer segment-0-only: `LOOP_SPACES` in CorridorSegment
 * puts them on the same 160-unit period as the rest of the corridor, so every
 * space has doors. That makes this bound less dangerous than it used to be,
 * but it is still the thing that decides whether the user sees anything.)
 */
const SegmentVisibilityWrapper = ({ children, segmentIndex }) => {
    const groupRef = useRef();
    const { camera } = useThree();

    // Segment 0 spans Z = CORRIDOR_FRONT_Z .. CORRIDOR_FRONT_Z - 80, segment 1 the
    // next 80 down, and so on. Only the far edge is needed here: "how far past the
    // end am I?" is asked against the camera's own segment index, not against a
    // fixed world Z — see the comment inside the frame loop for why.
    const endZ = CORRIDOR_FRONT_Z - (segmentIndex * SEGMENT_LENGTH) - SEGMENT_LENGTH;

    useFrame(() => {
        if (!groupRef.current) return;

        const z = camera.position.z;

        // "Behind": the camera has walked past this segment's far edge, so it is
        // genuinely out of view. Keep a small margin so the boundary is not a
        // hard pop right at the plane.
        const isBehind = z < endZ - 5;

        // "Ahead": the camera has not reached this segment yet.
        //
        // This MUST be measured against the camera's *own* segment, not against
        // `startZ`. The previous version used `z > startZ + 30`, which is broken
        // whenever the camera stands outside the segment's own span — and the
        // camera can, because it starts at the rest pose (z=45, see
        // config/restPose.js) while segment 0 begins at
        // CORRIDOR_FRONT_Z (≈ 4.15), and NOTHING CLAMPS targetZ (see
        // useInfiniteCamera: scrolling back is unbounded). So as soon as the user
        // stepped back past z=40, segment 0 failed `z > 40` and switched itself off
        // while the camera was still looking straight down it — the rooms vanished
        // and stayed gone until the user walked forward past z=40 again.
        //
        // Comparing segment indices instead makes the test independent of where
        // the camera's Z happens to be: "is this segment more than one step
        // ahead of the one I am standing in?"
        const cameraSegment = Math.floor((CORRIDOR_FRONT_Z - z) / SEGMENT_LENGTH);
        const isAhead = segmentIndex > cameraSegment + 1;

        let isVisible = !(isBehind || isAhead);

        // Hard guarantee: never hide the segment the camera is standing in.
        // Both bounds above are heuristics; this one is a fact. If they ever
        // disagree — and they can, because `cameraSegment` is derived from the
        // same value that feeds it here — this prevents the whole corridor from
        // ever going dark in a single frame.
        if (segmentIndex === cameraSegment) isVisible = true;

        if (groupRef.current.visible !== isVisible) {
            groupRef.current.visible = isVisible;
        }
    });

    return (
        <group ref={groupRef}>
            {children}
        </group>
    );
};

/**
 * InfiniteCorridorManager Component
 * 
 * Manages dynamic generation/removal of corridor segments.
 *
 * ⚠️ 2026-10-11（WO-6）删掉了 `hideDoorsForSegments` / `clipSegmentNeg1`：
 * 前者的唯一调用是 `[-1]`（入场前把段 −1 的门摘掉），而段号 < 0 的段现在
 * **整段**不渲染，那个开关永远打不开；后者是 `zClip` 的入口，而 `zClip`
 * 本身已经被删（它是几何截断，不是裁剪面 —— 见 `CorridorWalls` 顶部）。
 *
 * `visible`（2026-10-11，WO-6 的**封口②**）
 * ----------------------------------------
 * 整条走廊只在"人在里面"时渲染。院子 / 环绕视角下它**挂载但不可见**。
 *
 * 为什么是「挂载但不可见」而不是「卸载」：
 *   ① 卸载会把上百个 shader 一起丢掉，再进来时第一帧要现场编译 —— 那正是
 *      `RoomWarmup` 存在的理由，卸载等于把它的成果扔了；
 *   ② `gl.compile()` 走的是 `scene.traverse`（**不是** `traverseVisible`，
 *      见 three 的 WebGLRenderer.compile），所以 `visible = false` 的子树
 *      照样会被预热 —— 挂载但不可见是唯一同时满足这两条的做法；
 *   ③ R3F 的渲染走 three 的 `projectObject`，那一层**会**在
 *      `object.visible === false` 时整棵子树 early-return。
 *
 * ⚠️ 但 R3F 的**事件系统不认 `visible`**（它只把带 handler 的对象逐个丢给
 *    `raycaster.intersectObject`，而那个函数只查 `layers`）。所以"隐藏"不等于
 *    "点不到" —— 门的可点范围由 `DoorSection` 自己的距离判据负责，见那边的注释。
 */
const InfiniteCorridorManager = ({
    onDoorEnter,
    visible = true, // 封口②：院子 / 环绕时整条不画
    setCameraOverride // Function to take over camera control
}) => {
    const { camera } = useThree();
    // 预热：先挂上段 0 和段 1，让它们的 shader 在 loader 期间编译完。
    // 段 −1 不预热 —— 它**永远不会**被渲染（见下面 filter 的注释），
    // 而预挂一段必然要被摘掉的几何只是白烧一次编译。
    const [activeSegments, setActiveSegments] = useState([0, 1]);

    // Calculate which segment the camera is in
    const getSegmentFromZ = useCallback((z) => {
        return Math.floor((CORRIDOR_FRONT_Z - z) / SEGMENT_LENGTH);
    }, []);

    // Update active segments based on camera position
    useFrame((state) => {
        // The one writer for the corridor's ink mural (see uTimeUniform).
        // Under reduced motion the clock is left where it is, which freezes
        // the mist and the bamboo instead of animating them.
        if (!reducedMotion()) uTimeUniform.value = state.clock.elapsedTime;

        const currentSegment = getSegmentFromZ(camera.position.z);

        // Render previous, current, and next segment
        const shouldBeActive = [
            currentSegment - 1,
            currentSegment,
            currentSegment + 1
        ];

        // Check if we need to update
        const needsUpdate = shouldBeActive.some(seg => !activeSegments.includes(seg)) ||
            activeSegments.some(seg => !shouldBeActive.includes(seg));

        if (needsUpdate) {
            setActiveSegments(shouldBeActive);
        }
    });

    /**
     * 🔴 段号 < 0 的段**永远不渲染**（2026-10-11，WO-6）。
     *
     * 走廊的可见几何不能露到露天的前院里 —— 露出来从上面看就是院子正中间
     * 一大片暖白顶（带墨色远山），而前院本该是露天的。段 0 的前沿正好钉在
     * 屋身前墙上（`CORRIDOR_FRONT_Z` = `INTERIOR_FRONT_Z` = 22.15），所以
     * 凡是段号 < 0 的段**整段**都落在屋子那一侧之外 —— 摘掉即可。
     *
     * 为什么是"永远"而不是"未入场时"：门楼并进屋身、前墙挪到 22.15 之后，
     * 相机落点（`INTERIOR_FRONT_Z − 3.65` = 18.5）**本身就在段 0 里**
     * （`floor((22.15 − 18.5) / 80) = 0`），入场后也没有任何一刻需要段 −1。
     * 只要往后退，`useInfiniteCamera` 会把相机夹在门前（见那里的注释），
     * 所以"相机掉进段 −1"这件事已经不可能发生。
     *
     * 旧做法是 `zClip = 22` 硬裁段 −1 的几何，但那个做法有两个洞：
     *   · 天花板瓦片按 10 单位网格对齐，段 −1 的瓦片正好落在 z = 17
     *     （跨 12..22）—— 硬裁也铺满院子；
     *   · 裁剪面（22）与段前沿不重合 ⇒ `hasEntered` 翻转时墙和顶的面板
     *     尺寸变化，画面上会跳一下。
     * 整段摘掉两个洞都没有，而且连装饰 / 大锯齿门 / 涂鸦一起带走了。
     *
     * 🔴 **不要再引入任何形式的裁剪面**（`zClip` 已从 `CorridorWalls` /
     * `CorridorSegment` / `CorridorDecorations` 全部删除）。它名字叫 clip，
     * 做的却是几何截断，会把整段墙 / 地板 / 天花板 `return null` 掉而**门、
     * 装饰、英雄机位照样渲染** —— 用户 2026-10-11 报的「进入房间后往后退，
     * 墙壁丢失了」就是这一条。截断的职责**只在下面这一行 filter**。
     */
    const visibleSegments = activeSegments.filter((segmentIndex) => segmentIndex >= 0);

    return (
        // `name` 是给 harness 用的：封口② 的验收判据是「环绕任何角度都看不见
        // 走廊的管子」，而"看不见"在截图上是**无法反证**的（管子可能只是被
        // 屋身挡住了）。挂个名字，探针就能直接断言 `visible === false`。
        // 见 `.workbuddy-ai/harness/probe-corridor-seal.mjs`。
        <group name="infinite-corridor" visible={visible}>
            {visibleSegments.map((segmentIndex) => (
                <SegmentVisibilityWrapper key={`seg-wrap-${segmentIndex}`} segmentIndex={segmentIndex}>
                    <CorridorSegment
                        key={`segment-${segmentIndex}`}
                        segmentIndex={segmentIndex}
                        onDoorEnter={onDoorEnter}
                        setCameraOverride={setCameraOverride}
                    />
                </SegmentVisibilityWrapper>
            ))}
        </group>
    );
};

export default InfiniteCorridorManager;
