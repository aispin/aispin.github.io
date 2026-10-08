import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import { playBark, playWindChime, playSwallow } from '../../../audio/sfx';
import { setGuitarCursor } from '../../../utils/guitarCursor';
import { reducedMotion } from '../../../hooks/useReducedMotion';
import { sharedGeometry } from '../../../engine/resources';
import { makeCurtainTexture, makeWindowInteriorTexture } from '../../../utils/entranceArt';
import { useSitePreferences } from '../../../context/SitePreferences';

/**
 * Procedural entrance props — built purely from Three.js geometry,
 * no image assets (project convention: 尽量不用图片).
 *
 *  - WindChime      replaces the hanging mouse picture
 *  - WhiteDog       replaces the cat picture (blinking eyes, wagging tail)
 *  - WoodenPlanter  replaces the pot_with_duck picture (keeps the easter
 *                   egg as 3D geometry — the duck is now a rabbit)
 *  - SwallowNest    燕子窝 above the door — mud bowl + two swallows; clicking
 *                   it plays a synthesized twitter
 */

const WOOD = '#8B5E3C';
const WOOD_DARK = '#6F4A2F';

/* ------------------------------------------------------------------ */
/* Wind chime — string + wooden cap + bronze tubes + clapper            */
/* ------------------------------------------------------------------ */

const CHIME_TUBES = [
    { x: -0.065, z: 0, len: 0.30 },
    { x: 0.065, z: 0, len: 0.34 },
    { x: 0, z: -0.065, len: 0.27 },
    { x: 0, z: 0.065, len: 0.24 }
];

export function WindChime({ position }) {
    const chimeRef = useRef();
    // Extra swing kicked in by a click, on top of the idle breeze.
    const swingRef = useRef({ amp: 0 });

    const handleChimeClick = (e) => {
        e.stopPropagation();
        playWindChime(1);
        // Give the click a visible response too: the tubes get knocked hard
        // and ring down over ~1.5s.
        swingRef.current.amp = 0.6;
    };

    useFrame((state, delta) => {
        const swing = swingRef.current;
        // amp 的衰减**永远**要跑：点击累积下来的摆幅不清零的话，用户之后
        // 关掉"减少动态效果"会被一记迟到的巨幅摇摆吓到。
        if (swing.amp > 0.001) {
            swing.amp *= Math.pow(0.03, delta);
        } else {
            swing.amp = 0;
        }

        if (!chimeRef.current) return;

        // prefers-reduced-motion：钟停在竖直位，点击时也不再甩 ——
        // 点击的反馈由 playWindChime() 的声音承担，不需要靠晃。
        if (reducedMotion()) {
            chimeRef.current.rotation.z = 0;
            chimeRef.current.rotation.x = 0;
            return;
        }

        const t = state.clock.elapsedTime;
        chimeRef.current.rotation.z =
            Math.sin(t * 1.3) * 0.12 + swing.amp * Math.sin(t * 9.0);
        chimeRef.current.rotation.x =
            Math.sin(t * 0.9 + 1.3) * 0.08 + swing.amp * 0.35 * Math.cos(t * 7.0);
    });

    return (
        <group position={position}>
            {/* hanging string */}
            <mesh position={[0, -0.25, 0]}>
                <primitive object={sharedGeometry('cylinder', 0.008, 0.008, 0.5, 6)} attach="geometry" />
                <meshStandardMaterial color="#8A7A5E" roughness={1} />
            </mesh>

            <group ref={chimeRef} position={[0, -0.5, 0]}>
                {/* wooden cap */}
                <mesh>
                    <primitive object={sharedGeometry('cylinder', 0.11, 0.09, 0.06, 16)} attach="geometry" />
                    <meshStandardMaterial color={WOOD} roughness={0.85} />
                </mesh>

                {/* bronze tubes */}
                {CHIME_TUBES.map((tube, i) => (
                    <mesh
                        key={i}
                        position={[tube.x, -tube.len / 2 - 0.04, tube.z]}
                    >
                        <primitive object={sharedGeometry('cylinder', 0.016, 0.016, tube.len, 10)} attach="geometry" />
                        <meshStandardMaterial color="#C9A86A" metalness={0.55} roughness={0.35} />
                    </mesh>
                ))}

                {/* clapper */}
                <mesh position={[0, -0.17, 0]}>
                    <primitive object={sharedGeometry('sphere', 0.035, 12, 12)} attach="geometry" />
                    <meshStandardMaterial color={WOOD_DARK} roughness={0.8} />
                </mesh>
            </group>

            {/* invisible hitbox: click to ring the chime */}
            <mesh
                position={[0, -0.55, 0]}
                onClick={handleChimeClick}
                onPointerEnter={() => setGuitarCursor('pointer')}
                onPointerLeave={() => setGuitarCursor('auto')}
            >
                <primitive object={sharedGeometry('box', 0.44, 0.62, 0.36)} attach="geometry" />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
        </group>
    );
}

/* ------------------------------------------------------------------ */
/* White dog — sitting, blinking eyes, wagging tail, floppy ears        */
/* Origin at ground level between the front paws.                       */
/* ------------------------------------------------------------------ */

const FUR = '#F7F3EA';
const FUR_SHADE = '#E7DFCF';
const EAR = '#D9B48F';
const NOSE = '#3A2E28';

