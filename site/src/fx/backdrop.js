// Fixed full-page background behind every section below the hero:
// a slow nebula gradient mesh with sparse twinkling stars (WebGL, half resolution, 30fps cap) and
// one large light shaft whose position, tilt and strength belong to the current section (so each
// section has its own atmosphere and the shaft swings across as the page moves between them),
// plus a fine film-grain overlay (CSS, generated tile). The stars drift with scroll (parallax)
// and stretch slightly with scroll velocity.
//
//   import { initBackdrop, setTint } from './fx/backdrop.js';
//   initBackdrop();                 // once, from main.js
//   setTint([r,g,b], [r,g,b]);      // 0..1 colours; transitions.js drives this per section
//   setAtmos(curId, nextId, t);     // shaft + nebula gain, blended between two sections (t 0..1)
//
// Reduced motion, no WebGL or a lost context: a static CSS gradient (tinted per section through
// .backdrop[data-temp], see backdrop.css). The canvas is created lazily, near the end of the hero,
// and rendering is skipped while the hero covers the viewport or the tab is hidden.

import './backdrop.css';
import { isReduced, isTouch } from './scroll.js';

const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;
uniform float uVel;
uniform vec3 uA;
uniform vec3 uB;
uniform vec4 uShaft; // x (0..1 of width), tilt (rad), strength, nebula gain

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

