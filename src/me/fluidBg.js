/**
 * /me 的背景：手写 WebGL 流体场（原生 WebGL + GLSL，不依赖 three.js）。
 *
 * 从 demos/3d-ip-landing 原型搬过来，改动只有两处：
 *   1. 颜色不再硬编码，改成每次主题切换时从 CSS 变量读（--shader-*），
 *      这样明暗两套配色只写在 me.css 里，shader 里没有颜色字面量；
 *   2. 暴露 dispose()，离开页面 / 热更新时能停掉 rAF 并释放 GL 资源。
 *
 * 为什么不用 three.js：这个页面唯一的 3D 就是一张全屏背景。为它引入
 * ~600KB 的 three 会让 /me 的 bundle 和整个 3D 主站一样重，而这里只需要
 * 一个全屏三角形和一个 fragment shader。
 */

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform vec2  u_mouse;
uniform float u_time;
uniform vec3  u_bg;
uniform vec3  u_c1;
uniform vec3  u_c2;
uniform vec3  u_ac;

vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec2 mod289(vec2 x){return x - floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187,0.366025403784439,
                     -0.577350269189626,0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0,i1.y,1.0))
                            + i.x + vec3(0.0,i1.x,1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main(){
  vec2 res = u_res;
  vec2 p = (gl_FragCoord.xy - 0.5*res) / min(res.x, res.y);
  float t = u_time * 0.09;

  // 鼠标位置（归一化到同一坐标系）
  vec2 m = (u_mouse - 0.5*res) / min(res.x, res.y);
  float md = length(p - m);
  float mInf = smoothstep(0.55, 0.0, md);

  // 三层噪声叠加，越靠里层越快
  float n1 = snoise(p*1.4 + vec2(t, t*0.7));
  float n2 = snoise(p*2.8 - vec2(t*1.2, t*0.55) + n1*0.55);
  float n3 = snoise(p*5.5 + vec2(t*0.35) + n2*0.35);
  float n = n1*0.55 + n2*0.3 + n3*0.15;

  // 鼠标推流：围绕指针的波纹
  float ripple = sin(md*16.0 - u_time*2.2) * exp(-md*3.2);
  n += mInf * ripple * 0.32;
  n += mInf * 0.18;

  // 颜色混合：底层 → 主色 → 辅色
  vec3 col = mix(u_bg, u_c1, smoothstep(-0.75, 0.55, n));
  col = mix(col, u_c2, smoothstep(0.05, 0.85, n*0.85 + 0.2));
  col = mix(col, u_ac, pow(smoothstep(0.55, 1.0, n), 2.5) * 0.55);

  // 鼠标光晕
  col += u_c2 * mInf * 0.22;
  col += u_ac * mInf * mInf * 0.12;

  // 极轻的暗角，让视线聚焦中心
  float vig = smoothstep(1.5, 0.35, length(p));
  col *= 0.88 + 0.12 * vig;

  gl_FragColor = vec4(col, 1.0);
}
`

function hexToRgb(h) {
  let s = String(h).replace('#', '').trim()
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  const n = parseInt(s, 16)
  if (Number.isNaN(n)) return [0, 0, 0]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** 从 CSS 变量读色，兼容 #rrggbb 与 rgb()/rgba()。 */
function cssColor(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!v) return [0, 0, 0]
  if (v.startsWith('#')) return hexToRgb(v)
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(',').map((s) => parseFloat(s))
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255]
  }
  return [0, 0, 0]
}

/**
 * 挂载流体背景。
 * @param {HTMLCanvasElement} canvas
 * @returns {{ dispose: () => void }}
 */
export function mountFluidBackground(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false })
    || canvas.getContext('experimental-webgl')

  if (!gl) {
    // 不支持 WebGL：退化成一层渐变，页面其余部分照常工作。
    canvas.style.background = 'radial-gradient(circle at 50% 40%, var(--brand-bg), var(--n-0))'
    return { dispose() {} }
  }

  function compile(type, src) {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[me] shader compile error:', gl.getShaderInfoLog(s))
      return null
    }
    return s
  }

  const vs = compile(gl.VERTEX_SHADER, VERT)
  const fs = compile(gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) {
    return { dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext() } }
  }

  const prog = gl.createProgram()
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[me] program link error:', gl.getProgramInfoLog(prog))
    return { dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext() } }
  }
  gl.useProgram(prog)

  // 全屏三角形
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  const uRes = gl.getUniformLocation(prog, 'u_res')
  const uMouse = gl.getUniformLocation(prog, 'u_mouse')
  const uTime = gl.getUniformLocation(prog, 'u_time')
  const uBg = gl.getUniformLocation(prog, 'u_bg')
  const uC1 = gl.getUniformLocation(prog, 'u_c1')
  const uC2 = gl.getUniformLocation(prog, 'u_c2')
  const uAc = gl.getUniformLocation(prog, 'u_ac')

  const dpr = Math.min(window.devicePixelRatio || 1, 1.75)
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 }
  const start = performance.now()
  let paused = false
  let raf = 0

  function resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(uRes, canvas.width, canvas.height)
    if (!mouse.tx && !mouse.ty) {
      mouse.tx = canvas.width / 2
      mouse.ty = canvas.height * 0.4
      mouse.x = mouse.tx
      mouse.y = mouse.ty
    }
  }

  function applyTheme() {
    gl.uniform3fv(uBg, cssColor('--shader-bg'))
    gl.uniform3fv(uC1, cssColor('--shader-c1'))
    gl.uniform3fv(uC2, cssColor('--shader-c2'))
    gl.uniform3fv(uAc, cssColor('--shader-ac'))
  }

  function onPointerMove(e) {
    mouse.tx = e.clientX * dpr
    mouse.ty = (window.innerHeight - e.clientY) * dpr // WebGL y 轴朝上
  }

  function onVisibility() {
    paused = document.hidden
  }

  function onSchemeChange() {
    if (!document.documentElement.dataset.theme) applyTheme()
  }

  function frame(now) {
    raf = requestAnimationFrame(frame)
    if (paused) return
    mouse.x += (mouse.tx - mouse.x) * 0.08
    mouse.y += (mouse.ty - mouse.y) * 0.08
    gl.uniform2f(uMouse, mouse.x, mouse.y)
    gl.uniform1f(uTime, (now - start) / 1000)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('themechange', applyTheme)
  darkQuery.addEventListener('change', onSchemeChange)

  resize()
  applyTheme()
  raf = requestAnimationFrame(frame)

  return {
    /** 主题切换后重新取色（me.css 里的变量已经变了）。 */
    refreshTheme: applyTheme,
    dispose() {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('themechange', applyTheme)
      darkQuery.removeEventListener('change', onSchemeChange)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
