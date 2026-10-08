import React from 'react';
import { useAchievements, ACHIEVEMENTS } from '../../context/AchievementsContext';
import { useAudio } from '../../context/AudioManager';
import '../../styles/AchievementPopup.scss';

const AchievementPopup = () => {
    const { activePopup } = useAchievements();
    const { isMuted, toggleMute } = useAudio();

    if (!activePopup) return null;

    const data = ACHIEVEMENTS[activePopup.id];
    if (!data) return null;

    const isCompleted = activePopup.status === 'completed';
    const isHiding = activePopup.status === 'hiding';

    // Specjalna logika dla corridor_enter (pytanie o dźwięk)
    const isSoundPrompt = activePopup.id === 'corridor_enter';

    return (
        <div
            className={`achievement-popup ${isCompleted ? 'completed' : ''} ${isHiding ? 'hiding' : ''} ${isSoundPrompt ? 'interactive' : ''}`}
            style={isSoundPrompt ? { pointerEvents: 'auto' } : {}}
        >
            <div className="popup-content">
                {!isSoundPrompt && (
                    <div className={`checkbox ${isCompleted ? 'checked' : ''}`}>
                        {isCompleted && (
                            <svg viewBox="0 0 24 24" className="checkmark">
                                <path d="M5 13l4 4L19 7" fill="none" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                    </div>
                )}
                <div className="text-content" style={isSoundPrompt ? { alignItems: 'center', textAlign: 'center' } : {}}>
                    <span className="title">{data.title}</span>

                    {!isSoundPrompt ? (
                        <span className="description">{data.label}</span>
                    ) : (
                        <span className="description">
                            Click a door to enter. Audio is currently
                            <button
                                className={`inline-sound-toggle ${!isMuted ? 'on' : 'off'}`}
                                onClick={(e) => {
                                    e.stopPropagation();

                                    // 只翻「静音」这一个标志位，别的什么都不碰。
                                    //
                                    // 这里以前还顺手 setGlobalVolume(0) / setMusicVolume(0)，
                                    // 用「把音量调成 0」来表达静音 —— 两个后果：
                                    //  1. 用户辛苦调好的音量被抹掉，取消静音时又被强行写成
                                    //     1.0 / 0.3，等于每次开声音都重置一遍设置
                                    //  2. setMusicVolume(0) 改的是模块级 bgVolume，而
                                    //     syncMuteState() 只管 muted 标志、不管音量 ——
                                    //     于是「取消静音了却还是没声」（2026-10-08 用户报的 bug）
                                    //
                                    // 静音必须是标志位；音量归用户。React 的 effect 会在
                                    // isMuted 变化时调 syncMuteState，mp3 元素 / 合成引擎 /
                                    // 空间音效一起同步，所以不需要在这里碰模块层。
                                    toggleMute();
                                }}
                            >
                                {!isMuted ? " [🔊 ON]" : " [🔇 OFF]"}
                            </button>
                        </span>
                    )}
                </div>

            </div>
        </div>
    );
};

export default AchievementPopup;
