import { useCallback, useEffect, useRef, useState } from 'react'
import { useSitePreferences } from '../../context/SitePreferences'
import { useAudio } from '../../context/AudioManager'
import { useScene } from '../../context/SceneContext'
import '../../styles/SiteControls.scss'

/**
 * SiteControls — the single control column in the top-right corner.
 *
 * Five buttons, top to bottom, dropping in one after another once the page has
 * loaded: map, language, settings, audio, achievements.
 *
 * Everything lives here so the corner is ONE column with ONE button style.
 * Before this, map/language/theme were here while audio/achievements sat in
 * NavigationUI behind `hasEntered` — a second cluster in the same corner, in a
 * different (torn-paper) style, that only showed up after entering the house.
 *
 * The panels those last three buttons open are still owned by NavigationUI: the
 * audio card is part of its layout and <AchievementsPanel /> is its child. The
 * button and the panel talk over window events, which is the pattern already
 * used for the map — SiteControls asks with `hudToggle`, NavigationUI answers
 * with `hudState` so the button can show its pressed state.
 *
 * 2026-10-09：第 3 个按钮由「明暗模式」改为「设置」——明暗与四季都进了设置
 * 面板，见 NavigationUI 的 settings panel。主题偏好由 SitePreferences 提供，
 * 面板直接读它，这里不再需要 theme/toggleTheme。
 *
 * 2026-11-12：**房间里这一列会淡出**（用户要求「进入房间后，3D 房子右上角的
 * 图标隐藏掉」）。原因是它在房间里是**挡内容**的：音乐房间的歌单面板铺到
 * `right:34px`，而这一列从 `right:18px` 起、宽 46 ⇒ 实测压住歌单右边缘 **30px**
 * （1440 下 `.side` 1068→1440、列 1376→1422）。其他接管房间（craft / posts /
 * ai）也各有自己的右上角。
 *
 * 🔴 **不是 `display:none`，是"淡出 + 热区召回"**：
 *   这一列里有**设置**和**音频**，房间里照样要用（音乐房间尤其 —— 用户正在
 *   听东西，想调音量不该被迫先退出房间）。所以做成播放器那种自动隐藏：
 *   静止 2.4s 后淡到 0（`pointer-events:none`），指针移到右上角热区就回来；
 *   键盘 Tab 聚焦到里面任何一颗按钮时也回来（`:focus-within`）。
 *   面板开着时**不隐藏** —— 那是用户正在用的东西。
 */

/** Panel ids, in the order they appear as buttons. */
const PANEL_IDS = ['map', 'settings', 'audio', 'achievements']

/**
 * 房间里静止多久之后把这一列淡出（ms）。
 *
 * 2400 是"看完一屏内容"的量级：进场动画 + 扫一眼唱盘/歌单大约就是这个时间，
 * 再短会在人还在看的时候就消失，再长就白占了内容。
 */
const HIDE_AFTER = 2400

/**
 * 指针进入"角落热区"的判据（px）。取 16 = 按钮自己的 18px 内缩再往里一点，
 * 所以鼠标**还没碰到按钮**时它就已经淡回来了，不用瞄。
 */
const CORNER_SLACK = 16

