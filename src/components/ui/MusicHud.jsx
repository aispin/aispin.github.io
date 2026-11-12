import { useEffect, useLayoutEffect, useRef } from 'react'
import { useScene } from '../../context/SceneContext'
import { useSitePreferences } from '../../context/SitePreferences'
import { pauseBackgroundMusic, playBackgroundMusic } from '../../utils/audioManager'
import { musicStage, setSpinning } from '../../state/musicRoom'
import createVinyl from './vinylEngine'
import './MusicHud.scss'

/**
 * 音乐房间 —— 唱盘的 **DOM 层**。
 *
 * 这一层是 `public/demos/web3d/vinyl-player/index.html` 那套东西的移植：
 * 一台真的会转、真的会响的唱盘，封套是作品、唱片是声音、唱臂是时间。
 * 环境（暗房：顶灯 + 浮尘 + 暗角）由 `canvas/rooms/RoomMusic.jsx` 接管渲染。
 *
 * ── 为什么唱盘不做成 three 网格 ──────────────────────────────────────
 * 和 `PostsHud` 的理由一样：盘面、封套、频谱全是 **canvas 2D 绘制**，
 * 透视靠 CSS `rotateX(52deg)`。走 three 就要把这三张 2D 图渲成纹理会糊，
 * 而且唱臂的命中判定（`nearArm`）会全部重写 —— 那套东西上周刚踩完坑
 * （`preserve-3d` 里 z-index 不排序、`elementFromPoint` 与真实 pointer 命中
 * 是两条路径）。平面变换和 three 的 plane 视觉上几乎无差别。
 *
 * ── 引擎 ──────────────────────────────────────────────────────────────
 * 逻辑在 `./vinylEngine.js`（demo 的移植，逐字相同，只改了"环境从哪来"
 * 和"什么时候启动/销毁"）。这里只负责：挂 DOM → 起引擎 → 房子换主题/语言
 * 时通知它 → 卸载时销毁它。
 *
 * ── 音频 ──────────────────────────────────────────────────────────────
 * 🔴 进房间要**停掉站内 BGM**（`pauseBackgroundMusic()`），否则两首歌一起响。
 *    出门再放回来。这是 WO-5 验收判据里那条"退出房间后音频必须停"的另一半。
 *
 * ── 主题 / 语言 ───────────────────────────────────────────────────────
 * 跟随房子（`useSitePreferences()`），本层**没有**自己的切换器。
 */

