// App-wide ambient background: one fixed WebGL canvas behind every view.
// A slow domain-warped flow field ("liquid light") in the Nebula palette, tinted per view.
//
// Look: deep saturated light masses with pastel hot cores and thin silk ribbons, blended in linear
// light. The light is budgeted by zone instead of dimmed globally: full strength in the side gutters
// and below the content (no text there), held low inside the content column and under the title row,
// so text on the bare ground and on the glass panels keeps its contrast.
//
// Cost: half CSS resolution, 15 fps (30 only while a mood cross-fades, 5 when the window is blurred),
// setTimeout-paced (no idle rAF polling), stopped while hidden or while the Home hero covers the
// window, one static frame under prefers-reduced-motion, CSS gradient fallback without WebGL.
//
// API: const amb = mountAmbient(store); amb.setView(id). Reads store keys scan, scanProgress, speedProgress.

const SCALE = 0.5;
const FPS = 15;
const FPS_FADE = 30;
const FPS_BLUR = 5;
const FADE_MS = 1200;
const STATIC_T = 52; // reduced-motion frame: a composed moment with no bloom streak

// sRGB hex -> linear light (the shader blends in linear space and encodes back to sRGB).
const lin = (h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));
const C = {
  // Deep, saturated anchors for the light masses.
  indigo: lin('#2A1E9E'),
  violetDeep: lin('#4A2FD8'),
  cobalt: lin('#1B5FD1'),
  tealDeep: lin('#0B8F86'),
  plum: lin('#241466'),
  // Pastels for hot cores and ribbon highlights only.
  violet: lin('#7C6CFF'),
  lavender: lin('#B7A9FF'),
  sky: lin('#8FD3FF'),
  teal: lin('#3FE3C9'),
};

// a/b: deep light masses, c: ribbon highlight, hot: core highlight. focus: where the light gathers
// (uv, y up). gain: overall strength. iri: iridescent mix (agents).
const MOODS = {
  home: { a: C.indigo, b: C.cobalt, c: C.lavender, hot: C.violet, focus: [0.5, 0.0], gain: 0.9, iri: 0 },
  shield: { a: C.indigo, b: C.violetDeep, c: C.lavender, hot: C.lavender, focus: [0.86, 0.12], gain: 1.0, iri: 0 },
  speed: { a: C.cobalt, b: C.tealDeep, c: C.sky, hot: C.sky, focus: [0.88, 0.22], gain: 1.0, iri: 0 },
  devices: { a: C.indigo, b: C.violetDeep, c: C.violet, hot: C.lavender, focus: [0.14, 0.1], gain: 1.0, iri: 0 },
  agents: { a: C.violetDeep, b: C.indigo, c: C.lavender, hot: C.lavender, focus: [0.8, 0.08], gain: 1.05, iri: 1 },
  settings: { a: C.plum, b: C.indigo, c: C.violet, hot: C.violet, focus: [0.92, 0.04], gain: 0.6, iri: 0 },
};

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

// All colours below are linear light.
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uA, uB, uC, uHot;
uniform vec2 uFocus;
uniform vec2 uCol;   // content column left/right edge, canvas px
uniform float uGain, uIri, uWarm, uWave, uCut, uBloom;

