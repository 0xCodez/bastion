// WebGL engine for the Shield exposure radar: a shallow glass disc seen at a three-quarter angle,
// a phosphor sweep, and one beacon per scan check. It renders into a transparent canvas so the
// illustration sits in the glass card itself: every light is additive and only the soft contact
// shadow under the rim writes coverage. It only draws what the radar core hands it in
// render(frame); layout, labels and interaction live in exposure-radar.js, which falls back to
// exposure-radar-2d.js when this module cannot start or its context does not come back.
// Patterns follow hero3d.js: capped DPR, HDR composer with a quiet bloom, context-loss handling,
// full disposal.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const VFOV = 24;
const TARGET = new THREE.Vector3(0, 0, 0);
const FIT_EL = 36 * Math.PI / 180;
const DOME_R = 2.7; // sphere radius of the shallow cap; the cap meets the disc rim at radius 1
const DOME_ANGLE = Math.asin(1 / DOME_R);
const DOME_H = DOME_R * (1 - Math.cos(DOME_ANGLE));
const PILLAR = { risk: 0.3, warn: 0.15 };
const STATUSES = ['risk', 'warn', 'ok', 'unknown', 'checking'];

const GLSL_HAIR = `
  float hair(float d, float aa, float wpx) {
    return 1.0 - smoothstep(wpx * aa * 0.5, wpx * aa * 0.5 + aa, abs(d));
  }
`;

const VERT_WORLD = `
  varying vec3 vW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const VERT_NORMAL = `
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Floor: no surface of its own. A faint pool of violet light under the disc that melts into the
// card, and a contact shadow under the rim written to alpha (premultiplied coverage).
const FLOOR_FRAG = `
  uniform vec3 uGlow, uLine, uCam;
  uniform vec2 uRes;
  varying vec3 vW;
  void main() {
    float r = length(vW.xz);
    vec3 col = uGlow * (0.045 * exp(-r * r * 1.6) + 0.01 * exp(-r * 1.2));
    // a whisper of reflected bezel light on the floor just outside the rim
    float rb = (r - 1.12) / 0.16;
    col += uLine * 0.012 * exp(-rb * rb);
    float cs = (r - 1.015) / 0.09;
    float shadow = 0.3 * exp(-cs * cs) * smoothstep(0.9, 1.0, r);
    vec2 uv = gl_FragCoord.xy / uRes;
    float e = smoothstep(0.0, 0.12, uv.x) * smoothstep(0.0, 0.12, 1.0 - uv.x) * smoothstep(0.0, 0.12, uv.y) * smoothstep(0.0, 0.12, 1.0 - uv.y);
    gl_FragColor = vec4(col * e, shadow * e);
  }
`;