/**
 * Gaze targets for the dog.
 *
 * The entrance camera sits at world (0, 0.2, ~22) while the dog stands at
 * x = -1.5, so a dog that stares straight down +Z reads as "looking past you,
 * off to the side". These base angles point it at the camera — i.e. at the
 * middle of the screen — and the pointer then nudges it around that target.
 */
const GAZE_BASE_YAW = 0.075;    // turn slightly toward +X (screen centre)
const GAZE_BASE_PITCH = -0.05;  // and slightly up
const GAZE_POINTER_YAW = 0.18;  // pointer travel, radians
const GAZE_POINTER_PITCH = 0.12;
const PUPIL_TRAVEL_X = 0.013;
const PUPIL_TRAVEL_Y = 0.010;

/**
 * The dog is modelled ~1.20 local units tall (paw to ear tip). At the gate's
 * scale — DOOR_HEIGHT is 2.55 units against a real 大门 leaf of ~2.2 m, so
 * ~0.86 m per unit — that made it a metre-tall animal. Next to the 门槛 it
 * read as a pony, and its head came up to the middle of the 春联.
 *
 * A 中华田园犬 stands about 0.40 m at the shoulder and ~0.60 m to the top of
 * the head, i.e. ~0.70 units here. 1.20 × 0.58 = 0.70.
 *
 * Applied to the OUTER group so `position` stays a world-space anchor and the
 * click-hop amplitude (0.32, authored against the old size) shrinks with the
 * body instead of launching a small dog half a metre into the air.
 */
const DOG_SCALE = 0.58;

