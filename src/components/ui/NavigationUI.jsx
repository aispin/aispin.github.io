import { useState, useEffect, useRef } from 'react';
import { useScene } from '../../context/SceneContext';
import { useAudio } from '../../context/AudioManager';
import { setMusicVolume, getMusicVolume, playBackgroundMusic } from '../../utils/audioManager';
import { useAchievements } from '../../context/AchievementsContext';
import { useSitePreferences } from '../../context/SitePreferences';
import { ROOMS, ROOM_COPY } from '../../config/theme';
// 设置面板里的「四季」。表只有一份（config/seasons.js）。
import { SEASON_IDS, SEASONS, SEASON_AUTO } from '../../config/seasons';
// 「自动」档下实际生效的是哪一季 —— 面板底部那句话要说出来。
import { useSeason } from '../../hooks/useSeason';
import AchievementPopup from './AchievementPopup';
import AchievementsPanel from './AchievementsPanel';
import '../../styles/NavigationUI.scss';

/**
 * 面板 id —— `hudToggle`（SiteControls 请求）与 `hudState`（本组件回答）用它们
 * 对话。**一次只开一个**，见下面 `openPanel` 的说明。
 */
const PANEL_IDS = ['map', 'audio', 'achievements', 'settings'];

const NavigationUI = () => {
    const { currentRoom, isInRoom, requestExit, hasEntered, teleportTo, isTeleporting, markEntered, requestHouseExit, doorBusy } = useScene();
    const { globalVolume, setGlobalVolume, isMuted, toggleMute } = useAudio();
    const { showTutorial } = useAchievements();
    const { language, theme, setTheme, season, setSeason } = useSitePreferences();
    // 解析后的季节（'auto' 时按月份算出来的那个）。只用于面板底部那句提示。
    const resolvedSeason = useSeason();

    /**
     * 当前打开的面板：'map' | 'audio' | 'achievements' | 'settings' | null。
     *
     * 四个面板共用一个状态，而不是四个独立布尔 —— 因为它们本来就不该同时
     * 出现。各自 toggle 时「地图开着再点音频」会把两张卡片叠在同一角，而且
     * `hudState` 只能报出其中一个（按优先级取第一个），另一个的按钮就永远
     * 显示成"没打开"。互斥现在是**构造出来**的，不靠每次记得关别人。
     */
    const [openPanel, setOpenPanel] = useState(null);
    const isMenuOpen = openPanel === 'map';
    const isAudioMenuOpen = openPanel === 'audio';
    const isAchievementsOpen = openPanel === 'achievements';
    const isSettingsOpen = openPanel === 'settings';

    const [hoveredRoom, setHoveredRoom] = useState(null);
    const [isExiting, setIsExiting] = useState(false); // Track when back button is clicked

    // Seeded from the audio manager rather than a hard-coded 0.3 + a mount
    // effect that immediately overwrote it with the real value (which both
    // flickered the slider and tripped react-hooks/set-state-in-effect).
    const [bgmVol, setBgmVol] = useState(getMusicVolume);

    // Refs for focus management
    const mapPanelRef = useRef();
    const mapCloseRef = useRef();
    const settingsPanelRef = useRef();
    const settingsCloseRef = useRef();

    useEffect(() => {
        // Starting an inspection (the gallery card close-up) closes any open
        // panel so the two overlays never fight. The controls themselves now
        // stay put: they live in the always-visible SiteControls column, and the
        // user asked for them to be permanently fixed in the corner.
        const handleInspectChange = (e) => {
            if (e.detail) setOpenPanel(null);
        };
        window.addEventListener('inspectChange', handleInspectChange);
        return () => window.removeEventListener('inspectChange', handleInspectChange);
    }, []);

    useEffect(() => {
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

    /**
     * 音乐现在是不是"开着" —— 面板里那个开关的**文案 / 图标 / 旋钮**都按它取态。
     *
     * ⚠️ **不能按 `isMuted` 取态**。首访时浏览器必然拒绝自动播放，所以站点一进来
     * 就是没声音的，但 `isMuted` 仍是 false（那是"用户偏好位"）。按它取态会显示
     * 「一键静音」—— 而此刻本来就没声音，这个按钮等于在说废话（用户 2026-10-09 报的：
     * 「静音时设置面板里应该是『打开音乐』」）。
     *
     * 起播点是推门与这个开关本身，两处都会经 audioManager 广播 `musicStateChanged`。
     */
    const [musicOn, setMusicOn] = useState(false);
    useEffect(() => {
        const onMusicState = (event) => setMusicOn(!!event.detail?.on);
        window.addEventListener('musicStateChanged', onMusicState);
        return () => window.removeEventListener('musicStateChanged', onMusicState);
    }, []);

    /**
     * 动作必须与文案一致 —— 写着「打开音乐」，点下去就得真有音乐。
     *
     * 三种情形（少了哪一条都会出问题）：
     *   音乐在放              → 静音：停 mp3 / 停合成
     *   没在放 + 静音位是 true → 取消静音。`syncMuteState` 认得这是"用户主动要听"，
     *                           会直接 `playBackgroundMusic()`（见 utils/audioManager）
     *   没在放 + 没静音        → 首访那种状态，直接起播
     *                           （只调 `toggleMute` 会把它**静**掉，与文案相反）
     */
    const handleMusicToggle = () => {
        if (musicOn) toggleMute();
        else if (isMuted) toggleMute();
        else playBackgroundMusic();
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
            setOpenPanel(null);
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
    //
    // 因为只有一个 `openPanel`，"打开一个就必然关掉别的"是天然的 —— 点当前
    // 打开的那个则关掉它（`prev === id ? null : id`）。
    useEffect(() => {
        const onToggle = (event) => {
            const id = event.detail
            if (PANEL_IDS.includes(id)) setOpenPanel((prev) => (prev === id ? null : id))
        }
        window.addEventListener('hudToggle', onToggle)
        return () => window.removeEventListener('hudToggle', onToggle)
    }, [])

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('hudState', { detail: openPanel }))
    }, [openPanel])

    // A4: Focus management for the top-anchored panels — auto-focus the close
    // button when one opens, so Escape/Tab land inside it immediately.
    useEffect(() => {
        if (isMenuOpen) {
            setTimeout(() => mapCloseRef.current?.focus(), 100);
        }
    }, [isMenuOpen]);

    useEffect(() => {
        if (isSettingsOpen) {
            setTimeout(() => settingsCloseRef.current?.focus(), 100);
        }
    }, [isSettingsOpen]);

    // Global Escape key handler — closes any open panel
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') setOpenPanel(null);
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, []);

    /**
     * Focus trap for a top-anchored panel: Tab cycles inside it instead of
     * walking off into the HUD buttons behind. Shared by the map and settings
     * panels so the two cannot drift apart.
     */
    const trapFocus = (e, panelRef) => {
        if (e.key !== 'Tab' || !panelRef.current) return;

        const focusable = panelRef.current.querySelectorAll(
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
        setOpenPanel(null);
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
            <div className={`map-panel ${isMenuOpen ? 'open' : ''}`} inert={!isMenuOpen ? true : undefined} ref={mapPanelRef} onKeyDown={(e) => trapFocus(e, mapPanelRef)} role="dialog" aria-label="Map">
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
                            onClick={() => setOpenPanel(null)}
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
                                onClick={() => setOpenPanel(null)}
                                aria-label="Close audio settings"
                            >
                                <svg viewBox="0 0 24 24">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        {/* Music on/off switch. Lives above the two sliders
                            because it is the coarse control.

                            ⚠️ 文案与状态都按 **musicOn** 取，不按 `isMuted`
                            （原因见上面 `musicOn` 的注释）。用户 2026-10-09 要求：
                            没在放 → 「打开音乐」；在放 → 「关闭音乐」。

                            动作走 `handleMusicToggle` 而不是裸 `toggleMute` ——
                            首访时音乐根本没起播（浏览器拦了自动播放），这时只调
                            `toggleMute` 会把它**静**掉，与「打开音乐」正好相反。
                            `toggleMute` → `syncMuteState` 会把 BGM(mp3/合成) 与
                            全部 SFX 一起处理，是唯一能同时够到 mp3 元素、合成引擎
                            和门声的路径；拉高任一滑杆也会自动取消静音
                            （见 enhancedSetGlobalVolume），两者不打架。 */}
                        <button
                            type="button"
                            className={`audio-mute ${musicOn ? 'is-on' : ''}`}
                            role="switch"
                            aria-checked={musicOn}
                            onClick={handleMusicToggle}
                            aria-label={language === 'zh'
                                ? (musicOn ? '关闭音乐' : '打开音乐')
                                : (musicOn ? 'Turn off music' : 'Turn on music')}
                        >
                            <span className="audio-mute__icon" aria-hidden="true">
                                {musicOn ? (
                                    <svg viewBox="0 0 24 24">
                                        <path d="M11 5L6 9H2v6h4l5 4V5z" />
                                        <path d="M15 9a5 5 0 0 1 0 6" />
                                        <path d="M18 5a9 9 0 0 1 0 14" />
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 24 24">
                                        <path d="M11 5L6 9H2v6h4l5 4V5z" />
                                        <line x1="23" y1="9" x2="17" y2="15" />
                                        <line x1="17" y1="9" x2="23" y2="15" />
                                    </svg>
                                )}
                            </span>
                            <span className="audio-mute__label">
                                {language === 'zh'
                                    ? (musicOn ? '关闭音乐' : '打开音乐')
                                    : (musicOn ? 'Turn off music' : 'Turn on music')}
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

            {/* Settings Panel —— 与地图面板同一张撕纸卡片（样式见
                NavigationUI.scss 的 .settings-panel，两者共用 $torn-paper-clip）。

                里面是本站的两个**正交**偏好：
                  外观（明暗主题）× 季节（四季院子）
                这两个轴是独立的（2 × 4 = 8 态），所以做成两行选择而不是一个
                循环按钮 —— 循环按钮表达不了两个轴。

                「自动」是季节的默认档：跟月份走。它必须存在，否则用户碰一次
                面板，"以后每个月自己变"就永久变成了"停在这一季"。 */}
            <div
                className={`settings-panel ${isSettingsOpen ? 'open' : ''}`}
                inert={!isSettingsOpen ? true : undefined}
                ref={settingsPanelRef}
                onKeyDown={(e) => trapFocus(e, settingsPanelRef)}
                role="dialog"
                aria-label={language === 'zh' ? '设置' : 'Settings'}
            >
                <div className="settings-content-clipped">
                    <div className="settings-header">
                        {/* 与 MAP / AUDIO SETTINGS 一致：标题保持英文大写，
                            行标签才走双语（地图的房间名也是这么分的）。 */}
                        <h3>SETTINGS</h3>
                        <button
                            ref={settingsCloseRef}
                            className="close-btn"
                            onClick={() => setOpenPanel(null)}
                            aria-label={language === 'zh' ? '关闭设置' : 'Close settings'}
                        >
                            <svg viewBox="0 0 24 24">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="settings-body">
                        <div className="settings-row">
                            <span className="settings-row__label">
                                {language === 'zh' ? '外观' : 'Appearance'}
                            </span>
                            <div className="settings-choice" role="radiogroup" aria-label={language === 'zh' ? '外观' : 'Appearance'}>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={theme === 'light'}
                                    className={`settings-chip ${theme === 'light' ? 'is-active' : ''}`}
                                    onClick={() => setTheme('light')}
                                >
                                    {language === 'zh' ? '浅色' : 'Light'}
                                </button>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={theme === 'dark'}
                                    className={`settings-chip ${theme === 'dark' ? 'is-active' : ''}`}
                                    onClick={() => setTheme('dark')}
                                >
                                    {language === 'zh' ? '深色' : 'Dark'}
                                </button>
                            </div>
                        </div>

                        <div className="settings-row">
                            <span className="settings-row__label">
                                {language === 'zh' ? '季节' : 'Season'}
                            </span>
                            <div className="settings-choice settings-choice--seasons" role="radiogroup" aria-label={language === 'zh' ? '季节' : 'Season'}>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={season === SEASON_AUTO}
                                    className={`settings-chip ${season === SEASON_AUTO ? 'is-active' : ''}`}
                                    onClick={() => setSeason(SEASON_AUTO)}
                                >
                                    {language === 'zh' ? '自动' : 'Auto'}
                                </button>
                                {SEASON_IDS.map((id) => (
                                    <button
                                        key={id}
                                        type="button"
                                        role="radio"
                                        aria-checked={season === id}
                                        className={`settings-chip ${season === id ? 'is-active' : ''}`}
                                        onClick={() => setSeason(id)}
                                        // 无头验收靠它精确点到某一季（按文字选会
                                        // 随语言变，按索引选会被「自动」错位）。
                                        data-season={id}
                                    >
                                        {language === 'zh' ? SEASONS[id].zh : SEASONS[id].en}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 说清楚"现在到底是哪一季" —— 选「自动」时面板上只有
                            「自动」是亮的，看不出实际生效的是哪一季。 */}
                        <p className="settings-hint">
                            {season === SEASON_AUTO
                                ? (language === 'zh'
                                    ? `跟随月份 · 当前 ${SEASONS[resolvedSeason].zh}季`
                                    : `Follows the calendar · now ${SEASONS[resolvedSeason].en}`)
                                : (language === 'zh'
                                    ? `已固定在${SEASONS[season].zh}季 · 院子与门联都会跟着变`
                                    : `Pinned to ${SEASONS[season].en} · the courtyard and the couplet follow`) }
                        </p>
                    </div>
                </div>
            </div>

            {/* Achievements Panel */}
            <AchievementsPanel
                isOpen={isAchievementsOpen}
                onClose={() => setOpenPanel(null)}
            />

            {/* Overlay to close menus */}
            {openPanel && (
                <div className="menu-overlay" onClick={() => setOpenPanel(null)} />
            )}
        </div>
    );
};

export default NavigationUI;
