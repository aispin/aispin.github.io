import { useRef, useMemo } from 'react';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SCENE_FONTS } from '../../../config/theme';
import { BANNER_TOP_Y } from '../../../config/entranceMetrics';
import { sharedGeometry } from '../../../engine/resources';
import { makeLanternTexture } from '../../../utils/entranceArt';
import { useSitePreferences } from '../../../context/SitePreferences';

/**
 * SignSystem — minimal rustic wooden sign hanging from a beam, with a 灯笼
 * hung off the right end of it.
 *
 * Fully procedural 3D (no image assets): beam + two ropes + one clean board
 * with "ZEO STUDIO" text, plus the lantern. Keeps the gentle wind sway.
 *
 * SIZING / PLACEMENT
 * ------------------
 * The board hangs directly above the 横批, which in turn sits on the gate's
 * lintel. Both of those are geometry the gate owns, so they are read from
 * config/entranceMetrics rather than restated here.
 *
 * This used to hardcode `LINTEL_Y = 0.742` and a pixel gap measured against
 * it, with a long comment deriving both from a 2.4-tall door. When the gate
 * was made taller the lintel moved to 1.10 and this file did not, so the
 * board landed squarely on top of the 横批. The clearance below is now the
 * only number here that is a choice.
 */

const WOOD = '#8B5E3C';
const WOOD_EDGE = '#6F4A2F';
const ROPE = '#B49A72';

const BOARD_W = 1.2;
const BOARD_H = 0.42;
const BEAM_W = 1.9;
const BEAM_H = 0.16;
const ROPE_LEN = 0.14;

// Clearance between the top of the 横批 and the bottom of the board. The old
// 62 px gap was ~0.43 world units at the sign's distance; this is a shade
// tighter so the sign does not drift up the wall as the gate grows.
const GAP_ABOVE_BANNER = 0.30;

const BOARD_CY = BANNER_TOP_Y + GAP_ABOVE_BANNER + BOARD_H / 2;
const BEAM_CY = BOARD_CY + BOARD_H / 2 + ROPE_LEN + BEAM_H / 2;

/* ---- the lantern ------------------------------------------------------ */

const LANTERN_H = 0.34;
const LANTERN_R = 0.155;
/** Inboard of the beam's right end (+0.95 half-width) so the tassel does not
 *  hang past the timber it is tied to. */
const LANTERN_X = 0.78;
const LANTERN_DROP = 0.16; // rope from the underside of the beam to the cap

/** Warm at night, a plain red paper decoration by day. */
const GLOW = '#FF8A4C';
/**
 * Emissive colour for the lit paper. Deliberately a deep vivid RED, not GLOW's
 * orange: emissive is ADDED to the map, and the map is already red, so an
 * orange emissive just desaturates the whole lantern to peach. A red one
 * brightens the paper while keeping it red.
 *
 * `LANTERN_LIT` is above 1 on purpose, and not a fudge factor: the night veil
 * multiplies the entire frame by ~(0.40, 0.46, 0.66) *after* this is drawn, so
 * a lantern that only glowed at 1.0 would come out a dull brown. Over-driving
 * the emissive here is what makes it read as the light source it is. The
 * numbers: (map + 1.5 x this) x veil lands around (0.90, 0.24, 0.11) — a
 * saturated glow, not a white blob.
 */
const GLOW_EMISSIVE = '#FF3B0A';
const LANTERN_LIT = 1.5;
const GOLD = '#CE9B3E';
const GOLD_DARK = '#8A6524';
const TASSEL = '#8E1B12';

/**
 * The pumpkin profile. `sin(pi·t)^0.7` rather than a circle because a real
 * 灯笼 is cinched at both caps — a sphere reads as a beach ball. The 0.7
 * exponent fattens the shoulders so the widest point sits a little above the
 * middle, which is where a hanging lantern actually swells.
 */
function useLanternGeometry() {
    return useMemo(() => {
        const points = [];
        const N = 24;
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const r = LANTERN_R * (0.34 + 0.66 * Math.pow(Math.sin(Math.PI * t), 0.7));
            points.push(new THREE.Vector2(r, (t - 0.5) * LANTERN_H));
        }
        return new THREE.LatheGeometry(points, 28);
    }, []);
}