export function WhiteDog({ position }) {
    const dogGroupRef = useRef();
    const headRef = useRef();
    const tailRef = useRef();
    const earLRef = useRef();
    const earRRef = useRef();
    const eyeLRef = useRef();
    const eyeRRef = useRef();
    const pupilRefs = useRef([]);
    const blinkState = useRef({ next: 1.2, timer: 0 });
    const jumpingRef = useRef(false);

    // Click: bark + hop (small cooldown to avoid spam)
    const handleDogClick = (e) => {
        e.stopPropagation();
        if (jumpingRef.current) return;
        jumpingRef.current = true;

        playBark(0.9);

        if (dogGroupRef.current) {
            // `dogGroupRef` is the group INSIDE <group position={position}>, so
            // its position is a LOCAL offset from the dog's world anchor — the
            // rest pose is y = 0, not `position[1]`. Animating to `position[1]`
            // (=-1.73 here) dropped the dog straight through the floor, which
            // is why it "disappeared" on click. Hop relative to whatever the
            // local rest y happens to be.
            const restY = dogGroupRef.current.position.y;
            gsap.timeline({
                onComplete: () => { jumpingRef.current = false; }
            })
                .to(dogGroupRef.current.position, {
                    y: restY + 0.32,
                    duration: 0.2,
                    ease: 'power2.out'
                })
                .to(dogGroupRef.current.position, {
                    y: restY,
                    duration: 0.35,
                    ease: 'bounce.out'
                });
        } else {
            jumpingRef.current = false;
        }
    };

    useFrame((state, delta) => {
        const t = state.clock.elapsedTime;
        // prefers-reduced-motion：尾巴和耳朵的持续摆动停掉，眨眼也停 ——
        // 但眼睛要显式撑开，否则正好在"闭眼"那一帧被冻住会一直眯着。
        // 视线跟随（GAZE）保留：那是跟着鼠标的，用户自己驱动的。
        const still = reducedMotion();

        // Tail wag
        if (tailRef.current) tailRef.current.rotation.z = still ? 0 : Math.sin(t * 4.2) * 0.4;

        // Subtle ear sway
        if (earLRef.current) earLRef.current.rotation.z = still ? 0.5 : 0.5 + Math.sin(t * 0.7) * 0.04;
        if (earRRef.current) earRRef.current.rotation.z = still ? -0.5 : -0.5 - Math.sin(t * 0.7 + 0.5) * 0.04;

        // Blinking: quick close every 1.6-4.4s
        const b = blinkState.current;
        if (still) {
            b.timer = 0;
        } else {
            b.next -= delta;
            if (b.next <= 0) {
                b.timer = 0.13;
                b.next = 1.6 + Math.random() * 2.8;
            }
            if (b.timer > 0) b.timer -= delta;
        }
        const eyeScale = b.timer > 0 ? 0.08 : 1;
        if (eyeLRef.current) eyeLRef.current.scale.y = eyeScale;
        if (eyeRRef.current) eyeRRef.current.scale.y = eyeScale;

        // === GAZE ===
        // Default: look at the camera (screen centre). The pointer adds a
        // gentle head turn + pupil travel on top of that target.
        const px = state.pointer?.x ?? 0;
        const py = state.pointer?.y ?? 0;
        const k = 1 - Math.pow(0.002, delta);

        if (headRef.current) {
            const yaw = GAZE_BASE_YAW + px * GAZE_POINTER_YAW;
            const pitch = GAZE_BASE_PITCH - py * GAZE_POINTER_PITCH;
            headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, yaw, k);
            headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, pitch, k);
        }

        const pOffX = PUPIL_TRAVEL_X * (px + GAZE_BASE_YAW * 2.4);
        const pOffY = -PUPIL_TRAVEL_Y * (py - GAZE_BASE_PITCH * 2.4);
        pupilRefs.current.forEach((p) => {
            if (!p) return;
            p.position.x = THREE.MathUtils.lerp(p.position.x, pOffX, k);
            p.position.y = THREE.MathUtils.lerp(p.position.y, pOffY, k);
        });
    });

    return (
        <group position={position} scale={DOG_SCALE}>
            <group ref={dogGroupRef}>
                {/* haunches (back) */}
            <mesh position={[0, 0.3, -0.16]} scale={[1.05, 0.8, 0.7]}>
                <primitive object={sharedGeometry('sphere', 0.34, 20, 20)} attach="geometry" />
                <meshStandardMaterial color={FUR} roughness={0.9} />
            </mesh>
            {/* chest / body */}
            <mesh position={[0, 0.42, 0.04]} scale={[0.72, 1, 0.62]}>
                <primitive object={sharedGeometry('sphere', 0.38, 20, 20)} attach="geometry" />
                <meshStandardMaterial color={FUR} roughness={0.9} />
            </mesh>
            {/* front legs */}
            {[-0.13, 0.13].map((x) => (
                <mesh key={x} position={[x, 0.18, 0.2]}>
                    <primitive object={sharedGeometry('capsule', 0.072, 0.24, 4, 10)} attach="geometry" />
                    <meshStandardMaterial color={FUR} roughness={0.9} />
                </mesh>
            ))}
            {/* paws */}
            {[-0.13, 0.13].map((x) => (
                <mesh key={x} position={[x, 0.05, 0.24]} scale={[1, 0.6, 1.4]}>
                    <primitive object={sharedGeometry('sphere', 0.08, 12, 12)} attach="geometry" />
                    <meshStandardMaterial color={FUR_SHADE} roughness={0.9} />
                </mesh>
            ))}
            {/* tail (wagging) */}
            <group ref={tailRef} position={[0, 0.48, -0.36]}>
                <mesh position={[0, 0.1, -0.09]} rotation={[0.9, 0, 0]}>
                    <primitive object={sharedGeometry('capsule', 0.05, 0.22, 4, 10)} attach="geometry" />
                    <meshStandardMaterial color={FUR} roughness={0.9} />
                </mesh>
            </group>

            {/* head — turns slightly toward the pointer (see GAZE above) */}
            <group ref={headRef} position={[0, 0.92, 0.14]}>
                <mesh scale={[1, 0.95, 0.95]}>
                    <primitive object={sharedGeometry('sphere', 0.26, 20, 20)} attach="geometry" />
                    <meshStandardMaterial color={FUR} roughness={0.9} />
                </mesh>
                {/* snout */}
                <mesh position={[0, -0.06, 0.2]} scale={[0.8, 0.62, 0.9]}>
                    <primitive object={sharedGeometry('sphere', 0.13, 16, 16)} attach="geometry" />
                    <meshStandardMaterial color={FUR_SHADE} roughness={0.9} />
                </mesh>
                {/* nose */}
                <mesh position={[0, -0.02, 0.31]} scale={[1.1, 0.8, 0.8]}>
                    <primitive object={sharedGeometry('sphere', 0.045, 12, 12)} attach="geometry" />
                    <meshStandardMaterial color={NOSE} roughness={0.6} />
                </mesh>
                {/* floppy ears */}
                <mesh ref={earLRef} position={[-0.22, 0.14, 0]} rotation={[0, 0, 0.5]} scale={[0.45, 1, 0.35]}>
                    <primitive object={sharedGeometry('sphere', 0.14, 12, 12)} attach="geometry" />
                    <meshStandardMaterial color={EAR} roughness={0.95} />
                </mesh>
                <mesh ref={earRRef} position={[0.22, 0.14, 0]} rotation={[0, 0, -0.5]} scale={[0.45, 1, 0.35]}>
                    <primitive object={sharedGeometry('sphere', 0.14, 12, 12)} attach="geometry" />
                    <meshStandardMaterial color={EAR} roughness={0.95} />
                </mesh>
                {/* eyes (blink by scaling Y; the pupil group carries the gaze) */}
                {[-0.1, 0.1].map((x, i) => (
                    <group
                        key={x}
                        ref={i === 0 ? eyeLRef : eyeRRef}
                        position={[x, 0.05, 0.21]}
                    >
                        <mesh>
                            <primitive object={sharedGeometry('sphere', 0.045, 12, 12)} attach="geometry" />
                            <meshStandardMaterial color="#FFFFFF" roughness={0.3} />
                        </mesh>
                        <group ref={(el) => (pupilRefs.current[i] = el)}>
                            <mesh position={[0, 0, 0.028]}>
                                <primitive object={sharedGeometry('sphere', 0.024, 10, 10)} attach="geometry" />
                                <meshStandardMaterial color="#2A201A" roughness={0.3} />
                            </mesh>
                        </group>
                    </group>
                ))}
                {/* collar */}
                <mesh position={[0, -0.2, 0.02]} rotation={[Math.PI / 2 - 0.25, 0, 0]}>
                    <primitive object={sharedGeometry('torus', 0.19, 0.028, 10, 24)} attach="geometry" />
                    <meshStandardMaterial color="#C0392B" roughness={0.6} />
                </mesh>
            </group>
            </group>{/* end dogGroupRef (jump animation target) */}

            {/* invisible click hitbox: bark + hop */}
            <mesh
                position={[0, 0.55, 0.05]}
                onClick={handleDogClick}
                onPointerEnter={() => setGuitarCursor('pointer')}
                onPointerLeave={() => setGuitarCursor('auto')}
            >
                <primitive object={sharedGeometry('box', 1.1, 1.5, 0.9)} attach="geometry" />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
        </group>
    );
}

