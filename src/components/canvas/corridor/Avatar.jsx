import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion } from '../../../hooks/useReducedMotion';
import { sharedGeometry } from '../../../engine/resources';

/**
 * Avatar Component - ZEO IP character waving in the corridor
 *
 * The artwork is a single sprite strip (4 poses in a row, normalised so the
 * feet share one baseline and the body centre sits in the middle of each
 * cell). The strip is cut into frames HERE, in code, with a 2D canvas — so
 * the repo carries one asset instead of nine, and the frames arrive as
 * GPU-ready CanvasTextures.
 *
 * The four poses are deliberately near-identical: same body, same stance,
 * only the right forearm and hand move, and only by a little. The previous
 * strip was drawn as four separate full-body poses, so ping-ponging it read
 * as the whole character snapping between positions — a flapping, exaggerated
 * wave. A real greeting is one hand, small, slow.
 *
 * Effects:
 * - Ping-pong wave animation (1-2-3-4-3-2-1) at WAVE_FPS
 * - Parallax depth effect on scroll
 * - Dodges to the side when the camera walks up to it
 */

const AVATAR_STRIP = '/textures/corridor/avatar_zeo.webp';
const STRIP_COLUMNS = 4;

/**
 * Height of the avatar plane, in world units.
 *
 * The strip is normalised so the figure fills ~94 % of its cell height (the
 * previous strip filled 91.7 %), and this number is the PLANE height, so the
 * raw value would silently make the character 3 % taller than it used to be.
 * 2.3 × (0.9167 / 0.9438) keeps the on-screen figure exactly where it was.
 */
const BASE_HEIGHT = 2.235;

/**
 * Wave tempo. It was 7 fps, which on a 4-frame loop is a full hand cycle
 * roughly every 0.9 s — a nervous flutter, and at that rate the eye reads
 * every pose difference as a jump. 3 fps gives a ~2 s cycle: the hand drifts
 * up and back down, which is what a person actually does when they wave at
 * someone across a courtyard.
 */
const WAVE_FPS = 3;

const Avatar = ({ position = [10, -20, 30] }) => {
    const meshRef = useRef();
    const groupRef = useRef();
    const { camera } = useThree();

    // --- frames, sliced out of the strip on the fly ---
    const [frames, setFrames] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const image = new Image();
        image.decoding = 'async';

        image.onload = () => {
            if (cancelled) return;

            const cellW = Math.floor(image.width / STRIP_COLUMNS);
            const cellH = image.height;
            const cut = [];

            for (let i = 0; i < STRIP_COLUMNS; i++) {
                const canvas = document.createElement('canvas');
                canvas.width = cellW;
                canvas.height = cellH;
                canvas.getContext('2d').drawImage(
                    image,
                    i * cellW, 0, cellW, cellH,
                    0, 0, cellW, cellH
                );

                const texture = new THREE.CanvasTexture(canvas);
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.generateMipmaps = false;
                texture.needsUpdate = true;
                cut.push(texture);
            }

            setFrames(cut);
        };

        image.src = AVATAR_STRIP;

        return () => { cancelled = true; };
    }, []);

    // Free the canvas textures when the avatar leaves the scene.
    useEffect(() => () => {
        frames?.forEach((texture) => texture.dispose());
    }, [frames]);

    const dimensions = useMemo(() => {
        const aspect = frames ? frames[0].image.width / frames[0].image.height : 340 / 720;
        return { width: BASE_HEIGHT * aspect, height: BASE_HEIGHT };
    }, [frames]);

    // Dodge state
    const dodgeX = useRef(0);
    const targetDodgeX = useRef(0);
    const worldPosVec = useRef(new THREE.Vector3());

    // Animation control refs
    const currentFrame = useRef(0);
    const isReversing = useRef(false);
    const frameTimer = useRef(0);

    // Set the first frame once, so there is no white flash on mount.
    useEffect(() => {
        if (!frames || !meshRef.current) return;
        meshRef.current.material.map = frames[0];
        meshRef.current.material.needsUpdate = true;
    }, [frames]);

    // Main animation loop
    useFrame((state, delta) => {
        if (!groupRef.current || !meshRef.current || !frames) return;

        // === DODGE LOGIC ===
        groupRef.current.getWorldPosition(worldPosVec.current);
        const distance = camera.position.z - worldPosVec.current.z;

        const DODGE_START = 3;
        const DODGE_PEAK = 0;
        const DODGE_END = -2;
        const DODGE_AMOUNT = -1.5;

        if (distance > DODGE_PEAK && distance < DODGE_START) {
            const t = (DODGE_START - distance) / (DODGE_START - DODGE_PEAK);
            targetDodgeX.current = DODGE_AMOUNT * easeOutQuad(t);
        } else if (distance <= DODGE_PEAK && distance > DODGE_END) {
            const t = (distance - DODGE_END) / (DODGE_PEAK - DODGE_END);
            targetDodgeX.current = DODGE_AMOUNT * easeOutQuad(t);
        } else {
            targetDodgeX.current = 0;
        }

        dodgeX.current = THREE.MathUtils.lerp(dodgeX.current, targetDodgeX.current, 0.08);

        groupRef.current.position.x = position[0] + dodgeX.current;
        groupRef.current.position.y = position[1];

        // === FRAME ANIMATION LOGIC (PING-PONG) ===
        // Using delta for consistent speed regardless of monitor Hz
        // prefers-reduced-motion：把 7fps 的挥手逐帧动画冻在当前帧。躲闪逻辑
        // 在上面、照常跑 —— 那是相机推近时角色让开，属于用户驱动的运动。
        if (reducedMotion()) return;

        const frameDuration = 1 / WAVE_FPS;

        frameTimer.current += delta;

        if (frameTimer.current >= frameDuration) {
            frameTimer.current = 0;

            if (currentFrame.current >= STRIP_COLUMNS - 1) {
                isReversing.current = true;
            } else if (currentFrame.current <= 0) {
                isReversing.current = false;
            }

            currentFrame.current += isReversing.current ? -1 : 1;

            const safeIndex = Math.max(0, Math.min(STRIP_COLUMNS - 1, currentFrame.current));
            meshRef.current.material.map = frames[safeIndex];
            meshRef.current.material.needsUpdate = true;
        }
    });

    return (
        <group ref={groupRef} position={position}>
            <mesh ref={meshRef}>
                <primitive object={sharedGeometry('plane', dimensions.width, dimensions.height)} attach="geometry" />
                <meshBasicMaterial color="#ffffff"
                    transparent={true}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
};

// Easing function
const easeOutQuad = (t) => t * (2 - t);

export default Avatar;