const vec3 GROUND = vec3(.0021, .0018, .0047);   // #07060E
const vec3 MAGENTA_D = vec3(.48, .032, .32);      // #B8329A
const vec3 VIOLET_D = vec3(.07, .028, .69);       // #4A2FD8
const vec3 TEAL_D = vec3(.0036, .27, .24);        // #0B8F86
const vec3 MAGENTA = vec3(1., .114, .65);         // #FF5FD2
const vec3 TEAL = vec3(.05, .77, .58);            // #3FE3C9
const vec3 LAVENDER = vec3(.47, .40, 1.);         // #B7A9FF
const vec3 SKY = vec3(.27, .65, 1.);              // #8FD3FF
const vec3 ROSE = vec3(.74, .082, .15);           // #E0506E
const vec3 CORAL = vec3(1., .27, .19);            // #FF8E7A (hot core of the warm pocket only)

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
const mat2 M = mat2(1.6, 1.2, -1.2, 1.6);
float fbm(vec2 p) {
  float a = .5, s = 0.;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = M * p; a *= .5; }
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  float t = uTime;

  // Domain-warped flow field (very slow).
  vec2 p0 = p * .9;
  vec2 q = vec2(fbm(p0 + vec2(0., t * .018)), fbm(p0 + vec2(5.2, 1.3) - t * .015));
  vec2 r = vec2(fbm(p0 + 2.3 * q + vec2(1.7, 9.2) + t * .026), fbm(p0 + 2.3 * q + vec2(8.3, 2.8) - t * .022));
  float f = fbm(p0 + 2.1 * r);

  // Masses: troughs fall back to the ground, cores build up (contrast gives the depth).
  float m = smoothstep(.36, .84, f);
  float body = m * m;
  float core = body * m * m;
  // Silk: thin highlights along two level sets of the field, like folds of light.
  float silk = smoothstep(.3, .8, length(r));
  float rib = (exp(-pow((f - .6) * 11., 2.)) + .6 * exp(-pow((f - .72) * 18., 2.))) * silk;

  // Colour: two deep masses blended by the warp; agents swap them for an iridescent set.
  vec3 massC = mix(uA, uB, smoothstep(.25, .75, q.y));
  float h = abs(fract(r.x * 1.1 + q.y * .8 + t * .006) - .5) * 2.;
  vec3 iriD = mix(mix(MAGENTA_D, VIOLET_D, smoothstep(0., .5, h)), TEAL_D, smoothstep(.5, 1., h));
  vec3 iriP = mix(mix(MAGENTA, LAVENDER, smoothstep(0., .5, h)), TEAL, smoothstep(.5, 1., h));
  massC = mix(massC, iriD, uIri);
  vec3 hotC = mix(uHot, iriP, uIri * .7);
  vec3 ribC = mix(mix(uC, uHot, smoothstep(.3, .7, q.x)), iriP, uIri * .6);

  // Composition: light gathers around a per-view focus; the far side stays darker.
  vec2 fc = uFocus + .06 * vec2(sin(t * .05), cos(t * .041));
  float comp = smoothstep(1.3, .0, length((uv - fc) * vec2(1., 1.25)));
  comp = .28 + .72 * comp;

  vec3 light = massC * body * 1.25 + hotC * core * .55 + ribC * rib * .32 * (.35 + .65 * m);
  light *= comp * uGain;

  // Rare accents (magenta / teal) in small pockets.
  float acc = smoothstep(.68, .9, fbm(p * .9 + r * 1.4 + vec2(11., 3.) + t * .008));
  light += mix(MAGENTA, TEAL, smoothstep(.3, .7, q.x)) * acc * .035 * comp * uGain;

  // Activity wave: a slow luminous band sweeping diagonally while a scan or speed test runs.
  float wpos = fract(t * .06) * 2.2 - .6;
  float w = exp(-pow((dot(uv, vec2(.94, .34)) - wpos) * 3.2, 2.)) * uWave;
  light += (massC * (.15 + .9 * body) + ribC * rib * .25) * w * uGain;

  // Anamorphic bloom: a wide, soft horizontal band drifting across now and then.
  float cyc = t / 36.;
  float k = fract(cyc), idx = floor(cyc);
  float on = smoothstep(.0, .2, k) * smoothstep(.7, .4, k) * step(.35, hash(vec2(idx, 7.3))) * uBloom;
  float dy = uv.y - (.15 + .45 * hash(vec2(idx, 3.1)));
  float x0 = mix(-.2, 1.2, k / .7);
  float band = exp(-pow(dy * 30., 2.)) * exp(-pow((uv.x - x0) * 1.1, 2.));
  light += mix(LAVENDER, SKY, .45) * band * on * .045 * uGain;

  // Warning warmth (shield with open risks): a breathing rose-coral pocket in the right gutter.
  float wn = smoothstep(.42, .0, length((uv - vec2(.99, .4)) * vec2(1.3, .85)));
  wn *= wn * (.8 + .2 * sin(t * 1.05)) * uWarm * uGain;
  light = mix(light, light * .6, wn);                        // the warm pocket replaces, not muddies
  light += ROSE * wn * (.28 + .55 * body + .25 * rib) + CORAL * wn * wn * (.06 + .4 * core);

  // Vignette (light only, the ground stays put).
  light *= smoothstep(1.2, .3, length((uv - vec2(.5, .42)) * vec2(1.05, 1.2))) * .55 + .45;

  // Light budget by zone. x / y in canvas px; y measured from the top.
  float x = gl_FragCoord.x, fromTop = uRes.y - gl_FragCoord.y;
  float inCol = smoothstep(uCol.x - 24., uCol.x + 14., x) * smoothstep(uCol.y + 24., uCol.y - 14., x);
  float head = 1. - smoothstep(.1, .32, fromTop / uRes.y);          // title row + tab bar
  float bar = 1. - smoothstep(.06, .1, fromTop / uRes.y);           // tab bar strip, all widths
  light *= mix(1., .5, inCol) * mix(1., .45, head * inCol) * mix(1., .4, bar);

  // Soft luminance ceilings: content column <= ~.075, title row <= ~.04, gutters <= ~.24.
  vec3 col = GROUND + light;
  float lum = dot(col, vec3(.2126, .7152, .0722));
  float cap = mix(mix(.24, .075, inCol), .04, head * inCol);
  float knee = cap * .6;
  if (lum > knee) col *= (knee + (cap - knee) * (1. - exp(-(lum - knee) / (cap - knee)))) / lum;

  // Home: fade in only below the 3D hero (uCut = hero bottom in canvas px from the top).
  col = mix(GROUND, col, smoothstep(uCut, uCut + .3 * uRes.y, fromTop));

  // Encode to sRGB; a whisper of dither against banding (the fine grain is the CSS layer).
  col = pow(max(col, 0.), vec3(1. / 2.2));
  col += (hash(gl_FragCoord.xy + fract(t * 3.7) * 91.) - .5) * (1. / 255.);
  gl_FragColor = vec4(col, 1.);
}`;

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function snapshotMood(m) {
  return { a: [...m.a], b: [...m.b], c: [...m.c], hot: [...m.hot], focus: [...m.focus], gain: m.gain, iri: m.iri, warm: m.warm || 0 };
}
function mixMood(from, to, k) {
  const v3 = (x, y) => [0, 1, 2].map((i) => lerp(x[i], y[i], k));
  return {
    a: v3(from.a, to.a), b: v3(from.b, to.b), c: v3(from.c, to.c), hot: v3(from.hot, to.hot),
    focus: [lerp(from.focus[0], to.focus[0], k), lerp(from.focus[1], to.focus[1], k)],
    gain: lerp(from.gain, to.gain, k), iri: lerp(from.iri, to.iri, k), warm: lerp(from.warm, to.warm, k),
  };
}

export function mountAmbient(store) {
  const host = document.createElement('div');
  host.className = 'ambient';
  host.setAttribute('aria-hidden', 'true');
  host.dataset.mood = 'home';
  const canvas = document.createElement('canvas');
  canvas.className = 'ambient__gl';
  const grain = document.createElement('div');
  grain.className = 'ambient__grain';
  host.append(canvas, grain);
  document.body.prepend(host);

  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let view = 'home';
  let mood = snapshotMood({ ...MOODS.home, warm: 0 });
  let fromMood = mood;
  let toMood = mood;
  let fadeStart = 0;
  let wave = 0;
  let waveTarget = 0;
  let risky = false;

  let gl = null;
  let prog = null;
  let U = {};
  let raf = 0;
  let timer = 0;
  let prevDraw = 0;
  let focused = document.hasFocus ? document.hasFocus() : true;
  // Layout, measured on navigation / resize / Home scroll only (never per frame).
  let cut = -1e4;
  let colL = 0;
  let colR = 0;
  const t0 = performance.now() - 40000; // start mid-flow so the first frame is already composed

  function initGL() {
    const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return false;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    U = {};
    for (const n of ['uRes', 'uTime', 'uA', 'uB', 'uC', 'uHot', 'uFocus', 'uCol', 'uGain', 'uIri', 'uWarm', 'uWave', 'uCut', 'uBloom']) U[n] = gl.getUniformLocation(prog, n);
    return true;
  }

  function resize() {
    const w = Math.max(2, Math.round(window.innerWidth * SCALE));
    const h = Math.max(2, Math.round(window.innerHeight * SCALE));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (gl) gl.viewport(0, 0, w, h);
    }
  }

  // Content column (where text lives) and, on Home, the hero bottom. Returns true when it changed.
  function measure() {
    const W = window.innerWidth;
    let l = Math.max(0, (W - 1320) / 2) + 24;
    let r = W - l;
    const pad = document.querySelector('.view:not(.is-out) .view-pad');
    if (pad) {
      const b = pad.getBoundingClientRect();
      const cs = getComputedStyle(pad);
      if (b.width > 0) {
        l = b.left + parseFloat(cs.paddingLeft || '0');
        r = b.right - parseFloat(cs.paddingRight || '0');
      }
    }
    let c = -1e4;
    if (view === 'home') {
      const hero = document.querySelector('.view.view--home:not(.is-out) .nv-hero');
      c = hero ? hero.getBoundingClientRect().bottom * SCALE : 1e4;
    }
    const changed = Math.abs(c - cut) > 0.5 || Math.abs(l * SCALE - colL) > 0.5 || Math.abs(r * SCALE - colR) > 0.5;
    cut = c;
    colL = l * SCALE;
    colR = r * SCALE;
    return changed;
  }

  const fading = (now) => now - fadeStart < FADE_MS + 50;
  // Home with the hero covering the whole window: nothing of the field is visible.
  const covered = (now) => view === 'home' && !fading(now) && cut >= canvas.height - 1;

  function draw(now) {
    if (!gl) return;
    const k = ease((now - fadeStart) / FADE_MS);
    mood = k >= 1 ? toMood : mixMood(fromMood, toMood, k);
    const dt = Math.min(0.25, (now - (prevDraw || now)) / 1000);
    prevDraw = now;
    wave = reduce.matches ? 0 : lerp(wave, waveTarget, 1 - Math.exp(-dt / 0.9));
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, reduce.matches ? STATIC_T : (now - t0) / 1000);
    gl.uniform3fv(U.uA, mood.a);
    gl.uniform3fv(U.uB, mood.b);
    gl.uniform3fv(U.uC, mood.c);
    gl.uniform3fv(U.uHot, mood.hot);
    gl.uniform2fv(U.uFocus, mood.focus);
    gl.uniform2f(U.uCol, colL, colR);
    gl.uniform1f(U.uGain, mood.gain);
    gl.uniform1f(U.uIri, mood.iri);
    gl.uniform1f(U.uWarm, mood.warm);
    gl.uniform1f(U.uWave, wave);
    gl.uniform1f(U.uCut, cut);
    gl.uniform1f(U.uBloom, reduce.matches ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // One frame, then the next is paced by a timer (no rAF polling between frames).
  function frame(now) {
    raf = 0;
    if (document.hidden || !gl) return;
    if (covered(now)) return; // restarted by scroll / navigation
    draw(now);
    if (reduce.matches && !fading(now)) return;
    const fps = fading(now) ? FPS_FADE : focused ? FPS : FPS_BLUR;
    timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, Math.max(0, 1000 / fps - (performance.now() - now)));
  }
  function kick() {
    if (!gl || document.hidden) return;
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function retarget() {
    const base = MOODS[view] || MOODS.home;
    const next = snapshotMood({ ...base, warm: view === 'shield' && risky ? 1 : 0 });
    fromMood = mood;
    toMood = next;
    fadeStart = reduce.matches ? -1e9 : performance.now();
    host.dataset.mood = view;
    host.classList.toggle('is-warm', view === 'shield' && risky);
    kick();
  }

  function readStore() {
    const scan = store.get('scan');
    const nowRisky = !!(scan && Array.isArray(scan.checks) && scan.checks.some((c) => c.status === 'risk'));
    const sp = store.get('scanProgress');
    const spd = store.get('speedProgress');
    const nextWave = (sp && sp.running) || (spd && spd.running) ? 1 : 0;
    const waveChanged = nextWave !== waveTarget;
    waveTarget = nextWave;
    if (nowRisky !== risky) {
      risky = nowRisky;
      retarget();
    } else if (waveChanged) {
      kick();
    }
  }

  let ok = false;
  try {
    ok = initGL();
  } catch (err) {
    console.warn('[ambient] WebGL unavailable, using the CSS background', err);
    ok = false;
  }
  if (!ok) {
    gl = null;
    canvas.remove();
    host.classList.add('ambient--flat');
  } else {
    resize();
    host.classList.add('is-ready');
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf); clearTimeout(timer); raf = 0; timer = 0; gl = null;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try { if (initGL()) { resize(); measure(); kick(); } } catch (err) { console.warn('[ambient] restore failed', err); }
  });
  let rz = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { resize(); measure(); if (gl) draw(performance.now()); kick(); });
  });
  window.addEventListener('focus', () => { focused = true; kick(); });
  window.addEventListener('blur', () => { focused = false; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  if (reduce.addEventListener) reduce.addEventListener('change', kick);
  // Home scrolls inside .view: the fade below the hero follows it (and wakes the loop when the
  // hero scrolls away). Measured at most once per animation frame, only on Home.
  let sc = 0;
  document.addEventListener('scroll', () => {
    if (view !== 'home' || sc || !gl) return;
    sc = requestAnimationFrame(() => {
      sc = 0;
      if (!measure()) return;
      if (reduce.matches) draw(performance.now());
      else kick();
    });
  }, { capture: true, passive: true });
  // Views mount after setView(); re-measure once their layout has settled.
  function settle() {
    for (const ms of [60, 400, FADE_MS + 100]) setTimeout(() => { if (measure()) kick(); }, ms);
  }

  if (store && typeof store.on === 'function') {
    for (const key of ['scan', 'scanProgress', 'speedProgress']) store.on(key, readStore);
    readStore();
  }
  measure();
  if (gl) draw(performance.now());
  kick();
  settle();

  return {
    setView(id) {
      if (!MOODS[id] || id === view) return;
      view = id;
      retarget();
      settle();
    },
  };
}

export default mountAmbient;
