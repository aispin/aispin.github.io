/* =============================================================================
 * `_from.js` —— 让 demo 页左上角那颗返回胶囊知道"你从哪个房间来的"。
 *
 * 问题：房间里的 demo 是用
 *     window.open(url, '_blank', 'noopener,noreferrer')
 * 打开的，`noreferrer` 让 `document.referrer` **一定是空字符串**，所以
 * "按 referrer 判断来源"这条路根本走不通（试过，永远是空的）。只能由房间
 * 显式把来源写在地址里：`?from=craft`。
 *
 * 于是这里只做一件事：地址里带 `from` 且认得出是哪个房间，就把页面上的
 * `.lab-back`（`_lab.css` 里那颗胶囊，文案本来是「← Demos」）改成
 * 「← 创意实验」并指回 `/craft`。不带 `from` 时**什么都不做** ——
 * 从 `/demos/` 索引页点进来的，胶囊照旧回索引页。
 *
 * 为什么是"改写"而不是"新建"：15 个独立 demo（web3d/*、landing、textural…）
 * 本来就没有这颗胶囊，它们各有各的左上角 HUD，硬塞一个会压住原有信息。
 * 有胶囊的 10 个页面用 `_lab.css`，样式天然一致。
 * ========================================================================== */
(function () {
    'use strict';

    var from;
    try {
        from = new URLSearchParams(window.location.search).get('from');
    } catch {
        return; // 极老的浏览器：没有 URLSearchParams，就不管了
    }
    if (!from) return;

    /* 房间 id → 地址与两种语言的叫法。加房间时在这里加一行即可。 */
    var ROOMS = {
        craft: { href: '/craft', zh: '创意实验', en: 'Craft' },
        career: { href: '/career', zh: '履历', en: 'Career' },
        posts: { href: '/posts', zh: '文稿', en: 'Writing' }
    };

    var room = ROOMS[from];
    if (!room) return;

    /* 语言跟站点一致：站点把选择存在 `aispin-language`（见
       `src/context/SitePreferences.jsx`），localStorage 读不到（隐私模式）
       时退回浏览器语言。 */
    var lang = 'zh';
    try {
        lang = localStorage.getItem('aispin-language') || lang;
    } catch {
        /* 读不到就用默认值 */
    }
    if (lang !== 'zh' && lang !== 'en') {
        lang = /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
    }

    var label = '← ' + (lang === 'en' ? room.en : room.zh);

    var links = document.querySelectorAll('.lab-back, .back');
    for (var i = 0; i < links.length; i++) {
        links[i].setAttribute('href', room.href);
        links[i].textContent = label;
    }
})();
