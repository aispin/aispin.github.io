import { useMemo, Suspense, useEffect } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import {
    WARM_WALL_FRAG,
    WARM_CEILING_FRAG,
    BASEBOARD_FRAG,
    makeRoomMaterial,
    makeFloorMaterial,
    bakeWorldUVs
} from '../../../shaders/roomSurfaces';

// Eagerly import room components - textures are preloaded during the preloader phase
import GalleryRoom from '../rooms/Gallery/GalleryRoom';
import ContactRoom from '../rooms/Contact/ContactRoom';
import ContentRoom from '../rooms/ContentRoom';
import { SCENE_FONTS } from '../../../config/theme';

// Room configurations
const ROOM_CONFIG = {
    corridorWidth: 2.2,   // Wider "vestibule" feeling
    corridorHeight: 2.4,  // frameHeight - 0.1
    corridorDepth: 2,     // Shorter - quick transition
    roomWidth: 30,
    roomHeight: 20,
    roomDepth: 25
};

const SUBTITLES = {
    'THE GALLERY': 'Explore my creative projects',
    'THE STUDIO': 'Watch behind the scenes',
    'DEV DIARY': 'My development journey',
    "LET'S CONNECT": 'Get in touch with me'
};

/**
 * RoomInterior Component
 *
 * Memoized room geometry to prevent re-renders and improve performance.
 * Contains corridor + giant room at the end.
 *
 * All vestibule surfaces (floor / walls / ceiling / trim) are drawn
 * procedurally with GLSL — no image textures — so the floor is a warm wood
 * plank surface instead of the old grey-white hand-drawn bitmap, and the
 * walls + ceiling are warm white.
 */
