import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { getPaintingMaterial } from '../../../shaders/paintings';
import { sharedGeometry } from '../../../engine/resources';

/**
 * PaintingCanvas - the canvas inside a corridor picture frame, drawn entirely
 * by a GLSL fragment shader (src/shaders/paintings.js). Zero bitmaps.
 *
 * The material is SHARED per (name, aspect) and never disposed: the corridor
 * recycles segments on every scroll, and disposing a material while three.js
 * is still polling `gl.compileAsync` can throw outside the promise chain and
 * stall the preloader.
 */

// The shared material's clock is advanced once per rendered frame, not once
// per frame on screen — a dozen frames can share the same material.
let paintClockLast = -1;
let paintClockTime = 0;

const PaintingCanvas = ({ name, width, height, isActive = false }) => {
    const material = useMemo(
        () => getPaintingMaterial(name, width / height),
        [name, width, height]
    );

    useFrame((state, delta) => {
        const now = state.clock.elapsedTime;
        if (now !== paintClockLast) {
            paintClockLast = now;
            paintClockTime += delta * (isActive ? 1.0 : 0.22);
        }
        material.uniforms.uTime.value = paintClockTime;
    });

    return (
        <mesh position={[0, 0, 0.01]}>
            <primitive object={sharedGeometry('plane', width, height)} attach="geometry" />
            <primitive object={material} attach="material" />
        </mesh>
    );
};

export default PaintingCanvas;
