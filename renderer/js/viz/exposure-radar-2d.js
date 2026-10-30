// Canvas 2D engine for the Shield exposure radar, used when WebGL is not available. It draws the
// same scene as exposure-radar-gl.js with an affine three-quarter projection: glass disc, hairline
// rings with a quiet bezel, phosphor sweep, beacons with pillars, ripples and beads. Same
// interface. The canvas is transparent so the drawing sits in the glass card.

const TAU = Math.PI * 2;
const PILLAR = { risk: 0.3, warn: 0.15 };

function rgba(hex, a) {
  let h = String(hex || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (!/^#[0-9a-f]{6}$/i.test(h)) return 'rgba(183,169,255,' + a + ')';
  const n = parseInt(h.slice(1), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
}

export function createCanvasEngine(host, pal) {
  const canvas = document.createElement('canvas');
  canvas.className = 'rx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  host.prepend(canvas);

  const size = { w: 1, h: 1, pr: 1 };
  const view = { az: 0, el: 35 * Math.PI / 180 };
  let S = 100;
  let cx = 50;
  let cy = 50;

  // Same margins as the WebGL fit: the bezel keeps clear space on every side.
  function layout() {
    const mx = Math.min(72, Math.max(28, size.w * 0.1));
    const myT = Math.max(24, size.h * 0.06);
    const myB = Math.max(24, size.h * 0.05);
    const sy = Math.sin(view.el);
    const top = PILLAR.risk * Math.cos(view.el);
    S = Math.min((size.w - 2 * mx) / 2.15, (size.h - myT - myB) / (2.15 * sy + top));
    cx = size.w / 2;
    cy = myT + top * S + 1.075 * S * sy + ((size.h - myT - myB) - S * (2.15 * sy + top)) / 2;
  }

  function proj(x, y, z) {
    const ca = Math.cos(view.az);
    const sa = Math.sin(view.az);
    const xr = x * ca - z * sa;
    const zr = x * sa + z * ca;
    return {
      x: cx + xr * S,
      y: cy + zr * S * Math.sin(view.el) - y * S * Math.cos(view.el),
      soft: Math.min(1, Math.max(0, (0.9 - zr) / 1.8)),
      zr,
    };
  }

  function colorOf(s) {
    return s === 'risk' ? pal.coral : s === 'warn' ? pal.amber : s === 'ok' ? pal.mint : s === 'checking' ? pal.lavender : pal.dim;
  }

  function glow(x, y, r, col, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, a));
    g.addColorStop(0.35, rgba(col, a * 0.35));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  function ellipse(r, stroke, width, dash) {
    const sy = Math.sin(view.el);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * S, r * S * sy, 0, 0, TAU);
    ctx.setLineDash(dash || []);
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function flatRing(x, z, r, col, a, width, dash, rot) {
    const sy = Math.sin(view.el);
    const p = proj(x, 0, z);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * S, r * S * sy, 0, rot || 0, (rot || 0) + TAU);
    ctx.setLineDash(dash || []);
    ctx.lineWidth = width;
    ctx.strokeStyle = rgba(col, a);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  return {
    kind: '2d',
    canvas,
    resize(w, h) {
      const pr = Math.min(window.devicePixelRatio || 1, 2);
      size.w = Math.max(1, w); size.h = Math.max(1, h); size.pr = pr;
      canvas.width = Math.round(size.w * pr);
      canvas.height = Math.round(size.h * pr);
      layout();
    },
    isLost() { return false; },
    setView(az, el) { view.az = az; view.el = el; },
    project(x, y, z) { const p = proj(x, y, z); return { x: p.x, y: p.y, soft: p.soft }; },
    // Screen point to the disc plane (inverse of proj at y = 0).
    unproject(x, y) {
      const sy = Math.sin(view.el);
      const xr = (x - cx) / S;
      const zr = (y - cy) / (S * Math.max(sy, 0.05));
      const ca = Math.cos(view.az);
      const sa = Math.sin(view.az);
      return { x: xr * ca + zr * sa, z: -xr * sa + zr * ca };
    },
    pillarHeight(status) { return PILLAR[status] || 0; },
    render(f) {
      const { w, h, pr } = size;
      const sy = Math.sin(view.el);
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, w, h);

      // floor glow and the contact shadow under the rim
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, sy);
      let g = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 2.2);
      g.addColorStop(0, rgba(pal.violet, 0.12));
      g.addColorStop(0.45, rgba(pal.violet, 0.04));
      g.addColorStop(1, rgba(pal.violet, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, S * 2.2, 0, TAU); ctx.fill();
      g = ctx.createRadialGradient(0, 0, S * 0.94, 0, 0, S * 1.2);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.35, 'rgba(4,3,10,.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, S * 1.2, 0, TAU); ctx.fill();
      // glass body
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, S);
      g.addColorStop(0, rgba(pal.lavender, 0.14));
      g.addColorStop(0.3, rgba(pal.violet, 0.06));
      g.addColorStop(0.8, rgba(pal.violet, 0.05));
      g.addColorStop(1, rgba(pal.violet, 0.1));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, S, 0, TAU); ctx.fill();
      ctx.restore();

      ctx.globalCompositeOperation = 'lighter';
      // glass thickness: the front half of the rim, dropped by the puck depth
      const drop = 0.05 * S * Math.cos(view.el);
      ctx.beginPath();
      ctx.ellipse(cx, cy + drop, S, S * sy, 0, 0, Math.PI);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(pal.lavender, 0.12);
      ctx.stroke();

      // rings and spokes
      ellipse(0.25, rgba(pal.lavender, 0.12), 0.75);
      ellipse(0.5, rgba(pal.lavender, 0.15), 0.75);
      ellipse(0.75, rgba(pal.lavender, 0.18), 0.75);
      ellipse(1, rgba('#E6E1FF', 0.42), 0.75);
      ctx.lineWidth = 0.75;
      for (let i = 0; i < 4; i++) {
        const a = i * TAU / 4;
        const p0 = proj(0.14 * Math.cos(a), 0, 0.14 * Math.sin(a));
        const p1 = proj(0.97 * Math.cos(a), 0, 0.97 * Math.sin(a));
        ctx.strokeStyle = rgba(pal.lavender, 0.05);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      for (let i = 0; i < 72; i++) {
        const a = i * TAU / 72;
        const major = i % 18 === 0;
        const p0 = proj(1.03 * Math.cos(a), 0, 1.03 * Math.sin(a));
        const p1 = proj((major ? 1.07 : 1.046) * Math.cos(a), 0, (major ? 1.07 : 1.046) * Math.sin(a));
        ctx.strokeStyle = rgba(pal.lavender, (major ? 0.32 : 0.09) * (0.65 + 0.35 * (1 - p0.soft)));
        ctx.lineWidth = 0.75;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }

      // sweep: wedges in disc space, exponential phosphor decay
      const sa = f.sweep + view.az;
      if (f.trail > 0) {
        for (let k = 0; k < 56; k++) {
          const d0 = k * 0.05;
          const a = Math.exp(-d0 * 1.2) * 0.07 * f.trail;
          if (a < 0.003) break;
          ctx.fillStyle = rgba(k < 4 ? pal.lavender : pal.violet, a);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.ellipse(cx, cy, S, S * sy, 0, sa - d0 - 0.052, sa - d0);
          ctx.closePath();
          ctx.fill();
        }
        const tip = proj(Math.cos(f.sweep), 0, Math.sin(f.sweep));
        const lg = ctx.createLinearGradient(cx, cy, tip.x, tip.y);
        lg.addColorStop(0, rgba(pal.sky, 0));
        lg.addColorStop(0.5, rgba(pal.lavender, 0.45 * f.trail));
        lg.addColorStop(1, rgba(pal.sky, 0));
        ctx.strokeStyle = lg;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tip.x, tip.y); ctx.stroke();
      }
      if (f.pingA > 0 && f.ping < 1) ellipse(f.ping, rgba(pal.lavender, 0.4 * f.pingA * Math.pow(1 - f.ping, 1.6)), 1);

      // devices
      for (const d of f.devices) {
        const p = proj(d.x, 0, d.z);
        const c = d.kind === 'self' ? pal.mint : pal.lavender;
        ctx.fillStyle = rgba(c, d.kind === 'self' ? 0.85 : 0.5);
        ctx.beginPath(); ctx.arc(p.x, p.y, d.kind === 'self' ? 1.6 : 1.2, 0, TAU); ctx.fill();
      }

      // core
      const cp = proj(0, 0.05, 0);
      glow(cp.x, cp.y, S * 0.24, pal.lavender, 0.26 + 0.05 * f.breath);
      flatRing(0, 0, 0.085, pal.lavender, 0.4, 1);
      ctx.globalCompositeOperation = 'source-over';
      const og = ctx.createRadialGradient(cp.x - 2, cp.y - 3, 0, cp.x, cp.y, 9);
      og.addColorStop(0, '#FFFFFF'); og.addColorStop(0.25, '#D6CEFF'); og.addColorStop(1, rgba(pal.violet, 0));
      ctx.fillStyle = og;
      ctx.beginPath(); ctx.arc(cp.x, cp.y, 8, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';

      // beacons, far to near
      const list = f.beacons.map((b) => ({ b, p: proj(b.x, 0.02, b.z) })).sort((u, v) => u.p.zr - v.p.zr);
      for (const { b, p } of list) {
        const a = b.appear;
        if (a <= 0.001) continue;
        const col = colorOf(b.status);
        const fade = (1 - 0.55 * b.dim) * a;
        const soft = p.soft;
        const lit = b.lit;
        const hot = b.hot;
        if (b.status === 'risk') {
          for (let i = 0; i < 2; i++) {
            const ph = f.reduced ? 0.35 + i * 0.3 : (f.time / 3.2 + i / 2) % 1;
            flatRing(b.x, b.z, 0.03 + ph * 0.24, col, fade * Math.pow(1 - ph, 1.8) * 0.7, 1);
          }
        }
        if (PILLAR[b.status]) {
          const top = proj(b.x, PILLAR[b.status] * (0.3 + 0.7 * a), b.z);
          const lg = ctx.createLinearGradient(p.x, p.y, top.x, top.y);
          lg.addColorStop(0, rgba(col, 0.85 * fade * (0.8 + 0.5 * lit)));
          lg.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = lg;
          ctx.fillRect(p.x - 0.75, top.y, 1.5, p.y - top.y);
          const lg2 = ctx.createLinearGradient(p.x, p.y, top.x, top.y);
          lg2.addColorStop(0, rgba(col, 0.16 * fade));
          lg2.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = lg2;
          ctx.fillRect(p.x - 4, top.y, 8, p.y - top.y);
        }
        const base = b.status === 'risk' ? 24 : b.status === 'warn' ? 17 : b.status === 'ok' ? 10 : 9;
        const rad = base * (1 + 0.25 * lit + 0.3 * hot) * (1 + soft * 0.25);
        if (b.status === 'unknown' || b.status === 'checking') {
          flatRing(b.x, b.z, 0.026, col, fade * (b.status === 'checking' ? 0.95 : 0.6 + 0.4 * lit + 0.4 * hot), 1.1,
            b.status === 'checking' ? [3, 3] : null, b.status === 'checking' ? -f.time * 2.4 : 0);
          glow(p.x, p.y, rad, col, fade * 0.25);
        } else if (b.status === 'ok') {
          glow(p.x, p.y, rad, col, fade * (0.35 + 0.5 * lit + 0.3 * hot));
          ctx.globalCompositeOperation = 'source-over';
          const bg = ctx.createRadialGradient(p.x - 1.2, p.y - 1.5, 0, p.x, p.y, 4.5);
          bg.addColorStop(0, rgba('#FFFFFF', 0.95 * fade));
          bg.addColorStop(0.45, rgba(col, 0.75 * fade));
          bg.addColorStop(1, rgba(col, 0.25 * fade));
          ctx.fillStyle = bg;
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
        } else {
          glow(p.x, p.y, rad, col, fade * (0.55 + 0.6 * lit + 0.3 * hot));
          ctx.fillStyle = rgba('#FFFFFF', 0.9 * fade);
          ctx.beginPath(); ctx.arc(p.x, p.y, (b.status === 'risk' ? 2.6 : 2.1) * (1 - 0.3 * soft), 0, TAU); ctx.fill();
        }
        if (hot > 0.01) flatRing(b.x, b.z, 0.05, col, hot * a * 0.85, 1);
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    dispose() { canvas.remove(); },
  };
}
