import { useEffect, useRef } from 'react';
import { useScene } from '../context/SceneContext';

/**
 * useDocumentMeta — Dynamic Meta Tags & Virtual Routing (History API)
 * 
 * Updates the browser URL, page title, and meta description
 * whenever the user enters/exits a 3D room. Also handles the
 * browser back/forward buttons for seamless navigation.
 */

const SITE_BASE = 'https://aispin.github.io';

const ROOM_META = {
    null: {
        path: '/',
        title: 'ZEO · 泽昊 · WEB3D HOUSE',
        description: '一个可以走进去的个人主页：8 个 3D 房间，装着档案、摄影、项目、文章、视频、音乐与 AI 技能。',
    },
    about: {
        path: '/about',
        title: '档案 · About — AISPIN',
        description: '关于 AISPIN：15+ 年互联网研发经验，做过智能设计平台与即时配送业务，也写歌、拍照、做 AI 技能。',
    },
    gallery: {
        path: '/gallery',
        title: '摄影 · Gallery — AISPIN',
        description: 'AISPIN 的摄影房间：手绘卡片墙上的光影瞬间。',
    },
    studio: {
        path: '/studio',
        title: '项目 · Studio — AISPIN',
        description: 'AISPIN 的工作室：项目与实验室，从智能设计平台到 AI 技能应用。',
    },
    posts: {
        path: '/posts',
        title: '文稿 · Posts — AISPIN',
        description: 'AISPIN 的文稿房间：研发管理、产品思维与工程实践的随笔，以及站外连载的小说。',
    },
    videos: {
        path: '/videos',
        title: '视频 · Videos — AISPIN',
        description: 'AISPIN 的短视频房间，作品陆续上架中。',
    },
    music: {
        path: '/music',
        title: '音乐 · Music — AISPIN',
        description: 'AISPIN 的原创音乐房间：独立创作的专辑与单曲。',
    },
    ai: {
        path: '/ai',
        title: 'AI+ · AI Skills — AISPIN',
        description: 'AI+ 房间：AISPIN 在 GitHub 开源的 iskill 系列技能包与 AI 应用，数据每周自动刷新。',
    },
    contact: {
        path: '/contact',
        title: '联系 · Contact — AISPIN',
        description: '联系 AISPIN：合作、交流或只是打个招呼。',
    },
};

// Map URL paths back to room IDs for deep linking
const PATH_TO_ROOM = {
    '/': null,
    '/about': 'about',
    '/gallery': 'gallery',
    '/studio': 'studio',
    '/posts': 'posts',
    '/videos': 'videos',
    '/music': 'music',
    '/ai': 'ai',
    '/contact': 'contact',
};

/**
 * Returns the room ID that the initial URL points to (for deep linking).
 * Call this once at app startup to determine if we need to auto-teleport.
 */
export function getInitialRoomFromUrl() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    return PATH_TO_ROOM[path] !== undefined ? PATH_TO_ROOM[path] : null;
}

export function useDocumentMeta() {
    const { currentRoom, teleportTo, hasEntered } = useScene();
    const isHandlingPopState = useRef(false);
    const lastPushedRoom = useRef(undefined); // Track what we last pushed to avoid duplicates

    // Update document meta and URL when room changes
    useEffect(() => {
        const roomKey = currentRoom === null ? 'null' : currentRoom;
        const meta = ROOM_META[roomKey] || ROOM_META['null'];

        // Update the page title
        document.title = meta.title;

        // Update meta description
        const descTag = document.querySelector('meta[name="description"]');
        if (descTag) {
            descTag.setAttribute('content', meta.description);
        }

        // Update OG meta tags
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) ogTitle.setAttribute('content', meta.title);

        const ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) ogDesc.setAttribute('content', meta.description);

        const ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) ogUrl.setAttribute('content', `${SITE_BASE}${meta.path}`);

        // Update canonical link to ensure virtual routes are correctly indexable as separate pages
        const canonicalTag = document.querySelector('link[rel="canonical"]');
        if (canonicalTag) {
            canonicalTag.setAttribute('href', `${SITE_BASE}${meta.path}`);
        }

        // Push to browser history (only if not handling a popstate event and room actually changed)
        if (!isHandlingPopState.current && lastPushedRoom.current !== currentRoom) {
            // Preserve query string (debug flags, UTM, OAuth callbacks...)
            const qs = window.location.search || '';
            // Use replaceState for the very first load, pushState for subsequent navigations
            if (lastPushedRoom.current === undefined) {
                window.history.replaceState({ room: currentRoom }, '', meta.path + qs);
            } else {
                window.history.pushState({ room: currentRoom }, '', meta.path + qs);
            }
            lastPushedRoom.current = currentRoom;
        }

        isHandlingPopState.current = false;
    }, [currentRoom]);

    // Handle browser back/forward buttons
    useEffect(() => {
        const handlePopState = (event) => {
            isHandlingPopState.current = true;
            const targetRoom = event.state?.room ?? null;
            lastPushedRoom.current = targetRoom;

            if (targetRoom === null) {
                // Going back to corridor — we don't teleport, just need to trigger exit
                // The SceneContext requestExit will handle the animation
                // For now, we update meta immediately
                const meta = ROOM_META['null'];
                document.title = meta.title;
            } else if (hasEntered) {
                // Teleport to the target room
                teleportTo(targetRoom);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [teleportTo, hasEntered]);
}
