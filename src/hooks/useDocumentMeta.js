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
        description: '一个可以走进去的个人主页：8 个 3D 房间，装着履历、摄影、项目、文章、视频、音乐与 AI 技能。',
    },
    career: {
        path: '/career',
        title: '履历 · Career — AISPIN',
        description: 'AISPIN 的履历房间：15+ 年互联网研发经历，从百度、腾讯、京东到美团与轻远科技，一条时间线看完。',
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

// Map URL paths back to room IDs for deep linking.
//
// 🔴 `/about` 是**已公开索引过的旧地址**（曾经在 sitemap 里），所以它作为
//    别名保留：仍然能进房间，但 `useDocumentMeta` 会在首帧把它 replaceState
//    成 `/career`（因为 canonical / og:url 都取 `ROOM_META[room].path`）。
//    也就是说：旧链接不会失效，地址栏会自己纠正，搜索引擎拿到的是新地址。
//    别名只此一处，别在组件里再写一遍 `/about` 的分支。
const PATH_TO_ROOM = {
    '/': null,
    '/career': 'career',
    '/about': 'career',   // 旧地址别名 —— 见上面的说明
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
    /* 首帧地址栏是不是一个深链（`/career` 之类）。只读一次，之后不再变 ——
       用来决定首帧要不要"按住"地址栏，见下面 replaceState 那段。 */
    const deepLinkRef = useRef(getInitialRoomFromUrl());

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
            const isFirst = lastPushedRoom.current === undefined;
            /* 🔴 首帧「按住」地址栏：深链（`/career`）加载时 currentRoom 还是 null，
               这里原来会立刻 replaceState 成 `/` —— 地址栏闪一下 `/career` → `/`，
               等自动传送落地再变回 `/career`，中间那一下既难看、传送失败时还会
               把用户留在错误地址上。按住期间**不动** lastPushedRoom，等真正的房间
               落地时仍走 replaceState（同一个 URL，不会多出一条历史记录）。 */
            const holdDeepLink = isFirst && deepLinkRef.current && currentRoom === null;
            if (!holdDeepLink) {
                if (isFirst) {
                    window.history.replaceState({ room: currentRoom }, '', meta.path + qs);
                } else {
                    window.history.pushState({ room: currentRoom }, '', meta.path + qs);
                }
                lastPushedRoom.current = currentRoom;
            }
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