const Lantern = ({ x }) => {
    const { theme } = useSitePreferences();
    const night = theme === 'dark';

    const bodyRef = useRef();
    const goldRef = useRef();
    const lightRef = useRef();

    const bodyGeo = useLanternGeometry();
    const paper = useMemo(() => makeLanternTexture(), []);

    // Same eased-scalar approach as canvas/SceneLighting: one number drives
    // every part of "the lantern is lit", so the emissive skin and the light
    // it throws can never disagree.
    const t = useRef(-1);

    useFrame((state, delta) => {
        const target = night ? 1 : 0;
        if (t.current < 0) t.current = target;
        else if (t.current !== target) {
            const step = delta / 0.9;
            t.current = target > t.current
                ? Math.min(target, t.current + step)
                : Math.max(target, t.current - step);
        }

        const k = t.current;

        // A slow flicker, only visible once lit. Multiplied by k so the
        // flicker is gone at k = 0 rather than jittering in daylight.
        const flicker = 1 + Math.sin(state.clock.elapsedTime * 3.1) * 0.05 * k
            + Math.sin(state.clock.elapsedTime * 7.7) * 0.03 * k;

        if (bodyRef.current) {
            bodyRef.current.emissiveIntensity = LANTERN_LIT * k * flicker;
        }
        if (goldRef.current) {
            goldRef.current.emissiveIntensity = 0.35 * k * flicker;
        }
        if (lightRef.current) {
            lightRef.current.intensity = 2.6 * k * flicker;
        }
    });

    return (
        <group position={[x, 0, 0]}>
            {/* rope from the beam down to the cap */}
            <mesh position={[0, BEAM_CY - BEAM_H / 2 - LANTERN_DROP / 2, 0.65]}>
                <primitive object={sharedGeometry('cylinder', 0.008, 0.008, LANTERN_DROP, 6)} attach="geometry" />
                <meshStandardMaterial color={ROPE} roughness={1} />
            </mesh>

            {/* everything below hangs from that rope's end */}
            <group position={[0, BEAM_CY - BEAM_H / 2 - LANTERN_DROP, 0.65]}>
                {/* top cap (金箍) */}
                <mesh position={[0, -0.018, 0]}>
                    <primitive object={sharedGeometry('cylinder', 0.055, 0.062, 0.036, 14)} attach="geometry" />
                    <meshStandardMaterial ref={goldRef} color={GOLD} emissive={GLOW} emissiveIntensity={0} roughness={0.45} metalness={0.5} />
                </mesh>

                {/* paper body */}
                <mesh geometry={bodyGeo} position={[0, -0.036 - LANTERN_H / 2, 0]}>
                    <meshStandardMaterial
                        ref={bodyRef}
                        map={paper}
                        color="#FFFFFF"
                        emissive={GLOW_EMISSIVE}
                        emissiveIntensity={0}
                        roughness={0.72}
                        side={THREE.DoubleSide}
                    />
                </mesh>

                {/* bottom cap */}
                <mesh position={[0, -0.036 - LANTERN_H - 0.016, 0]}>
                    <primitive object={sharedGeometry('cylinder', 0.062, 0.055, 0.032, 14)} attach="geometry" />
                    <meshStandardMaterial color={GOLD_DARK} roughness={0.5} metalness={0.45} />
                </mesh>

                {/* tassel — three strands so it reads as thread, not a spike */}
                {[-0.016, 0, 0.016].map((ox, i) => (
                    <mesh
                        key={ox}
                        position={[ox, -0.036 - LANTERN_H - 0.032 - 0.055, ox * 0.5]}
                        rotation={[0, 0, i === 1 ? 0 : ox * 1.6]}
                    >
                        <primitive object={sharedGeometry('cylinder', 0.006, 0.002, 0.11, 5)} attach="geometry" />
                        <meshStandardMaterial color={TASSEL} roughness={0.95} />
                    </mesh>
                ))}

                {/* the light it throws. Zero by day, so it costs nothing until
                    the theme flips; `distance` keeps it a pool around the gate
                    rather than a wash over the whole facade. */}
                <pointLight
                    ref={lightRef}
                    position={[0, -0.036 - LANTERN_H / 2, 0.08]}
                    color={GLOW}
                    intensity={0}
                    distance={4.5}
                    decay={2}
                />
            </group>
        </group>
    );
};

const SignSystem = (props) => {
    const signGroupRef = useRef();

    useFrame((state) => {
        if (signGroupRef.current) {
            // Simple wind sway (idle animation only)
            const time = state.clock.elapsedTime;
            signGroupRef.current.rotation.x = Math.sin(time * 2) * 0.05;
        }
    });

    return (
        <group {...props}>
            {/* 1. THE MOUNT BEAM (simple rustic wood) */}
            <mesh position={[0, BEAM_CY, 0.65]}>
                <primitive object={sharedGeometry('box', BEAM_W, BEAM_H, 0.1)} attach="geometry" />
                <meshStandardMaterial color={WOOD_EDGE} roughness={0.9} />
            </mesh>

            {/* 1b. THE LANTERN, hung off the beam's right end. Outside the
                swaying group on purpose: it is tied to the timber, not to the
                board, so it must not swing with the sign. */}
            <Lantern x={LANTERN_X} />

            {/* 2. THE SIGN (sways from the rope tops) */}
            <group ref={signGroupRef} position={[0, BOARD_CY + BOARD_H / 2 + ROPE_LEN, 0.60]}>
                {/* hanging ropes */}
                {[-BOARD_W * 0.32, BOARD_W * 0.32].map((x) => (
                    <mesh key={x} position={[x, -ROPE_LEN / 2, 0]}>
                        <primitive object={sharedGeometry('cylinder', 0.011, 0.011, ROPE_LEN, 8)} attach="geometry" />
                        <meshStandardMaterial color={ROPE} roughness={1} />
                    </mesh>
                ))}

                {/* clean wooden board */}
                <mesh position={[0, -(ROPE_LEN + BOARD_H / 2), 0]}>
                    <primitive object={sharedGeometry('box', BOARD_W, BOARD_H, 0.06)} attach="geometry" />
                    <meshStandardMaterial color={WOOD} roughness={0.85} />
                </mesh>

                {/* name */}
                <Text
                    position={[0, -(ROPE_LEN + BOARD_H / 2), 0.036]}
                    fontSize={0.115}
                    color="#4A3220"
                    anchorX="center"
                    anchorY="middle"
                    maxWidth={BOARD_W * 0.86}
                    textAlign="center"
                    font={SCENE_FONTS.maple}
                >
                    ZEO STUDIO
                </Text>
            </group>
        </group>
    );
};

export default SignSystem;