float stars(vec2 px, float cell, float density, float seed, float stretch){
  vec2 id = floor(px / cell);
  vec2 gv = fract(px / cell) - 0.5;
  float h = hash(id + seed);
  if (h < density) return 0.0;
  vec2 o = vec2(hash(id + seed + 3.1), hash(id + seed + 7.7)) - 0.5;
  vec2 d = gv - o * 0.7;
  d.y /= stretch;
  float r = length(d * cell);
  float b = (h - density) / (1.0 - density);
  float tw = 0.55 + 0.45 * sin(uTime * (0.6 + h * 2.4) + h * 60.0);
  return smoothstep(1.35, 0.0, r) * b * tw;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  float aspect = uRes.x / uRes.y;
  vec2 uv = frag / uRes.y;                 // 0..1 vertically, 0..aspect horizontally
  float t = uTime * 0.016;
  float drift = uScroll * 0.00006;

  // nebula: domain-warped fbm, two tinted layers
  vec2 q = uv * 1.15 + vec2(0.0, drift);
  vec2 w = vec2(fbm(q + vec2(t, -t * 0.6)), fbm(q + vec2(5.2 - t * 0.7, 1.3 + t)));
  float n1 = fbm(q * 1.1 + w * 1.7 + vec2(-t * 0.4, t * 0.3));
  float n2 = fbm(q * 0.75 - w * 1.2 + vec2(3.1, -1.7 + t * 0.2));
  float m1 = smoothstep(0.34, 0.8, n1);
  float m2 = smoothstep(0.38, 0.82, n2);
  m1 = m1 * sqrt(m1) * (0.55 + 0.45 * n2);
  m2 = m2 * sqrt(m2);

  vec3 col = vec3(0.027, 0.024, 0.055);
  float gain = uShaft.w;
  // large soft light pools in the corners keep the middle calm for text
  float poolA = smoothstep(1.1, 0.0, length(uv - vec2(aspect * 0.08, 0.95)));
  float poolB = smoothstep(1.2, 0.0, length(uv - vec2(aspect * 0.95, 0.05)));
  // the nebula lives on the sides; a calmer band down the middle keeps the copy legible
  float side = 0.3 + 0.7 * smoothstep(0.12, 0.5, abs(uv.x / aspect - 0.5));
  col += uA * (0.2 * poolA);
  col += uB * (0.18 * poolB);
  col += uA * m1 * 0.92 * side * gain;
  col += uB * m2 * 0.62 * side * gain;
  // a brighter, tighter core inside the densest cloud
  col += mix(uA, vec3(0.9, 0.86, 1.0), 0.35) * pow(m1, 3.0) * 0.3 * side * gain;

  // light shaft: a soft beam falling from the top edge, widening as it goes, with slow dust in it
  vec2 o = vec2(uShaft.x * aspect, 1.08);
  vec2 dir = vec2(sin(uShaft.y), -cos(uShaft.y));
  vec2 rel = uv - o;
  float along = dot(rel, dir);
  float across = abs(rel.x * dir.y - rel.y * dir.x);
  float bw = 0.07 + 0.2 * max(along, 0.0);
  float beam = exp(-(across * across) / (bw * bw)) * smoothstep(-0.05, 0.25, along) * smoothstep(1.45, 0.3, along);
  float dust = 0.55 + 0.45 * fbm(vec2(across * 6.0, along * 2.2 - uTime * 0.05) + w);
  float core = exp(-(across * across) / (bw * bw * 0.12));
  col += mix(uB, vec3(0.86, 0.84, 1.0), 0.35) * beam * dust * 0.5 * uShaft.z;
  col += vec3(0.8, 0.82, 1.0) * core * beam * dust * 0.12 * uShaft.z;

  // stars in screen pixels, two depths with different parallax
  float stretch = 1.0 + min(abs(uVel), 30.0) * 0.06;
  vec2 p1 = frag + vec2(0.0, uScroll * 0.035);
  vec2 p2 = frag + vec2(11.0, uScroll * 0.085);
  float s = stars(p1, 23.0, 0.955, 0.0, stretch * 0.7 + 0.3) * 0.55
          + stars(p2, 41.0, 0.972, 17.0, stretch) * 0.95;
  col += vec3(0.86, 0.84, 1.0) * s;

  // vignette
  vec2 c = frag / uRes - 0.5;
  col *= 1.0 - dot(c, c) * 0.55;
  gl_FragColor = vec4(col, 1.0);
}
`;

const state = {
  a: [0.36, 0.25, 0.85],
  b: [0.17, 0.2, 0.62],
  s: [0.82, 0.35, 0.5, 1],
};

// per-section atmosphere: shaft x (0..1 of the width), tilt (rad), shaft strength, nebula gain
const ATMOS = {
  hero: [0.82, 0.32, 0.45, 1],
  problem: [0.84, 0.36, 0.6, 1.05],
  features: [0.12, -0.34, 0.65, 1.1],
  demo: [0.9, 0.46, 0.8, 1.2],
  agents: [0.16, -0.5, 0.7, 1.15],
  steps: [0.8, 0.26, 0.6, 1],
  privacy: [0.1, -0.2, 0.85, 1.25],
  faq: [0.86, 0.3, 0.35, 0.8],
  cta: [0.5, 0, 0.9, 1.3],
};
const ATMOS_FALLBACK = ATMOS.features;

export function setTint(a, b) {
  if (a) state.a = a;
  if (b) state.b = b;
}

export function setAtmos(curId, nextId, t = 0) {
  const a = ATMOS[curId] || ATMOS_FALLBACK;
  const b = ATMOS[nextId] || a;
  for (let i = 0; i < 4; i++) state.s[i] = a[i] + (b[i] - a[i]) * t;
}

let started = false;

export function initBackdrop() {
  if (started || typeof window === 'undefined') return;
  started = true;

  const root = document.createElement('div');
  root.className = 'backdrop';
  root.setAttribute('aria-hidden', 'true');
  const grain = document.createElement('div');
  grain.className = 'backdrop__grain';
  root.appendChild(grain);
  document.body.prepend(root);
  document.documentElement.classList.add('has-backdrop');

  makeGrain(grain);

  if (isReduced()) return; // static gradient only

  const hero = document.getElementById('hero');
  const heroBottom = () => (hero ? hero.getBoundingClientRect().bottom : 0);

  // lazy: start the GL layer when the hero's end is within ~1.5 screens
  const maybeStart = () => {
    if (heroBottom() < window.innerHeight * 2.5) {
      window.removeEventListener('scroll', maybeStart);
      startGL(root, heroBottom);
    }
  };
  window.addEventListener('scroll', maybeStart, { passive: true });
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => maybeStart(), { timeout: 2500 });
  // start anyway after the hero has settled, so the first scroll never lands on an empty layer
  setTimeout(() => { window.removeEventListener('scroll', maybeStart); startGL(root, heroBottom); }, 3500);
}

function makeGrain(el) {
  try {
    const c = document.createElement('canvas');
    const S = 140;
    c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    el.style.backgroundImage = `url(${c.toDataURL('image/png')})`;
  } catch {
    el.remove();
  }
}

let glStarted = false;

function startGL(root, heroBottom) {
  if (glStarted) return;
  glStarted = true;

  const canvas = document.createElement('canvas');
  canvas.className = 'backdrop__gl';
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) return;

  const prog = link(gl, VERT, FRAG);
  if (!prog) return;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = {};
  for (const n of ['uRes', 'uTime', 'uScroll', 'uVel', 'uA', 'uB', 'uShaft']) u[n] = gl.getUniformLocation(prog, n);

  // half resolution in CSS pixels (the nebula is soft; stars stay crisp enough), lower on touch
  const scale = isTouch() ? 0.4 : 0.5;
  let w = 0;
  let h = 0;
  const resize = () => {
    const vw = window.innerWidth;
    const vh = Math.max(window.innerHeight, document.documentElement.clientHeight);
    w = Math.max(2, Math.round(vw * scale));
    h = Math.max(2, Math.round(vh * scale));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  };
  resize();
  let rT = 0;
  window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(resize, 150); });

  root.prepend(canvas);

  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    root.classList.remove('is-gl');
    canvas.remove();
  });

  const cur = { a: state.a.slice(), b: state.b.slice(), s: state.s.slice() };
  let last = 0;
  let lastY = window.scrollY;
  let vel = 0;
  const t0 = performance.now();
  const FRAME = 1000 / 30;
  let raf = 0;
  let shown = false;

  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (lost || document.hidden) return;
    if (now - last < FRAME - 2) return;
    const dt = Math.min(100, now - last);
    last = now;

    const y = window.scrollY;
    // px per 60Hz frame, clamped so jumps (anchors, restored positions) don't smear the stars
    let raw = (y - lastY) / Math.max(1, dt / 16.7);
    if (raw > 60) raw = 60; else if (raw < -60) raw = -60;
    lastY = y;
    vel += (raw - vel) * 0.25;
    if (Math.abs(vel) < 0.05) vel = 0;

    // skip work while the (opaque) hero still fills the screen
    if (heroBottom() >= window.innerHeight) return;

    for (let i = 0; i < 3; i++) {
      cur.a[i] += (state.a[i] - cur.a[i]) * 0.08;
      cur.b[i] += (state.b[i] - cur.b[i]) * 0.08;
    }
    for (let i = 0; i < 4; i++) cur.s[i] += (state.s[i] - cur.s[i]) * 0.06;
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uTime, (now - t0) / 1000);
    gl.uniform1f(u.uScroll, y * scale);
    gl.uniform1f(u.uVel, vel * scale);
    gl.uniform3fv(u.uA, cur.a);
    gl.uniform3fv(u.uB, cur.b);
    gl.uniform4fv(u.uShaft, cur.s);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!shown) {
      shown = true;
      root.classList.add('is-gl');
    }
  };
  raf = requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else raf = requestAnimationFrame(loop);
  });
}

function link(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[bastion-site] backdrop shader', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const v = sh(gl.VERTEX_SHADER, vs);
  const f = sh(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  return p;
}