const DISC_FRAG = `
  uniform float uSweep, uTrail, uPing, uPingA, uNear, uFar;
  uniform vec3 uViolet, uLav, uSky, uCam;
  varying vec3 vW;
  const float TAU = 6.28318530718;
  const float PI = 3.14159265359;
  ${GLSL_HAIR}
  void main() {
    vec2 p = vW.xz;
    float r = length(p);
    float aa = length(fwidth(p)) * 0.72;
    float th = atan(p.y, p.x);
    vec2 n = p / max(r, 1e-4);
    float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    vec3 V = normalize(uCam - vW);
    vec3 col = vec3(0.0);

    // glass body: a breath of tint, denser toward the edge where the glass is thicker
    col += uViolet * (0.004 + 0.022 * pow(smoothstep(0.5, 1.0, r), 2.0)) * inside;
    // refracted inner edge: a soft gradient, not a second line
    float lightA = max(dot(n, normalize(vec2(-0.5, -0.86))), 0.0);
    col += uLav * exp(-(1.0 - r) / 0.035) * (0.025 + 0.07 * lightA) * inside;

    // precision rings, half-pixel hairlines
    float rings = 0.085 * hair(r - 0.25, aa, 0.5) + 0.1 * hair(r - 0.5, aa, 0.5) + 0.12 * hair(r - 0.75, aa, 0.5);
    // four cardinal guides, quiet and fading toward the core
    float q = PI * 0.5;
    float arcQ = abs(fract(th / q + 0.5) - 0.5) * q * r;
    float guides = 0.028 * hair(arcQ, aa, 0.4) * inside * smoothstep(0.12, 0.4, r) * (1.0 - smoothstep(0.88, 0.98, r));

    // rim: one hairline lit by a single far-left light plus fresnel at the silhouette
    vec3 n3 = vec3(n.x, 0.0, n.y);
    float fres = pow(1.0 - abs(dot(n3, V)), 3.0);
    float rim = hair(r - 1.0, aa, 0.5) * (0.12 + 0.55 * pow(lightA, 1.5) + 0.3 * fres);
    // a short specular arc on the far side, where the light enters the glass
    float spec = hair(r - 0.992, aa, 1.0) * pow(lightA, 28.0) * 0.4;

    // bezel: fine 5-degree ticks and four cardinal ticks, no text
    float tickA = TAU / 72.0;
    float arc5 = abs(fract(th / tickA + 0.5) - 0.5) * tickA * r;
    float band5 = smoothstep(1.03 - aa, 1.03, r) * (1.0 - smoothstep(1.046, 1.046 + aa, r));
    float bandQ = smoothstep(1.03 - aa, 1.03, r) * (1.0 - smoothstep(1.07, 1.07 + aa, r));
    float ticks = 0.07 * hair(arc5, aa, 0.4) * band5 + 0.26 * hair(arcQ, aa, 0.5) * bandQ;

    // radar sweep: a long phosphor trail with a volumetric falloff in r, and a soft tinted edge
    // that is brightest at mid-radius and fades out before the rim
    float d = mod(uSweep - th, TAU);
    float body = inside * smoothstep(0.03, 0.22, r);
    float vol = smoothstep(0.0, 0.45, r) * (1.0 - 0.6 * smoothstep(0.6, 1.0, r));
    float trail = exp(-d * 1.2) * body * vol;
    float behind = d * r;
    float ahead = (TAU - d) * r;
    float edge = (d < PI ? exp(-behind / (aa * 7.0)) : exp(-ahead / (aa * 1.6))) * body;
    float bell = exp(-pow((r - 0.5) / 0.34, 2.0));
    vec3 trailCol = mix(uViolet, uLav, 0.25 + 0.6 * exp(-d * 3.0));
    vec3 edgeCol = mix(uLav, uSky, 0.45);

    // ping: a ring that leaves the core and fades as it reaches the rim
    float ping = hair(r - uPing, aa, 0.5) * pow(1.0 - clamp(uPing, 0.0, 1.0), 1.6) * uPingA * inside;

    float dist = length(uCam - vW);
    float depthK = mix(0.6, 1.0, smoothstep(uFar, uNear, dist));

    col += uLav * (rings + guides + ticks) + mix(uLav, vec3(1.0), 0.3) * rim + mix(uSky, vec3(1.0), 0.5) * spec;
    col += trailCol * trail * uTrail * 0.26;
    col += edgeCol * edge * bell * uTrail * 0.34;
    col += uLav * ping * 0.35;
    col *= depthK;
    gl_FragColor = vec4(col, 0.0);
  }
`;

const EDGE_FRAG = `
  uniform vec3 uLav, uCam;
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    vec3 V = normalize(uCam - vW);
    vec3 N = normalize(vN);
    float fr = pow(1.0 - abs(dot(N, V)), 2.0);
    vec2 L = normalize(vec2(-0.5, -0.86));
    float lightA = max(dot(normalize(vW.xz), L), 0.0);
    float v = clamp(vUv.y, 0.0, 1.0);
    float body = mix(0.004, 0.03, pow(v, 2.5));
    vec3 col = uLav * (body + fr * 0.03) * (0.35 + 0.65 * lightA);
    gl_FragColor = vec4(col, 0.0);
  }
`;

const DOME_FRAG = `
  uniform vec3 uLav, uSky, uCam;
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec3 V = normalize(uCam - vW);
    vec3 N = normalize(vN);
    float ndv = max(dot(N, V), 0.0);
    float fr = pow(1.0 - ndv, 3.0);
    float r = length(vW.xz);
    vec2 dir = vW.xz / max(r, 1e-4);
    // a broad, soft reflection of the light on the far-left of the cap
    float side = max(dot(dir, normalize(vec2(-0.5, -0.86))), 0.0);
    float sheen = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.94, 0.995, r)) * pow(side, 6.0);
    vec3 col = uLav * fr * 0.035 * smoothstep(1.0, 0.85, r) + mix(uLav, uSky, 0.5) * sheen * 0.07;
    gl_FragColor = vec4(col, 0.0);
  }
`;