/* ------------------------------------------------------------------ */
/* Wooden planter with green plant + rabbit (easter egg kept)           */
/* Origin at ground level, planter centered.                            */
/* ------------------------------------------------------------------ */

const GREEN_STEMS = [
    { x: -0.32, tilt: 0.25, h: 0.5 },
    { x: -0.18, tilt: -0.15, h: 0.62 },
    { x: -0.02, tilt: 0.1, h: 0.55 },
    { x: 0.12, tilt: -0.3, h: 0.45 },
    { x: -0.25, tilt: 0.4, h: 0.4 }
];

export function WoodenPlanter({ position }) {
    return (
        <group position={position}>
            {/* planter body */}
            <mesh position={[0, 0.26, 0]}>
                <primitive object={sharedGeometry('box', 1.15, 0.52, 0.5)} attach="geometry" />
                <meshStandardMaterial color={WOOD} roughness={0.85} />
            </mesh>
            {/* rim */}
            <mesh position={[0, 0.55, 0]}>
                <primitive object={sharedGeometry('box', 1.25, 0.09, 0.6)} attach="geometry" />
                <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
            </mesh>
            {/* plank groove lines */}
            {[-0.19, 0.19].map((y) => (
                <mesh key={y} position={[0, 0.26 + y, 0.255]}>
                    <primitive object={sharedGeometry('box', 1.12, 0.018, 0.01)} attach="geometry" />
                    <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
                </mesh>
            ))}
            {/* soil */}
            <mesh position={[0, 0.53, 0]}>
                <primitive object={sharedGeometry('box', 1.1, 0.04, 0.45)} attach="geometry" />
                <meshStandardMaterial color="#4A382A" roughness={1} />
            </mesh>

            {/* green plant */}
            {GREEN_STEMS.map((s, i) => (
                <group key={i} position={[s.x, 0.54, 0]} rotation={[0, 0, s.tilt]}>
                    <mesh position={[0, s.h / 2, 0]}>
                        <primitive object={sharedGeometry('cylinder', 0.013, 0.02, s.h, 6)} attach="geometry" />
                        <meshStandardMaterial color="#3F7A35" roughness={0.8} />
                    </mesh>
                    <mesh position={[0.06, s.h * 0.65, 0]} rotation={[0.4, 0, 0.6]} scale={[1, 0.35, 0.6]}>
                        <primitive object={sharedGeometry('sphere', 0.11, 10, 10)} attach="geometry" />
                        <meshStandardMaterial color={i % 2 ? '#4C8A3F' : '#5FA24A'} roughness={0.8} />
                    </mesh>
                    <mesh position={[-0.07, s.h * 0.45, 0]} rotation={[-0.4, 0, -0.6]} scale={[1, 0.35, 0.6]}>
                        <primitive object={sharedGeometry('sphere', 0.1, 10, 10)} attach="geometry" />
                        <meshStandardMaterial color={i % 2 ? '#5FA24A' : '#4C8A3F'} roughness={0.8} />
                    </mesh>
                </group>
            ))}

            {/* rabbit (easter egg — the rubber duck it replaced lived in the
                old texture). Built the same way: a handful of primitives, no
                assets. Ears are capsules rather than cones so they stay
                rounded at the tip, which is most of what reads as "rabbit".
                Shares the dog's fur palette (FUR / EAR / NOSE, above) so the
                two white animals in the yard match. */}
            <group position={[0.38, 0.6, 0.05]}>
                {/* body — an egg, tipped back a little so it sits rather than stands */}
                <mesh position={[0, 0.055, -0.01]} scale={[1.0, 1.18, 0.95]}>
                    <primitive object={sharedGeometry('sphere', 0.095, 16, 16)} attach="geometry" />
                    <meshStandardMaterial color={FUR} roughness={0.85} />
                </mesh>
                {/* head */}
                <mesh position={[0, 0.175, 0.028]}>
                    <primitive object={sharedGeometry('sphere', 0.072, 14, 14)} attach="geometry" />
                    <meshStandardMaterial color={FUR} roughness={0.85} />
                </mesh>
                {/* ears — long, upright, splayed slightly apart; tan inner face */}
                {[-0.032, 0.032].map((x, i) => (
                    <group key={x} position={[x, 0.225, 0.02]} rotation={[0.12, 0, i ? -0.22 : 0.22]}>
                        <mesh position={[0, 0.075, 0]} scale={[1, 1, 0.55]}>
                            <primitive object={sharedGeometry('capsule', 0.021, 0.11, 4, 10)} attach="geometry" />
                            <meshStandardMaterial color={FUR} roughness={0.85} />
                        </mesh>
                        <mesh position={[0, 0.075, 0.013]} scale={[0.62, 1, 0.4]}>
                            <primitive object={sharedGeometry('capsule', 0.021, 0.10, 4, 8)} attach="geometry" />
                            <meshStandardMaterial color={EAR} roughness={0.9} />
                        </mesh>
                    </group>
                ))}
                {/* eyes */}
                {[-0.03, 0.03].map((x) => (
                    <mesh key={x} position={[x, 0.19, 0.088]}>
                        <primitive object={sharedGeometry('sphere', 0.013, 8, 8)} attach="geometry" />
                        <meshStandardMaterial color={NOSE} roughness={0.35} />
                    </mesh>
                ))}
                {/* nose */}
                <mesh position={[0, 0.163, 0.098]}>
                    <primitive object={sharedGeometry('sphere', 0.011, 8, 8)} attach="geometry" />
                    <meshStandardMaterial color={EAR} roughness={0.6} />
                </mesh>
                {/* tail — the scut, a shade off the body so it reads as a puff */}
                <mesh position={[0, 0.05, -0.098]}>
                    <primitive object={sharedGeometry('sphere', 0.032, 10, 10)} attach="geometry" />
                    <meshStandardMaterial color={FUR_SHADE} roughness={0.95} />
                </mesh>
            </group>
        </group>
    );
}

