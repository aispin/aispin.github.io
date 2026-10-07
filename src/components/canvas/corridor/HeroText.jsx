import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { SCENE_FONTS } from '../../../config/theme';
import { reducedMotion } from '../../../hooks/useReducedMotion';
import { settleLerp } from '../../../utils/settle';
import { sharedGeometry } from '../../../engine/resources';

// Local font for the wordmark. Maple is the only scene face left
// (troika needs ttf/otf/woff — see config/theme.js).
const HERO_FONT_URL = SCENE_FONTS.maple;

// Global flag - draw animation only happens ONCE per page load
let hasPlayedDrawAnimation = false;

/**
 * HeroText Component - Hand-drawn Style with Sketch Fonts
 * 
 * WOW Effects for Awwwards SOTD:
 * - ZEO wordmark, splits into letters during scroll
 * - Floating micro-animations
 * - Parallax split effect
 * - RESPONSIVE: scales down on mobile
 */
const HeroText = ({ position = [0, 0.3, 0] }) => {
    const groupRef = useRef();
    const letterRefs = useRef([]);
    const { camera } = useThree();

    // Responsive scale based on screen width - FLUID (no breakpoints)
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const updateScale = () => {
            const width = window.innerWidth;
            const minWidth = 320;
            const maxWidth = 1200;
            const minScale = 0.65;
            const maxScale = 1.0;

            const clampedWidth = Math.max(minWidth, Math.min(maxWidth, width));
            const t = (clampedWidth - minWidth) / (maxWidth - minWidth);
            setScale(minScale + t * (maxScale - minScale));
        };

        updateScale();
        window.addEventListener('resize', updateScale);
        return () => window.removeEventListener('resize', updateScale);
    }, []);

    // Split and dodge state
    const splitAmount = useRef(0);
    const targetSplit = useRef(0);
    const floatY = useRef(0);
    // Pre-allocate Vector3 to avoid per-frame garbage collection
    const worldPosVec = useRef(new THREE.Vector3());

    // Letter positions for the ZEO split effect (3 letters, centred)
    const letters = useMemo(() => [
        { char: 'Z', baseX: -0.68, splitDir: -1.5, delay: 0 },
        { char: 'E', baseX: 0.00, splitDir: 0.0, delay: 0 },
        { char: 'O', baseX: 0.68, splitDir: 1.5, delay: 0 },
    ], []);

    // Animation loop
    useFrame((state, delta) => {
        if (!groupRef.current) return;

        const time = state.clock.elapsedTime;

        // === SPLIT LOGIC based on camera distance ===
        groupRef.current.getWorldPosition(worldPosVec.current);
        const distance = camera.position.z - worldPosVec.current.z;

        const SPLIT_START = 3;
        const SPLIT_PEAK = 0;
        const SPLIT_END = -2;
        const SPLIT_AMOUNT = 0.9;

        if (distance > SPLIT_PEAK && distance < SPLIT_START) {
            const t = (SPLIT_START - distance) / (SPLIT_START - SPLIT_PEAK);
            targetSplit.current = SPLIT_AMOUNT * easeOutQuad(t);
        } else if (distance <= SPLIT_PEAK && distance > SPLIT_END) {
            const t = (distance - SPLIT_END) / (SPLIT_PEAK - SPLIT_END);
            targetSplit.current = SPLIT_AMOUNT * easeOutQuad(t);
        } else {
            targetSplit.current = 0;
        }

        // settleLerp：裸 lerp 只会无限逼近 targetSplit，字母 X 位置于是永远
        // 在变 —— 相机的自动扫视（glance）本来就够小，这点残差没有任何人
        // 看得见，但它让"场景静止"在浮点上永不成立。见 utils/settle.js。
        splitAmount.current = settleLerp(splitAmount.current, targetSplit.current, 0.08);

        // Apply split to each letter of ZEO
        // prefers-reduced-motion：字母的上下浮动与轻微摇摆停掉，但**分裂**
        // 保留 —— 那是相机推近才发生的，用户自己走出来的运动，也是这个标题
        // 唯一的交互表达；去掉等于把交互删了。
        const still = reducedMotion();
        letterRefs.current.forEach((ref, i) => {
            if (ref) {
                // Ensure opacity is 1
                if (ref.material) ref.material.opacity = 1;
                ref.scale.setScalar(1); // Ensure scale is 1, no lingering pop effect

                const letter = letters[i];
                ref.position.x = letter.baseX + letter.splitDir * splitAmount.current;
                ref.position.y = still ? 0.2 : 0.2 + Math.sin(time * 0.7 + i * 0.5) * 0.015;
                ref.rotation.z = still ? 0 : Math.sin(time * 0.5 + i) * 0.02 * (1 + splitAmount.current);
            }
        });

        // === FLOATING ANIMATION ===
        floatY.current = still ? 0 : Math.sin(time * 0.5) * 0.02;
        // Don't override Y position entirely, add to base
        groupRef.current.position.y = position[1] + floatY.current;
    });

    return (
        <group ref={groupRef} position={position} scale={[scale, scale, 1]}>
            {/* ZEO Letters - fade-in animation */}
            {letters.map((letter, i) => (
                <Text
                    key={letter.char}
                    ref={(el) => (letterRefs.current[i] = el)}
                    position={[letter.baseX, 0.2, 0]}
                    fontSize={0.9}
                    font={HERO_FONT_URL}
                    color="#ffffff"
                    outlineWidth={0.012}
                    outlineColor="#1a1a1a"
                    anchorX="center"
                    anchorY="middle"
                    letterSpacing={0}
                >
                    {letter.char}
                </Text>
            ))}

            {/* Small decorative doodles around title */}
            <SmallStar position={[-1.2, 0.55, 0]} scale={0.07} />
            <SmallStar position={[1.25, 0.45, 0]} scale={0.05} />
            <SmallStar position={[-1.0, -0.6, 0]} scale={0.04} />
            <SmallStar position={[1.1, -0.55, 0]} scale={0.035} />
        </group>
    );
};

// Easing function
const easeOutQuad = (t) => t * (2 - t);

/**
 * Small decorative star - STATIC to avoid useFrame overhead
 * Parent HeroText already handles all animations
 */
const SmallStar = ({ position, scale = 0.1 }) => {
    return (
        <group position={position} scale={scale}>
            {[0, 1, 2, 3].map((i) => (
                <mesh key={i} rotation={[0, 0, (i * Math.PI) / 4]}>
                    <primitive object={sharedGeometry('plane', 1, 0.12)} attach="geometry" />
                    <meshBasicMaterial color="#333" transparent opacity={0.6} side={2} />
                </mesh>
            ))}
        </group>
    );
};

export default HeroText;
