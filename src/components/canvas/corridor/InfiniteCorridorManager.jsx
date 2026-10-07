import { useState, useCallback, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

import CorridorSegment, { SEGMENT_LENGTH } from './CorridorSegment';
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

    // Segment 0 spans Z = 10 .. -70, segment 1 spans -70 .. -150, and so on.
    // Only the far edge is needed here: "how far past the end am I?" is asked
    // against the camera's own segment index, not against a fixed world Z —
    // see the comment inside the frame loop for why.
    const endZ = 10 - (segmentIndex * SEGMENT_LENGTH) - SEGMENT_LENGTH;

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
        // camera can, because it starts at z=28 while segment 0 begins at z=10,
        // and NOTHING CLAMPS targetZ (see useInfiniteCamera: scrolling back is
        // unbounded). So as soon as the user stepped back past z=40, segment 0
        // failed `z > 40` and switched itself off while the camera was still
        // looking straight down it — the rooms vanished and stayed gone until
        // the user walked forward past z=40 again.
        //
        // Comparing segment indices instead makes the test independent of where
        // the camera's Z happens to be: "is this segment more than one step
        // ahead of the one I am standing in?"
        const cameraSegment = Math.floor((10 - z) / SEGMENT_LENGTH);
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
        return Math.floor((10 - z) / SEGMENT_LENGTH);
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

    return (
        <group>
            {activeSegments.map((segmentIndex) => (
                <SegmentVisibilityWrapper key={`seg-wrap-${segmentIndex}`} segmentIndex={segmentIndex}>
                    <CorridorSegment
                        key={`segment-${segmentIndex}`}
                        segmentIndex={segmentIndex}
                        onDoorEnter={onDoorEnter}
                        hideSegmentDoors={hideDoorsForSegments.includes(segmentIndex)}
                        zClip={clipSegmentNeg1 && segmentIndex === -1 ? 22 : 100000}
                        setCameraOverride={setCameraOverride}
                    />
                </SegmentVisibilityWrapper>
            ))}
        </group>
    );
};

export default InfiniteCorridorManager;