/* ------------------------------------------------------------------ */
/* Rustic wooden window frame                                           */
/* ------------------------------------------------------------------ */

export function WoodenWindowFrame({ position, onPointerEnter, onPointerLeave }) {
    const W = 1.6;   // outer width
    const H = 1.6;   // outer height
    const T = 0.13;  // plank thickness

    return (
        <group position={position} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
            {/* top / bottom planks */}
            <mesh position={[0, H / 2 - T / 2, 0]}>
                <primitive object={sharedGeometry('box', W, T, T)} attach="geometry" />
                <meshStandardMaterial color={WOOD} roughness={0.85} />
            </mesh>
            <mesh position={[0, -H / 2 + T / 2, 0]}>
                <primitive object={sharedGeometry('box', W, T, T)} attach="geometry" />
                <meshStandardMaterial color={WOOD} roughness={0.85} />
            </mesh>
            {/* left / right planks */}
            <mesh position={[-W / 2 + T / 2, 0, 0]}>
                <primitive object={sharedGeometry('box', T, H, T)} attach="geometry" />
                <meshStandardMaterial color={WOOD} roughness={0.85} />
            </mesh>
            <mesh position={[W / 2 - T / 2, 0, 0]}>
                <primitive object={sharedGeometry('box', T, H, T)} attach="geometry" />
                <meshStandardMaterial color={WOOD} roughness={0.85} />
            </mesh>
            {/* cross mullions */}
            <mesh position={[0, 0, 0.01]}>
                <primitive object={sharedGeometry('box', W - T * 2, 0.05, 0.05)} attach="geometry" />
                <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
            </mesh>
            <mesh position={[0, 0, 0.01]}>
                <primitive object={sharedGeometry('box', 0.05, H - T * 2, 0.05)} attach="geometry" />
                <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
            </mesh>
            {/* sill */}
            <mesh position={[0, -H / 2 - 0.035, 0.02]}>
                <primitive object={sharedGeometry('box', W + 0.16, 0.07, 0.2)} attach="geometry" />
                <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
            </mesh>
        </group>
    );
}

/* ------------------------------------------------------------------ */
/* Window curtain — interior backdrop + rod + two tied fabric panels       */
/* Sits BEHIND the brick wall plane, visible through the window hole.     */
/* ------------------------------------------------------------------ */

function useWavyPanelGeometry(width, height, waves, amp) {
    return useMemo(() => {
        const geo = new THREE.PlaneGeometry(width, height, 16, 8);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            pos.setZ(i,
                Math.sin((x / width) * Math.PI * 2 * waves) * amp +
                Math.sin(y * 2.2) * amp * 0.35
            );
        }
        geo.computeVertexNormals();
        return geo;
    }, [width, height, waves, amp]);
}

/** The opening is 1.4 wide (uHoleWindow) and the panels are 0.56. */
const PANEL_W = 0.56;
const PANEL_H = 1.42;
const PANEL_X = 0.42;   // centres: spans -0.70..-0.14 and 0.14..0.70
const PANEL_TIE_Y = -0.06;
const PANEL_TIE_R = 0.075;