export default function SiteControls() {
  const { language, toggleLanguage } = useSitePreferences()
  const { isMuted } = useAudio()
  const { isInRoom } = useScene()
  const [updateReady, setUpdateReady] = useState(null)
  const [openPanel, setOpenPanel] = useState(null)

  /**
   * 房间里这一列"让开"的开关。
   *
   * 🔴 只有 `isInRoom` 时才会为 true：走廊和院子里这一列**永远在**（那里没有
   * 内容会跟它抢位置，而且它是"进屋"的主要入口之一）。
   */
  const [hidden, setHidden] = useState(false)
  const clusterRef = useRef(null)
  /* 每次"有动作"就把这个数 +1，effect 重挂定时器 —— 比手动 clearTimeout 少一处漏。 */
  const [poke, setPoke] = useState(0)

  /**
   * 音乐是不是"开着"。**默认 false** —— 这是有意的。
   *
   * 首访时浏览器必然拒绝自动播放（用户还没做过手势），所以站点一进来其实是
   * **静音**的。图标要如实反映"现在没声音"，而不是反映 `isMuted` 这个偏好位
   * ——那一位默认 false，画出来是"有声"，与实际不符（用户 2026-10-08 报的）。
   *
   * 起播点是**推门**（EntranceDoors）与**面板里取消静音**，两处都会经
   * audioManager 广播 `musicStateChanged`。
   */
  const [musicOn, setMusicOn] = useState(false)
  useEffect(() => {
    const onMusicState = (event) => setMusicOn(!!event.detail?.on)
    window.addEventListener('musicStateChanged', onMusicState)
    return () => window.removeEventListener('musicStateChanged', onMusicState)
  }, [])

  // 图标取"没声音"的态：全局静音，或者音乐还没起播
  const soundOff = isMuted || !musicOn

  // PWA 更新感知：main.jsx 在新 SW 安装完成后派发 'sw-update-ready'
  useEffect(() => {
    const onUpdate = (event) => setUpdateReady(event.detail)
    window.addEventListener('sw-update-ready', onUpdate)
    return () => window.removeEventListener('sw-update-ready', onUpdate)
  }, [])

  // Mirror whichever panel is open so the matching button can style itself
  useEffect(() => {
    const onState = (event) => setOpenPanel(event.detail || null)
    window.addEventListener('hudState', onState)
    return () => window.removeEventListener('hudState', onState)
  }, [])

  const applyUpdate = () => {
    if (!updateReady?.waiting) {
      window.location.reload()
      return
    }
    // 通知新 SW 立即接管，接管完成后刷新页面
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    }, { once: true })
    updateReady.waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  const togglePanel = useCallback(
    (id) => window.dispatchEvent(new CustomEvent('hudToggle', { detail: id })),
    []
  )

  /**
   * 房间里"让开"：进房间先亮一会儿（给人看清还有哪些控件），静止 `HIDE_AFTER`
   * 之后淡出；指针滑到右上角、或者键盘聚焦进来，又淡回来。
   *
   * 🔴 **面板开着时一律不隐藏** —— 那是用户正在用的东西，藏掉等于抢走。
   *
   * 两个"复位"放在**渲染期**做，不塞进 effect：effect 里同步 `setState` 会触发
   * 级联渲染（`react-hooks/set-state-in-effect`），而且这里本来就是
   * React 文档里那个「随 prop 变化调整 state」的标准写法。
   */
  const [wasInRoom, setWasInRoom] = useState(isInRoom)
  if (wasInRoom !== isInRoom) {
    // 进/出房间：复位（回走廊时隐藏态绝不能漏出去）
    setWasInRoom(isInRoom)
    setHidden(false)
  }
  if (openPanel && hidden) {
    setHidden(false)
  }

  useEffect(() => {
    if (!isInRoom || openPanel) return undefined
    const timer = window.setTimeout(() => setHidden(true), HIDE_AFTER)
    return () => window.clearTimeout(timer)
    // `poke` 只是用来"重置计时器"，本身不参与判断
  }, [isInRoom, openPanel, poke])

  /**
   * 右上角热区：指针靠近就淡回来。
   *
   * 用**一个大一点的方形热区**而不是"鼠标进入这一列"——后者要求瞄准那 46px 宽的
   * 按钮，而它们此刻是 `pointer-events:none`（隐形的），根本进不去。
   * 判据放在 `window` 的 pointermove 上，隐藏时才挂，显示时不花代价。
   */
  useEffect(() => {
    if (!hidden) return undefined
    const onMove = (event) => {
      const x = window.innerWidth - event.clientX
      const y = event.clientY
      if (x <= 18 + 46 + CORNER_SLACK && y <= 18 + 42 * 5 + 8 * 4 + CORNER_SLACK) {
        setHidden(false)
        setPoke((n) => n + 1)
      }
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [hidden])

  // Staggered drop-in: each button starts a little after the one above it, so
  // the column pulls down out of the top edge instead of appearing all at once.
  const dropDelay = (index) => ({ animationDelay: `${index * 70}ms` })

  const zh = language === 'zh'

  return (
    <>
      {updateReady && (
        <div className="site-controls__update-wrap">
          <button
            type="button"
            className="hud-btn site-controls__update"
            style={dropDelay(0)}
            onClick={applyUpdate}
            aria-label={zh ? '发现新版本，点击刷新' : 'New version available, click to refresh'}
          >
            {zh ? '↻ 新版本' : '↻ Update'}
          </button>
        </div>
      )}
      <div
        className={`hud-cluster hud-cluster--right site-controls ${hidden ? 'is-hidden' : ''}`}
        aria-label={zh ? '站点设置' : 'Site preferences'}
        ref={clusterRef}
        /* 键盘用户：Tab 进来一颗按钮就把它叫回来（`:focus-within` 负责视觉，
           这里只是提前把 `is-hidden` 摘掉，否则 `pointer-events:none` 下
           焦点能进但看不见按钮）。 */
        onFocusCapture={() => {
          if (!hidden) return
          setHidden(false)
          setPoke((n) => n + 1)
        }}
        /* 每次点按都是"还在用"，重新计时 */
        onClickCapture={() => setPoke((n) => n + 1)}
      >
        {/* 1 · Map */}
        <button
          type="button"
          className={`hud-btn ${openPanel === 'map' ? 'is-open' : ''}`}
          style={dropDelay(0)}
          onClick={() => togglePanel('map')}
          aria-label={zh ? '打开地图菜单' : 'Open map menu'}
          aria-expanded={openPanel === 'map'}
        >
          <span className="site-controls__burger" aria-hidden="true">
            <span /><span /><span />
          </span>
        </button>

        {/* 2 · Language */}
        <button
          type="button"
          className="hud-btn hud-btn--text"
          style={dropDelay(1)}
          onClick={toggleLanguage}
          aria-label={zh ? 'Switch to English' : '切换到中文'}
        >
          {zh ? 'EN' : '中文'}
        </button>

        {/* 3 · Settings —— 这个位置原来是「明暗模式」的图标按钮（☀/☾）。
                用户 2026-10-09 要求换成设置按钮：明暗与四季都收进面板里。
                四季是新功能，塞进一个"点一下轮换"的图标里会很难用（四个季节
                要盲点三次才知道到了哪一季），而设置面板本来就要有。 */}
        <button
          type="button"
          className={`hud-btn ${openPanel === 'settings' ? 'is-open' : ''}`}
          style={dropDelay(2)}
          onClick={() => togglePanel('settings')}
          aria-label={zh ? '设置' : 'Settings'}
          aria-expanded={openPanel === 'settings'}
        >
          {/* 齿轮 = 外圈 + 八颗齿 + 轮毂。齿的写法与上面那枚太阳同构
              （同半径区间、同相对命令），所以两者并排也不会一个粗一个细。 */}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.3" />
            <circle cx="12" cy="12" r="6.4" />
            <path d="M18.4 12h2.6M16.53 16.53l1.84 1.84M12 18.4v2.6M7.47 16.53l-1.84 1.84M5.6 12h-2.6M7.47 7.47l-1.84-1.84M12 5.6V3M16.53 7.47l1.84-1.84" />
          </svg>
        </button>

        {/* 4 · Audio settings —— 图标按「现在有没有声音」取态（默认静音态），
               但**行为不变**：点它只打开音频设置面板。用户 2026-10-08 明确要
               保留这个行为，因为播放/静音的开关就在面板里。

               🔴 静音时**只换图标，不给按钮加任何样式**（2026-10-12 用户要求：
               「没有声音的图标，太暗了。不做透明度处理。因为图标已经有反馈了。」）。
               原来这里还会加一个 `is-muted` 类，把按钮的背景改成透明的 ——
               背景一透明就**透出身后的深色场景**，整颗按钮发暗、读成"坏了"。
               换图标这**一件事**已经说清了状态，不需要第二个信号。 */}
        <button
          type="button"
          className={`hud-btn ${openPanel === 'audio' ? 'is-open' : ''}`}
          style={dropDelay(3)}
          onClick={() => togglePanel('audio')}
          aria-label={zh ? '音频设置' : 'Audio settings'}
          aria-expanded={openPanel === 'audio'}
        >
          {soundOff ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <path d="M15 9a5 5 0 0 1 0 6" />
              <path d="M18 5a9 9 0 0 1 0 14" />
            </svg>
          )}
        </button>

        {/* 5 · Achievements */}
        <button
          type="button"
          className={`hud-btn ${openPanel === 'achievements' ? 'is-open' : ''}`}
          style={dropDelay(4)}
          onClick={() => togglePanel('achievements')}
          aria-label={zh ? '成就' : 'Achievements'}
          aria-expanded={openPanel === 'achievements'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 21h8M12 17v4M7 4h10M5 4h14v5a7 7 0 0 1-7 7 7 7 0 0 1-7-7z" />
            <path d="M5 9H3V6h2" />
            <path d="M19 9h2V6h-2" />
          </svg>
        </button>
      </div>
    </>
  )
}
