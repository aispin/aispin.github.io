/**
 * Texture Preload List - ALL textures for the entire experience
 * Everything loads during the initial preloader for zero stutter when entering rooms.
 */

// Entrance scene textures
//
// EMPTY BY DESIGN — including the paper sheet, which used to be the one entry
// here. `paper-texture.webp` is drawn on canvas now (utils/paperArt.js) and
// shared with the DOM overlays through the `--paper-texture` custom property,
// so there is nothing left to fetch for the entrance either.
export const ENTRANCE_TEXTURES = [
    // Doors — the leaves, architrave, hinges, lock plate, slab edge AND the
    // lever handles are all procedural canvas art (utils/doorArt.js); the
    // 门神 / 倒福 / 门环 / 春联 decoration is procedural too (utils/gateArt.js).
    // Nothing on the doors comes from disk any more.
    // Environment
    // (bricks + stone path + grass field are GPU shaders; window/pot/mouse/cat/sign are 3D props now)
    // Characters/Objects
    // (the tree, ladybird, speech bubble and the bug-click ink splash are
    //  procedural canvas art now — utils/entranceArt.js — so nothing to fetch)
    //
    // The window character is the one exception: it is a generated
    // illustration, paired with the corridor IP sprite so both characters read
    // as the same person. See utils/entranceArt.js for why.
    '/textures/entrance/avatar-window.webp',
];

// Corridor scene textures
//
// EMPTY BY DESIGN. Every corridor bitmap has been replaced by procedural art:
//   - door leaves / architraves / hinges / slab edges -> utils/doorArt.js
//   - lever handles, arrow, sign board, picture frames, standing frame,
//     potted tree, potted flower, vent grate, lamp grille, lamp sides, desk
//     wood, table top, cabinet panels, the four doodles -> utils/corridorArt.js
//   - wall / floor / ceiling / baseboard -> shaders/roomSurfaces.js and
//     utils/proceduralTextures.js
//   - the wall decorations (while_true_loop, coffee_debug, idea_process) are
//     gone; while_true_loop's spot is now the `whileTrue` GLSL painting in
//     shaders/paintings.js.
// The only corridor bitmap left is the ZEO avatar strip — see UI_TEXTURES.
export const CORRIDOR_TEXTURES = [];

// Standard HTML Image assets (preloaded via new Image() in App.jsx)
//
// EMPTY BY DESIGN. This list exists to warm the HTTP cache for textures that
// are shown through a plain <img> tag, and nothing is any more:
//
//   map.webp / map_{about,contact,gallery,studio}_painted.webp / pin.webp /
//   pin-slot.webp — the room map is no longer a picture. NavigationUI draws it
//   as inline SVG (`aispin-map-paths` curves + `aispin-map-grid` buttons) over
//   CSS, so these seven files had no reader at all: they were fetched on every
//   cold start and rendered zero pixels. Deleted 2026-10-06 — see the texture
//   audit. (`images/JSSREDNIBALON_painted.webp` was a leftover copy of an
//   about-room tile and was orphaned too.)
//
//   ink-splash.webp — still very much in use, but it is a WebGL material
//   (EntranceDoors' bug-splat), not an <img>, so it belongs in
//   ENTRANCE_TEXTURES where `useTexture.preload` picks it up. Listing it here
//   as well only made the browser fetch and decode the same bytes twice.
export const IMAGE_ASSETS = [];

// Loaded with a plain HTMLImageElement (not useTexture), so they live here
// rather than in TEXTURE_PRELOAD_LIST.
export const UI_TEXTURES = [
    // ZEO IP character: one sprite strip, cut into 4 frames in code (Avatar.jsx).
    '/textures/corridor/avatar_zeo.webp',
];

// ============================================
// ROOM TEXTURES - Preloaded for instant room entry
// ============================================

// Gallery Room textures (loaded via useTexture / drei)
//
// EMPTY BY DESIGN. This was the last raster cluster in the project — seven
// files, 0.85 MB — and it is gone as of 2026-10-06. Every one of them is
// drawn on canvas in utils/galleryArt.js now:
//
//   railing.webp      -> makeRailingTexture    (tiles 7×, authored at the
//                                               tile's real 2.286 aspect; the
//                                               old 2.0 file squashed every
//                                               baluster by 14 %)
//   domki.webp        -> makeHousesTexture     (2.357, was 2.0)
//   miastotlo.webp    -> makeCityTexture       (2.357, was 2.0)
//   bird_gray.webp    -> makeBirdTexture       (square; the plane's 1.4 scale
//                                               does the squashing, which is
//                                               the shape the art was drawn for)
//   klamerka.webp     -> makeClothespinTexture (1.5, was 2.0)
//   tylkartki(.webp)  -> makeCardBackTexture(false)   the two sides of the
//   tylkartki_painted -> makeCardBackTexture(true)    hanging cards (0.75,
//                                               was 0.5)
export const GALLERY_TEXTURES_BASE = [];

