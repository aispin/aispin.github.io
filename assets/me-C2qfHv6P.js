import{p as k,m as l,g as rt,h as ot,i as Q,s as it,c as at}from"./site-DT7SkjFf.js";function s(t,e){return t==null?"":typeof t=="string"?t:t[e]??t.zh??t.en??""}function st(t,e){const n=Q.filter(r=>r.id===t);return n.find(r=>r.locale===e)??n.find(r=>r.locale==="zh")??n[0]??null}function V(t){if(!t)return"";const[e,n]=String(t).split("-");return n?`${e}.${n}`:e}function ct(t="zh"){const e=s({zh:k.name,en:k.nameEn},t)||l.brand,n=s({zh:k.location,en:k.locationEn},t),r=l.nav.map(i=>({id:i.id,label:s(i,t)})),m={eyebrow:s(l.roles.eyebrow,t),title:s(l.roles.title,t),desc:s(l.roles.desc,t),items:l.roles.items.map(i=>({key:i.key,icon:i.icon,title:s(i.title,t),desc:s(i.desc,t),tags:i.tags}))},a={eyebrow:s(l.works.eyebrow,t),title:s(l.works.title,t),desc:s(l.works.desc,t),items:l.works.items.map(i=>{const u=st(i.projectId,t);return u?{id:u.id,span:i.span,visual:i.visual,kind:s(i.kind,t),title:u.name,description:String(u.description||"").replace(/^[^\p{L}\p{N}]+/u,"").split(/[。.]/)[0].slice(0,90),url:u.url||"",role:u.role||"",period:[V(u.startDate),V(u.endDate)].filter(Boolean).join(" – "),opensource:!!u.opensource}:null}).filter(Boolean)},h=rt.map(i=>({id:i.id,title:i.title,album:i.album,platform:i.platform,date:V(i.publishedAt),url:`https://music.163.com/#/song?id=${(String(i.file).match(/id=(\d+)/)||[])[1]||""}`})),p=[{icon:"mail",label:t==="zh"?"邮件":"Email",href:`mailto:${k.email}`},{icon:"github",label:"GitHub",href:k.github},{icon:"music",label:t==="zh"?"音乐主页":"Music",href:h[0]?.url||k.github}],x=[{value:String(ot.length),label:t==="zh"?"开源 AI 技能":"open-source AI skills"},{value:String(h.length),label:t==="zh"?"发行曲目":"released tracks"},{value:String(Q.filter(i=>i.locale===t).length),label:t==="zh"?"项目记录":"projects logged"}];return{lang:t,brand:l.brand,name:e,location:n,badge:s(l.badge,t),tagline:s(l.heroTagline,t),nav:r,roles:m,works:a,tracks:h,music:{eyebrow:s(l.music.eyebrow,t),title:s(l.music.title,t),desc:s(l.music.desc,t),proceduralTitle:s(l.music.proceduralTitle,t),proceduralMeta:s(l.music.proceduralMeta,t),listTitle:s(l.music.listTitle,t)},contact:{eyebrow:s(l.contact.eyebrow,t),title:s(l.contact.title,t),desc:s(l.contact.desc,t)},links:p,stats:x,footerNote:s(l.footerNote,t),siteUrl:it.siteUrl}}const lt=`
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`,dt=`
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
`;function ht(t){let e=String(t).replace("#","").trim();e.length===3&&(e=e.split("").map(r=>r+r).join(""));const n=parseInt(e,16);return Number.isNaN(n)?[0,0,0]:[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]}function j(t){const e=getComputedStyle(document.documentElement).getPropertyValue(t).trim();if(!e)return[0,0,0];if(e.startsWith("#"))return ht(e);const n=e.match(/rgba?\(([^)]+)\)/);if(n){const r=n[1].split(",").map(m=>parseFloat(m));return[r[0]/255,r[1]/255,r[2]/255]}return[0,0,0]}function ut(t){const e=t.getContext("webgl",{antialias:!1,alpha:!1,premultipliedAlpha:!1})||t.getContext("experimental-webgl");if(!e)return t.style.background="radial-gradient(circle at 50% 40%, var(--brand-bg), var(--n-0))",{dispose(){}};function n(g,_){const b=e.createShader(g);return e.shaderSource(b,_),e.compileShader(b),e.getShaderParameter(b,e.COMPILE_STATUS)?b:(console.warn("[me] shader compile error:",e.getShaderInfoLog(b)),null)}const r=n(e.VERTEX_SHADER,lt),m=n(e.FRAGMENT_SHADER,dt);if(!r||!m)return{dispose(){e.getExtension("WEBGL_lose_context")?.loseContext()}};const a=e.createProgram();if(e.attachShader(a,r),e.attachShader(a,m),e.linkProgram(a),!e.getProgramParameter(a,e.LINK_STATUS))return console.warn("[me] program link error:",e.getProgramInfoLog(a)),{dispose(){e.getExtension("WEBGL_lose_context")?.loseContext()}};e.useProgram(a);const h=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,h),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW);const p=e.getAttribLocation(a,"a_pos");e.enableVertexAttribArray(p),e.vertexAttribPointer(p,2,e.FLOAT,!1,0,0);const x=e.getUniformLocation(a,"u_res"),i=e.getUniformLocation(a,"u_mouse"),u=e.getUniformLocation(a,"u_time"),R=e.getUniformLocation(a,"u_bg"),L=e.getUniformLocation(a,"u_c1"),A=e.getUniformLocation(a,"u_c2"),S=e.getUniformLocation(a,"u_ac"),w=Math.min(window.devicePixelRatio||1,1.75),d={x:0,y:0,tx:0,ty:0},W=performance.now();let B=!1,$=0;function E(){const g=window.innerWidth,_=window.innerHeight;t.width=Math.floor(g*w),t.height=Math.floor(_*w),t.style.width=`${g}px`,t.style.height=`${_}px`,e.viewport(0,0,t.width,t.height),e.uniform2f(x,t.width,t.height),!d.tx&&!d.ty&&(d.tx=t.width/2,d.ty=t.height*.4,d.x=d.tx,d.y=d.ty)}function y(){e.uniform3fv(R,j("--shader-bg")),e.uniform3fv(L,j("--shader-c1")),e.uniform3fv(A,j("--shader-c2")),e.uniform3fv(S,j("--shader-ac"))}function c(g){d.tx=g.clientX*w,d.ty=(window.innerHeight-g.clientY)*w}function v(){B=document.hidden}function f(){document.documentElement.dataset.theme||y()}function C(g){$=requestAnimationFrame(C),!B&&(d.x+=(d.tx-d.x)*.08,d.y+=(d.ty-d.y)*.08,e.uniform2f(i,d.x,d.y),e.uniform1f(u,(g-W)/1e3),e.drawArrays(e.TRIANGLES,0,3))}const F=window.matchMedia("(prefers-color-scheme: dark)");return window.addEventListener("resize",E),window.addEventListener("pointermove",c,{passive:!0}),document.addEventListener("visibilitychange",v),window.addEventListener("themechange",y),F.addEventListener("change",f),E(),y(),$=requestAnimationFrame(C),{refreshTheme:y,dispose(){cancelAnimationFrame($),window.removeEventListener("resize",E),window.removeEventListener("pointermove",c),document.removeEventListener("visibilitychange",v),window.removeEventListener("themechange",y),F.removeEventListener("change",f),e.getExtension("WEBGL_lose_context")?.loseContext()}}}const O=[{id:"morning",zh:"晨光",en:"Morning light",note:{zh:"明亮的五声",en:"bright pentatonic"}},{id:"campfire",zh:"篝火",en:"Campfire",note:{zh:"木吉他物理建模",en:"Karplus-Strong guitar"}},{id:"bedtime",zh:"睡前",en:"Bedtime",note:{zh:"八音盒摇篮曲",en:"music-box lullaby"}}],mt={morning:96,campfire:84,bedtime:64};function pt(t){let e=t>>>0;return()=>{e=e+1831565813>>>0;let n=Math.imul(e^e>>>15,1|e);return n=n+Math.imul(n^n>>>7,61|n)^n,((n^n>>>14)>>>0)/4294967296}}const M=96,ft=(()=>{const t=pt(23063);return Array.from({length:M},(e,n)=>{const r=n/M,m=Math.sin(r*Math.PI)**.6,a=Math.sin(n*.42)*.3,h=Math.sin(n*1.13)*.2,p=Math.sin(n*2.7)*.11;return Math.max(.12,Math.min(1,(.45+a+h+p)*m+t()*.14))})})();function gt({canvas:t,wrap:e,button:n,elapsedEl:r,themeSelect:m}){const a=at(),h=t.getContext("2d"),p=Math.min(window.devicePixelRatio||1,2);let x=O[1].id,i=!1,u=0,R=0,L=0;function A(){const c=e.getBoundingClientRect();c.width&&(t.width=Math.floor(c.width*p),t.height=Math.floor(c.height*p),t.style.width=`${c.width}px`,t.style.height=`${c.height}px`)}const S=c=>getComputedStyle(document.documentElement).getPropertyValue(c).trim();function w(){u=requestAnimationFrame(w);const c=t.width,v=t.height;if(!c||!v)return;h.clearRect(0,0,c,v);const f=Math.max(1,Math.floor(c/M*.62)),C=Math.max(1,Math.floor(c/M-f)),F=M*(f+C)-C,g=(c-F)/2,_=S("--n-300"),b=S("--brand"),tt=S("--accent"),H=i?L*(mt[x]||90)/60:0,et=H%1;for(let T=0;T<M;T++){const D=T/M;let z=ft[T];if(i){z*=.78+.22*Math.sin(Math.PI*et),z*=.86+.14*Math.sin(D*Math.PI*4-H*Math.PI*2);const G=H*.12%1;Math.abs(D-G)<.012&&(z=Math.min(1,z*1.5))}else z*=.78;const Y=Math.max(3,Math.min(1,z*1.3)*v*.9),q=g+T*(f+C),X=(v-Y)/2;if(h.fillStyle=i?b:_,i){const G=H*.12%1;Math.abs(D-G)<.012&&(h.fillStyle=tt)}const nt=Math.min(f/2,1.5);h.beginPath(),h.roundRect?h.roundRect(q,X,f,Y,nt):h.rect(q,X,f,Y),h.fill()}}function d(c){const v=Math.floor(c/60),f=String(Math.floor(c%60)).padStart(2,"0");return`${v}:${f}`}function W(){i&&(L=(performance.now()-R)/1e3,r&&(r.textContent=d(L)))}function B(c){i=c,n.classList.toggle("playing",i),n.setAttribute("aria-label",i?"Pause":"Play"),i?(R=performance.now()-L*1e3,a.start({kind:"theme",id:x,volume:.5})):a.stop()}function $(){B(!i)}function E(c){x=c.target.value,i&&a.start({kind:"theme",id:x,volume:.5})}const y=setInterval(W,250);return window.addEventListener("resize",A),n.addEventListener("click",$),m?.addEventListener("change",E),A(),r&&(r.textContent=d(0)),u=requestAnimationFrame(w),{dispose(){clearInterval(y),cancelAnimationFrame(u),window.removeEventListener("resize",A),n.removeEventListener("click",$),m?.removeEventListener("change",E),a.dispose()}}}function vt(t,e){t.innerHTML="";for(const n of O){const r=document.createElement("option");r.value=n.id,r.textContent=`${e==="zh"?n.zh:n.en} · ${e==="zh"?n.note.zh:n.note.en}`,t.append(r)}t.value=O[1].id}const Z="aispin-theme",J="aispin-language",N=document.documentElement;function xt(){const t=localStorage.getItem(Z);return t==="light"||t==="dark"?t:window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}function wt(){return localStorage.getItem(J)==="en"?"en":"zh"}let I=wt();const P={code:'<path d="M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16"/>',spark:'<path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z"/><circle cx="19" cy="5" r="1"/>',wave:'<path d="M3 12h3l2-5 3 10 2-7 2 4h6"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 7l9 6 9-6"/>',github:'<path d="M12 3a9 9 0 0 0-2.8 17.5c.5.1.7-.2.7-.5v-2c-2.5.5-3-1.2-3-1.2-.4-1-1-1.3-1-1.3-.8-.6.1-.6.1-.6.9.1 1.4.9 1.4.9.8 1.4 2.1 1 2.6.8.1-.6.3-1 .6-1.3-2-.2-4.1-1-4.1-4.5 0-1 .3-1.8.9-2.4-.1-.2-.4-1.1 0-2.3 0 0 .8-.3 2.5.9.7-.2 1.5-.3 2.3-.3s1.6.1 2.3.3c1.7-1.2 2.5-.9 2.5-.9.4 1.2.1 2.1 0 2.3.6.6.9 1.4.9 2.4 0 3.5-2.1 4.3-4.1 4.5.3.3.6.8.6 1.6v2.4c0 .3.2.6.7.5A9 9 0 0 0 12 3z"/>',music:'<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',down:'<path d="M6 9l6 6 6-6"/>',house:'<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'},U=(t,e=20,n="")=>`<svg width="${e}" height="${e}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${n}>${t}</svg>`;function yt(t){return t==="orbit"?`<svg viewBox="0 0 600 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="orbit">
      <defs><linearGradient id="wv-orbit" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--brand)" stop-opacity=".14"/>
        <stop offset="1" stop-color="var(--accent)" stop-opacity=".08"/>
      </linearGradient></defs>
      <rect width="600" height="340" fill="url(#wv-orbit)"/>
      <circle cx="300" cy="170" r="92" fill="none" stroke="var(--brand)" stroke-width="2" opacity=".5"/>
      <circle cx="300" cy="170" r="70" fill="none" stroke="var(--brand)" stroke-width="1" opacity=".3"/>
      <circle cx="300" cy="170" r="48" fill="none" stroke="var(--accent)" stroke-width="1" opacity=".28"/>
      <path d="M300 108 A62 62 0 0 1 357 190" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="357" cy="190" r="5" fill="var(--accent)"/>
      <rect x="276" y="158" width="48" height="26" rx="7" fill="var(--n-0)" opacity=".9"/>
      <rect x="287" y="167" width="26" height="3" rx="1.5" fill="var(--n-400)"/>
      <rect x="287" y="174" width="16" height="3" rx="1.5" fill="var(--n-300)"/>
    </svg>`:t==="chart"?`<svg viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="chart">
      <rect width="300" height="220" fill="var(--brand-bg)"/>
      <g stroke="var(--brand)" stroke-width="1.6" fill="none" stroke-linecap="round">
        <path d="M40 170 L80 130 L120 150 L160 90 L200 110 L240 60 L260 70"/>
      </g>
      <g fill="var(--brand)">
        <circle cx="80" cy="130" r="4"/><circle cx="160" cy="90" r="4"/><circle cx="240" cy="60" r="4"/>
      </g>
      <rect x="40" y="40" width="60" height="8" rx="4" fill="var(--brand)" opacity=".5"/>
      <rect x="40" y="54" width="40" height="8" rx="4" fill="var(--brand)" opacity=".25"/>
    </svg>`:`<svg viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="rings">
    <rect width="300" height="220" fill="var(--accent-bg)"/>
    <circle cx="150" cy="110" r="58" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <circle cx="150" cy="110" r="36" fill="none" stroke="var(--brand)" stroke-width="2.5"/>
    <circle cx="150" cy="110" r="14" fill="var(--brand)"/>
    <path d="M150 52 L150 40" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M150 180 L150 192" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M92 110 L80 110" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M220 110 L208 110" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`}const o=t=>document.getElementById(t);function bt(t){o("nav-brand-text").textContent=t.brand,o("nav-links").innerHTML=t.nav.map(e=>`<a href="#${e.id}">${e.label}</a>`).join(""),o("lang-toggle").textContent=t.lang==="zh"?"EN":"中",o("lang-toggle").setAttribute("aria-label",t.lang==="zh"?"Switch to English":"切换到中文")}function kt(t){const[e,...n]=[...t.brand];o("hero-name").innerHTML=`${e}<em>${n.join("")}</em>`,o("hero-badge-text").textContent=t.badge,o("hero-roles").innerHTML=t.roles.items.map(r=>`<span>${r.title}</span>`).join('<span class="sep">·</span>'),o("hero-tagline").textContent=t.tagline,o("hero-actions").innerHTML=`
    <a class="btn btn-pri" href="#works">${t.lang==="zh"?"查看作品":"See the work"}${U(P.arrow,15)}</a>
    <a class="btn btn-sec" href="/">${U(P.house,14)}${t.lang==="zh"?"走进 3D 房子":"Walk the 3D house"}</a>`}function Mt(t){o("roles-eyebrow").textContent=t.roles.eyebrow,o("roles-title").textContent=t.roles.title,o("roles-desc").textContent=t.roles.desc,o("role-grid").innerHTML=t.roles.items.map(e=>`
      <article class="role-card" data-tilt>
        <div class="role-icon">${U(P[e.icon]||P.code,22)}</div>
        <h3>${e.title}</h3>
        <p>${e.desc}</p>
        <div class="role-tags">${e.tags.map(n=>`<span class="role-tag">${n}</span>`).join("")}</div>
      </article>`).join("")}function Lt(t){o("works-eyebrow").textContent=t.works.eyebrow,o("works-title").textContent=t.works.title,o("works-desc").textContent=t.works.desc,o("works-grid").innerHTML=t.works.items.map(e=>`
      <a class="work work--${e.span}" href="${e.url}" target="_blank" rel="noopener noreferrer">
        <div class="work-visual">${yt(e.visual)}</div>
        <div class="work-meta">
          <span class="work-type">${e.kind}</span>
          <h3>${e.title}</h3>
          <p>${e.description}${t.lang==="zh"?"。":"."}</p>
          <div class="work-foot">
            ${e.opensource?`<span class="work-badge">${t.lang==="zh"?"开源":"Open source"}</span>`:""}
            <span>${e.role}</span>
            <span>${e.period}</span>
          </div>
        </div>
      </a>`).join("")}function $t(t){o("music-eyebrow").textContent=t.music.eyebrow,o("music-title").textContent=t.music.title,o("music-desc").textContent=t.music.desc,o("player-title").textContent=t.music.proceduralTitle,o("player-meta").textContent=t.music.proceduralMeta,o("track-list-head").textContent=t.music.listTitle,o("track-list").innerHTML=t.tracks.map((e,n)=>`
      <a class="track" href="${e.url}" target="_blank" rel="noopener noreferrer">
        <span class="track-idx">${String(n+1).padStart(2,"0")}</span>
        <span class="track-name">${e.title}</span>
        <span class="track-album">${e.album} · ${e.platform}</span>
        <span class="track-date">${e.date}</span>
      </a>`).join(""),vt(o("theme-select"),t.lang)}function Et(t){o("contact-eyebrow").textContent=t.contact.eyebrow,o("contact-title").textContent=t.contact.title,o("contact-desc").textContent=t.contact.desc,o("foot-links").innerHTML=t.links.map(e=>`<a class="foot-link" href="${e.href}" target="_blank" rel="noopener noreferrer">${U(P[e.icon],14)}${e.label}</a>`).join(""),o("stats").innerHTML=t.stats.map(e=>`<div class="stat"><b>${e.value}</b><span>${e.label}</span></div>`).join(""),o("foot-copy").textContent=`© ${new Date().getFullYear()} ${t.brand} · ${t.footerNote}`}function Ct(t){t.querySelectorAll("[data-tilt]").forEach(e=>{e.addEventListener("pointermove",n=>{const r=e.getBoundingClientRect(),m=n.clientX-r.left,a=n.clientY-r.top;e.style.setProperty("--rx",`${m/r.width*100}%`),e.style.setProperty("--ry",`${a/r.height*100}%`);const h=(a/r.height-.5)*-8,p=(m/r.width-.5)*8;e.style.transform=`perspective(900px) rotateX(${h}deg) rotateY(${p}deg) translateZ(0)`}),e.addEventListener("pointerleave",()=>{e.style.transform=""})})}function _t(){const t=o("hero-name");if(!t)return;let e=0;window.addEventListener("pointermove",n=>{e||(e=requestAnimationFrame(()=>{e=0,t.style.setProperty("--mx",((n.clientX/window.innerWidth-.5)*2).toFixed(3)),t.style.setProperty("--my",((n.clientY/window.innerHeight-.5)*2).toFixed(3))}))},{passive:!0})}function zt(){if(!("IntersectionObserver"in window))return;const t=document.querySelectorAll(".role-card, .work, .player, .track, .section-head, .stats"),e=new IntersectionObserver(n=>{n.forEach(r=>{r.isIntersecting&&(r.target.style.opacity="1",r.target.style.transform="translateY(0)",e.unobserve(r.target))})},{threshold:.12,rootMargin:"0px 0px -40px 0px"});t.forEach(n=>{n.style.opacity="0",n.style.transform="translateY(24px)",n.style.transition="opacity .7s cubic-bezier(.2,.7,.3,1), transform .7s cubic-bezier(.2,.7,.3,1)",e.observe(n)})}function At(t){N.dataset.theme=t,localStorage.setItem(Z,t),window.dispatchEvent(new CustomEvent("themechange"))}function K(){const t=ct(I);bt(t),kt(t),Mt(t),Lt(t),$t(t),Et(t),document.title=`${t.brand} — ${t.roles.items.map(e=>e.title).join(" · ")}`,N.lang=I==="zh"?"zh-CN":"en",Ct(document),zt()}function St(){N.dataset.theme=xt(),ut(o("gl")),gt({canvas:o("wave"),wrap:o("wave-wrap"),button:o("play-btn"),elapsedEl:o("elapsed"),themeSelect:o("theme-select")}),o("theme-toggle").addEventListener("click",()=>{At(N.dataset.theme==="dark"?"light":"dark")}),o("lang-toggle").addEventListener("click",()=>{I=I==="zh"?"en":"zh",localStorage.setItem(J,I),K()}),K(),_t()}St();
