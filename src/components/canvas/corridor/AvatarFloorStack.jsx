import { useMemo } from 'react';
import * as THREE from 'three';

import {
    makeTechLogoTexture,
    TECH_STACK_LAYOUT,
    TECH_STACK_TILE,
} from '../../../utils/techLogosArt';
import { sharedGeometry } from '../../../engine/resources';

/**
 * AvatarFloorStack — the ten tech marks ZEO has conquered, lying on the
 * corridor floor behind him.
 *
 * ONE PLANE PER MARK. An earlier pass stamped all ten onto a single wide canvas
 * and laid that down as one plane. Two things went wrong with it:
 *
 *   1. It read as a sheet of paper on the floor. Ten marks sharing one sheet
 *      have to share one transform, so they could not each be turned to sit on
 *      their own plank, and the eye grouped them into a single decal.
 *   2. It painted straight over the avatar. `renderOrder` outranks the
 *      back-to-front sort that transparent objects rely on, and the sheet was
 *      set to `renderOrder={1}` against the avatar's default 0 — so the sheet
 *      was drawn *after* ZEO and landed on his legs. The plane is now left at
 *      the default order, which lets the sort do its job: every tile is further
 *      down the corridor than he is, so he is drawn last and stays in front.
 *
 * The art itself is drawn from SVG path data — see utils/techLogosArt.js, which
 * also carries the layout and the reasoning behind the x columns.
 */

/**
 * The corridor floor plane sits at -corridorHeight / 2 = -1.75. A few
 * millimetres of clearance plus `polygonOffset` keeps the tiles off it without
 * a visible float.
 */
const FLOOR_Y = -1.744;

const AvatarFloorStack = ({ avatarLocalZ = -0.3 }) => {
    const tiles = useMemo(
        () =>
            TECH_STACK_LAYOUT.map((slot) => ({
                ...slot,
                texture: makeTechLogoTexture(slot.id),
                size: TECH_STACK_TILE * slot.s,
            })).filter((tile) => tile.texture),
        []
    );

    return (
        <group>
            {tiles.map((tile) => (
                <mesh
                    key={tile.id}
                    position={[tile.x, FLOOR_Y, avatarLocalZ - tile.back]}
                    rotation={[-Math.PI / 2, 0, (tile.rot * Math.PI) / 180]}
                >
                    <primitive object={sharedGeometry('plane', tile.size, tile.size)} attach="geometry" />
                    <meshBasicMaterial
                        map={tile.texture}
                        transparent={true}
                        depthWrite={false}
                        polygonOffset={true}
                        polygonOffsetFactor={-4}
                        polygonOffsetUnits={-4}
                        toneMapped={false}
                        side={THREE.FrontSide}
                    />
                </mesh>
            ))}
        </group>
    );
};

export default AvatarFloorStack;