const MusicHud = () => {
    const { currentRoom } = useScene()
    const { language, theme } = useSitePreferences()

    const visible = currentRoom === 'music'
    const rootRef = useRef(null)
    const engineRef = useRef(null)
    /* 引擎按 id 抓节点，DOM 必须先落地 ⇒ 在 ref 回调里起，不用 effect。 */
    const started = useRef(false)

    /* 🔴 引擎在构造时**同步**抓 `#discArt` / `#sleeveArt` / `#deck` 等节点
       （`const artCv = $('discArt')` 那些是模块顶层的常量）。
       所以 DOM 必须**已经进文档**才能起引擎。
       `useEffect` 的顺序是：先 commit（DOM 已插入）再跑 effect —— 但对
       `visible` 从 false 翻 true 的这一次，React 先渲染出新子树、再跑 effect，
       理论上 DOM 已就位。实测却拿到 null：因为上一轮 `return null` 时
       `rootRef.current` 已被置 null，而这次 effect 复用了同一个 null 判断。
       用 `useLayoutEffect` 更稳（DOM 一定已提交），并且把判断改成"节点在不在文档里"。
    */
    useLayoutEffect(() => {
        if (!visible) return undefined
        const root = rootRef.current
        if (!root || !root.isConnected) return undefined
        if (started.current) return undefined
        started.current = true

        /* 进门先把站内 BGM 停掉 —— 否则唱盘和 BGM 一起响，那是两个音源。
           demo 页没有 BGM，所以这一步只在房间里做。 */
        pauseBackgroundMusic()

        const engine = createVinyl({
            root,
            theme,
            lang: language,
            libUrl: '/data/netease-music-zeo.json',
        })
        engine.start()
        engineRef.current = engine

        /* 把"唱片在不在转"同步给暗房（着色器用它决定那道扫光要不要活）。
           引擎的 <audio> 事件是最可靠的真源 —— play/pause/ended 都会过这里。 */
        const audio = engine.audio
        const sync = () => setSpinning(!audio.paused)
        audio.addEventListener('play', sync)
        audio.addEventListener('pause', sync)
        audio.addEventListener('ended', sync)
        sync()

        return () => {
            started.current = false
            engineRef.current = null
            /* 🔴 `destroy()` 里会 `audio.pause()` —— 退出房间后音频必须停，
               这是 WO-5 的验收判据。然后再把 BGM 放回来。 */
            audio.removeEventListener('play', sync)
            audio.removeEventListener('pause', sync)
            audio.removeEventListener('ended', sync)
            engine.destroy()
            setSpinning(false)
            playBackgroundMusic()
        }
        /* 🔴 只在"进/出房间"时起停。主题和语言由下面那个 effect 单独推 ——
           把 theme/language 放进依赖会让引擎每切一次主题就重建一遍
           （唱片会从 0 开始转、当前曲目也会丢）。 */
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible])

    useEffect(() => {
        engineRef.current?.setEnv({ theme, lang: language })
    }, [theme, language])

    /* 探针用：把"唱片在不在转"暴露出去（只读）。
       和 demo 的 `window.__vinyl` 同一个用途 —— 无头里验的是状态，不是截图。 */
    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        window.__musicStage = musicStage
        return () => { delete window.__musicStage }
    }, [])

    if (!visible) return null

    return (
        <div className="music-room" ref={rootRef}>
            <header className="brand">
              <div className="brand__name" id="brandName">黑胶<i>/</i>VINYL</div>
              <div className="brand__meta" id="brandMeta">ZEO · 精选集</div>
            </header>

            <div className="stage">
              <div className="deckwrap" id="deckwrap">
                <div className="deck" id="deck">
                  <div className="deck__plane">
                    <div className="sleeve" id="sleeve"><canvas id="sleeveArt" width="600" height="600" /></div>
                    <div className="disc" id="disc">
                      <canvas id="discArt" />
                      <canvas id="discRing" />
                    </div>
                    <div className="arm" id="arm">
                      <div className="arm__rod"></div>
                      <div className="arm__weight"></div>
                      <div className="arm__pivot"></div>
                      <div className="arm__head"><i className="arm__needle" /></div>
                      <div className="arm__shadow"></div>
                    </div>
                  </div>
                </div>
              </div>
              <aside className="side">
                <div className="side__head">
                  <span className="side__kicker" id="kicker">精选 · SELECTED</span>
                  <span className="side__count" id="count">—</span>
                </div>
                <div className="shelf">
                  <div className="shelf__lists" id="shelfLists" role="tablist">
                    <button className="pl is-on" type="button" role="tab" data-list="curated">
                      <span className="pl__name">精选</span>
                      <span className="pl__num"><b>—</b><i>首</i></span>
                    </button>
                    <button className="pl" type="button" role="tab" data-list="latest" disabled>
                      <span className="pl__name">最新</span>
                      <span className="pl__num"><b>—</b><i>首</i></span>
                    </button>
                    <button className="pl" type="button" role="tab" data-list="hot" disabled>
                      <span className="pl__name">最热</span>
                      <span className="pl__num"><b>—</b><i>首</i></span>
                    </button>
                  </div>
                  <div className="shelf__row" id="shelf" hidden>
                    <a className="shelf__more" id="allAlbums" href="https://music.163.com/#/artist?id=49232788" target="_blank" rel="noopener noreferrer">全部<i>↗</i></a>
                  </div>
                </div>
                <ol className="tracks" id="tracks" />
                <div className="transport">
                  <div className="now">
                    <div className="now__title" id="nowTitle">—</div>
                    <div className="now__sub" id="nowSub">—</div>
                  </div>
                  <div className="bar" id="bar" role="slider" aria-label="进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabIndex={0}>
                    <div className="bar__rail"><div className="bar__fill" id="barFill"></div></div>
                    <div className="bar__dot" id="barDot"></div>
                  </div>
                  <div className="time"><span id="tCur">0:00</span><span id="tDur">0:00</span></div>
                  <div className="controls">
                    <button className="btn" id="prev" aria-label="上一首">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2.5 5 7l6 4.5z"/><path d="M3 2.5v9"/></svg>
                    </button>
                    <button className="btn btn--play" id="play" aria-label="播放">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" id="playIcon"><path d="M4.5 2.6 13 8l-8.5 5.4z"/></svg>
                    </button>
                    <button className="btn" id="next" aria-label="下一首">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2.5 9 7l-6 4.5z"/><path d="M11 2.5v9"/></svg>
                    </button>
                    <span className="controls__spacer" />
                    <a className="src" id="src" href="https://music.163.com/" target="_blank" rel="noopener noreferrer">网易云 ↗</a>
                  </div>
                  <div className="hint" id="hint">点曲目 / ↑↓ 切换 · 空格播放 · ←→ 快退快进 · 拖动进度条或唱臂</div>
                </div>
              </aside>
            </div>
            <div className="toast" id="toast"></div>

            <div className="toast" id="toast" />
        </div>
    )
}

export default MusicHud
