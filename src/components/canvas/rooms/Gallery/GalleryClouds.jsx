import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CLOUD_SPRITES, cloudTintFor } from '../../../../config/theme';
import { reducedMotion } from '../../../../hooks/useReducedMotion';
import { colorizeCloud } from '../../../../utils/colorizeCloud';
import { makeCloudTexture } from '../../../../utils/cloudArt';
import { sharedGeometry } from '../../../../engine/resources';

/**
 * GalleryClouds Component
 * Static clouds scattered randomly above the gallery room
 */
const GalleryClouds = ({ count = 12, seed = 42, rotationOffset = [0, -Math.PI / 3, 0] }) => {
    // Movement boundaries - must match StaticCloud
    const startX = 40;
    const endX = -40;
    const totalDistance = startX - endX;

    const clouds = useMemo(() => {
        const items = [];
        const random = seededRandom(seed);

        for (let i = 0; i < count; i++) {
            const y = 6 + random() * 8; // High above
            const z = -5 - random() * 30; // Depth variation
            const driftSpeed = 0.1 + random() * 0.15;

            // Równomierny offset dla każdej chmury - rozłożone po całej szerokości
            // Każda chmura startuje w innym miejscu na osi X
            const initialOffset = (i / count) * totalDistance + random() * 3;

            // Oblicz początkową pozycję X jakby chmura już była w ruchu
            const initialX = startX - (initialOffset % (totalDistance + 10)) + 5;

            items.push({
                id: i,
                position: [initialX, y, z],  // Pozycja już przeliczona!
                scale: 0.5 + random() * 1.2,
                opacity: 0.4 + random() * 0.3,
                textureIndex: Math.floor(random() * CLOUD_SPRITES.length),
                driftSpeed: driftSpeed,
                initialOffset: initialOffset,  // Zapamiętaj offset do animacji
            });
        }

        return items;
    }, [count, seed]);

    return (
        <group>
            {clouds.map((cloud) => (
                <StaticCloud
                    key={cloud.id}
                    position={cloud.position}
                    scale={cloud.scale}
                    opacity={cloud.opacity}
                    textureIndex={cloud.textureIndex}
                    driftSpeed={cloud.driftSpeed}
                    initialOffset={cloud.initialOffset}
                    rotationOffset={rotationOffset}
                />
            ))}
        </group>
    );
};

// Static cloud component (billboard with continuous drift)
const StaticCloud = ({ position, scale, opacity, textureIndex, driftSpeed, initialOffset, rotationOffset }) => {
    const meshRef = useRef();
    const basePosition = useRef(position);

    // Movement boundaries
    const startX = 40;  // Start from right
    const endX = -40;   // Exit to left
    const totalDistance = startX - endX;

    // Draw the cloud sketch at runtime (canvas 2D) instead of shipping eight
    // bitmaps, then paint it — both steps are cached, so this is safe to run on
    // every render.
    const sprite = CLOUD_SPRITES[textureIndex];
    const sketch = useMemo(
        () => makeCloudTexture(textureIndex, sprite.aspect),
        [textureIndex, sprite.aspect],
    );
    const texture = useMemo(
        () => colorizeCloud(sketch, cloudTintFor(textureIndex)),
        [sketch, textureIndex],
    );

    // The aspect has to come from the table, not the texture: the generator is
    // told what aspect to draw into, and the plane has to match it exactly or
    // the cloud gets squashed.
    const aspectRatio = sprite.aspect || 1.8;
    const width = 2.5 * scale;
    const height = width / aspectRatio;

    useFrame(({ camera, clock }) => {
        if (!meshRef.current) return;

        // prefers-reduced-motion：云不再横穿房间，停在 JSX 给的初始 position。
        // billboard（朝向相机）**照常跑** —— 那是让平面不侧翻，不是"运动"；
        // 停掉它云会在侧视时变成一条线。
        if (!reducedMotion()) {
            // Continuous linear movement from right to left with looping
            // initialOffset zapewnia że każda chmura startuje w innym miejscu
            const time = clock.getElapsedTime();
            const progress = ((time * driftSpeed + initialOffset) % (totalDistance + 10)) - 5;
            const currentX = startX - progress;

            meshRef.current.position.x = currentX;
            meshRef.current.position.y = basePosition.current[1];
            meshRef.current.position.z = basePosition.current[2];
        }

        // Billboard - always face camera with rotation offset
        const offsetRotation = new THREE.Euler(rotationOffset[0], rotationOffset[1], rotationOffset[2]);
        const offsetQuaternion = new THREE.Quaternion().setFromEuler(offsetRotation);
        meshRef.current.quaternion.copy(camera.quaternion).multiply(offsetQuaternion);
    });

    return (
        <mesh ref={meshRef} position={position}>
            <primitive object={sharedGeometry('plane', width, height)} attach="geometry" />
            <meshBasicMaterial color="#ffffff"
                map={texture}
                transparent
                opacity={opacity}
                depthWrite={false}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
};

function seededRandom(seed) {
    let s = seed;
    return function () {
        s = Math.sin(s * 9999) * 10000;
        return s - Math.floor(s);
    };
}

export default GalleryClouds;
