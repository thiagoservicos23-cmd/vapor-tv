/* ============================================================
   Vapor TV — fundo animado (campo de cor em fluxo, WebGL2)
   Adaptado do "Glass Headline Hero": ruido com domain-warp na paleta,
   renderizado em baixa resolucao e esticado. Pausa com o player aberto
   ou com a aba oculta. Sem WebGL2 cai para um gradiente CSS.
   ============================================================ */
(function () {
  'use strict';
  const canvas = document.getElementById('bg-field');
  if (!canvas) return;
  const PAL = ['#0D0A14', '#FF5A1F', '#FF9EC1', '#2F4CFF', '#FFE6B8'];
  const rgb = h => { const v = parseInt(h.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
  const pal = PAL.map(rgb);

  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) { canvas.classList.add('no-gl'); return; }

  const VERT = `#version 300 es
in vec2 a_position; out vec2 vUv;
void main(){ vUv = a_position*0.5+0.5; gl_Position = vec4(a_position,0.0,1.0); }`;
  const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform float u_time, u_aspect;
uniform vec3 u_c0,u_c1,u_c2,u_c3,u_c4;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; mat2 turn=mat2(0.8,0.6,-0.6,0.8);
  for(int i=0;i<4;i++){ v+=a*noise(p); p=turn*p*2.02; a*=0.5; } return v; }
void main(){
  vec2 p = vec2(vUv.x*u_aspect, vUv.y)*1.2;
  float t = u_time*0.06;
  vec2 q = vec2(fbm(p+vec2(0.0,t)), fbm(p+vec2(5.2,1.3)-t));
  vec2 r = vec2(fbm(p+3.5*q+vec2(1.7,9.2)+t*1.4), fbm(p+3.5*q+vec2(8.3,2.8)-t*1.1));
  float f = fbm(p+3.0*r);
  vec3 col = u_c0;
  col = mix(col, u_c3, smoothstep(0.25,0.72,q.x)*0.9);
  col = mix(col, u_c1, smoothstep(0.34,0.74,f));
  col = mix(col, u_c2, smoothstep(0.42,0.8,r.y)*0.8);
  col = mix(col, u_c4, smoothstep(0.55,0.9,f*r.x*1.8)*0.7);
  float bands = 0.5+0.5*sin((f*7.0+r.x*3.0)*3.14159);
  col *= mix(0.86,1.1,smoothstep(0.2,0.8,bands));
  o = vec4(col*0.9, 1.0);
}`;

  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let U;
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'a_position');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    U = n => gl.getUniformLocation(prog, 'u_' + n);
    pal.forEach((c, i) => gl.uniform3f(U('c' + i), c[0], c[1], c[2]));
  } catch (e) { canvas.classList.add('no-gl'); return; }

  // render pequeno e esticado: o campo e suave, parece igual e custa uma fracao
  let scale = 0.3, slow = 0, judged = 0;
  function size() {
    const w = Math.max(2, Math.round(canvas.clientWidth * scale));
    const h = Math.max(2, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }
  size();
  window.addEventListener('resize', size);

  const player = document.getElementById('player');
  let time = 0, last = 0, acc = 0;
  const STEP = 1 / 24; // 24 fps: suficiente para um fundo lento e poupa CPU/GPU em TV Box
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.25); last = now;
    if (document.hidden || (player && !player.hidden)) return; // player aberto cobre tudo
    acc += dt;
    if (acc < STEP) return;
    const spent = acc; acc = 0;
    time += spent;
    // se o aparelho for fraco, reduz a resolucao
    if (judged < 60) { judged++; if (judged > 5 && spent > 0.09) slow++; if (slow >= 6 && scale > 0.15) { scale = 0.18; size(); slow = -999; } }
    gl.uniform1f(U('time'), time);
    gl.uniform1f(U('aspect'), canvas.width / canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  requestAnimationFrame(t => { last = t; frame(t); });
})();