const RoomInterior = ({ label, roomId, showRoom, onReady, isExiting }) => {
    const { corridorWidth, corridorHeight, corridorDepth, roomWidth, roomHeight, roomDepth } = ROOM_CONFIG;
    const halfDepth = corridorDepth / 2;
    const roomZ = -corridorDepth - roomDepth / 2;

    // Procedural materials for the vestibule (zero image assets)
    const materials = useMemo(() => {
        // 门厅曾经跟过道一样墁方砖（"进门第一脚就该换材质"）。用户 2026-10-07
        // 要求屋子里的地板改回橡木、要温馨，所以门厅也铺木地板 —— 和过道一致，
        // 进门不再有一块冷灰的砖地。
        const floor = makeFloorMaterial();
        const wallL = makeRoomMaterial(WARM_WALL_FRAG, corridorDepth, corridorHeight, { uBottomShade: { value: 1 } });
        const wallR = makeRoomMaterial(WARM_WALL_FRAG, corridorDepth, corridorHeight, { uBottomShade: { value: 1 } });
        const ceiling = makeRoomMaterial(WARM_CEILING_FRAG, corridorWidth, corridorDepth);
        const bbLeft = makeRoomMaterial(BASEBOARD_FRAG, corridorDepth, 0.15, { uVertical: { value: 1 } });
        const bbRight = makeRoomMaterial(BASEBOARD_FRAG, corridorDepth, 0.15, { uVertical: { value: 1 } });
        const threshold = makeRoomMaterial(BASEBOARD_FRAG, corridorWidth, 0.15, { uVertical: { value: 0 } });

        return {
            corridorFloor: floor,
            corridorWallL: wallL,
            corridorWallR: wallR,
            corridorCeiling: ceiling,
            bbLeft,
            bbRight,
            threshold,
            // Room materials (keep flat for rooms that have their own content)
            // Warm-white fallbacks so the generic room never reads as cold grey.
            roomFloor: new THREE.MeshBasicMaterial({ color: '#e9dcc6', side: THREE.DoubleSide }),
            roomCeiling: new THREE.MeshBasicMaterial({ color: '#fbf7ef', side: THREE.DoubleSide }),
            roomWall: new THREE.MeshBasicMaterial({ color: '#f7f1e6', side: THREE.DoubleSide }),
            roomBackWall: new THREE.MeshBasicMaterial({ color: '#f4ede0', side: THREE.DoubleSide }),
        };
    }, [corridorWidth, corridorDepth, corridorHeight]);

    // Memoize geometries
    const geometries = useMemo(() => ({
        corridorSideWall: new THREE.PlaneGeometry(corridorDepth, corridorHeight),
        corridorFloorCeiling: new THREE.PlaneGeometry(corridorWidth, corridorDepth),
        // The floor's UVs carry world metres so the plank layout lines up with
        // the main corridor's floor instead of restarting in the vestibule.
        corridorFloor: bakeWorldUVs(
            new THREE.PlaneGeometry(corridorWidth, corridorDepth),
            corridorWidth,
            corridorDepth,
            // Mesh rotation is [-PI/2, 0, 0]: local X -> world X, local Y -> -world Z.
            (lx, ly) => [lx, -halfDepth - ly]
        ),
        corridorBaseboard: new THREE.PlaneGeometry(corridorDepth, 0.15),
        threshold: new THREE.PlaneGeometry(corridorWidth, 0.15),
        roomFloorCeiling: new THREE.PlaneGeometry(roomWidth, roomDepth),
        roomSideWall: new THREE.PlaneGeometry(roomDepth, roomHeight),
        roomBackWall: new THREE.PlaneGeometry(roomWidth, roomHeight)
    }), [corridorWidth, corridorDepth, corridorHeight, halfDepth]);

    const isGallery = roomId === 'gallery';
    const isContact = roomId === 'contact';
    const contentRoomIds = ['about', 'studio', 'posts', 'videos', 'music', 'ai'];
    // Debug hook (?noloader probes): window.__forceRoom renders a room without
    // walking the door animation. No-op in normal sessions.
    const roomVisible = showRoom || (typeof window !== 'undefined' && window.__forceRoom === roomId);

    // Keep a ready fallback for unknown IDs; custom rooms signal readiness themselves.
    useEffect(() => {
        if (showRoom && !['gallery', 'contact', ...contentRoomIds].includes(roomId)) onReady?.();
    }, [showRoom, roomId, onReady]);

    return (
        <group position={[0, -0.149, 0]}>
            {/* === CORRIDOR (The "Mini-Corridor" Transition) === */}
            {/* Left wall */}
            <mesh
                position={[-corridorWidth / 2, 0, -halfDepth]}
                rotation={[0, Math.PI / 2, 0]}
                geometry={geometries.corridorSideWall}
                material={materials.corridorWallL}
            />

            {/* Right wall */}
            <mesh
                position={[corridorWidth / 2, 0, -halfDepth]}
                rotation={[0, -Math.PI / 2, 0]}
                geometry={geometries.corridorSideWall}
                material={materials.corridorWallR}
            />

            {/* Floor */}
            <mesh
                position={[0, -corridorHeight / 2, -halfDepth]}
                rotation={[-Math.PI / 2, 0, 0]}
                geometry={geometries.corridorFloor}
                material={materials.corridorFloor}
            />

            {/* Ceiling */}
            <mesh
                position={[0, corridorHeight / 2, -halfDepth]}
                rotation={[Math.PI / 2, 0, 0]}
                geometry={geometries.corridorFloorCeiling}
                material={materials.corridorCeiling}
            />

            {/* Baseboard Left */}
            <mesh
                position={[-corridorWidth / 2 + 0.01, -corridorHeight / 2 + 0.075, -halfDepth]}
                rotation={[0, Math.PI / 2, 0]}
                geometry={geometries.corridorBaseboard}
                material={materials.bbLeft}
            />

            {/* Baseboard Right */}
            <mesh
                position={[corridorWidth / 2 - 0.01, -corridorHeight / 2 + 0.075, -halfDepth]}
                rotation={[0, -Math.PI / 2, 0]}
                geometry={geometries.corridorBaseboard}
                material={materials.bbRight}
            />

            {/* === THRESHOLD (End of Mini-Corridor) === */}
            <mesh
                position={[0, -corridorHeight / 2 + 0.005, -corridorDepth]}
                rotation={[-Math.PI / 2, 0, 0]}
                geometry={geometries.threshold}
                material={materials.threshold}
            />

            {/* === ROOM CONTENT === */}
            {roomVisible && (
                <group>
                    {isGallery ? (
                        // === NEW GALLERY ROOM ===
                        // Positioned at the end of the corridor
                        <group position={[0, -0.5, -corridorDepth]}>
                            <Suspense fallback={null}>
                                <GalleryRoom showRoom={roomVisible} onReady={onReady} isExiting={isExiting} />
                            </Suspense>
                        </group>
                    ) : isContact ? (
                        <group position={[0, -0.5, -corridorDepth]}>
                            <Suspense fallback={null}>
                                <ContactRoom showRoom={roomVisible} onReady={onReady} isExiting={isExiting} />
                            </Suspense>
                        </group>
                    ) : contentRoomIds.includes(roomId) ? (
                        <ContentRoom roomId={roomId} showRoom={roomVisible} onReady={onReady} />
                    ) : (
                        // === DEFAULT GENERIC ROOM (For other sections) ===
                        <group position={[0, roomHeight / 2 - corridorHeight / 2, roomZ]}>
                            {/* Floor */}
                            <mesh
                                position={[0, -roomHeight / 2, 0]}
                                rotation={[-Math.PI / 2, 0, 0]}
                                geometry={geometries.roomFloorCeiling}
                                material={materials.roomFloor}
                            />

                            {/* Floor grid */}
                            <gridHelper
                                args={[Math.min(roomWidth, roomDepth), 20, '#cccccc', '#dddddd']}
                                position={[0, -roomHeight / 2 + 0.01, 0]}
                            />

                            {/* Ceiling */}
                            <mesh
                                position={[0, roomHeight / 2, 0]}
                                rotation={[Math.PI / 2, 0, 0]}
                                geometry={geometries.roomFloorCeiling}
                                material={materials.roomCeiling}
                            />

                            {/* Back wall */}
                            <mesh
                                position={[0, 0, -roomDepth / 2]}
                                geometry={geometries.roomBackWall}
                                material={materials.roomBackWall}
                            />

                            {/* Left wall */}
                            <mesh
                                position={[-roomWidth / 2, 0, 0]}
                                rotation={[0, Math.PI / 2, 0]}
                                geometry={geometries.roomSideWall}
                                material={materials.roomWall}
                            />

                            {/* Right wall */}
                            <mesh
                                position={[roomWidth / 2, 0, 0]}
                                rotation={[0, -Math.PI / 2, 0]}
                                geometry={geometries.roomSideWall}
                                material={materials.roomWall}
                            />

                            {/* Title */}
                            <Text font={SCENE_FONTS.maple}
                                position={[0, 2, -roomDepth / 2 + 2]}
                                fontSize={4}
                                color="#1a1a1a"
                                anchorX="center"
                                anchorY="middle"
                                maxWidth={roomWidth * 0.8}
                                textAlign="center"
                            >
                                {label}
                            </Text>

                            {/* Subtitle */}
                            <Text font={SCENE_FONTS.maple}
                                position={[0, -1, -roomDepth / 2 + 2]}
                                fontSize={0.8}
                                color="#666666"
                                anchorX="center"
                                anchorY="middle"
                                maxWidth={roomWidth * 0.7}
                                textAlign="center"
                            >
                                {SUBTITLES[label] || ''}
                            </Text>

                            {/* Lighting - WYLACZONE */}
                            {/* <pointLight position={[0, roomHeight / 2 - 2, 0]} intensity={1} distance={40} color="#ffffff" /> */}
                            {/* <pointLight position={[0, 0, -roomDepth / 4]} intensity={0.5} distance={30} color="#fffaf0" /> */}
                        </group>
                    )}
                </group>
            )}
        </group>
    );
};

RoomInterior.displayName = 'RoomInterior';

export default RoomInterior;
