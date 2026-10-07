/**
 * engine/audioBus — 全站**一个** AudioListener
 * ==============================================
 *
 * 实测出来的问题
 * --------------
 * 场景里同时存在 **42 个** drei `<PositionalAudio>` 实例（每扇门 2-3 个，
 * 门又按走廊分段/房间各挂一份），而它们总共只播 3 个音效文件，
 * 加起来 99 KB：
 *
 *     otwarciedrzwi.mp3    65 KB
 *     uchyleniedrzwi.mp3   16 KB
 *     zamknieciedrzwi.mp3  18 KB
 *
 * drei 的实现在每个实例里都做这两件事：
 *
 *     const [listener] = useState(() => new AudioListener())
 *     camera.add(listener)
 *
 * 而 three 的 `AudioListener` 构造时会 `createGain()` 并
 * `gain.connect(context.destination)`，同时把自己挂成一个 Object3D。
 * 所以 42 个实例 = 42 个 AudioListener + 42 个直连 destination 的 GainNode
 * + 42 个挂在相机下的子对象，每帧都要跟着相机走一遍矩阵更新。
 *
 * 正解是**共用一个 listener** —— 位置同步本来就只需要一份。
 *
 * ---------------------------------------------------------------------------
 * 为什么**没有**连音效节点一起做池
 * ---------------------------------------------------------------------------
 * 直觉上 42 个节点也该收成 3 个（每个文件一个），播的时候把节点挪到正在
 * 开门的那扇门上。但这样做会改变行为：门扇的悬停音是按 `ref.current.isPlaying`
 * 判断"我这一扇现在响不响"的（见 Door.jsx / DoorSection.jsx 的 hover 逻辑），
 * 节点一共用，A 门的判断就会被 B 门的播放影响。
 * 而一个 PannerNode 在没有活动声源时几乎不消耗 —— 真正常驻的开销是
 * listener 那一层（GainNode 直连 destination + 相机子对象），已经被消掉了。
 *
 * 所以：**共用一个 listener，每扇门保留自己的节点**。
 * 如果将来真的实测到 42 个 PannerNode 有开销（比如同时有很多扇门在响），
 * 再考虑池化 —— 那时候要把 hover 的"我在响吗"改成按门记录，而不是问节点。
 */

import * as THREE from 'three';

let _listener = null;

/**
 * 挂/摘的环形日志。**只用于排查**「listener 明明挂上了又没了」这类问题 ——
 * 光看最终状态分不清是"从没挂上"还是"挂上又被摘了"。
 */
const _log = [];
function _rec(op, cam) {
    _log.push({
        op,
        t: Math.round(performance.now()),
        cam: cam ? cam.uuid.slice(0, 8) : '-',
        listener: _listener ? _listener.uuid.slice(0, 8) : '-',
        parent: _listener && _listener.parent ? _listener.parent.uuid.slice(0, 8) : '-',
        kids: cam ? cam.children.length : -1,
    });
    if (_log.length > 200) _log.shift();
}

/**
 * 全站唯一的 AudioListener。
 *
 * 它会用 three 的全局 AudioContext（`AudioContext.getContext()`），而
 * src/audio/sfxContext.js 已经把那个单例钉住了 —— 所以这里不会额外多出
 * 一个原生 AudioContext。
 */
export function sharedListener() {
    if (!_listener) _listener = new THREE.AudioListener();
    return _listener;
}

/**
 * 把 listener 挂到相机上。位置音效靠 listener 的世界矩阵同步到 Web Audio
 * 的听者坐标，所以它必须在场景图里、且跟着相机。
 * 只会成功挂一次；重复调用是幂等的。
 */
export function attachListenerTo(camera) {
    if (!camera) return null;
    const l = sharedListener();
    if (l.parent !== camera) camera.add(l);
    _rec('attach', camera);
    return l;
}

export function detachListenerFrom(camera) {
    if (_listener && camera && _listener.parent === camera) camera.remove(_listener);
    _rec('detach', camera);
}

/** 调试 / 测试用：现在到底有几个 listener、挂在谁身上。 */
export function audioBusStats() {
    return {
        hasListener: !!_listener,
        parentIsCamera: !!_listener && _listener.parent?.isCamera === true,
        contextState: _listener ? _listener.context.state : null,
    };
}

/* ------------------------------------------------------------------ */
/* 自检                                                                */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ 自检**不能有副作用** —— 这条是踩出来的。
 *
 * `sharedListener()` 是**全站单例**，所以下面没法拿一个"干净的"实例来测挂载，
 * 只能把它临时挪到一台一次性相机上。第一版忘了还原，结果：
 * 自检跑完，线上那个 listener 被摘得**没有 parent** 了，位置音效全部静默。
 *
 * 更坑的是它的表现：无头验证里先 `waitForFunction` 看到 parentIsCamera=true，
 * 紧接着的断言全是 false —— 看起来像"挂上又掉了"的诡异竞态，
 * 其实是**断言自己把被测对象拆了**。
 *
 * 所以这里必须记下原来的 parent 并还原，而且把"还原了"也断言一遍。
 */
export function demo() {
    const assert = (c, m) => {
        if (!c) throw new Error('audioBus.demo: ' + m);
    };
    const a = sharedListener();
    const b = sharedListener();
    assert(a === b, 'sharedListener 不是单例');
    // 注意：three **没有** `isAudioListener` 标志位，只有 `type`。
    assert(a.type === 'AudioListener', 'sharedListener 返回的不是 AudioListener');

    const originalParent = a.parent;

    const cam = new THREE.PerspectiveCamera();
    attachListenerTo(cam);
    attachListenerTo(cam);          // 幂等
    const kids = cam.children.filter((c) => c === a).length;
    assert(kids === 1, '重复挂载产生了多个 listener 子对象: ' + kids);
    assert(audioBusStats().parentIsCamera, 'listener 没挂到相机上');
    detachListenerFrom(cam);
    assert(cam.children.length === 0, 'detach 没摘干净');

    // 还原现场（没有原 parent 就是没有，保持 null）
    if (originalParent) originalParent.add(a);
    assert(a.parent === originalParent, '自检把单例 listener 的 parent 弄丢了');

    return '✅ engine/audioBus 自检通过';
}

if (typeof window !== 'undefined') {
    window.__engineAudioBusDemo = demo;
    // 给无头验证用。注意 three 的 AudioListener **没有** `isAudioListener` 标志位
    // （只设了 `this.type = 'AudioListener'`），而且 listener 是相机的子对象、
    // 相机不一定在 scene 图里 —— 所以从场景里 traverse 是数不到的，只能从
    // 模块内部把实例交出去。
    window.__audioBus = { stats: audioBusStats, listener: sharedListener, log: () => _log.slice() };
}