export const GALLERY_TEXTURES_VERSIONED = [
    // NOTE: `tylkartki` / `tylkartki_painted` dropped off here on 2026-10-06
    // with the rest of the gallery set — the card back is drawn on canvas.
    // NOTE: `monetuneprzod` / `timberkittyprzod` / `youngmultiprzod` /
    // `bioprzod` (+ `_painted`) dropped off here on 2026-10-06. Those eight
    // files fed the `fileTextures` branch of GalleryRoom, which only runs for
    // projects WITHOUT a `placeholder` — and every record in
    // src/data/photography.json has one, so the branch is unreachable and the
    // eight requests were wasted on every cold start. The four
    // FALLBACK_PROJECTS entries now carry a `placeholder` too, so the fallback
    // path is procedural as well.
    // NOTE: `przyciskdotylukartki` (the "OPEN PROJECT" button plate, 2 files /
    // 74 KB) dropped off this list when the gallery card stopped turning over:
    // the button lived on the back and its `window.open(project.url)` pointed at
    // an empty string for every record in src/data/photography.json. Nothing
    // references the plates any more — see the texture audit for deletion.
    // NOTE: the ten tech-stack logos (csslogo / elementorlogo / firebaselogo /
    // htmllogo / jslogo / netlifylogo / phplogo / reactlogo / tailwindlogo /
    // wordpresslogo) are gone from here. They were preloaded on every cold
    // start but rendered nothing, and the marks are now drawn procedurally on
    // the corridor floor — see utils/techLogosArt.js.
];

export const GALLERY_TEXTURES = [
    ...GALLERY_TEXTURES_BASE,
    ...GALLERY_TEXTURES_VERSIONED.flatMap(name => [
        `/textures/gallery/${name}.webp`,
        `/textures/gallery/${name}_painted.webp`
    ])
];

// Contact Room textures
//
// EMPTY BY DESIGN. The whole "message in a bottle" room is procedural art now
// (utils/contactArt.js), and the 1.40 MB / 8-file public/textures/contact/ set
// is gone:
//   sea / jetty / lighthouse / ship -> makeSeaTexture, makePierTexture,
//                                      makeLighthouseTexture, makeShipTexture
//   barrel (sketch + painted)       -> makeBarrelSketchTexture / ...Painted
//   contact sheet + SEND plate      -> makePaperFormTexture / makeSendButtonTexture
// The clouds GalleryClouds scatters over the room are procedural too — see
// CLOUD_TEXTURES below.
export const CONTACT_TEXTURES = [];

// ============================================
// REMOVED 2026-10-06 — about & studio texture sets
// ============================================
//
// ABOUT (35 files / 2.57 MB) and STUDIO (36 files / 1.66 MB) are gone, along
// with every `backups/` directory in this tree. Both were referenced only from
// inside components that nothing imports — and on 2026-10-07 those components
// themselves were deleted too:
//
//   About/    (5 files / 2 238 lines)  AboutRoom, InfiniteSkyManager,
//                                      PaperAirplane, SkyChunk, StoryMilestone
//   Studio/   (3 files / 1 501 lines)  StudioRoom, FloatingCodeParticles,
//                                      contentData
//
// `RoomInterior.jsx` renders `about` and `studio` through ContentRoom (canvas
// cards) instead, so neither room ever touched these bitmaps. A cold-start
// capture confirmed it: `about` burned 35 requests to render zero pixels, and
// `studio` was not even in a preload list, so it made 0 requests at all.
//
// The lists below are kept as EMPTY, NAMED exports rather than deleted, so the
// intent is visible and re-mounting either room fails loudly at the call site
// instead of silently 404ing. If `about` or `studio` is ever revived, redraw
// the art procedurally (canvas, like utils/corridorArt.js) — do not restore
// the bitmaps.

export const ABOUT_TEXTURES = [];

export const STUDIO_TEXTURES = [];

// Cloud sprites — EMPTY BY DESIGN.
//
// `GalleryClouds` is mounted by TWO live rooms (the gallery, count 65, and the
// contact room, count 45), so this list used to matter. The eight sketches are
// drawn on a canvas at runtime (utils/cloudArt.js) and only tinted in code
// (utils/colorizeCloud), so there is nothing left to fetch.
export const CLOUD_TEXTURES = [];

// ============================================
// COMBINED EXPORTS
// ============================================

// Textures loaded via useTexture (drei) - entrance, corridor, UI, gallery, contact
export const PRELOAD_ALL = [
    ...ENTRANCE_TEXTURES,
    ...CORRIDOR_TEXTURES,
    ...UI_TEXTURES,
    ...GALLERY_TEXTURES,
    ...CONTACT_TEXTURES,
    ...CLOUD_TEXTURES,
    ...IMAGE_ASSETS,
];


// Textures loaded via useLoader(TextureLoader).
// EMPTY: the only two consumers were about and studio, and both of those
// component trees are unreachable — see the removal note above. Kept as an
// exported empty array so App.jsx's preload path does not need to change.
export const PRELOAD_LOADER = [];

/**
 * Filters the preload list based on whether the device supports hover (desktop) 
 * or is a touch-only device (mobile/tablet).
 * @param {string[]} list The list of texture paths to filter
 * @param {boolean} usePainted Whether to prioritize _painted versions
 * @returns {string[]} The filtered list
 */
export const filterTexturesByDevice = (list, usePainted) => {
    return list.filter(path => {
        const isPainted = path.includes('_painted.webp');

        // Painted variants are desktop-only; touch devices keep the sketch layer.
        if (isPainted) return usePainted;

        // Sketches are always kept: desktop uses them as the reveal base layer,
        // and touch devices use them as the only layer.
        return true;
    });
};
