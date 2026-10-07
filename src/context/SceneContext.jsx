import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { getInitialRoomFromUrl } from '../hooks/useDocumentMeta';
import { useSitePreferences } from './SitePreferences';
import { ROOMS } from '../config/theme';
import { showToast } from '../utils/toast';

const SceneContext = createContext(null);

/**
 * Messages for the teleport guards. Kept next to the guards because they only
 * make sense together — see teleportTo below.
 *
 * `{room}` is filled with the localised room name from ROOMS, so the toast says
 * "ALREADY IN PHOTOGRAPHY" rather than exposing the internal id.
 */
const TELEPORT_TOAST = {
    alreadyHere: { zh: '已经在「{room}」里了', en: 'Already in {room}' },
    inFlight: { zh: '正在传送中，请稍候…', en: 'Teleport in progress…' },
};

/** Localised display name for a room id, falling back to the raw id. */
function roomLabel(roomId, language) {
    const room = ROOMS.find((item) => item.id === roomId);
    return room ? room[language] : roomId;
}

export const useScene = () => {
    const context = useContext(SceneContext);
    if (!context) {
        throw new Error('useScene must be used within a SceneProvider');
    }
    return context;
};

export const SceneProvider = ({ children }) => {
    // Deep linking: check if URL points to a specific room on first load
    const initialRoom = useRef(getInitialRoomFromUrl());
    const deeplinkHandled = useRef(false);

    // Only used to localise the guard toasts. Safe to read here: SceneProvider
    // is always mounted inside SitePreferencesProvider (see App.jsx).
    const { language } = useSitePreferences();

    /**
     * How long a teleport is allowed to stay in flight before we assume it is
     * wedged and force the site back to a usable state.
     *
     * `isTeleporting` is what gates `teleportTo`, so if a teleport ever stalls
     * halfway — the room never signals ready, a door click is swallowed because
     * another animation still held its `isAnimating` lock, a gsap timeline is
     * killed by an unrelated re-render — then `isTeleporting` stays true and
     * EVERY later teleport is refused. The user sees the paper stuck shut over
     * a blank screen and no room will open again: "all the rooms disappear".
     *
     * A healthy entry finishes in ~1-2s (the DoorSection's own room-load
     * fallback fires at 8s), so this is a last-resort escape hatch, not part of
     * normal flow.
     */
    const TELEPORT_WATCHDOG_MS = 25000;
    const teleportWatchdogRef = useRef(null);
    const clearTeleportWatchdog = useCallback(() => {
        if (teleportWatchdogRef.current) {
            clearTimeout(teleportWatchdogRef.current);
            teleportWatchdogRef.current = null;
        }
    }, []);

    const [currentRoom, setCurrentRoom] = useState(null); // null = corridor, 'about', 'portfolio', etc.
    const [hasEntered, setHasEntered] = useState(false);  // Has user clicked entrance doors?
    // Set while the camera is gliding back out of the house. The corridor's
    // scroll hook checks this so it stops driving camera.position.z and lets the
    // exit animation own the camera (otherwise the two fight for the same axis
    // and the camera stalls halfway out).
    const [houseExitRequested, setHouseExitRequested] = useState(false);
    /**
     * True while a corridor door is running its align / fly-in / fly-out
     * animation.
     *
     * DoorSection owns that animation and drives `camera.position` directly, so
     * nothing else may touch the camera meanwhile. It used to be possible to hit
     * the back button during a fly-in: the exit glide would kill the door's
     * tween, its onComplete never ran, and DoorSection was left locked forever —
     * the door stopped responding and the room never appeared.
     */
    const [doorBusy, setDoorBusy] = useState(false);
    const [exitRequested, setExitRequested] = useState(false); // Signal to request exit from room
    const [overlayContent, setOverlayContent] = useState(null); // Content for overlay (Studio monitor etc)

    // Teleportation states
    const [teleportTarget, setTeleportTarget] = useState(null); // Room ID to teleport to
    const [isTeleporting, setIsTeleporting] = useState(false);  // Currently in teleport transition
    const [teleportPhase, setTeleportPhase] = useState(null);   // 'closing' | 'teleporting' | 'opening' | null
    const [pendingDoorClick, setPendingDoorClick] = useState(null); // Label of door to click after teleport
    const [isFastTeleport, setIsFastTeleport] = useState(false); // Fast teleport in progress (skip animations)

    // Inspecting state removed to avoid global re-renders

    const enterRoom = useCallback((roomId) => {
        setCurrentRoom(roomId);
        setExitRequested(false); // Clear any pending exit request
        setOverlayContent(null); // Clear overlay on room change

        // Actually arriving in a room cancels any queued "leave the house".
        // Without this, a back press made *during* the door fly-in stays armed
        // and would fire the moment the user later walks back out of the room —
        // gliding them straight out of the front door, which is not what they
        // asked for and looks like the scene acting on its own.
        setHouseExitRequested(false);
        clearTeleportWatchdog();

        // Teleportation cleanup - if we just teleported in
        // Note: isFastTeleport is cleared by signalRoomReady, not here
        // Don't clear teleportPhase if it's 'opening' - let the paper animation complete
        setIsTeleporting(false);
        setPendingDoorClick(null);
        // teleportPhase is cleared by finishPaperOpen after animation

        // The teleport landed, so the watchdog is no longer needed.
        clearTeleportWatchdog();
    }, [clearTeleportWatchdog]);

    const exitRoom = useCallback(() => {
        setCurrentRoom(null);
        setExitRequested(false);
        setOverlayContent(null);
    }, []);

    // Request exit - this signals to DoorSection to trigger exit animation
    const requestExit = useCallback(() => {
        setExitRequested(true);
        setOverlayContent(null);
    }, []);

    // Clear exit request - called by DoorSection after handling
    const clearExitRequest = useCallback(() => {
        setExitRequested(false);
    }, []);

    const markEntered = useCallback(() => {
        setHasEntered(true);
        setHouseExitRequested(false);
    }, []);

    /**
     * Ask the scene to walk back out of the house.
     *
     * `hasEntered` used to be a one-way latch: nothing ever set it back to
     * false, so once you were inside the corridor the entrance scene was
     * unmounted permanently and there was no way out of the house at all.
     * The camera glide is owned by <HouseExit /> (a 3D component — only it can
     * reach the camera), which calls markExited() when it arrives.
     */
    const requestHouseExit = useCallback(() => {
        // Refused, not queued, while a door is mid-animation. Queuing looked
        // tempting but is worse: the request would stay armed and fire the
        // moment the user later walked out of a room, gliding them straight out
        // of the front door with no input at that moment.
        if (doorBusy) return;
        setHouseExitRequested(true);
    }, [doorBusy]);

    // Called by <HouseExit /> once the camera is back outside. Re-mounts the
    // entrance and returns the whole scene to its pre-entry state.
    const markExited = useCallback(() => {
        setHouseExitRequested(false);
        setHasEntered(false);
        setCurrentRoom(null);
        setExitRequested(false);
        setOverlayContent(null);
    }, []);

    const openOverlay = useCallback((content) => {
        setOverlayContent(content);
    }, []);

    const closeOverlay = useCallback(() => {
        setOverlayContent(null);
    }, []);

    // Teleportation functions

    // Initiate teleport - called when user clicks room on map
    const teleportTo = useCallback((roomId) => {
        // Both guards below used to `return` silently, which is why a dropped
        // request was indistinguishable from a broken map: the user clicks and
        // nothing at all happens. The request is still dropped (retargeting a
        // teleport that is already in flight would mean aborting a live
        // timeline), but now it says why.
        if (roomId === currentRoom) {
            showToast(TELEPORT_TOAST.alreadyHere[language].replace('{room}', roomLabel(roomId, language)));
            return;
        }
        if (isTeleporting) {
            showToast(TELEPORT_TOAST.inFlight[language]);
            return;
        }

        setTeleportTarget(roomId);
        setIsTeleporting(true);
        setIsFastTeleport(true); // Enable fast teleport mode
        setTeleportPhase('closing'); // Paper starts closing
        setOverlayContent(null);

        // Arm the watchdog: if this teleport never lands, release the lock so the
        // map keeps working instead of refusing every room from then on.
        clearTeleportWatchdog();
        teleportWatchdogRef.current = setTimeout(() => {
            teleportWatchdogRef.current = null;
            console.warn('[Scene] Teleport watchdog fired - releasing a stalled teleport');
            setTeleportTarget(null);
            setIsTeleporting(false);
            setTeleportPhase(null);
            setPendingDoorClick(null);
            setIsFastTeleport(false);
        }, TELEPORT_WATCHDOG_MS);
    }, [isTeleporting, currentRoom, clearTeleportWatchdog, language]);

    // Called when paper close animation completes - actually move camera
    const startTeleportTransition = useCallback(() => {
        setTeleportPhase('teleporting');
        // Camera will be moved here by listening components
    }, []);

    // Called when teleport is ready (room loaded) - start paper open animation
    // During fast teleport, this is called AFTER camera is inside room
    const openTeleportTransition = useCallback(() => {
        setTeleportPhase('opening');
    }, []);

    // Called when paper open animation completes - cleanup
    const completeTeleport = useCallback(() => {
        // During FAST teleport: paper stays closed, trigger door click immediately
        // The paper will open when signalRoomReady() is called by DoorSection
        setPendingDoorClick(teleportTarget);

        // Don't clear isTeleporting yet! Wait for enterRoom() logic to finish
        // We only clear target here (phase cleared later)
        setTeleportTarget(null);
        // Note: teleportPhase stays at 'teleporting' during fast teleport so paper remains closed
    }, [teleportTarget]);

    // Called by DoorSection when camera has finished entering the room during fast teleport
    // This opens the paper and completes the teleport sequence
    const signalRoomReady = useCallback(() => {
        if (isFastTeleport) {
            // Now open the paper
            setTeleportPhase('opening');
            setIsFastTeleport(false);
        }
    }, [isFastTeleport]);

    // Called by PaperTransition when paper open animation finishes
    // This just clears the phase - teleport logic is already done
    const finishPaperOpen = useCallback(() => {
        clearTeleportWatchdog();
        setTeleportPhase(null);
    }, [clearTeleportWatchdog]);

    // REMOVED clearPendingDoorClick - it's now handled in enterRoom

    // Cancel teleport (in case of error)
    const cancelTeleport = useCallback(() => {
        clearTeleportWatchdog();
        setTeleportTarget(null);
        setIsTeleporting(false);
        setTeleportPhase(null);
        setPendingDoorClick(null);
        setIsFastTeleport(false);
    }, [clearTeleportWatchdog]);

    // Clear the teleport watchdog if the provider goes away.
    useEffect(() => clearTeleportWatchdog, [clearTeleportWatchdog]);

    const value = useMemo(() => ({
        currentRoom,
        hasEntered,
        houseExitRequested,
        doorBusy,
        setDoorBusy,
        exitRequested,
        overlayContent, // Exposed
        enterRoom,
        exitRoom,
        requestExit,
        clearExitRequest,
        markEntered,
        requestHouseExit,
        markExited,
        openOverlay,    // Exposed
        closeOverlay,   // Exposed
        isInRoom: currentRoom !== null,
        // Deep linking
        initialRoom: initialRoom.current,
        deeplinkHandled,
        // Teleportation
        teleportTarget,
        isTeleporting,
        teleportPhase,
        pendingDoorClick,
        isFastTeleport,
        teleportTo,
        startTeleportTransition,
        openTeleportTransition,
        completeTeleport,
        signalRoomReady,
        finishPaperOpen,
        cancelTeleport,
    }), [
        currentRoom,
        hasEntered,
        houseExitRequested,
        doorBusy,
        exitRequested,
        overlayContent,
        enterRoom,
        exitRoom,
        requestExit,
        clearExitRequest,
        markEntered,
        requestHouseExit,
        markExited,
        openOverlay,
        closeOverlay,
        // Teleportation dependencies
        teleportTarget,
        isTeleporting,
        teleportPhase,
        pendingDoorClick,
        isFastTeleport,
        teleportTo,
        startTeleportTransition,
        openTeleportTransition,
        completeTeleport,
        signalRoomReady,
        finishPaperOpen,
        cancelTeleport
    ]);

    return (
        <SceneContext.Provider value={value}>
            {children}
        </SceneContext.Provider>
    );
};

export default SceneContext;
