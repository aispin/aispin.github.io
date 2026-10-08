import { useState, useEffect, useRef } from 'react';
import { useScene } from '../../context/SceneContext';
import { useAudio } from '../../context/AudioManager';
import { setMusicVolume, getMusicVolume } from '../../utils/audioManager';
import { useAchievements } from '../../context/AchievementsContext';
import { useSitePreferences } from '../../context/SitePreferences';
import { ROOMS, ROOM_COPY } from '../../config/theme';
import AchievementPopup from './AchievementPopup';
import AchievementsPanel from './AchievementsPanel';
import '../../styles/NavigationUI.scss';

const NavigationUI = () => {
    const { currentRoom, isInRoom, requestExit, hasEntered, teleportTo, isTeleporting, markEntered, requestHouseExit, doorBusy } = useScene();
    const { globalVolume, setGlobalVolume, isMuted, toggleMute } = useAudio();
    const { showTutorial } = useAchievements();
    const { language } = useSitePreferences();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [hoveredRoom, setHoveredRoom] = useState(null);
    const [isExiting, setIsExiting] = useState(false); // Track when back button is clicked

    // Audio controls state
    const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false);
    const [isAchievementsOpen, setIsAchievementsOpen] = useState(false);
    const [bgmVol, setBgmVol] = useState(0.3);

    // Refs for focus management
    const mapPanelRef = useRef();
    const mapCloseRef = useRef();

    useEffect(() => {
        // Starting an inspection (the gallery card close-up) closes any open
        // panel so the two overlays never fight. The controls themselves now
        // stay put: they live in the always-visible SiteControls column, and the
        // user asked for them to be permanently fixed in the corner.
        const handleInspectChange = (e) => {
            if (e.detail) {
                setIsMenuOpen(false);
                setIsAudioMenuOpen(false);
                setIsAchievementsOpen(false);
            }
        };
        window.addEventListener('inspectChange', handleInspectChange);
        return () => window.removeEventListener('inspectChange', handleInspectChange);
    }, []);

    useEffect(() => {
        setBgmVol(getMusicVolume());

        const handleMusicVolumeChange = (e) => {
            setBgmVol(e.detail);
        };
        window.addEventListener('musicVolumeChanged', handleMusicVolumeChange);

        return () => window.removeEventListener('musicVolumeChanged', handleMusicVolumeChange);
    }, []);

    const handleBgmChange = (val) => {
        setBgmVol(val);
        setMusicVolume(val);
    };

    // Show entrance hint before entering, and explore hint when user enters
    useEffect(() => {
        if (!hasEntered && !isTeleporting) {
            showTutorial('corridor_enter');
        } else if (hasEntered && !isTeleporting && !isInRoom) {
            showTutorial('corridor_explore');
        }
    }, [hasEntered, isTeleporting, isInRoom, showTutorial]);

    // Close menu when entering a room or starting teleport
    useEffect(() => {
        if (isInRoom || isTeleporting) {
            setIsMenuOpen(false);
            setIsAudioMenuOpen(false);
            setIsAchievementsOpen(false);
            setIsExiting(false);
        }
    }, [isInRoom, isTeleporting]);

    // Reset exiting state when not in room anymore
    useEffect(() => {
        if (!isInRoom) {
            setIsExiting(false);
        }
    }, [isInRoom]);

    // ...and never let it stay stuck. `isExiting` hides the back button
    // (opacity 0 + pointer-events none) on the assumption that the exit
    // animation finishes and isInRoom flips. If that animation is ever lost the
    // button would stay invisible forever, so it is also cleared on a timer.
    useEffect(() => {
        if (!isExiting) return undefined;
        const timer = setTimeout(() => setIsExiting(false), 5000);
        return () => clearTimeout(timer);
    }, [isExiting]);

    // The five top-right buttons live in SiteControls (one cluster, one style).
    // They talk to us over window events: `hudToggle` asks us to flip a panel,
    // `hudState` tells them which panel is now open so the button can show its
    // pressed state. This replaced the map-only toggleMap/mapStateChange pair.
    useEffect(() => {
        const onToggle = (event) => {
            const id = event.detail
            if (id === 'map') setIsMenuOpen((prev) => !prev)
            else if (id === 'audio') setIsAudioMenuOpen((prev) => !prev)
            else if (id === 'achievements') setIsAchievementsOpen((prev) => !prev)
        }
        window.addEventListener('hudToggle', onToggle)
        return () => window.removeEventListener('hudToggle', onToggle)
    }, [])

    useEffect(() => {
        const open = isMenuOpen ? 'map' : isAudioMenuOpen ? 'audio' : isAchievementsOpen ? 'achievements' : null
        window.dispatchEvent(new CustomEvent('hudState', { detail: open }))
    }, [isMenuOpen, isAudioMenuOpen, isAchievementsOpen])

    // A4: Focus management for map panel — auto-focus, Escape, and focus trap
    useEffect(() => {
        if (isMenuOpen) {
            // Auto-focus on close button when map opens
            setTimeout(() => mapCloseRef.current?.focus(), 100);
        }
    }, [isMenuOpen]);

    // Global Escape key handler — closes any open panel
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                if (isMenuOpen) setIsMenuOpen(false);
                if (isAudioMenuOpen) setIsAudioMenuOpen(false);
                if (isAchievementsOpen) setIsAchievementsOpen(false);
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isMenuOpen, isAudioMenuOpen, isAchievementsOpen]);

    // Focus trap handler for map panel
    const handleMapKeyDown = (e) => {
        if (e.key !== 'Tab' || !mapPanelRef.current) return;

        const focusable = mapPanelRef.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
            // Shift+Tab on first element → wrap to last
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            // Tab on last element → wrap to first
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };

    const handleRoomClick = (roomId) => {
        // Don't teleport to the same room or if already teleporting
        if (roomId === currentRoom || isTeleporting) return;

        // The menu button is visible everywhere, so the map can be opened from
        // the entrance too. Entering first puts the scene into the corridor
        // state the teleport flow expects.
        if (!hasEntered) markEntered();

        // Close map first, then start teleport
        setIsMenuOpen(false);
        setIsAudioMenuOpen(false);
        setIsAchievementsOpen(false);
        teleportTo(roomId);
    };

    /**
     * Two-level back.
     *
     *   in a room  -> back to the corridor (DoorSection runs its reverse fly-out)
     *   in the corridor -> back out of the house, to the entrance
     *
     * The corridor level used to be missing entirely, and `hasEntered` was a
     * one-way latch (nothing ever set it back to false), so once you were
     * inside there was genuinely no way out of the house.
     */
    const handleBackClick = () => {
        setIsExiting(true); // Immediately start exit animation
        if (isInRoom) {
            // Request exit - DoorSection will handle the animation
            requestExit();
        } else {
            // <HouseExit /> glides the camera out and then clears hasEntered.
            requestHouseExit();
        }
    };

    return (
        <div className="navigation-ui">
            {/* Global Achievement Popup */}
            <AchievementPopup />

            {/* Back Button — left corner, appears once inside and slides down.
                Visible in the corridor too, so there is always a way back out of
                the house (see handleBackClick). Hidden mid-teleport: the paper
                is covering the screen and the camera is not ours to move. */}
            {hasEntered && !isTeleporting && (
                <div className="hud-cluster hud-cluster--left">
                    <button
                        type="button"
                        className={`hud-btn back-btn ${isExiting ? 'is-leaving' : ''}`}
                        onClick={handleBackClick}
                        disabled={doorBusy}
                        aria-label={isInRoom
                            ? (language === 'zh' ? '返回走廊' : 'Back to corridor')
                            : (language === 'zh' ? '走出房子' : 'Exit the house')}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Map Panel - Drops from top when open. Not gated on hasEntered:
                the menu button lives in the always-visible SiteControls
                cluster, and picking a room from the map enters the scene. */}
            <div className={`map-panel ${isMenuOpen ? 'open' : ''}`} inert={!isMenuOpen ? true : undefined} ref={mapPanelRef} onKeyDown={handleMapKeyDown} role="dialog" aria-label="Map">
                {/* SVG Border Overlay */}
                <svg
                    className="map-border-overlay"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                        zIndex: 10
                    }}
                >
                    <path
                        d="M 0 0 L 100 0 L 100 0 L 99 3 L 100 6 L 98 10 L 100 14 L 99 18 L 100 22 L 98 26 L 100 30 L 99 35 L 100 40 L 98 45 L 100 50 L 99 55 L 100 60 L 98 65 L 100 70 L 99 75 L 100 80 L 98 85 L 100 90 L 99 95 L 100 100 L 96 99 L 92 100 L 88 98 L 84 100 L 80 99 L 76 100 L 72 98 L 68 100 L 64 99 L 60 100 L 56 98 L 52 100 L 48 99 L 44 100 L 40 98 L 36 100 L 32 99 L 28 100 L 24 98 L 20 100 L 16 99 L 12 100 L 8 98 L 4 100 L 0 99 L 0.5 99.5 L 1 95 L 0 90 L 2 85 L 0 80 L 1 75 L 0 70 L 2 65 L 0 60 L 1 55 L 0 50 L 2 45 L 0 40 L 1 35 L 0 30 L 2 26 L 0 22 L 1 18 L 0 14 L 2 10 L 0 6 L 1 3 L 0 0 Z"
                        fill="none"
                        stroke="#1a1a1a"
                        strokeWidth="0.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                    />
                </svg>

                <div className="map-content-clipped">
                    <div className="map-header">
                        <h3>MAP</h3>
                        <button
                            ref={mapCloseRef}
                            className="close-btn"
                            onClick={() => setIsMenuOpen(false)}
                            aria-label="Close map"
                        >
                            <svg viewBox="0 0 24 24">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="map-container aispin-map">
                        <div className="aispin-map-art" aria-label={language === 'zh' ? '八个房间的手绘地图' : 'Hand-drawn map of eight rooms'}>
                            <svg className="aispin-map-paths" viewBox="0 0 800 540" aria-hidden="true">
                                <path d="M400 42 C240 100 180 150 170 230 S260 320 400 270 S620 180 640 280 S520 430 400 470" />
                                <path d="M400 270 C300 340 220 420 165 470" />
                                <circle cx="400" cy="42" r="8" /><circle cx="170" cy="230" r="7" /><circle cx="640" cy="280" r="7" />
                            </svg>
                            <div className="aispin-map-title">{language === 'zh' ? '小屋地图' : 'THE LITTLE HOUSE'}</div>
                            <div className="aispin-map-grid">
                                {ROOMS.map((room, index) => (
                                    <button
                                        key={room.id}
                                        type="button"
                                        className={`aispin-map-room ${currentRoom === room.id ? 'active' : ''} ${hoveredRoom === room.id ? 'hovered' : ''}`}
                                        onClick={() => handleRoomClick(room.id)}
                                        onMouseEnter={() => setHoveredRoom(room.id)}
                                        onMouseLeave={() => setHoveredRoom(null)}
                                        aria-label={`${language === 'zh' ? '前往' : 'Go to'} ${room[language]}`}
                                        aria-current={currentRoom === room.id ? 'page' : undefined}
                                    >
                                        <span className="aispin-map-room__number">{String(index + 1).padStart(2, '0')}</span>
                                        <strong>{room[language]}</strong>
                                        <small>{ROOM_COPY[room.id]?.[language]}</small>
                                    </button>
                                ))}
                            </div>
                            <p className="aispin-map-hint">{language === 'zh' ? '选一扇门，走进去看看' : 'Choose a door and step inside'}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Audio Panel — drops down from its button.
                No longer gated on hasEntered: the button now lives in the
                always-visible SiteControls column, so the panel has to be
                renderable from the entrance too. */}
            <div className={`audio-panel ${isAudioMenuOpen ? 'open' : ''}`} inert={!isAudioMenuOpen ? true : undefined}>
                    <div className="audio-card">
                        <div className="audio-header">
                            <h3>AUDIO SETTINGS</h3>
                            <button
                                className="close-btn"
                                onClick={() => setIsAudioMenuOpen(false)}
                                aria-label="Close audio settings"
                            >
                                <svg viewBox="0 0 24 24">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        {/* One-tap mute (user request 2026-10-08). Lives above
                            the two sliders because it is the coarse control:
                            it silences BGM *and* every SFX at once via
                            AudioManager's `toggleMute` → `syncMuteState`, which
                            is the only path that reaches the mp3 element, the
                            synth engine and the positional door sounds alike.
                            Dragging either slider above 0 un-mutes again (see
                            enhancedSetGlobalVolume), so the two never fight. */}
                        <button
                            type="button"
                            className={`audio-mute ${isMuted ? 'is-muted' : ''}`}
                            role="switch"
                            aria-checked={isMuted}
                            onClick={toggleMute}
                            aria-label={language === 'zh' ? '一键静音' : 'Mute all audio'}
                        >
                            <span className="audio-mute__icon" aria-hidden="true">
                                {isMuted ? (
                                    <svg viewBox="0 0 24 24">
                                        <path d="M11 5L6 9H2v6h4l5 4V5z" />
                                        <line x1="23" y1="9" x2="17" y2="15" />
                                        <line x1="17" y1="9" x2="23" y2="15" />
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 24 24">
                                        <path d="M11 5L6 9H2v6h4l5 4V5z" />
                                        <path d="M15 9a5 5 0 0 1 0 6" />
                                        <path d="M18 5a9 9 0 0 1 0 14" />
                                    </svg>
                                )}
                            </span>
                            <span className="audio-mute__label">
                                {language === 'zh' ? '一键静音' : 'Mute all'}
                            </span>
                            <span className="audio-mute__pill" aria-hidden="true">
                                <span className="audio-mute__knob" />
                            </span>
                        </button>

                        <div className="audio-sliders-container">
                            <div className="slider-group">
                                <div className="slider-label">
                                    <span>Music</span>
                                    <span>{Math.round(bgmVol * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0" max="1" step="0.01"
                                    value={bgmVol}
                                    onChange={(e) => handleBgmChange(parseFloat(e.target.value))}
                                    className="paper-slider"
                                    aria-label="Music volume"
                                    aria-valuetext={`${Math.round(bgmVol * 100)} percent`}
                                />
                            </div>
                            <div className="slider-group">
                                <div className="slider-label">
                                    <span>SFX</span>
                                    <span>{Math.round(globalVolume * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0" max="1" step="0.01"
                                    value={globalVolume}
                                    onChange={(e) => setGlobalVolume(parseFloat(e.target.value))}
                                    className="paper-slider"
                                    aria-label="SFX volume"
                                    aria-valuetext={`${Math.round(globalVolume * 100)} percent`}
                                />
                            </div>
                        </div>
                    </div>
            </div>

            {/* Achievements Panel */}
            <AchievementsPanel
                isOpen={isAchievementsOpen}
                onClose={() => setIsAchievementsOpen(false)}
            />

            {/* Overlay to close menus */}
            {(isMenuOpen || isAudioMenuOpen || isAchievementsOpen) && (
                <div
                    className="menu-overlay"
                    onClick={() => {
                        setIsMenuOpen(false);
                        setIsAudioMenuOpen(false);
                        setIsAchievementsOpen(false);
                    }}
                />
            )}
        </div>
    );
};

export default NavigationUI;