// Billboard glow: a small crisp core and a soft halo. Kept below 1.0 so only lit or hovered
// beacons reach the bloom threshold.
const GLOW_FRAG = `
  uniform vec3 uColor;
  uniform float uI, uSoft, uCore, uHalo;
  varying vec2 vUv;
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float d = length(q);
    float cr = uCore * (1.0 + uSoft * 0.4);
    float core = 1.0 - smoothstep(cr - 0.014, cr + 0.016 + uSoft * 0.03, d);
    float halo = exp(-d * d * mix(30.0, 18.0, uSoft)) * 0.42 + exp(-d * 6.0) * 0.08;
    vec3 col = uColor * halo * uHalo + mix(uColor, vec3(1.0), 0.4) * core * 0.9;
    col *= uI * (1.0 - smoothstep(0.8, 1.0, d));
    gl_FragColor = vec4(col, 0.0);
  }
`;

const PILLAR_FRAG = `
  uniform vec3 uColor;
  uniform float uI, uTime, uSoft;
  varying vec2 vUv;
  void main() {
    float x = vUv.x * 2.0 - 1.0;
    float v = vUv.y;
    float core = exp(-x * x * mix(320.0, 160.0, uSoft));
    float soft = exp(-x * x * 18.0) * 0.12;
    float fade = pow(clamp(1.0 - v, 0.0, 1.0), 1.8) * smoothstep(0.0, 0.06, v);
    float travel = 0.9 + 0.1 * sin(v * 14.0 - uTime * 2.0);
    vec3 col = (mix(uColor, vec3(1.0), 0.2) * core + uColor * soft) * fade * travel * uI;
    gl_FragColor = vec4(col, 0.0);
  }
`;

const RING_FRAG = `
  uniform vec3 uColor;
  uniform float uR, uW, uA, uDash, uRot, uHalf, uFill;
  varying vec2 vUv;
  const float TAU = 6.28318530718;
  void main() {
    vec2 q = (vUv * 2.0 - 1.0) * uHalf;
    float r = length(q);
    float aa = length(fwidth(q)) * 0.72;
    float ring = 1.0 - smoothstep(uW * aa * 0.5, uW * aa * 0.5 + aa, abs(r - uR));
    if (uDash > 0.5) {
      float a = atan(q.y, q.x) + uRot;
      float s = fract(a / TAU * uDash);
      ring *= smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(0.5, 0.56, s));
    }
    float fill = uFill * exp(-r * r / max(uR * uR, 1e-5) * 1.6) * step(r, uR);
    vec3 col = uColor * (ring + fill) * uA;
    gl_FragColor = vec4(col, 0.0);
  }
`;

// Sealed bead: clear glass. A crisp refractive rim, a nearly empty centre and one specular dot.
const BEAD_FRAG = `
  uniform vec3 uColor, uCam;
  uniform float uI;
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec3 V = normalize(uCam - vW);
    vec3 N = normalize(vN);
    float ndv = max(dot(N, V), 0.0);
    float rim = smoothstep(0.62, 0.18, ndv) * smoothstep(0.0, 0.12, ndv);
    vec3 Lk = normalize(vec3(-0.5, 1.0, -0.6));
    float spec = pow(max(dot(N, normalize(Lk + V)), 0.0), 90.0);
    float caustic = pow(max(dot(N, -normalize(Lk + V * 0.2)), 0.0), 6.0) * 0.18;
    vec3 col = uColor * (0.05 + 0.62 * rim + caustic) + vec3(1.0) * spec * 0.6;
    gl_FragColor = vec4(col * uI, 0.0);
  }
`;

// Router core: a lavender sphere of light with a white-hot centre a few pixels across. The
// silhouette dissolves into the halo instead of ending in a hard edge.
const CORE_FRAG = `
  uniform vec3 uViolet, uLav, uCam;
  uniform float uI;
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec3 V = normalize(uCam - vW);
    vec3 N = normalize(vN);
    float ndv = max(dot(N, V), 0.0);
    vec3 col = mix(uViolet * 0.55, uLav * 0.85, smoothstep(0.1, 0.8, ndv));
    col += vec3(1.0) * pow(ndv, 14.0) * 0.55;
    col *= smoothstep(0.0, 0.35, ndv);
    gl_FragColor = vec4(col * uI, 0.0);
  }
`;

