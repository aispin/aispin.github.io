import { useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { SURFACE_VERT, GRASS_FRAG, makeSurfaceUniforms } from '../../../shaders/entranceTextures';
import { OUTDOOR_DROP } from '../../../config/entranceMetrics';
import { sharedGeometry } from '../../../engine/resources';
// 草地也要跟着季节走 —— 它与甬路的草边共用 grassSurface()，见下面的说明。
// 用 useSeasonUniforms 而不是 useMemo(..., [season])：换季只能**就地**改
// uniform 的 .value，换对象 three 不会重新上传（原因见那个 hook 的注释）。
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';

/**
 * EmptyCorridor Component
 * 
 * Simple corridor walls for loading phase.
 * No doors, no decorations, no ZEO - just the corridor structure.
 * Used during preloader auto-scroll.
 */
const EmptyCorridor = ({ camera }) => {
    const corridorWidth = 25; // Wide floor
    const corridorHeight = 3.5; // Standard height for floor level calculation
    const [segmentBase, setSegmentBase] = useState(0);

    // Update segment base when camera moves to a new segment (not every frame)
    useFrame(() => {
        if (!camera) return;
        const segmentLength = 40;
        const newBase = Math.floor(camera.position.z / segmentLength) * segmentLength;
        if (newBase !== segmentBase) {
            setSegmentBase(newBase);
        }
    });

    // Generate corridor segments around camera
    const segments = useMemo(() => {
        const result = [];
        for (let i = -2; i <= 2; i++) {
            result.push(segmentBase + i * 40);
        }
        return result;
    }, [segmentBase]);

    return (
        <group>
            {segments.map((zStart) => (
                <CorridorSegmentEmpty
                    key={zStart}
                    zStart={zStart}
                    corridorWidth={corridorWidth}
                    corridorHeight={corridorHeight}
                />
            ))}
        </group>
    );
};

/**
 * Single empty corridor segment
 */
const CorridorSegmentEmpty = ({ zStart, corridorWidth, corridorHeight }) => {
    const length = 40;
    const zCenter = zStart - length / 2;

    // The outdoor ground sits a deliberate 0.34 below the indoor floor plane.
    //
    // Two things are load-bearing here and they are different sizes:
    //
    // 1. The 0.04 of it that keeps the lawn off the corridor floor. Before any
    //    of this, the grass field and the corridor's own floor were both exactly
    //    on y = -1.75. The grass is 25 units wide and tiles the whole
    //    neighbourhood, so while the entrance is still mounted it is coplanar
    //    with the 7-unit-wide corridor floor over the doorway stretch
    //    (z ≈ 10..22). The camera flies from z 28 to 11 during the entrance,
    //    i.e. straight through that overlap, and two coplanar surfaces seen from
    //    a moving camera don't just z-fight — the depth test flips wholesale as
    //    the view distance changes, so the corridor floor appears to flash green
    //    a few times on the way in, until `hasEntered` unmounts the grass.
    //
    // 2. The other 0.30, which is the gate's 踏跺. The lawn is the street: a
    //    real 宅门 is entered by stepping up off it onto the 台明 and over the
    //    门槛. With the street level with the threshold there is nothing to
    //    step up, and the gate reads as a wall with doors in it. See
    //    OUTDOOR_DROP in config/entranceMetrics.
    //
    // Both drops are ~3000x the depth-buffer resolution at that distance, so
    // neither is a tuned number — any gap that clears one depth step works.
    const GROUND_DROP = OUTDOOR_DROP + 0.04;

    // Procedural grass field (zero image assets). Replaces the old white
    // paper floor that read as a blank slab either side of the stone path.
    //
    // uOrigin is the plane's vUv=(0,0) corner in TRUE world XZ, and the
    // shader flips the v axis (`uOrigin + world * vec2(1, -1)`) because a
    // -PI/2-rotated plane's v runs against world +Z. This plane sits at
    // z = zCenter, so vUv=(0,0) is at world z = zCenter, not zCenter - 20.
    // The old off-by-half-a-tile origin was only ever a per-tile decorrelator;
    // with the true corner the grass is genuinely world-stable, so it no
    // longer repeats every 40 units — and, more importantly, it now shares a
    // frame with the stone path's verge, which is what removes the seam
    // between the path and the lawn (see GRASS_GLSL in shaders/entranceTextures.js).
    const grassUniforms = useSeasonUniforms(
        (season) => makeSurfaceUniforms(
            corridorWidth,
            length,
            [-corridorWidth / 2, zCenter],
            season
        ),
        [corridorWidth, length, zCenter]
    );

    return (
        <group>
            {/* Grass floor — sits just under floor level so the stone path
                (y = floorY + 0.02) still reads as a flush walkway on top. */}
            <mesh
                position={[0, -(corridorHeight / 2) - GROUND_DROP, zCenter]}
                rotation={[-Math.PI / 2, 0, 0]}
            >
                <primitive object={sharedGeometry('plane', corridorWidth, length)} attach="geometry" />
                <shaderMaterial
                    vertexShader={SURFACE_VERT}
                    fragmentShader={GRASS_FRAG}
                    uniforms={grassUniforms}
                />
            </mesh>
        </group>
    );
};

export default EmptyCorridor;
