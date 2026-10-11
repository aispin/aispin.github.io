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
        // camera can, because it starts at z=28 while segment 0 begins at
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
 * hideDoorsForSegments: Array of segment indices that should hide their SegmentDoors
 * (used during entrance to avoid duplicate doors while keeping content preloaded)
 */
const InfiniteCorridorManager = ({
    onDoorEnter,
    hideDoorsForSegments = [], // Segments that should hide their SegmentDoors
    clipSegmentNeg1 = false, // Whether to clip segment -1 at EntranceDoors
    setCameraOverride // Function to take over camera control
}) => {
    const { camera } = useThree();
    // Pre-mount segments 0 and 1 so shaders compile during preloader.
    // Segment -1 is NOT pre-mounted to avoid visual collision with entrance doors.
    // It mounts dynamically when camera reaches entrance (behind camera = invisible stutter).
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
     * 🔴 未入场时**整段摘掉段号 < 0 的段**。
     *
     * 走廊的可见几何不能露到露天的院子里 —— 露出来从上面看就是院子正中间
     * 一大片暖白顶（带墨色远山），而院子本该是露天的。段 0 的前沿正好钉在
     * 后罩墙（`CORRIDOR_FRONT_Z` = `INTERIOR_FRONT_Z`）上，所以凡是段号 < 0
     * 的段**整段**都落在院子那一侧 —— 摘掉即可。
     *
     * 旧做法是 `zClip = 22` 硬裁段 −1 的几何，但那个做法有两个洞：
     *   · 天花板瓦片按 10 单位网格对齐（`CorridorWalls` 的 `firstTileIndex`），
     *     段 −1 的瓦片正好落在 z = 17（跨 12..22）—— 硬裁也铺满院子；
     *   · 裁剪面（22）与段前沿（10）不重合 ⇒ `hasEntered` 翻转时墙和顶的
     *     面板尺寸变化，画面上会跳一下。
     * 整段摘掉两个洞都没有，而且连装饰 / 大锯齿门 / 涂鸦一起带走了
     * （`CorridorDecorations` **不认** `zClip`，它只按 zOffset 摆东西）。
     *
     * 入场后段 −1 / −2 照常挂回来：那时它们全在相机**背后**（相机落点 ≈ z 0.5，
     * 段 −1 从 z = 84.15 到 4.15），所以挂载是隐形的。
     */
    const visibleSegments = clipSegmentNeg1
        ? activeSegments.filter((segmentIndex) => segmentIndex >= 0)
        : activeSegments;

    return (
        <group>
            {visibleSegments.map((segmentIndex) => (
                <SegmentVisibilityWrapper key={`seg-wrap-${segmentIndex}`} segmentIndex={segmentIndex}>
                    <CorridorSegment
                        key={`segment-${segmentIndex}`}
                        segmentIndex={segmentIndex}
                        onDoorEnter={onDoorEnter}
                        hideSegmentDoors={hideDoorsForSegments.includes(segmentIndex)}
                        // 硬保险：任何段都不许在室内前端面之前画东西。
                        // 段 0 的前沿正好等于它 ⇒ 对所有段都是 no-op，纯粹是兜底。
                        zClip={CORRIDOR_FRONT_Z}
                        setCameraOverride={setCameraOverride}
                    />
                </SegmentVisibilityWrapper>
            ))}
        </group>
    );
};

export default InfiniteCorridorManager;