const POINTS_VERT = `
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  uniform float uPr;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPr;
    gl_Position = projectionMatrix * mv;
  }
`;
const POINTS_FRAG = `
  varying vec3 vColor;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d = length(q);
    float w = fwidth(d);
    float dot = 1.0 - smoothstep(0.5 - w, 0.5 + w, d);
    gl_FragColor = vec4(vColor * dot, 0.0);
  }
`;

// Final pass: linear HDR to sRGB, then premultiplied output. Light becomes colour with matching
// coverage (rgb never exceeds alpha), and the contact shadow kept in alpha darkens the card.
const OUT_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }
    void main() {
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 L = clamp(toSRGB(max(t.rgb, vec3(0.0))), 0.0, 1.0);
      float m = max(L.r, max(L.g, L.b));
      float a = clamp(m + clamp(t.a, 0.0, 1.0) * (1.0 - m), 0.0, 1.0);
      gl_FragColor = vec4(L, a);
    }
  `,
};

// Additive light that leaves the coverage channel alone.
const LIGHT_BLEND = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendEquationAlpha: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};

function light(uniforms, vertexShader, fragmentShader, extra = {}) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, ...LIGHT_BLEND, ...extra });
}

// hooks: { onLost(), onRestored() } so the core can wait for the context or swap to 2D.
export function createGLEngine(host, pal, hooks = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, premultipliedAlpha: true, stencil: false, powerPreference: 'high-performance' });
  try {
    return build(host, pal, renderer, hooks);
  } catch (err) {
    try { renderer.dispose(); } catch { /* released */ }
    try { renderer.forceContextLoss(); } catch { /* lost */ }
    if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.remove();
    throw err;
  }
}

function build(host, pal, renderer, hooks) {
  const C = {};
  for (const k of Object.keys(pal)) {
    try { C[k] = new THREE.Color(pal[k]); } catch { C[k] = new THREE.Color('#B7A9FF'); }
  }

  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'rx-canvas';
  host.prepend(canvas);
  let shaderFailed = false;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    shaderFailed = true;
    console.warn('[exposure-radar] shader error', gl.getShaderInfoLog(vs) || '', gl.getShaderInfoLog(fs) || '', gl.getProgramInfoLog(program) || '');
  };
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  // A GPU reset or the page's context cap: stop drawing, let three restore its state, and tell
  // the core so it can swap to the 2D engine if the context does not come back.
  let lost = false;
  const onContextLost = (e) => {
    e.preventDefault();
    lost = true;
    if (typeof hooks.onLost === 'function') hooks.onLost();
  };
  const onContextRestored = () => {
    lost = false;
    size.w = 0; // force the next resize to reallocate every target
    if (typeof hooks.onRestored === 'function') hooks.onRestored();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const size = { w: 1, h: 1, pr: 1 };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VFOV, 1, 0.1, 60);
  const view = { az: 0, el: FIT_EL, dist: 5 };

  const geos = [];
  const mats = [];
  const track = (g) => { geos.push(g); return g; };
  const plane = track(new THREE.PlaneGeometry(1, 1));
  const flat = track(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const sphere = track(new THREE.SphereGeometry(1, 40, 24));

  // floor: light added, shadow written to coverage
  const floorU = { uGlow: { value: C.violet }, uLine: { value: C.lavender }, uCam: { value: camera.position }, uRes: { value: new THREE.Vector2(1, 1) } };
  const floorMat = new THREE.ShaderMaterial({
    uniforms: floorU, vertexShader: VERT_WORLD, fragmentShader: FLOOR_FRAG,
    ...LIGHT_BLEND, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  mats.push(floorMat);
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2)), floorMat);
  floor.position.y = -0.06;
  floor.renderOrder = -10;
  scene.add(floor);

  // glass disc with rings, bezel and the sweep
  const discU = {
    uSweep: { value: 0 }, uTrail: { value: 0.8 }, uPing: { value: 2 }, uPingA: { value: 0 },
    uNear: { value: 3 }, uFar: { value: 6 },
    uViolet: { value: C.violet }, uLav: { value: C.lavender }, uSky: { value: C.sky }, uCam: { value: camera.position },
  };
  const discMat = light(discU, VERT_WORLD, DISC_FRAG);
  mats.push(discMat);
  const disc = new THREE.Mesh(track(new THREE.CircleGeometry(1.1, 192).rotateX(-Math.PI / 2)), discMat);
  disc.renderOrder = 1;
  scene.add(disc);

  // glass edge band (thickness of the puck)
  const edgeMat = light({ uLav: { value: C.lavender }, uCam: { value: camera.position } }, VERT_NORMAL, EDGE_FRAG);
  mats.push(edgeMat);
  const edge = new THREE.Mesh(track(new THREE.CylinderGeometry(1, 1, 0.04, 192, 1, true)), edgeMat);
  edge.position.y = -0.02;
  scene.add(edge);

  // shallow dome cap: fresnel sheen and one broad reflection
  const domeMat = light({ uLav: { value: C.lavender }, uSky: { value: C.sky }, uCam: { value: camera.position } }, VERT_NORMAL, DOME_FRAG);
  mats.push(domeMat);
  const dome = new THREE.Mesh(track(new THREE.SphereGeometry(DOME_R, 128, 24, 0, Math.PI * 2, 0, DOME_ANGLE)), domeMat);
  dome.position.y = -(DOME_R - DOME_H);
  dome.renderOrder = 20;
  scene.add(dome);

  // router core
  const coreMat = light({ uViolet: { value: C.violet }, uLav: { value: C.lavender }, uCam: { value: camera.position }, uI: { value: 1 } }, VERT_NORMAL, CORE_FRAG);
  mats.push(coreMat);
  const core = new THREE.Mesh(sphere, coreMat);
  core.scale.setScalar(0.034);
  core.position.y = 0.045;
  core.renderOrder = 7;
  scene.add(core);
  const coreGlowU = { uColor: { value: C.lavender }, uI: { value: 0.5 }, uSoft: { value: 0.3 }, uCore: { value: 0.0 }, uHalo: { value: 1 } };
  const coreGlowMat = light(coreGlowU, VERT_WORLD, GLOW_FRAG);
  mats.push(coreGlowMat);
  const coreGlow = new THREE.Mesh(plane, coreGlowMat);
  coreGlow.scale.setScalar(0.42);
  coreGlow.position.y = 0.045;
  coreGlow.renderOrder = 5;
  scene.add(coreGlow);
  const coreRingU = { uColor: { value: C.lavender }, uR: { value: 0.075 }, uW: { value: 0.5 }, uA: { value: 0.32 }, uDash: { value: 0 }, uRot: { value: 0 }, uHalf: { value: 0.12 }, uFill: { value: 0.12 } };
  const coreRingMat = light(coreRingU, VERT_WORLD, RING_FRAG);
  mats.push(coreRingMat);
  const coreRing = new THREE.Mesh(flat, coreRingMat);
  coreRing.scale.setScalar(0.24);
  coreRing.position.y = 0.002;
  coreRing.renderOrder = 4;
  scene.add(coreRing);

  // LAN devices: crisp 2px points
  const devGeo = track(new THREE.BufferGeometry());
  const devMat = light({ uPr: { value: 1 } }, POINTS_VERT, POINTS_FRAG);
  mats.push(devMat);
  const devPoints = new THREE.Points(devGeo, devMat);
  devPoints.renderOrder = 6;
  devPoints.frustumCulled = false;
  scene.add(devPoints);
  let devKey = '';

  // composer: only the scene render is multisampled (as in hero3d); renderTarget2 is the MSAA
  // buffer and render() keeps it as the read buffer RenderPass draws into.
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt);
  const msaa = composer.renderTarget2;
  msaa.samples = 4;
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.55, 0.86);
  // bloom adds light only; it must not add coverage
  Object.assign(bloom.blendMaterial, {
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  bloom.blendMaterial.needsUpdate = true;
  composer.addPass(bloom);
  const outPass = new ShaderPass(OUT_SHADER);
  outPass.material.blending = THREE.NoBlending;
  outPass.material.transparent = false;
  outPass.clear = true;
  composer.addPass(outPass);

  // beacons
  const beacons = new Map();
  const statusColor = (s) => (s === 'risk' ? C.coral : s === 'warn' ? C.amber : s === 'ok' ? C.mint : s === 'checking' ? C.lavender : C.dim);

  function makeBeacon(b) {
    const g = new THREE.Group();
    const parts = { group: g, status: b.status, mats: [] };
    const col = statusColor(b.status).clone();
    const add = (mesh, mat) => { parts.mats.push(mat); g.add(mesh); return mesh; };

    const glowU = { uColor: { value: col }, uI: { value: 1 }, uSoft: { value: 0 }, uCore: { value: 0.1 }, uHalo: { value: 1 } };
    parts.glowU = glowU;
    const glowMat = light(glowU, VERT_WORLD, GLOW_FRAG);
    parts.glow = add(new THREE.Mesh(plane, glowMat), glowMat);
    parts.glow.renderOrder = 12;

    if (b.status === 'risk' || b.status === 'warn') {
      const pU = { uColor: { value: col }, uI: { value: 1 }, uTime: { value: 0 }, uSoft: { value: 0 } };
      parts.pillarU = pU;
      const pMat = light(pU, VERT_WORLD, PILLAR_FRAG, { side: THREE.DoubleSide });
      parts.pillar = add(new THREE.Mesh(plane, pMat), pMat);
      parts.pillarH = PILLAR[b.status];
      parts.pillar.renderOrder = 11;
    }
    if (b.status === 'risk') {
      parts.ripples = [0, 1].map(() => {
        const u = { uColor: { value: col }, uR: { value: 0.05 }, uW: { value: 0.6 }, uA: { value: 0 }, uDash: { value: 0 }, uRot: { value: 0 }, uHalf: { value: 0.3 }, uFill: { value: 0 } };
        const m = light(u, VERT_WORLD, RING_FRAG);
        const mesh = add(new THREE.Mesh(flat, m), m);
        mesh.scale.setScalar(0.6);
        mesh.position.y = 0.002;
        mesh.renderOrder = 3;
        return u;
      });
    }
    if (b.status === 'ok') {
      const bU = { uColor: { value: col }, uCam: { value: camera.position }, uI: { value: 1 } };
      parts.beadU = bU;
      const bMat = light(bU, VERT_NORMAL, BEAD_FRAG);
      parts.bead = add(new THREE.Mesh(sphere, bMat), bMat);
      parts.bead.scale.setScalar(0.024);
      parts.bead.position.y = 0.026;
      parts.bead.renderOrder = 13;
    }
    if (b.status === 'unknown' || b.status === 'checking') {
      const u = { uColor: { value: col }, uR: { value: 0.026 }, uW: { value: 0.9 }, uA: { value: 0.8 }, uDash: { value: b.status === 'checking' ? 6 : 0 }, uRot: { value: 0 }, uHalf: { value: 0.06 }, uFill: { value: 0 } };
      parts.ringU = u;
      const m = light(u, VERT_WORLD, RING_FRAG);
      const mesh = add(new THREE.Mesh(flat, m), m);
      mesh.scale.setScalar(0.12);
      mesh.position.y = 0.003;
      mesh.renderOrder = 4;
    }
    // hover ring
    const hU = { uColor: { value: col }, uR: { value: 0.05 }, uW: { value: 0.6 }, uA: { value: 0 }, uDash: { value: 0 }, uRot: { value: 0 }, uHalf: { value: 0.08 }, uFill: { value: 0.1 } };
    parts.hotU = hU;
    const hMat = light(hU, VERT_WORLD, RING_FRAG);
    const hMesh = add(new THREE.Mesh(flat, hMat), hMat);
    hMesh.scale.setScalar(0.16);
    hMesh.position.y = 0.004;
    hMesh.renderOrder = 4;

    scene.add(g);
    return parts;
  }

  function dropBeacon(parts) {
    scene.remove(parts.group);
    parts.mats.forEach((m) => m.dispose());
  }

  function syncDevices(devices) {
    const key = devices.map((d) => d.key + d.kind + d.x.toFixed(3)).join('|');
    if (key === devKey) return;
    devKey = key;
    const n = devices.length;
    const pos = new Float32Array(n * 3);
    const colA = new Float32Array(n * 3);
    const sz = new Float32Array(n);
    devices.forEach((d, i) => {
      pos[i * 3] = d.x; pos[i * 3 + 1] = 0.006; pos[i * 3 + 2] = d.z;
      const c = d.kind === 'self' ? C.mint : C.lavender;
      const k = d.kind === 'self' ? 0.85 : 0.5;
      colA[i * 3] = c.r * k; colA[i * 3 + 1] = c.g * k; colA[i * 3 + 2] = c.b * k;
      sz[i] = d.kind === 'self' ? 4.5 : 3.5;
    });
    devGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    devGeo.setAttribute('aColor', new THREE.BufferAttribute(colA, 3));
    devGeo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    devGeo.setDrawRange(0, n);
  }

  function placeCamera() {
    const ce = Math.cos(view.el);
    camera.position.set(
      TARGET.x + view.dist * Math.sin(view.az) * ce,
      TARGET.y + view.dist * Math.sin(view.el),
      TARGET.z + view.dist * Math.cos(view.az) * ce,
    );
    camera.lookAt(TARGET);
    camera.updateMatrixWorld();
    discU.uNear.value = view.dist - 1.1;
    discU.uFar.value = view.dist + 1.1;
  }

  // Fit the bezel (and the tallest pillar) inside the stage with a clear margin on every side,
  // then centre it with a view offset. Done at the rest view; tilting stays inside the margin.
  const tmp = new THREE.Vector3();
  const fitPts = [];
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * Math.PI * 2;
    fitPts.push([1.075 * Math.cos(a), 0, 1.075 * Math.sin(a)]);
    if (i % 3 === 0) fitPts.push([0.84 * Math.cos(a), PILLAR.risk, 0.84 * Math.sin(a)]);
  }
  function bounds() {
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const p of fitPts) {
      tmp.set(p[0], p[1], p[2]).project(camera);
      const x = (tmp.x + 1) / 2 * size.w;
      const y = (1 - tmp.y) / 2 * size.h;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, x1, y0, y1 };
  }
  function fitCamera() {
    const keep = { az: view.az, el: view.el };
    camera.aspect = size.w / size.h;
    camera.clearViewOffset();
    view.az = 0; view.el = FIT_EL;
    const mx = Math.min(72, Math.max(28, size.w * 0.1));
    const myT = Math.max(24, size.h * 0.06);
    const myB = Math.max(24, size.h * 0.05);
    let dist = 5;
    let bb = null;
    for (let i = 0; i < 8; i++) {
      view.dist = dist;
      placeCamera();
      camera.updateProjectionMatrix();
      bb = bounds();
      const k = Math.max((bb.x1 - bb.x0) / Math.max(40, size.w - 2 * mx), (bb.y1 - bb.y0) / Math.max(40, size.h - myT - myB));
      if (Math.abs(k - 1) < 0.002) break;
      dist *= k;
    }
    const offX = (bb.x0 + bb.x1) / 2 - size.w / 2;
    const offY = (bb.y0 + bb.y1) / 2 - (myT + (size.h - myT - myB) / 2);
    camera.setViewOffset(size.w, size.h, offX, offY, size.w, size.h);
    camera.updateProjectionMatrix();
    view.az = keep.az; view.el = keep.el;
    placeCamera();
  }

  function depthSoft(x, y, z) {
    tmp.set(x, y, z);
    const d = tmp.distanceTo(camera.position);
    return Math.min(1, Math.max(0, (d - (view.dist - 0.9)) / 1.8));
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  const api = {
    kind: 'webgl',
    canvas,
    isLost() { return lost; },
    resize(w, h) {
      const pr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === size.w && h === size.h && pr === size.pr) return;
      size.w = Math.max(1, w); size.h = Math.max(1, h); size.pr = pr;
      renderer.setPixelRatio(pr);
      renderer.setSize(size.w, size.h, false);
      composer.setPixelRatio(pr);
      composer.setSize(size.w, size.h);
      devMat.uniforms.uPr.value = pr;
      floorU.uRes.value.set(size.w * pr, size.h * pr);
      fitCamera();
    },
    setView(az, el) {
      view.az = az;
      view.el = el;
      placeCamera();
    },
    project(x, y, z) {
      tmp.set(x, y, z).project(camera);
      return { x: (tmp.x + 1) / 2 * size.w, y: (1 - tmp.y) / 2 * size.h, soft: depthSoft(x, y, z) };
    },
    // Screen point to the disc plane (y = 0), or null above the horizon.
    unproject(x, y) {
      ndc.set(x / size.w * 2 - 1, 1 - y / size.h * 2);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(ground, hit) ? { x: hit.x, z: hit.z } : null;
    },
    pillarHeight(status) {
      return PILLAR[status] || 0;
    },
    render(f) {
      if (lost) return;
      placeCamera();
      discU.uSweep.value = f.sweep;
      discU.uTrail.value = f.trail;
      discU.uPing.value = f.ping;
      discU.uPingA.value = f.pingA;
      coreGlowU.uI.value = 0.42 + 0.06 * f.breath;
      syncDevices(f.devices);

      const seen = new Set();
      for (const b of f.beacons) {
        seen.add(b.id);
        let p = beacons.get(b.id);
        if (p && p.status !== b.status) { dropBeacon(p); p = null; }
        if (!p) { p = makeBeacon(b); beacons.set(b.id, p); }
        const a = b.appear;
        const soft = depthSoft(b.x, 0, b.z);
        const fade = 1 - 0.55 * b.dim;
        const lit = b.lit;
        const hot = b.hot;
        p.group.position.set(b.x, 0, b.z);
        p.group.visible = a > 0.001;
        const pop = a < 1 ? 1 + 0.5 * Math.sin(a * Math.PI) * (1 - a) : 1;
        const base = b.status === 'risk' ? 0.24 : b.status === 'warn' ? 0.16 : b.status === 'ok' ? 0.1 : b.status === 'checking' ? 0.14 : 0.07;
        p.glow.scale.setScalar(base * (1 + 0.2 * lit + 0.25 * hot) * pop * (0.6 + 0.4 * a));
        p.glow.position.y = b.status === 'ok' ? 0.026 : 0.02;
        p.glow.quaternion.copy(camera.quaternion);
        p.glowU.uSoft.value = soft;
        p.glowU.uCore.value = b.status === 'ok' || b.status === 'unknown' ? 0.0 : b.status === 'risk' ? 0.085 : 0.095;
        p.glowU.uHalo.value = b.status === 'unknown' ? 0.3 : b.status === 'ok' ? 0.32 : b.status === 'warn' ? 0.65 : 0.9;
        const pulse = b.status === 'risk' ? 0.06 * Math.sin(f.time * 2.2) : 0;
        p.glowU.uI.value = a * fade * ((b.status === 'unknown' ? 0.35 : b.status === 'ok' ? 0.5 : 0.85) + 0.35 * lit + 0.3 * hot + pulse);
        if (p.pillar) {
          const h = p.pillarH * (0.3 + 0.7 * a);
          p.pillar.scale.set(0.05, h, 1);
          p.pillar.position.y = h / 2;
          p.pillar.rotation.set(0, Math.atan2(camera.position.x - b.x, camera.position.z - b.z), 0);
          p.pillarU.uI.value = a * fade * (0.7 + 0.3 * lit + 0.25 * hot);
          p.pillarU.uTime.value = f.time;
          p.pillarU.uSoft.value = soft;
        }
        if (p.ripples) {
          p.ripples.forEach((u, i) => {
            const ph = f.reduced ? 0.35 + i * 0.3 : (f.time / 3.2 + i / 2) % 1;
            u.uR.value = 0.03 + ph * 0.22;
            u.uA.value = a * fade * Math.pow(1 - ph, 1.8) * 0.5;
          });
        }
        if (p.bead) {
          p.beadU.uI.value = a * fade * (0.8 + 0.35 * lit + 0.3 * hot);
          p.bead.scale.setScalar(0.024 * (0.5 + 0.5 * a) * (1 + 0.15 * hot));
        }
        if (p.ringU) {
          p.ringU.uA.value = a * fade * (b.status === 'checking' ? 0.9 : 0.5 + 0.4 * lit + 0.4 * hot);
          p.ringU.uRot.value = b.status === 'checking' ? -f.time * 2.4 : 0;
        }
        p.hotU.uA.value = hot * a * 0.75;
        p.hotU.uR.value = 0.045 + 0.01 * hot;
      }
      for (const [id, p] of beacons) if (!seen.has(id)) { dropBeacon(p); beacons.delete(id); }

      if (composer.readBuffer !== msaa) composer.swapBuffers();
      composer.render();
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      for (const p of beacons.values()) dropBeacon(p);
      beacons.clear();
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      try { bloom.dispose(); } catch { /* released */ }
      try { outPass.dispose(); } catch { /* released */ }
      try { composer.dispose(); } catch { /* released */ }
      rt.dispose();
      msaa.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* lost */ }
      canvas.remove();
    },
  };

  // Compile every program once, including one hidden beacon of each kind (pillar, ripples, bead,
  // rings), so a shader failure falls back to 2D instead of silently dropping beacons.
  placeCamera();
  // Rendering once (not only compiling) makes three read each program's diagnostics before the
  // probe materials are released.
  const probes = STATUSES.map((s) => makeBeacon({ status: s }));
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  probes.forEach(dropBeacon);
  const gl = renderer.getContext();
  if (!gl || gl.isContextLost()) throw new Error('WebGL context lost');
  if (shaderFailed) throw new Error('radar shaders failed to compile');
  return api;
}