export function WindowCurtain({ position }) {
    const panelGeo = useWavyPanelGeometry(PANEL_W, PANEL_H, 3, 0.045);

    const interior = useMemo(() => makeWindowInteriorTexture(), []);
    const fabric = useMemo(() => makeCurtainTexture(), []);

    /**
     * The room is its own light source, so unlike everything else in the
     * scene it must NOT get darker at night — a lit window is the whole point
     * of a lit window. It is unlit (meshBasicMaterial), so the only way the
     * night veil can be answered is by over-driving `color` past 1: the veil
     * multiplies the frame by ~(0.40, 0.46, 0.66) afterwards, and these are
     * the values that land on a warm (0.96, 0.70, 0.44) once it has.
     *
     * Lerped in useFrame rather than set from a ternary so the window warms up
     * over the same 0.9 s as the rest of the day/night fade.
     *
     * 2026-10-08: user asked for a brighter window light. R was already at
     * 0.96 of 1.0, so the extra brightness had to come out of G and B — the
     * glow is now a lighter, more amber light rather than a deeper orange.
     *
     * The first attempt (1+1.85 / 1+0.95 / 1+0.15) measured only +8..13% on
     * the lit panes, which is below the threshold where a change is noticed at
     * all — and this was a "too dim" report, so a change nobody can see is a
     * failed change. Measured against `.workbuddy-ai/round2-2026-10-08/
     * before-night-window.png` with harness/measure-night-brightness.py.
     */
    const interiorMat = useMemo(() => new THREE.MeshBasicMaterial({
        map: interior,
        color: new THREE.Color(1, 1, 1),
    }), [interior]);

    /**
     * The window REVEAL — the sliver of wall you see past the curtain when you
     * look through the opening at an angle.
     *
     * WHY IT EXISTS: the curtain panels end exactly at the opening's edges
     * (±0.70), so at any off-axis angle the sight line through the opening
     * misses both the fabric and the 1.55-wide interior backdrop, and lands on
     * the legacy tunnel wall panel 0.65 behind — which is flat `#e0e0e0`. That
     * is a **white slit down one side of the window**, reported by the user as
     * "窗帘有一边露出了白缝隙". Measured: at the resting entrance camera it is
     * invisible; from 3.9 world units to the right it is 10px of (216,216,216)
     * — see .workbuddy-ai/round2-2026-10-08/probe-win-right.png.
     *
     * Widening the interior backdrop instead would have been the obvious fix
     * and is the wrong one: the backdrop's plane and its texture share an
     * aspect, so a 1.5x wider plane shows only the middle 58% of the room
     * painting and cuts the shelf off the side. A dark reveal plane behind it
     * costs one quad, changes nothing at rest, and turns the slit into what a
     * real window reveal looks like — the shadowed side of the opening.
     */
    const revealMat = useMemo(() => new THREE.MeshBasicMaterial({
        color: new THREE.Color('#2A1C12'),
    }), []);

    const { theme } = useSitePreferences();

    useFrame((state, delta) => {
        const target = theme === 'dark' ? 1 : 0;
        const lit = state.__curtainLit ?? (state.__curtainLit = { t: -1 });
        if (lit.t < 0) lit.t = target;
        else if (lit.t !== target) {
            const step = delta / 0.9;
            lit.t = target > lit.t ? Math.min(target, lit.t + step) : Math.max(target, lit.t - step);
        } else return;
        interiorMat.color.setRGB(
            1 + 2.15 * lit.t,
            1 + 1.25 * lit.t,
            1 + 0.30 * lit.t,
        );
        // The reveal warms with the room, or it would cut a cold dark line
        // across the edge of a glowing window at night.
        revealMat.color.setRGB(
            0.165 + 0.42 * lit.t,
            0.110 + 0.26 * lit.t,
            0.071 + 0.10 * lit.t,
        );
    });

    return (
        <group position={position}>
            {/* the room beyond. Unlit, and warmed up at night — see above. */}
            <mesh position={[0, 0, -0.075]} material={interiorMat}>
                <primitive object={sharedGeometry('plane', 1.55, 1.62)} attach="geometry" />
            </mesh>

            {/* the reveal, 0.02 further back so the two never z-fight */}
            <mesh position={[0, 0, -0.095]} material={revealMat}>
                <primitive object={sharedGeometry('plane', 2.6, 2.2)} attach="geometry" />
            </mesh>

            {/* curtain rod + finials */}
            <mesh position={[0, 0.68, 0.01]} rotation={[0, 0, Math.PI / 2]}>
                <primitive object={sharedGeometry('cylinder', 0.022, 0.022, 1.5, 10)} attach="geometry" />
                <meshStandardMaterial color={WOOD_DARK} roughness={0.8} />
            </mesh>
            {[-0.75, 0.75].map((x) => (
                <mesh key={x} position={[x, 0.68, 0.01]} rotation={[0, Math.PI / 2, 0]}>
                    <primitive object={sharedGeometry('sphere', 0.04, 10, 10)} attach="geometry" />
                    <meshStandardMaterial color={WOOD_DARK} roughness={0.8} />
                </mesh>
            ))}

            {/* Two fabric panels, gathered at the sides, tied off near the
                bottom. They used to be 0.44 wide at x = ±0.47, i.e. hanging
                right at the jamb, and painted a flat #EFE0C9 that matched the
                interior — so they read as a couple of faint slivers. Wider,
                further in, and drawn with folds and weave they hold their own
                against the room behind them. */}
            {[-1, 1].map((side) => (
                <group key={side} position={[side * PANEL_X, 0, 0.02]}>
                    <mesh geometry={panelGeo} scale={[side, 1, 1]}>
                        <meshStandardMaterial
                            map={fabric}
                            color="#FFFFFF"
                            roughness={0.95}
                            side={THREE.DoubleSide}
                        />
                    </mesh>
                    {/* the tieback — a band pinching the fabric at the waist */}
                    <mesh position={[0, PANEL_TIE_Y, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('cylinder', PANEL_TIE_R, PANEL_TIE_R, 0.035, 12)} attach="geometry" />
                        <meshStandardMaterial color="#B08A5E" roughness={0.9} />
                    </mesh>
                </group>
            ))}
        </group>
    );
}

/* ------------------------------------------------------------------ */
/* Swallow nest — 燕子窝                                                 */
/* ------------------------------------------------------------------ */
/*
 * Built in the corner above the entrance, the way the reference mock-up has
 * it. Three parts: a lathed mud bowl, a ring of mud pellets pressed onto the
 * rim, and two swallows perched on top. Clicking the nest twitters at you
 * (playSwallow) and sets both birds flapping.
 */

const NEST_MUD = '#8a6a4a';
const NEST_MUD_DARK = '#6b5238';
const NEST_STRAW = '#c9a86a';
const SWALLOW_BACK = '#242730';
const SWALLOW_WING = '#171a21';
const SWALLOW_BELLY = '#f2ead9';
const SWALLOW_BEAK = '#e8a020';

/**
 * Bowl profile for the lathe — up the outside, over the rim, back down the
 * inside to the base. `x` is the radius, `y` the height.
 */
const NEST_PROFILE = [
    [0.000, 0.000],
    [0.048, 0.000],
    [0.088, 0.010],
    [0.117, 0.038],
    [0.130, 0.077],
    [0.125, 0.100],
    [0.109, 0.104],
    [0.102, 0.080],
    [0.081, 0.047],
    [0.048, 0.017],
    [0.000, 0.010],
].map(([x, y]) => new THREE.Vector2(x, y));

/** Outer wall of the bowl, so pellets can be laid exactly on its surface. */
const NEST_OUTER = [
    [0.000, 0.000],
    [0.048, 0.000],
    [0.088, 0.010],
    [0.117, 0.038],
    [0.130, 0.077],
    [0.125, 0.100],
];

function nestRadiusAt(y) {
    for (let i = 1; i < NEST_OUTER.length; i++) {
        const [x0, y0] = NEST_OUTER[i - 1];
        const [x1, y1] = NEST_OUTER[i];
        if (y >= y0 && y <= y1 && y1 > y0) {
            return x0 + (x1 - x0) * ((y - y0) / (y1 - y0));
        }
    }
    return 0.125;
}

/**
 * Deterministic scatter of mud pellets. Spread over the whole outer wall rather
 * than just the rim — the nest is read from below, so the underside needs the
 * texture more than the top does.
 */
const NEST_PELLETS = (() => {
    const out = [];
    let seed = 7;
    const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    for (let i = 0; i < 40; i++) {
        const y = 0.012 + rnd() * 0.086;
        const a = (i / 40) * Math.PI * 2 * 1.7 + rnd() * 0.5;
        out.push({
            a,
            r: nestRadiusAt(y) * 0.96,
            y,
            s: 0.011 + rnd() * 0.010,
        });
    }
    return out;
})();

/** A few straws poking out of the rim. */
const NEST_STRAWS = [
    { a: 0.5, y: 0.098, len: 0.075, tilt: 0.5 },
    { a: 2.3, y: 0.092, len: 0.062, tilt: -0.7 },
    { a: 4.1, y: 0.100, len: 0.058, tilt: 0.35 },
    { a: 5.4, y: 0.086, len: 0.070, tilt: -0.45 },
    { a: 1.4, y: 0.094, len: 0.052, tilt: 0.8 },
    { a: 3.3, y: 0.088, len: 0.066, tilt: -0.25 },
];

/**
 * One swallow, origin at its feet, beak toward +Z. The body reads from the
 * side; the head is a separate group so it can bob and turn on its own.
 */
function Swallow({ position, rotation = [0, 0, 0], scale = 1, phase = 0, flutter }) {
    const headRef = useRef();
    const wingLRef = useRef();
    const wingRRef = useRef();

    useFrame((state) => {
        const t = state.clock.elapsedTime + phase;
        const still = reducedMotion();
        if (headRef.current) {
            // 头部的持续小幅摆动是装饰 —— 减少动态效果时摆正。
            // 扇翅（下面那段）**保留**：那是点击燕子窝才触发的，
            // 用户主动发起，去掉的话点击就没有任何反馈了。
            headRef.current.rotation.x = still ? 0 : Math.sin(t * 1.7) * 0.15;
            headRef.current.rotation.y = still ? 0 : Math.sin(t * 0.85) * 0.30;
        }
        const amp = flutter.current.amp;
        const flap = Math.sin(state.clock.elapsedTime * 36) * amp;
        if (wingLRef.current) wingLRef.current.rotation.z = 0.22 + flap * 1.15;
        if (wingRRef.current) wingRRef.current.rotation.z = -0.22 - flap * 1.15;
    });

    return (
        <group position={position} rotation={rotation} scale={scale}>
            {/* tail — two thin blades forked back */}
            {[-1, 1].map((s) => (
                <mesh key={s} position={[s * 0.014, 0.012, -0.055]} rotation={[0.1, s * 0.42, 0]}>
                    <primitive object={sharedGeometry('box', 0.008, 0.005, 0.062)} attach="geometry" />
                    <meshStandardMaterial color={SWALLOW_WING} roughness={0.85} />
                </mesh>
            ))}

            {/* body */}
            <mesh position={[0, 0.030, -0.004]} scale={[0.85, 0.9, 1.55]}>
                <primitive object={sharedGeometry('sphere', 0.028, 14, 12)} attach="geometry" />
                <meshStandardMaterial color={SWALLOW_BACK} roughness={0.8} />
            </mesh>

            {/* cream belly */}
            <mesh position={[0, 0.020, 0.008]} scale={[0.78, 0.72, 1.25]}>
                <primitive object={sharedGeometry('sphere', 0.024, 12, 10)} attach="geometry" />
                <meshStandardMaterial color={SWALLOW_BELLY} roughness={0.9} />
            </mesh>

            {/* wings */}
            <mesh ref={wingLRef} position={[-0.024, 0.036, -0.006]} rotation={[0, 0.12, 0.22]}>
                <primitive object={sharedGeometry('sphere', 0.020, 10, 8)} attach="geometry" />
                <meshStandardMaterial color={SWALLOW_WING} roughness={0.85} />
            </mesh>
            <mesh ref={wingRRef} position={[0.024, 0.036, -0.006]} rotation={[0, -0.12, -0.22]}>
                <primitive object={sharedGeometry('sphere', 0.020, 10, 8)} attach="geometry" />
                <meshStandardMaterial color={SWALLOW_WING} roughness={0.85} />
            </mesh>

            {/* head group — bobs and turns */}
            <group ref={headRef} position={[0, 0.062, 0.030]}>
                <mesh scale={[0.92, 0.92, 1]}>
                    <primitive object={sharedGeometry('sphere', 0.022, 14, 12)} attach="geometry" />
                    <meshStandardMaterial color={SWALLOW_BACK} roughness={0.8} />
                </mesh>

                {/* throat patch */}
                <mesh position={[0, -0.008, 0.012]} scale={[0.7, 0.6, 0.8]}>
                    <primitive object={sharedGeometry('sphere', 0.016, 10, 8)} attach="geometry" />
                    <meshStandardMaterial color="#b8332a" roughness={0.9} />
                </mesh>

                {/* beak */}
                <mesh position={[0, 0.002, 0.030]} rotation={[Math.PI / 2, 0, 0]}>
                    <primitive object={sharedGeometry('cone', 0.007, 0.024, 8)} attach="geometry" />
                    <meshStandardMaterial color={SWALLOW_BEAK} roughness={0.7} />
                </mesh>

                {/* eyes */}
                {[-1, 1].map((s) => (
                    <group key={s}>
                        <mesh position={[s * 0.014, 0.006, 0.014]}>
                            <primitive object={sharedGeometry('sphere', 0.006, 8, 8)} attach="geometry" />
                            <meshStandardMaterial color="#f8f6f0" roughness={0.6} />
                        </mesh>
                        <mesh position={[s * 0.016, 0.006, 0.018]}>
                            <primitive object={sharedGeometry('sphere', 0.0032, 8, 8)} attach="geometry" />
                            <meshStandardMaterial color="#12131a" roughness={0.5} />
                        </mesh>
                    </group>
                ))}
            </group>
        </group>
    );
}

/**
 * 燕子窝 — mud bowl + swallows, perched in the corner above the door.
 * Click it: the birds twitter (playSwallow) and flap.
 */
export function SwallowNest({ position }) {
    const flutter = useRef({ amp: 0 });
    const nestGeo = useMemo(() => new THREE.LatheGeometry(NEST_PROFILE, 26), []);

    const handleClick = (e) => {
        e.stopPropagation();
        playSwallow(1);
        flutter.current.amp = 1;
    };

    useFrame((state, delta) => {
        const f = flutter.current;
        if (f.amp > 0.001) {
            f.amp *= Math.pow(0.06, delta);
        } else {
            f.amp = 0;
        }
        void state;
    });

    return (
        <group position={position}>
            {/* mud bowl */}
            <mesh geometry={nestGeo}>
                <meshStandardMaterial color={NEST_MUD} roughness={1} side={THREE.DoubleSide} />
            </mesh>

            {/* dark inner hollow so the bowl reads as open */}
            <mesh position={[0, 0.070, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <primitive object={sharedGeometry('circle', 0.100, 20)} attach="geometry" />
                <meshStandardMaterial color={NEST_MUD_DARK} roughness={1} side={THREE.DoubleSide} />
            </mesh>

            {/* pressed mud pellets */}
            {NEST_PELLETS.map((p, i) => (
                <mesh key={i} position={[Math.cos(p.a) * p.r, p.y, Math.sin(p.a) * p.r]}>
                    <primitive object={sharedGeometry('sphere', p.s, 8, 6)} attach="geometry" />
                    <meshStandardMaterial
                        color={i % 3 === 0 ? NEST_MUD_DARK : NEST_MUD}
                        roughness={1}
                    />
                </mesh>
            ))}

            {/* straw */}
            {NEST_STRAWS.map((s, i) => (
                <mesh
                    key={`straw-${i}`}
                    position={[Math.cos(s.a) * 0.118, s.y, Math.sin(s.a) * 0.118]}
                    rotation={[s.tilt, -s.a, 0.3]}
                >
                    <primitive object={sharedGeometry('cylinder', 0.0022, 0.0032, s.len, 5)} attach="geometry" />
                    <meshStandardMaterial color={NEST_STRAW} roughness={1} />
                </mesh>
            ))}

            {/* the two swallows — perched on the rim, leaning over the edge */}
            <Swallow position={[0.055, 0.118, 0.066]} rotation={[0, 0.34, 0]} scale={1.12} phase={0} flutter={flutter} />
            <Swallow position={[-0.064, 0.116, 0.048]} rotation={[0, -0.26, 0]} scale={1.06} phase={1.7} flutter={flutter} />

            {/* invisible hitbox */}
            <mesh
                position={[0, 0.075, 0]}
                onClick={handleClick}
                onPointerEnter={() => setGuitarCursor('pointer')}
                onPointerLeave={() => setGuitarCursor('auto')}
            >
                <primitive object={sharedGeometry('box', 0.36, 0.32, 0.36)} attach="geometry" />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
        </group>
    );
}
