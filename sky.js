// Pixel night sky on a low-resolution canvas scaled with `image-rendering: pixelated`.
// Ported from Safai's landing PixelSky. The sky and the hill are painted once into offscreen
// layers; a frame only blits them, redraws the twinkling stars and moves at most two comets.
// The loop stops while the tab is hidden and never starts under prefers-reduced-motion.
(() => {
  "use strict";
  const canvas = document.querySelector(".pixel-sky");
  const ctx = canvas && canvas.getContext("2d", { alpha: false });
  if (!canvas || !ctx) return;

  const PIXEL = 3;
  const DENSITY = 0.55;
  const COMET_LIFE = 200;
  const MAX_COMETS = 2;
  const FRAME_MS = 1000 / 30;
  const UNIT_MS = 1000 / 60;

  const PALETTE = {
    grad: ["#04061a", "#0a1132", "#15245a"],
    haze: [70, 115, 205, 0.22],
    moonHaze: [246, 199, 104, 0.05],
    starBright: [255, 252, 255],
    starDim: [226, 238, 255],
    starArm: [190, 215, 255],
    trail: [216, 234, 255],
    head: [255, 255, 255],
    headHalo: [226, 240, 255],
    headRing: [160, 200, 255],
    ridge: "#050818",
    ridgeGlow: [22, 34, 84],
  };

  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
  const layer = () => document.createElement("canvas");

  let rng = 1;
  const random = () => {
    rng = (rng + 0x6d2b79f5) | 0;
    let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (a, b) => a + random() * (b - a);

  let w = 0;
  let h = 0;
  let stars = [];
  let twinklers = [];
  let comets = [];
  let nextComet = 0;
  let base = null;
  let ridge = null;
  let raf = 0;
  let last = 0;
  let clock = 0;

  function buildStars() {
    rng = 20261105;
    const count = Math.round(((w * h) / 240) * DENSITY);
    stars = [];
    for (let i = 0; i < count; i++) {
      const b = Math.pow(random(), 2.6);
      stars.push({
        x: Math.floor(random() * w),
        y: Math.floor(random() * h * 0.9),
        b: 0.16 + b * 0.84,
        big: b > 0.82,
        tw: random() < 0.34,
        ph: random() * Math.PI * 2,
        sp: range(0.6, 1.6),
      });
    }
    twinklers = stars.filter((s) => s.tw);
  }

  function drawStar(c, s, a) {
    c.fillStyle = rgba(s.big ? PALETTE.starBright : PALETTE.starDim, a);
    c.fillRect(s.x, s.y, 1, 1);
    if (!s.big) return;
    c.fillRect(s.x + 1, s.y, 1, 1);
    c.fillRect(s.x, s.y + 1, 1, 1);
    c.fillRect(s.x + 1, s.y + 1, 1, 1);
    c.fillStyle = rgba(PALETTE.starArm, a * 0.3);
    c.fillRect(s.x - 1, s.y, 1, 1);
    c.fillRect(s.x + 2, s.y, 1, 1);
    c.fillRect(s.x, s.y - 1, 1, 1);
    c.fillRect(s.x, s.y + 2, 1, 1);
  }

  function paintBase() {
    base = layer();
    base.width = w;
    base.height = h;
    const c = base.getContext("2d", { alpha: false });
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, PALETTE.grad[0]);
    g.addColorStop(0.42, PALETTE.grad[1]);
    g.addColorStop(1, PALETTE.grad[2]);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    const [hr, hg, hb, ha] = PALETTE.haze;
    const haze = c.createRadialGradient(w * 0.1, h * 1.02, 0, w * 0.1, h * 1.02, w * 0.55);
    haze.addColorStop(0, `rgba(${hr},${hg},${hb},${ha})`);
    haze.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
    c.fillStyle = haze;
    c.fillRect(0, 0, w, h);
    const [mr, mg, mb, ma] = PALETTE.moonHaze;
    const moon = c.createRadialGradient(w * 0.82, h * 0.18, 0, w * 0.82, h * 0.18, w * 0.4);
    moon.addColorStop(0, `rgba(${mr},${mg},${mb},${ma})`);
    moon.addColorStop(1, `rgba(${mr},${mg},${mb},0)`);
    c.fillStyle = moon;
    c.fillRect(0, 0, w, h);
    for (const s of stars) if (!s.tw) drawStar(c, s, s.b);
  }

  function paintRidge() {
    ridge = layer();
    ridge.width = w;
    ridge.height = h;
    const c = ridge.getContext("2d");
    const top = Math.round(h * 0.88);
    c.fillStyle = PALETTE.ridge;
    for (let x = 0; x < w; x++) {
      const j = Math.round(
        Math.sin(x * 0.21) * 1.6 + Math.sin(x * 0.061) * 2.4 + Math.sin(x * 0.013) * 3,
      );
      c.fillRect(x, top + j, 1, h - top - j);
    }
    const g = c.createLinearGradient(0, top - 4, 0, h);
    g.addColorStop(0, rgba(PALETTE.ridgeGlow, 0.5));
    g.addColorStop(1, rgba(PALETTE.ridgeGlow, 0));
    c.fillStyle = g;
    c.fillRect(0, top - 4, w, h - top + 4);
  }

  function spawnComet() {
    const fromLeft = random() < 0.45;
    const ang = fromLeft ? range(0.5, 0.72) : range(2.42, 2.64);
    const speed = range(0.5, 0.85);
    comets.push({
      x: fromLeft ? range(-0.05, 0.35) * w : range(0.6, 1.05) * w,
      y: range(-0.08, 0.3) * h,
      dx: Math.cos(ang) * speed,
      dy: Math.sin(ang) * speed,
      len: Math.round(range(0.16, 0.3) * Math.max(w, h)),
      peak: range(0.6, 0.95),
      age: 0,
    });
  }

  function drawComets() {
    for (const c of comets) {
      const fade = Math.min(1, c.age / 14) * Math.max(0, 1 - c.age / (COMET_LIFE - 10));
      if (fade <= 0) continue;
      const m = Math.hypot(c.dx, c.dy) || 1;
      const nx = -c.dx / m;
      const ny = -c.dy / m;
      for (let i = 1; i <= c.len; i++) {
        const px = Math.round(c.x + nx * i);
        const py = Math.round(c.y + ny * i);
        if (px < -2 || py < -2 || px > w + 2 || py > h + 2) continue;
        const a = c.peak * fade * Math.pow(1 - i / c.len, 1.9);
        if (a < 0.012) continue;
        ctx.fillStyle = rgba(PALETTE.trail, a);
        ctx.fillRect(px, py, 1, 1);
      }
      const hx = Math.round(c.x);
      const hy = Math.round(c.y);
      ctx.fillStyle = rgba(PALETTE.head, 0.95 * fade);
      ctx.fillRect(hx, hy, 2, 2);
      ctx.fillStyle = rgba(PALETTE.headHalo, 0.5 * fade);
      ctx.fillRect(hx - 1, hy, 1, 2);
      ctx.fillRect(hx + 2, hy, 1, 2);
      ctx.fillRect(hx, hy - 1, 2, 1);
      ctx.fillRect(hx, hy + 2, 2, 1);
      ctx.fillStyle = rgba(PALETTE.headRing, 0.2 * fade);
      ctx.fillRect(hx - 2, hy, 1, 2);
      ctx.fillRect(hx + 3, hy, 1, 2);
      ctx.fillRect(hx, hy - 2, 2, 1);
      ctx.fillRect(hx, hy + 3, 2, 1);
    }
  }

  function paint(motion) {
    ctx.drawImage(base, 0, 0);
    for (const s of twinklers) {
      const a = motion ? s.b * (0.68 + 0.32 * Math.sin(clock * 0.0011 * s.sp + s.ph)) : s.b;
      drawStar(ctx, s, a);
    }
    drawComets();
    ctx.drawImage(ridge, 0, 0);
  }

  function step(dt) {
    clock += dt;
    if (clock > nextComet && comets.length < MAX_COMETS) {
      spawnComet();
      nextComet = clock + range(3800, 10500) * 2;
    }
    const k = dt / UNIT_MS;
    for (const c of comets) {
      c.x += c.dx * k;
      c.y += c.dy * k;
      c.age += k;
    }
    comets = comets.filter(
      (c) => c.age < COMET_LIFE && c.y < h + c.len && c.x > -c.len && c.x < w + c.len,
    );
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = now - last;
    if (dt < FRAME_MS) return;
    last = now;
    step(Math.min(dt, 100));
    paint(true);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function start() {
    stop();
    if (!base) return;
    if (reducedQuery.matches) {
      comets = [];
      spawnComet();
      const c = comets[0];
      c.x += c.dx * 60;
      c.y += c.dy * 60;
      c.age = 40;
      paint(false);
      return;
    }
    if (document.hidden) return;
    comets = [];
    clock = 0;
    nextComet = 900;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const nw = Math.max(8, Math.ceil(rect.width / PIXEL));
    const nh = Math.max(8, Math.ceil(rect.height / PIXEL));
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false;
    buildStars();
    paintBase();
    paintRidge();
    start();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (!raf) start();
  });
  const onMotionChange = () => start();
  if (reducedQuery.addEventListener) reducedQuery.addEventListener("change", onMotionChange);
  else reducedQuery.addListener(onMotionChange);

  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }
  resize();
})();
