import { useMemo } from 'react';
import * as THREE from 'three';
import { INK_WALL_FRAG, WARM_CEILING_FRAG, makeRoomMaterial, makeFloorMaterial, bakeWorldUVs, WORLD_UV_VERT } from '../../../shaders/roomSurfaces';
import { trimTexture } from '../../../utils/proceduralTextures';
import { sharedGeometry } from '../../../engine/resources';

// Import constants to match CorridorSegment logic
// Note: In a real project these might be in a shared config file.
// For now, we duplicate the values to avoid circular dependencies or complex imports if check is not rigorous.
const WALL_X_OUTER = 3.5;
const WALL_X_INNER = 1.7;
// Note: DOOR_Z_SPAN = 4 (from CorridorSegment)

// NOTE: the old `DoorWallSegment` (a camera-tilting wall for the angled walls
// beside doors) was removed — it was never rendered and the angled door walls
// are now owned by DoorSection.jsx.

/**
 * CorridorWalls Component
 * 
 * Renders the floor, ceiling, and the Sawtooth Walls.
 * 
 * @param {Array} doorPositions - Array of door objects with { relativeZ, side, ... }
 * @param {number} zClip - Optional Z value to clip geometry (hide anything with Z > zClip)
 */
const CorridorWalls = ({ zStart = 10, length = 80, doorPositions = [], zClip = 100000 }) => {
    const corridorHeight = 3.5;
    const CORRIDOR_WIDTH = 7;

    // =============================================
    // SURFACES — all procedural, zero image textures
    // =============================================
    // The floor is a warm light-oak plank surface drawn by GLSL, the ceiling a
    // warm-white plaster shader, and the walls carry an ink-wash landscape
    // (INK_WALL_FRAG) — they used to be a flat meshBasicMaterial in #f7f1e6,
    // which is what left the corridor reading as an empty tube. Only the
    // baseboard keeps a texture, generated on canvas instead of shipped as a
    // webp.
    const FLOOR_TILE_LENGTH = 10;
    const ceilingMaterial = useMemo(
        () => makeRoomMaterial(WARM_CEILING_FRAG, CORRIDOR_WIDTH, FLOOR_TILE_LENGTH),
        []
    );
    const wallMaterial = useMemo(
        // WORLD_UV_VERT, not ROOM_VERT: the ink wash reads vUv in world metres
        // and uses vViewZ to fade hairline detail with distance.
        () => makeRoomMaterial(INK_WALL_FRAG, CORRIDOR_WIDTH, corridorHeight, {}, WORLD_UV_VERT),
        []
    );
    const baseboardTexture = useMemo(() => trimTexture('corridor-baseboard'), []);

    // Calculate effective geometry based on clipping
    // We only render from Math.min(zStart, zClip) down to (zStart - length)
    const effectiveStart = Math.min(zStart, zClip);
    const effectiveLength = effectiveStart - (zStart - length);
    const effectiveEndZ = effectiveStart - effectiveLength;

    // ---- FLOOR ----------------------------------------------------------
    // ONE plane per segment instead of a run of 10-unit tiles. The plank
    // layout is authored in world metres (baked into the UVs), so it runs
    // continuously through the segment instead of restarting every tile —
    // which is what produced the unnatural cross-corridor lines.
    //
    // 橡木地板（默认，uPaving = 0）。
    //
    // ⚠️ 这里曾经是 方砖墁地，理由是"过道是交通空间，青砖黑瓦的墙下铺暖橡木
    // 等于把两个世纪放进同一张画面"。**2026-10-07 用户决定改回来**：走进去
    // 是一整条冷灰方砖，屋子不像屋子，而且要"温馨一点"。年代解释权归用户。
    // 那个理由留在 `roomSurfaces.js` 的 uPaving 分支里，方砖本身没有删——
    // 想改回方砖只要把这个 `paving: true` 加回来。
    const floorMaterial = useMemo(() => makeFloorMaterial(), []);
    const floorGeometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(effectiveLength, CORRIDOR_WIDTH);
        // Mesh rotation is [-PI/2, 0, -PI/2]: local Y -> world X, local X -> world Z.
        return bakeWorldUVs(geo, effectiveLength, CORRIDOR_WIDTH, (lx, ly) => [
            ly,                       // world X (across the corridor)
            effectiveEndZ + lx        // world Z (along the corridor)
        ]);
    }, [effectiveLength, effectiveEndZ]);

    // =============================================
    // REGULACJA PRZYCIĘCIA LISTWY PRZY DRZWIACH
    // =============================================
    // O ile (w unitach 3D) skrócić listwę z każdej strony przy ramce drzwi.
    // Zwiększ wartość → większa przerwa między listwą a drzwiami.
    // Zmniejsz wartość → listwa bliżej drzwi (może najeżdżać na ramkę).
    const BASEBOARD_DOOR_MARGIN = 0.5;

    // Helper to generate wall segments for a side ('left' or 'right')
    const generateWallSegments = (side) => {
        const segments = [];
        const isLeft = side === 'left';
        const baseX = isLeft ? -WALL_X_OUTER : WALL_X_OUTER;
        const innerX = isLeft ? -WALL_X_INNER : WALL_X_INNER;

        // We build the wall from Start (High Z) to End (Low Z).
        // Current 'cursor' for Z
        let currentZ = effectiveStart;
        const endZ = effectiveStart - effectiveLength;

        // Sort doors by relativeZ descending (closest to start first) if needed
        // relativeZ is negative (-18, -32...). -18 > -32.
        const sideDoors = doorPositions
            .filter(d => d.side === side)
            .sort((a, b) => b.relativeZ - a.relativeZ);

        sideDoors.forEach(door => {
            const doorZ = zStart + door.relativeZ; // Use original zStart for correct world position
            const doorStartZ = doorZ + 2.0; // Start of angled section
            const doorEndZ = doorZ - 2.0;   // End of angled section

            // Skip doors that are completely clipped (starts "behind" us)
            if (doorStartZ > currentZ) return;
            // Also skip if door is fully "ahead" of us (shouldn't happen with standard logic but safe)
            if (doorEndZ < endZ) return;

            // 1. Straight Filler Segment (from currentZ to doorStartZ)
            if (currentZ > doorStartZ) {
                const segLength = currentZ - doorStartZ;
                const segCenterZ = currentZ - segLength / 2;
                segments.push({
                    type: 'filler',
                    position: [baseX, 0, segCenterZ],
                    rotation: [0, isLeft ? Math.PI / 2 : -Math.PI / 2, 0],
                    width: segLength,
                    isLeft,
                    // Ten segment kończy się przy drzwiach (od strony niższego Z)
                    trimLowZ: true
                });
            }

            // 2. Connector (Step Out) - The wall that faces the camera
            // Wait, if we are at baseX (Outer), and we want to start angled wall?
            // Actually, the angled wall GOES from Outer to Inner.
            // So we are rightfully at Outer.
            // Wait, the "Filler" is at Outer (Recessed).
            // So we are already at the start point of the angled wall.
            // No connector needed BEFORE the door?
            // Let's trace Left Wall (-X):
            // Filler is at x = -3.5.
            // Angled wall starts at x = -3.5.
            // Angled wall ends at x = -1.7.
            // So continuous join. Good.

            // 3. Angled Wall (Door holder)
            // From (baseX, doorStartZ) to (innerX, doorEndZ).
            const dx = innerX - baseX;
            const dz = doorEndZ - doorStartZ; // Negative (-4)
            const dist = Math.sqrt(dx * dx + dz * dz);
            // atan2(dx, dz). Left: dx = 1.8, dz = -4. Angle ~ 155 deg.
            // Standard wall normal is 90 deg.
            // We want rotation around Y.
            // Center of segment:
            const midX = (baseX + innerX) / 2;
            const midZ = (doorStartZ + doorEndZ) / 2;

            // Rotation:
            // Plane defaults to facing +Z (if simple plane)? No planeGeometry defaults to XY plane.
            // LookAt approach is easiest.
            // Wall normal should point inwards?
            // Actually simpler: Position geometry center and rotate.
            // Vector from Start to End: (dx, 0, dz).
            // Rotation Y = -atan2(dz, dx).
            // Left: dx=1.8, dz=-4. atan2(-4, 1.8) = -1.14 rad ~ -65 deg.
            // -(-65) = 65 deg.
            // Check: 0 deg = +X alignment. 90 deg = -Z alignment.
            // 65 deg = Pointing mostly +X, slightly -Z.
            // This aligns with vector.
            // Normal is +90 deg from that?
            // Left: dx=1.8, dz=-4. atan2(-4, 1.8) = -1.14 rad. -(-1.14) = +1.14. 
            // Normal (+0.9, +0.4) -> Right/Back. Correct for Left Wall.
            // Right: dx=-1.8, dz=-4. atan2(-4, -1.8) = -1.9 rad (-110deg). -(-1.9) = +1.9. 
            // Normal (+0.3, -0.9)? No. Check Math.
            // We need Right Wall Normal to point (-X, +Z). 
            // Adding PI fixes the backface issue.

            const baseRotation = -Math.atan2(dz, dx);
            const finalRotation = isLeft ? baseRotation : baseRotation + Math.PI;

            segments.push({
                type: 'door',
                position: [midX, 0, midZ],
                rotationY: finalRotation,
                width: dist,
                side: side  // For dynamic tilt direction
            });

            // 4. Reset Connector (The hidden face)
            // We are now at (innerX, doorEndZ).
            // We need to return to (baseX, doorEndZ).
            // Or (baseX, doorEndZ - eps).
            // This is a straight wall segment facing AWAY (-Z direction).
            // Left: From -1.7 to -3.5. Vector (-1.8, 0).
            // Facing -Z? Normal should be -Z.
            // Only need to render it.
            const connWidth = Math.abs(baseX - innerX);
            const connX = (innerX + baseX) / 2;

            segments.push({
                type: 'connector',
                position: [connX, 0, doorEndZ],
                rotation: [0, 0, 0], // Plane facing +Z.
                // If Face +Z, and we view from +Z, we see it.
                // We want it facing -Z (Away).
                // So Rotation Y = PI.
                rotationY: Math.PI,
                width: connWidth
            });

            currentZ = doorEndZ;
        });

        // Final filler segment
        if (currentZ > endZ) {
            const segLength = currentZ - endZ;
            const segCenterZ = currentZ - segLength / 2;
            segments.push({
                type: 'filler',
                position: [baseX, 0, segCenterZ],
                rotation: [0, isLeft ? Math.PI / 2 : -Math.PI / 2, 0],
                width: segLength,
                isLeft,
                // Ten segment zaczyna się zaraz po drzwiach (od strony wyższego Z)
                trimHighZ: currentZ !== effectiveStart
            });
        }

        return segments;
    };

    // Cheap (a handful of small objects) — recomputed inline rather than
    // memoized so the hook order stays simple and correct.
    const leftSegments = generateWallSegments('left');
    const rightSegments = generateWallSegments('right');

    // ---- WALL PANELS ----------------------------------------------------
    // The wall is one quad per filler segment. Each gets world-space UVs baked
    // in (see INK_WALL_FRAG) so the ink wash runs continuously through the
    // corridor instead of restarting at every panel — the same treatment the
    // floor gets. Memoized because baking rewrites the geometry's UV
    // attribute, which is not something to redo on every render.
    const wallPanels = useMemo(
        () => [...leftSegments, ...rightSegments]
            .filter((seg) => seg.type === 'filler')
            .map((seg) => ({
                ...seg,
                geometry: bakeWorldUVs(
                    new THREE.PlaneGeometry(seg.width, corridorHeight),
                    seg.width, corridorHeight,
                    (lx, ly) => [
                        // Local +X runs along the wall: left wall points at
                        // world -Z, right wall at world +Z. Converting both to
                        // world Z parameterises the two walls by the same
                        // corridor coordinate, so a bamboo clump on the left
                        // is mirrored by one directly opposite it.
                        seg.isLeft ? seg.position[2] - lx : seg.position[2] + lx,
                        ly + corridorHeight / 2,   // 0 at the floor, 3.5 at the ceiling
                    ],
                ),
            })),
        // generateWallSegments() reads exactly these; it is recreated each
        // render, so it cannot itself be a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [effectiveStart, effectiveLength, zStart, doorPositions]
    );

    // If fully clipped, render nothing. Kept AFTER every hook call so the hook
    // order stays identical on each render.
    if (effectiveLength <= 0) return null;

    return (
        <group>
            {/* =============================================
                PODŁOGA - Kafelki (FLOOR TILES)
                =============================================
                Każdy kafelek jest płaskim plane z teksturą kawalekpodlogi.webp
                Co drugi kafelek jest obrócony o 180° i lustrzanie odbity
                żeby fajnie się łączyły ze sobą.
                
                USTAWIENIA DO RĘCZNEJ REGULACJI:
                - TILE_LENGTH: długość jednego kafelka (w unitach 3D)
                - TILE_WIDTH: szerokość (powinna pasować do korytarza = 7)
                - FLOOR_START_OFFSET: przesunięcie startu podłogi
            */}
            {/* =============================================
                PODŁOGA - jednolity pas desek (SINGLE PLANK FLOOR)
                =============================================
                Wcześniej: kafelki 10-unitowe z bitmapą (co drugi obrócony
                i lustrzany). Teraz jeden płaski plane na segment, a układ
                desek liczy shader w przestrzeni świata (patrz
                bakeWorldUVs) — dzięki temu deski biegną nieprzerwanie
                przez cały korytarz, bez sztucznych linii w poprzek.
            */}
            <mesh
                position={[0, -corridorHeight / 2, effectiveEndZ + effectiveLength / 2]}
                rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
                geometry={floorGeometry}
                material={floorMaterial}
            />


            {/* Ceiling with procedural warm-white plaster */}
            {(() => {
                const tileLength = FLOOR_TILE_LENGTH; // Match floor tile length
                const tileWidth = CORRIDOR_WIDTH;     // Ceiling width (matching corridor)
                const tiles = [];
                const ceilingY = corridorHeight / 2;

                // Use same global Z alignment as floor
                const segmentEndZ = effectiveEndZ;

                // First tile position with fine-tuned offset (same as floor)
                const CEILING_START_OFFSET = 2; // Match floor offset
                const firstTileIndex = Math.floor(effectiveStart / tileLength);
                let tileZ = firstTileIndex * tileLength - tileLength / 2 + CEILING_START_OFFSET;

                while (tileZ + tileLength / 2 > segmentEndZ) {
                    tiles.push(
                        <mesh
                            key={`ceiling-tile-${tileZ.toFixed(1)}`}
                            position={[0, ceilingY, tileZ]}
                            rotation={[Math.PI / 2, 0, 0]}
                            material={ceilingMaterial}
                        >
                            <primitive object={sharedGeometry('plane', tileWidth, tileLength)} attach="geometry" />
                        </mesh>
                    );
                    tileZ -= tileLength;
                }
                return tiles;
            })()}

            {/* Render Wall Segments with the ink-wash shader */}
            {/* Skip 'connector' and 'door' segments - door segments are now handled by DoorSection */}
            {wallPanels
                .map((seg, i) => {
                    // Baseboard texture clone
                    // Texture: 512x32 px canvas tile → natural tile 2.524 units wide
                    const bbTexture = baseboardTexture.clone();
                    bbTexture.needsUpdate = true;
                    bbTexture.wrapS = bbTexture.wrapT = THREE.RepeatWrapping;
                    bbTexture.rotation = 0; // CRITICAL: reset rotation (shared texture may have PI/2 from threshold)
                    bbTexture.offset.set(0, 0);
                    const NATURAL_TILE_W = 2.524;
                    bbTexture.repeat.set(seg.width / NATURAL_TILE_W, 1);

                    // =============================================
                    // PRZYCINANIE LISTWY PRZY DRZWIACH
                    // =============================================
                    // Listwa jest węższa o BASEBOARD_DOOR_MARGIN z każdej strony
                    // gdzie segment sąsiaduje z drzwiami (trimStart / trimEnd).
                    // Środek listwy jest przesunięty, żeby wyrównać do ściany.
                    // trimHighZ = przytnij od strony wyższego Z (gdzie zaczyna się wnęka drzwi)
                    // trimLowZ  = przytnij od strony niższego Z  (gdzie kończy się wnęka drzwi)
                    const bbMarginHighZ = seg.trimHighZ ? BASEBOARD_DOOR_MARGIN : 0;
                    const bbMarginLowZ = seg.trimLowZ ? BASEBOARD_DOOR_MARGIN : 0;
                    const bbWidth = seg.width - bbMarginHighZ - bbMarginLowZ;

                    // Przesunięcie środka listwy wzdłuż osi lokalnej (X w przestrzeni grupy)
                    // Segment jest obrócony, więc lokalna oś X = wzdłuż ściany.
                    // Po rotacji +PI/2 (lewa ściana): lokalna oś +X → świat -Z (niższy Z)
                    // Po rotacji -PI/2 (prawa ściana): lokalna oś +X → świat +Z (wyższy Z)
                    // Dlatego offset jest odwrócony między lewą a prawą ścianą.
                    let bbOffsetX;
                    if (seg.isLeft) {
                        // +X lokalny = -Z świat = strona lowZ
                        bbOffsetX = (bbMarginLowZ - bbMarginHighZ) / 2;
                    } else {
                        // +X lokalny = +Z świat = strona highZ
                        bbOffsetX = (bbMarginHighZ - bbMarginLowZ) / 2;
                    }

                    return (
                        <group key={i} position={seg.position} rotation={seg.rotation || [0, seg.rotationY, 0]}>
                            {/* Main Wall Segment — ink-wash landscape, UVs in world metres */}
                            <mesh geometry={seg.geometry} material={wallMaterial} />

                            {/* Baseboard (Listwa przypodłogowa) - przycięta przy drzwiach */}
                            <mesh position={[bbOffsetX, -corridorHeight / 2 + 0.075, 0.01]}>
                                <primitive object={sharedGeometry('plane', bbWidth, 0.15)} attach="geometry" />
                                <meshBasicMaterial color="#ffffff"
                                    map={bbTexture}
                                    roughness={0.8}
                                    side={THREE.DoubleSide}
                                />
                            </mesh>
                        </group>
                    );
                })}



            {/* Baseboards (Approximated or skip for complex geo for now) */}
            {/* Simplified: Just skip baseboards on zigzag for MVP efficiency */}
        </group>
    );
};

export default CorridorWalls;
