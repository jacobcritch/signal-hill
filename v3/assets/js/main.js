(function () {
  "use strict";

  var yearEl = document.querySelector(".js-year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  var canvas = document.getElementById("field");
  if (!canvas) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ctx = canvas.getContext("2d", { alpha: true });

  // Signal Hill as a plotted series in logo space (y down).
  // The hill traces a Cabot Tower silhouette at the peak: squat castellated
  // main block, taller corner turret with a flared cap, flag, and a low entrance wing.
  var PATH = [
    [9, 28], [14, 26.6], [19, 24.8], [23, 23.2], [26, 21.5],
    [29, 17.2], [32.4, 13.0], [35.0, 10.55],
    [35.8, 9.85],
    // plinth
    [35.25, 9.85], [35.25, 8.95], [35.8, 8.95],
    // left wall + corbel
    [35.8, 5.85],
    [35.45, 5.85], [35.45, 5.40], [35.8, 5.40],
    // main-block merlons
    [35.8, 4.45],
    [36.95, 4.45], [36.95, 5.15], [37.45, 5.15],
    [37.45, 4.45], [38.60, 4.45], [38.60, 5.15], [39.10, 5.15],
    [39.10, 4.45], [40.25, 4.45], [40.25, 5.15], [40.75, 5.15],
    [40.75, 4.45], [41.90, 4.45], [41.90, 5.15],
    [42.40, 5.15],
    // turret left wall + flared cap
    [42.40, 2.55],
    [42.05, 2.55], [42.05, 2.15], [42.40, 2.15],
    [42.40, 1.45],
    [43.20, 1.45], [43.20, 1.95], [43.50, 1.95], [43.50, 1.45],
    [43.80, 1.45],
    // flagpole + small flag
    [43.80, 0.18], [45.20, 0.18], [45.20, 0.72], [43.80, 0.72], [43.80, 1.45],
    [44.15, 1.45], [44.15, 1.95], [44.45, 1.95], [44.45, 1.45],
    [45.25, 1.45],
    [45.25, 2.15], [45.60, 2.15], [45.60, 2.55], [45.25, 2.55],
    // lower entrance wing
    [45.25, 8.25], [46.25, 8.25], [46.25, 9.85],
    // seaward descent
    [48.2, 10.4], [52.4, 11.6], [58, 13.2]
  ];

  var PAPER = [239, 236, 230];
  var PAPER2 = [247, 245, 240];
  var INK = [22, 21, 19];
  var RUST = [232, 85, 46];
  var GRID = "rgba(22, 21, 19, 0.08)";
  var AXIS = "rgba(22, 21, 19, 0.32)";

  var T_CHAOS = 1600;
  var T_GATHER = 4800;
  var T_HOLD = 4200;
  var T_RELEASE = 2600;
  var T_CYCLE = T_CHAOS + T_GATHER + T_HOLD + T_RELEASE;

  var dpr = 1;
  var w = 0, h = 0;
  var count = 0;
  var x, y, vx, vy, tx, ty, delay, size, kind, seed;
  var bornX, bornY;
  var mouse = { x: 0, y: 0, tx: 0, ty: 0, on: false };
  var start = 0;
  var frozen = null; // ms into cycle, or null
  var running = false;
  var raf = 0;
  var last = 0;
  var visible = true;
  var rngState = 1;

  function mulberry() {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    var t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rand() { return mulberry(); }

  function color(rgb, a) {
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")";
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }

  function pathLength(pts) {
    var n = 0;
    for (var i = 1; i < pts.length; i++) {
      n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return n;
  }

  function samplePath(pts, t) {
    var total = pathLength(pts);
    var d = t * total, acc = 0;
    for (var i = 1; i < pts.length; i++) {
      var sx = pts[i - 1][0], sy = pts[i - 1][1];
      var ex = pts[i][0], ey = pts[i][1];
      var seg = Math.hypot(ex - sx, ey - sy);
      if (acc + seg >= d || i === pts.length - 1) {
        var u = seg ? (d - acc) / seg : 0;
        u = clamp(u, 0, 1);
        var px = lerp(sx, ex, u), py = lerp(sy, ey, u);
        var dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy) || 1;
        return { x: px, y: py, nx: -dy / len, ny: dx / len, t: t };
      }
      acc += seg;
    }
    var last = pts[pts.length - 1];
    return { x: last[0], y: last[1], nx: 0, ny: -1, t: 1 };
  }

  // Map the hill into the right-hand (or, on mobile, lower) stage element.
  function layout() {
    var stage = document.querySelector(".hero__stage");
    var r = stage ? stage.getBoundingClientRect() : null;
    var plot, left, right, top, bottom;
    if (r && r.width > 40 && r.height > 40) {
      var origin = canvas.getBoundingClientRect();
      plot = { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
    } else if (w < 860) {
      plot = { x: w * 0.08, y: h * 0.5, w: w * 0.84, h: h * 0.42 };
    } else {
      plot = { x: w * 0.52, y: h * 0.18, w: w * 0.4, h: h * 0.64 };
    }
    var axisL = Math.max(22, Math.min(36, plot.w * 0.07));
    var axisB = Math.max(18, Math.min(32, plot.h * 0.08));
    var axisT = Math.max(12, plot.h * 0.06);
    var axisR = Math.max(12, plot.w * 0.05);
    left = plot.x + axisL;
    right = plot.x + plot.w - axisR;
    top = plot.y + axisT;
    bottom = plot.y + plot.h - axisB;
    var boxW = Math.max(40, right - left);
    var boxH = Math.max(40, bottom - top);
    var sx = boxW / 56;
    var sy = boxH / 32;
    var s = Math.min(sx, sy);
    var pw = 56 * s, ph = 32 * s;
    var ox = left + (boxW - pw) / 2 - 6 * s;
    var oy = top + (boxH - ph) / 2 - 1 * s;
    return { s: s, ox: ox, oy: oy, left: left, right: right, top: top, bottom: bottom, plot: plot };
  }

  function drawPlot(L) {
    var p = L.plot;
    if (!p) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.fillStyle = color(PAPER2, 1);
    ctx.fillRect(p.x, p.y, p.w, p.h);

    // Graph-paper grid, origin at the axis corner
    var step = 28;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = L.left; gx <= L.right + 0.5; gx += step) {
      ctx.moveTo(Math.round(gx) + 0.5, p.y);
      ctx.lineTo(Math.round(gx) + 0.5, p.y + p.h);
    }
    for (var gy = L.bottom; gy >= p.y - 0.5; gy -= step) {
      ctx.moveTo(p.x, Math.round(gy) + 0.5);
      ctx.lineTo(p.x + p.w, Math.round(gy) + 0.5);
    }
    for (gy = L.bottom + step; gy <= p.y + p.h; gy += step) {
      ctx.moveTo(p.x, Math.round(gy) + 0.5);
      ctx.lineTo(p.x + p.w, Math.round(gy) + 0.5);
    }
    ctx.stroke();

    // Faint axes + ticks
    ctx.strokeStyle = AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L.left + 0.5, L.top);
    ctx.lineTo(L.left + 0.5, L.bottom + 0.5);
    ctx.lineTo(L.right, L.bottom + 0.5);
    ctx.stroke();
    ctx.beginPath();
    var tick = 5;
    for (gx = L.left + step; gx < L.right - 2; gx += step) {
      ctx.moveTo(Math.round(gx) + 0.5, L.bottom + 0.5);
      ctx.lineTo(Math.round(gx) + 0.5, L.bottom + 0.5 + tick);
    }
    for (gy = L.bottom - step; gy > L.top + 2; gy -= step) {
      ctx.moveTo(L.left + 0.5, Math.round(gy) + 0.5);
      ctx.lineTo(L.left + 0.5 - tick, Math.round(gy) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function toCanvas(lx, ly, L) {
    return { x: L.ox + lx * L.s, y: L.oy + ly * L.s };
  }

  function buildTargets(n) {
    var L = layout();
    var targets = [];
    var wanderN = Math.max(80, Math.floor(n * 0.16));
    var pathN = n - wanderN;

    for (var i = 0; i < pathN; i++) {
      var t = pathN <= 1 ? 0 : i / (pathN - 1);
      var jitterT = clamp(t + (rand() - 0.5) * 0.004, 0, 1);
      var s = samplePath(PATH, jitterT);
      // Tight to the polyline — a thin plotted series, not a scatter ridge.
      var spread = (rand() + rand() + rand() - 1.5) * L.s * 0.11;
      var p = toCanvas(s.x, s.y, L);
      targets.push({
        x: p.x + s.nx * spread,
        y: p.y + s.ny * spread,
        t: jitterT,
        kind: 0
      });
    }
    for (var j = 0; j < wanderN; j++) {
      targets.push({ x: rand() * w, y: rand() * h, t: rand(), kind: 2 });
    }
    return targets;
  }

  function seriesUntil(ph) {
    if (ph.name === "chaos") return 0;
    if (ph.name === "gather") return easeInOut(ph.local);
    if (ph.name === "hold") return 1;
    return 1 - ph.release;
  }

  function drawSeries(L, untilT) {
    if (!L || untilT <= 0.02) return;
    var pts = PATH;
    var total = pathLength(pts);
    var maxd = untilT * total;
    var startP = toCanvas(pts[0][0], pts[0][1], L);
    ctx.save();
    ctx.beginPath();
    ctx.lineJoin = "miter";
    ctx.miterLimit = 10;
    ctx.lineCap = "butt";
    ctx.strokeStyle = color(RUST, 0.96);
    ctx.lineWidth = Math.max(1.4, L.s * 0.2);
    ctx.moveTo(startP.x, startP.y);
    var drawn = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (drawn + seg <= maxd) {
        var p = toCanvas(b[0], b[1], L);
        ctx.lineTo(p.x, p.y);
        drawn += seg;
      } else {
        var u = (maxd - drawn) / (seg || 1);
        var q = toCanvas(lerp(a[0], b[0], u), lerp(a[1], b[1], u), L);
        ctx.lineTo(q.x, q.y);
        break;
      }
    }
    ctx.stroke();

    // Sparse markers: hill elbows and the flag tip, not the dense merlons.
    var acc = 0;
    var mark = Math.max(1.25, L.s * 0.18);
    ctx.fillStyle = color(RUST, 0.96);
    for (i = 0; i < pts.length; i++) {
      if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc / total > untilT + 0.002) break;
      var lx = pts[i][0], ly = pts[i][1];
      var isFlagTip = Math.abs(lx - 45.20) < 0.01 && Math.abs(ly - 0.18) < 0.01;
      var onHill = lx <= 35.0 || lx >= 48.2;
      if (!isFlagTip && !onHill) continue;
      var m = toCanvas(lx, ly, L);
      ctx.fillRect(m.x - mark, m.y - mark, mark * 2, mark * 2);
    }
    ctx.restore();
  }

  function alloc() {
    var area = w * h;
    var isMobile = w < 700 || ("ontouchstart" in window && w < 900);
    var target = isMobile ? 2200 : area > 4e5 ? 5600 : 4200;
    if (reduce) target = Math.min(target, 1800);
    count = target;
    x = new Float32Array(count);
    y = new Float32Array(count);
    vx = new Float32Array(count);
    vy = new Float32Array(count);
    tx = new Float32Array(count);
    ty = new Float32Array(count);
    delay = new Float32Array(count);
    size = new Float32Array(count);
    kind = new Uint8Array(count);
    seed = new Float32Array(count);
    bornX = new Float32Array(count);
    bornY = new Float32Array(count);
  }

  function seedParticles() {
    rngState = 0xC0FFEE;
    var targets = buildTargets(count);
    var L0 = layout();
    for (var i = 0; i < count; i++) {
      var t = targets[i] || { x: rand() * w, y: rand() * h, t: rand(), kind: 2 };
      tx[i] = t.x; ty[i] = t.y;
      kind[i] = t.kind;
      delay[i] = t.kind === 1 ? 0.72 + t.t * 0.25 : t.kind === 2 ? 1 : t.t;
      seed[i] = rand() * 100;
      size[i] = t.kind === 2 ? (1.05 + rand() * 1.1) : (0.85 + rand() * 0.55);
      if (t.kind === 2 || rand() < 0.28) {
        bornX[i] = rand() * w;
        bornY[i] = rand() * h;
      } else {
        bornX[i] = L0.left + rand() * Math.max(40, L0.right - L0.left);
        bornY[i] = L0.top + rand() * Math.max(40, L0.bottom - L0.top);
      }
      x[i] = bornX[i];
      y[i] = bornY[i];
      vx[i] = (rand() - 0.5) * 0.3;
      vy[i] = (rand() - 0.5) * 0.3;
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var host = canvas.parentElement || document.querySelector(".hero") || document.documentElement;
    w = Math.max(1, host.clientWidth || window.innerWidth);
    h = Math.max(1, host.clientHeight || window.innerHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    alloc();
    seedParticles();
    if (reduce) {
      snapResolved();
      draw(1);
    } else if (frozen != null) {
      seek(frozen);
    }
  }

  function flow(px, py, t) {
    var s = 0.0018;
    var n1 = Math.sin(px * s * 1.3 + t * 0.00035) + Math.cos(py * s * 1.1 - t * 0.00028);
    var n2 = Math.sin((px + py) * s * 0.7 - t * 0.00042);
    var a = n1 * 1.1 + n2 * 0.6;
    return { x: Math.cos(a) * 0.22, y: Math.sin(a * 0.9) * 0.22 };
  }

  function phaseAt(ms) {
    var t = ((ms % T_CYCLE) + T_CYCLE) % T_CYCLE;
    if (t < T_CHAOS) return { name: "chaos", t: t, local: t / T_CHAOS, pull: 0, release: 0 };
    t -= T_CHAOS;
    if (t < T_GATHER) return { name: "gather", t: t, local: t / T_GATHER, pull: easeInOut(t / T_GATHER), release: 0 };
    t -= T_GATHER;
    if (t < T_HOLD) return { name: "hold", t: t, local: t / T_HOLD, pull: 1, release: 0 };
    t -= T_HOLD;
    var rel = easeInOut(t / T_RELEASE);
    return { name: "release", t: t, local: t / T_RELEASE, pull: 1 - rel, release: rel };
  }

  function step(dt, now) {
    var elapsed = frozen != null ? frozen : (now - start);
    var ph = phaseAt(elapsed);
    var mx = mouse.x, my = mouse.y, mOn = mouse.on;
    var i, f, dx, dy, d2, d, force, px, py, formed, stagger, pull, fl;

    for (i = 0; i < count; i++) {
      px = x[i]; py = y[i];
      fl = flow(px, py, elapsed + seed[i] * 200);

      stagger = delay[i];
      if (ph.name === "gather") {
        formed = easeOut(clamp((ph.local - stagger * 0.78) / 0.28, 0, 1));
      } else if (ph.name === "hold") {
        formed = 1;
      } else if (ph.name === "release") {
        formed = 1 - ph.release;
      } else {
        formed = 0;
      }
      if (kind[i] === 2) formed *= 0.08;

      pull = formed * ph.pull;

      vx[i] += fl.x * (1.15 - pull * 0.95);
      vy[i] += fl.y * (1.15 - pull * 0.95);

      if (pull > 0.001 && kind[i] !== 2) {
        dx = tx[i] - px;
        dy = ty[i] - py;
        vx[i] += dx * (0.045 + pull * 0.09);
        vy[i] += dy * (0.045 + pull * 0.09);
      } else if (ph.name === "chaos" || (kind[i] === 2 && ph.pull < 1)) {
        // slowly roam
      }

      if (mOn) {
        dx = px - mx; dy = py - my;
        d2 = dx * dx + dy * dy;
        var r = 140;
        if (d2 < r * r && d2 > 0.1) {
          d = Math.sqrt(d2);
          force = (1 - d / r) * 0.55;
          vx[i] += (dx / d) * force;
          vy[i] += (dy / d) * force;
        }
      }

      vx[i] *= 0.9 - pull * 0.06;
      vy[i] *= 0.9 - pull * 0.06;
      x[i] += vx[i] * (dt / 16.67);
      y[i] += vy[i] * (dt / 16.67);

      // soft wrap during chaos so the field stays full
      if (pull < 0.2) {
        if (x[i] < -8) x[i] = w + 8;
        else if (x[i] > w + 8) x[i] = -8;
        if (y[i] < -8) y[i] = h + 8;
        else if (y[i] > h + 8) y[i] = -8;
      }
    }
  }

  function formedOf(i, ph) {
    var formed;
    if (ph.name === "gather") {
      formed = easeOut(clamp((ph.local - delay[i] * 0.78) / 0.28, 0, 1));
    } else if (ph.name === "hold") {
      formed = 1;
    } else if (ph.name === "release") {
      formed = 1 - ph.release;
    } else {
      formed = 0;
    }
    if (kind[i] === 2) formed *= 0.08;
    return formed;
  }

  function paintDot(i, ph) {
    var f = formedOf(i, ph);
    var s = size[i] * (0.95 + f * 0.2);
    if (s < 1.15) s = 1.15;
    var c, a;
    if (kind[i] === 2) {
      c = INK; a = 0.22;
    } else if (f > 0.65) {
      c = RUST; a = 0.42 + (f - 0.65) * 1.15;
    } else if (f > 0.25) {
      c = RUST; a = 0.22 + f * 0.45;
    } else {
      c = INK; a = 0.28 + f * 0.15;
    }
    ctx.fillStyle = color(c, clamp(a, 0.1, 0.94));
    ctx.fillRect(x[i] - s * 0.5, y[i] - s * 0.5, s, s);
  }

  function draw(now) {
    var elapsed = frozen != null ? frozen : (now - start);
    var ph = phaseAt(elapsed);
    var L = layout();

    ctx.clearRect(0, 0, w, h);
    drawPlot(L);

    var i;
    if (L.plot) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.plot.x, L.plot.y, L.plot.w, L.plot.h);
      ctx.clip();
    }
    for (i = 0; i < count; i++) paintDot(i, ph);
    drawSeries(L, seriesUntil(ph));
    if (L.plot) ctx.restore();
  }


  function snapResolved() {
    for (var i = 0; i < count; i++) {
      if (kind[i] === 2) continue;
      x[i] = tx[i];
      y[i] = ty[i];
      vx[i] = 0; vy[i] = 0;
    }
    frozen = T_CHAOS + T_GATHER + 200;
  }

  function resetCycle(at) {
    rngState = 0xC0FFEE;
    seedParticles();
    start = performance.now() - (at || 0);
    last = 0;
  }

  function seek(ms) {
    frozen = null;
    resetCycle(0);
    start = 0;
    last = 0;
    var dt = 1000 / 60;
    var t = 0;
    while (t < ms) {
      step(dt, t);
      t += dt;
    }
    frozen = ms;
    draw(ms);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    if (frozen != null) {
      // still allow a little cursor lag visual on a frozen resolved frame? no — hold still
      draw(now);
      return;
    }
    if (!last) last = now;
    var dt = Math.min(32, now - last);
    last = now;
    step(dt, now);
    draw(now);
  }

  function play() {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onPointer(e) {
    var p = e.touches ? e.touches[0] : e;
    if (!p) return;
    var cr = canvas.getBoundingClientRect();
    mouse.x = p.clientX - cr.left;
    mouse.y = p.clientY - cr.top;
    mouse.on = true;
  }

  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("touchmove", onPointer, { passive: true });
  window.addEventListener("pointerleave", function () { mouse.on = false; });
  window.addEventListener("blur", function () { mouse.on = false; });

  document.addEventListener("visibilitychange", function () {
    visible = document.visibilityState === "visible";
    if (visible && !reduce && frozen == null) last = 0;
  });

  var io = new IntersectionObserver(function (entries) {
    visible = entries[0] && entries[0].isIntersecting && document.visibilityState === "visible";
    if (visible && !reduce && frozen == null) last = 0;
  });
  io.observe(canvas);

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var keep = frozen;
      resize();
      if (keep != null) seek(keep);
      else if (!reduce) { start = performance.now(); last = 0; }
    }, 80);
  }
  var resizeTimer;
  window.addEventListener("resize", onResize);
  if (window.ResizeObserver) {
    var host = canvas.parentElement;
    if (host) new ResizeObserver(onResize).observe(host);
  }

  // Screenshot / debug hook: ?freeze=mid|resolved|chaos
  function parseFreeze(val) {
    if (!val) return null;
    if (val === "chaos") return 400;
    if (val === "mid") return T_CHAOS + T_GATHER * 0.52;
    if (val === "resolved") return T_CHAOS + T_GATHER + 400;
    var n = parseFloat(val);
    return isFinite(n) ? n : null;
  }

  window.__signalHill = {
    freeze: function (name) {
      var ms = parseFreeze(String(name));
      if (ms == null) { frozen = null; start = performance.now(); last = 0; return; }
      seek(ms);
    },
    times: { chaos: T_CHAOS, gather: T_GATHER, hold: T_HOLD, release: T_RELEASE, cycle: T_CYCLE }
  };

  resize();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      var keep = frozen;
      resize();
      if (keep != null) seek(keep);
    });
  }
  var query = new URLSearchParams(window.location.search).get("freeze");
  var want = parseFreeze(query);
  if (reduce) {
    snapResolved();
    draw(1);
  } else if (want != null) {
    seek(want);
    play(); // keep drawing the frozen frame (in case of later resize)
  } else {
    start = performance.now();
    play();
  }
})();
