(function () {
  "use strict";

  var field = document.getElementById("field");
  var overlay = document.getElementById("overlay");
  if (!field) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Signal Hill + Cabot Tower in logo space (y down). Same polyline as the main site.
  var PATH = [
    [9, 28], [14, 26.6], [19, 24.8], [23, 23.2], [26, 21.5],
    [29, 17.2], [32.4, 13.0], [35.0, 10.55],
    [35.8, 9.85],
    [35.25, 9.85], [35.25, 8.95], [35.8, 8.95],
    [35.8, 5.85],
    [35.45, 5.85], [35.45, 5.40], [35.8, 5.40],
    [35.8, 4.45],
    [36.95, 4.45], [36.95, 5.15], [37.45, 5.15],
    [37.45, 4.45], [38.60, 4.45], [38.60, 5.15], [39.10, 5.15],
    [39.10, 4.45], [40.25, 4.45], [40.25, 5.15], [40.75, 5.15],
    [40.75, 4.45], [41.90, 4.45], [41.90, 5.15],
    [42.40, 5.15],
    [42.40, 2.55],
    [42.05, 2.55], [42.05, 2.15], [42.40, 2.15],
    [42.40, 1.45],
    [43.20, 1.45], [43.20, 1.95], [43.50, 1.95], [43.50, 1.45],
    [43.80, 1.45],
    [43.80, 0.18], [45.20, 0.18], [45.20, 0.72], [43.80, 0.72], [43.80, 1.45],
    [44.15, 1.45], [44.15, 1.95], [44.45, 1.95], [44.45, 1.45],
    [45.25, 1.45],
    [45.25, 2.15], [45.60, 2.15], [45.60, 2.55], [45.25, 2.55],
    [45.25, 8.25], [46.25, 8.25], [46.25, 9.85],
    [48.2, 10.4], [52.4, 11.6], [58, 13.2]
  ];

  var BG = [7, 7, 6];
  var INK = [232, 228, 220];
  var RUST = [232, 85, 46];

  var T_INTRO = 2600;
  var T_CHAOS = 5400;
  var T_GATHER = 7000;
  var T_HOLD = 5200;
  var T_RELEASE = 4000;
  var T_CYCLE = T_CHAOS + T_GATHER + T_HOLD + T_RELEASE;

  var dpr = 1, w = 0, h = 0, count = 0;
  var x, y, vx, vy, tx, ty, delay, size, kind, seed;
  var mouse = { x: 0, y: 0, cx: 0, cy: 0, on: false };
  var start = 0, last = 0, frozen = null, running = false, raf = 0, visible = true;
  var rngState = 1;
  var renderer = null;
  var octx = overlay ? overlay.getContext("2d") : null;
  var pathTotal = 0;
  var pathCum = [];

  var wordmark = document.querySelector("[data-wordmark]");
  var scanEl = document.querySelector(".scan");
  var crossEl = document.querySelector("[data-crosshair]");
  var telState = document.querySelector("[data-tel-state]");
  var telMode = document.querySelector("[data-tel-mode]");
  var telSnr = document.querySelector("[data-tel-snr]");
  var telClock = document.querySelector("[data-tel-clock]");
  var hudLast = 0;

  function mulberry() {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    var t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rand() { return mulberry(); }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function color(rgb, a) {
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")";
  }

  // Value noise + curl. Cheap enough for tens of thousands of particles.
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function hash2(ix, iy) {
    var n = Math.imul(ix, 1274126177) ^ Math.imul(iy + 0x9e3779b9, 1640531513);
    n = Math.imul(n ^ (n >>> 16), 2246822519);
    return (n >>> 0) / 4294967296;
  }
  function noise2(x, y) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var u = fade(fx), v = fade(fy);
    var a = hash2(x0, y0), b = hash2(x0 + 1, y0);
    var c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y) {
    var n = noise2(x, y);
    n += noise2(x * 2.03, y * 2.03) * 0.5;
    n += noise2(x * 4.07, y * 4.07) * 0.25;
    return n;
  }
  function curlAt(px, py, t, s) {
    var z = t * 0.00013;
    var x = px * s, y = py * s + z;
    var e = 0.012;
    var n1 = fbm(x, y + e);
    var n2 = fbm(x, y - e);
    var n3 = fbm(x + e, y);
    var n4 = fbm(x - e, y);
    var inv = 1 / (2 * e);
    return { x: (n1 - n2) * inv, y: (n4 - n3) * inv };
  }
  function curl(px, py, t) {
    var a = curlAt(px, py, t, 0.00215);
    var b = curlAt(px, py, t * 0.7 + 40, 0.0007);
    return { x: a.x * 0.55 + b.x * 1.05, y: a.y * 0.55 + b.y * 1.05 };
  }

  function buildPathMeta() {
    pathCum = [0];
    pathTotal = 0;
    for (var i = 1; i < PATH.length; i++) {
      pathTotal += Math.hypot(PATH[i][0] - PATH[i - 1][0], PATH[i][1] - PATH[i - 1][1]);
      pathCum.push(pathTotal);
    }
  }
  buildPathMeta();

  function samplePath(t) {
    var d = clamp(t, 0, 1) * pathTotal, acc = 0;
    for (var i = 1; i < PATH.length; i++) {
      var sx = PATH[i - 1][0], sy = PATH[i - 1][1];
      var ex = PATH[i][0], ey = PATH[i][1];
      var seg = pathCum[i] - pathCum[i - 1];
      if (acc + seg >= d || i === PATH.length - 1) {
        var u = seg ? (d - acc) / seg : 0;
        u = clamp(u, 0, 1);
        var dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy) || 1;
        return { x: lerp(sx, ex, u), y: lerp(sy, ey, u), nx: -dy / len, ny: dx / len, t: t };
      }
      acc += seg;
    }
    var lastP = PATH[PATH.length - 1];
    return { x: lastP[0], y: lastP[1], nx: 0, ny: -1, t: 1 };
  }

  function layout() {
    var mobile = w < 700;
    var padX = Math.max(36, w * (mobile ? 0.1 : 0.16));
    var padY = Math.max(56, h * (mobile ? 0.18 : 0.22));
    var boxW = Math.max(40, w - padX * 2);
    var boxH = Math.max(40, h - padY * 2);
    var s = Math.min(boxW / 56, boxH / 32);
    var pw = 56 * s, ph = 32 * s;
    var ox = (w - pw) / 2 - 6 * s;
    var oy = (h - ph) / 2 - 1 * s + h * 0.015;
    return { s: s, ox: ox, oy: oy };
  }
  function toCanvas(lx, ly, L) {
    return { x: L.ox + lx * L.s, y: L.oy + ly * L.s };
  }

  function phaseAt(ms) {
    if (!reduce && ms < T_INTRO) {
      return { name: "intro", t: ms, local: ms / T_INTRO, pull: 0, release: 0, stroke: 0 };
    }
    var t = reduce ? ms : ms - T_INTRO;
    t = ((t % T_CYCLE) + T_CYCLE) % T_CYCLE;
    if (t < T_CHAOS) return { name: "chaos", t: t, local: t / T_CHAOS, pull: 0, release: 0, stroke: 0 };
    t -= T_CHAOS;
    if (t < T_GATHER) {
      var g = easeInOut(t / T_GATHER);
      return { name: "gather", t: t, local: t / T_GATHER, pull: g, release: 0, stroke: g };
    }
    t -= T_GATHER;
    if (t < T_HOLD) return { name: "hold", t: t, local: t / T_HOLD, pull: 1, release: 0, stroke: 1 };
    t -= T_HOLD;
    var rel = easeInOut(t / T_RELEASE);
    return { name: "release", t: t, local: t / T_RELEASE, pull: 1 - rel, release: rel, stroke: 1 - rel };
  }

  function targetCount() {
    var mobile = w < 700 || ("ontouchstart" in window && w < 900);
    var gl = renderer && renderer.kind === "webgl";
    if (reduce) return mobile ? 900 : 1600;
    if (gl) return mobile ? 9000 : 28000;
    return mobile ? 2800 : 8000;
  }

  function alloc() {
    count = targetCount();
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
  }

  function seedParticles() {
    rngState = 0xC0FFEE;
    var L = layout();
    var wanderN = Math.max(80, Math.floor(count * 0.14));
    var pathN = count - wanderN;
    var i;
    for (i = 0; i < pathN; i++) {
      var t = pathN <= 1 ? 0 : i / (pathN - 1);
      var jitterT = clamp(t + (rand() - 0.5) * 0.004, 0, 1);
      var s = samplePath(jitterT);
      var spread = (rand() + rand() + rand() - 1.5) * L.s * 0.1;
      var p = toCanvas(s.x, s.y, L);
      tx[i] = p.x + s.nx * spread;
      ty[i] = p.y + s.ny * spread;
      delay[i] = jitterT;
      kind[i] = 0;
      seed[i] = rand() * 100;
      size[i] = 1.35 + rand() * 0.9;
      x[i] = rand() * w;
      y[i] = rand() * h;
      vx[i] = (rand() - 0.5) * 0.4;
      vy[i] = (rand() - 0.5) * 0.4;
    }
    for (i = pathN; i < count; i++) {
      tx[i] = rand() * w;
      ty[i] = rand() * h;
      delay[i] = 1;
      kind[i] = 2;
      seed[i] = rand() * 100;
      size[i] = 1.15 + rand() * 1.05;
      x[i] = rand() * w;
      y[i] = rand() * h;
      vx[i] = (rand() - 0.5) * 0.4;
      vy[i] = (rand() - 0.5) * 0.4;
    }
  }

  function snapLocked() {
    for (var i = 0; i < count; i++) {
      if (kind[i] === 2) continue;
      x[i] = tx[i];
      y[i] = ty[i];
      vx[i] = 0;
      vy[i] = 0;
    }
  }

  function formedOf(i, ph) {
    var formed;
    if (ph.name === "intro" || ph.name === "chaos") formed = 0;
    else if (ph.name === "gather") {
      formed = easeOut(clamp((ph.local - delay[i] * 0.78) / 0.28, 0, 1));
    } else if (ph.name === "hold") formed = 1;
    else formed = 1 - ph.release;
    if (kind[i] === 2) formed *= 0.06;
    return formed;
  }

  function step(dt, now) {
    var elapsed = frozen != null ? frozen : now - start;
    var ph = phaseAt(elapsed);
    var Lscale = dt / 16.67;
    var i, pul, fl, dx, dy, d2, d, force, formed;
    var mx = mouse.x, my = mouse.y, mOn = mouse.on;
    var flowAmp = ph.name === "hold" ? 0.22 : 1;

    for (i = 0; i < count; i++) {
      fl = curl(x[i], y[i], elapsed + seed[i] * 180);
      formed = formedOf(i, ph);
      pul = formed * ph.pull;

      vx[i] += fl.x * (0.85 * flowAmp) * (1.05 - pul * 0.96);
      vy[i] += fl.y * (0.85 * flowAmp) * (1.05 - pul * 0.96);

      if (pul > 0.001 && kind[i] !== 2) {
        dx = tx[i] - x[i];
        dy = ty[i] - y[i];
        vx[i] += dx * (0.04 + pul * 0.1);
        vy[i] += dy * (0.04 + pul * 0.1);
      }

      if (mOn) {
        dx = x[i] - mx;
        dy = y[i] - my;
        d2 = dx * dx + dy * dy;
        var rad = 130;
        if (d2 < rad * rad && d2 > 0.2) {
          d = Math.sqrt(d2);
          force = (1 - d / rad) * (0.7 - pul * 0.45);
          vx[i] += (dx / d) * force;
          vy[i] += (dy / d) * force;
        }
      }

      vx[i] *= 0.935 - pul * 0.08;
      vy[i] *= 0.935 - pul * 0.08;
      x[i] += vx[i] * Lscale;
      y[i] += vy[i] * Lscale;

      if (pul < 0.25) {
        if (x[i] < -10) x[i] = w + 10;
        else if (x[i] > w + 10) x[i] = -10;
        if (y[i] < -10) y[i] = h + 10;
        else if (y[i] > h + 10) y[i] = -10;
      }
    }
  }

  /* ---------- WebGL renderer ---------- */
  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  function program(gl, vsSrc, fsSrc) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  function createWebGL(canvas) {
    var gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance"
    });
    if (!gl) return null;

    var prog = program(gl,
      "attribute vec2 a_pos;\n" +
      "attribute float a_size;\n" +
      "attribute vec4 a_col;\n" +
      "uniform vec2 u_res;\n" +
      "uniform float u_dpr;\n" +
      "varying vec4 v_col;\n" +
      "void main(){\n" +
      "  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;\n" +
      "  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);\n" +
      "  gl_PointSize = max(a_size * u_dpr, 1.0);\n" +
      "  v_col = a_col;\n" +
      "}",
      "precision mediump float;\n" +
      "varying vec4 v_col;\n" +
      "void main(){\n" +
      "  vec2 p = gl_PointCoord - 0.5;\n" +
      "  float d = dot(p,p);\n" +
      "  if (d > 0.25) discard;\n" +
      "  float a = smoothstep(0.25, 0.04, d);\n" +
      "  gl_FragColor = vec4(v_col.rgb * v_col.a * a, v_col.a * a);\n" +
      "}"
    );
    if (!prog) return null;

    var buf = gl.createBuffer();
    var locPos = gl.getAttribLocation(prog, "a_pos");
    var locSize = gl.getAttribLocation(prog, "a_size");
    var locCol = gl.getAttribLocation(prog, "a_col");
    var uRes = gl.getUniformLocation(prog, "u_res");
    var uDpr = gl.getUniformLocation(prog, "u_dpr");
    var data = null;

    function resize() {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function draw(ph) {
      var need = count * 7;
      if (!data || data.length !== need) data = new Float32Array(need);
      var i, o, f, a, r, g, b, s;
      for (i = 0; i < count; i++) {
        f = formedOf(i, ph);
        if (kind[i] === 2) {
          r = INK[0] / 255; g = INK[1] / 255; b = INK[2] / 255;
          a = 0.32;
          s = size[i];
        } else if (f > 0.65) {
          r = RUST[0] / 255; g = RUST[1] / 255; b = RUST[2] / 255;
          a = 0.4 + (f - 0.65) * 1.1;
          s = size[i] * (0.95 + f * 0.15);
        } else if (f > 0.2) {
          r = lerp(INK[0], RUST[0], f) / 255;
          g = lerp(INK[1], RUST[1], f) / 255;
          b = lerp(INK[2], RUST[2], f) / 255;
          a = 0.2 + f * 0.45;
          s = size[i];
        } else {
          r = INK[0] / 255; g = INK[1] / 255; b = INK[2] / 255;
          a = 0.38 + f * 0.15;
          s = size[i];
        }
        o = i * 7;
        data[o] = x[i];
        data[o + 1] = y[i];
        data[o + 2] = s;
        data[o + 3] = r;
        data[o + 4] = g;
        data[o + 5] = b;
        data[o + 6] = clamp(a, 0.06, 0.95);
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(BG[0] / 255, BG[1] / 255, BG[2] / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(prog);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uDpr, dpr);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      var stride = 28;
      gl.enableVertexAttribArray(locPos);
      gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(locSize);
      gl.vertexAttribPointer(locSize, 1, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(locCol);
      gl.vertexAttribPointer(locCol, 4, gl.FLOAT, false, stride, 12);
      gl.drawArrays(gl.POINTS, 0, count);
    }

    resize();
    return { kind: "webgl", draw: draw, resize: resize, gl: gl };
  }

  function createCanvas2D(canvas) {
    var ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;
    function draw(ph) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var trail = ph.name === "chaos" || ph.name === "intro" || (ph.name === "gather" && ph.local < 0.55) || ph.name === "release";
      if (trail) {
        ctx.fillStyle = "rgba(" + BG[0] + "," + BG[1] + "," + BG[2] + ",0.2)";
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.fillStyle = color(BG, 1);
        ctx.fillRect(0, 0, w, h);
      }
      var i, f, c, a, s;
      for (i = 0; i < count; i++) {
        f = formedOf(i, ph);
        if (kind[i] === 2) { c = INK; a = 0.32; }
        else if (f > 0.65) { c = RUST; a = 0.4 + (f - 0.65) * 1.1; }
        else if (f > 0.2) { c = RUST; a = 0.2 + f * 0.45; }
        else { c = INK; a = 0.38 + f * 0.15; }
        s = size[i] * (0.95 + f * 0.15);
        if (s < 0.9) s = 0.9;
        ctx.fillStyle = color(c, clamp(a, 0.08, 0.94));
        ctx.fillRect(x[i] - s * 0.5, y[i] - s * 0.5, s, s);
      }
    }
    return { kind: "2d", draw: draw, resize: function () {}, ctx: ctx };
  }

  function drawStroke(ph) {
    if (!octx) return;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, w, h);
    var until = ph.stroke || 0;
    if (until <= 0.02) return;
    var L = layout();
    var maxd = until * pathTotal;
    var startP = toCanvas(PATH[0][0], PATH[0][1], L);
    octx.save();
    octx.beginPath();
    octx.lineJoin = "miter";
    octx.miterLimit = 10;
    octx.lineCap = "butt";
    octx.strokeStyle = color(RUST, 0.96);
    octx.lineWidth = Math.max(1.25, L.s * 0.18);
    octx.moveTo(startP.x, startP.y);
    var drawn = 0, i;
    for (i = 1; i < PATH.length; i++) {
      var a = PATH[i - 1], b = PATH[i];
      var seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (drawn + seg <= maxd) {
        var p = toCanvas(b[0], b[1], L);
        octx.lineTo(p.x, p.y);
        drawn += seg;
      } else {
        var u = (maxd - drawn) / (seg || 1);
        var q = toCanvas(lerp(a[0], b[0], u), lerp(a[1], b[1], u), L);
        octx.lineTo(q.x, q.y);
        break;
      }
    }
    octx.stroke();

    var acc = 0;
    var mark = Math.max(1.15, L.s * 0.16);
    octx.fillStyle = color(RUST, 0.96);
    for (i = 0; i < PATH.length; i++) {
      if (i > 0) acc += Math.hypot(PATH[i][0] - PATH[i - 1][0], PATH[i][1] - PATH[i - 1][1]);
      if (acc / pathTotal > until + 0.002) break;
      var lx = PATH[i][0], ly = PATH[i][1];
      var isFlagTip = Math.abs(lx - 45.20) < 0.01 && Math.abs(ly - 0.18) < 0.01;
      var onHill = lx <= 35.0 || lx >= 48.2;
      if (!isFlagTip && !onHill) continue;
      var m = toCanvas(lx, ly, L);
      octx.fillRect(m.x - mark, m.y - mark, mark * 2, mark * 2);
    }
    octx.restore();
  }

  /* ---------- HUD / intro ---------- */
  function prepWordmark() {
    if (!wordmark || wordmark.dataset.prepped) return;
    var text = wordmark.textContent;
    wordmark.textContent = "";
    for (var i = 0; i < text.length; i++) {
      var s = document.createElement("span");
      s.className = "ch";
      s.textContent = text[i] === " " ? "\u00a0" : text[i];
      wordmark.appendChild(s);
    }
    wordmark.dataset.prepped = "1";
  }

  function typeWordmark(ms) {
    if (!wordmark) return;
    var chars = wordmark.querySelectorAll(".ch");
    if (reduce) {
      wordmark.classList.add("is-typed");
      return;
    }
    var t0 = 520, stepMs = 68;
    var all = true;
    for (var i = 0; i < chars.length; i++) {
      var on = ms >= t0 + i * stepMs;
      chars[i].style.opacity = on ? "1" : "0";
      if (!on) all = false;
    }
    if (all) wordmark.classList.add("is-typed");
  }

  function pad(n, z) {
    z = z || 2;
    var s = String(n);
    while (s.length < z) s = "0" + s;
    return s;
  }

  function decorativeSnr(ph, elapsed) {
    var base = 0.03;
    if (ph.name === "intro") base = 0.02 + ph.local * 0.03;
    else if (ph.name === "chaos") base = 0.05 + Math.sin(elapsed * 0.0011) * 0.03 + ph.local * 0.04;
    else if (ph.name === "gather") base = 0.12 + easeInOut(ph.local) * 0.8;
    else if (ph.name === "hold") base = 0.94 + Math.sin(elapsed * 0.0022) * 0.02;
    else base = 0.92 * (1 - easeInOut(ph.release)) + 0.04;
    var j = (hash2(Math.floor(elapsed / 80), 17) - 0.5) * 0.012;
    return clamp(base + j, 0, 0.999);
  }

  function updateHud(ph, elapsed, force) {
    if (!force && elapsed - hudLast < 80 && ph.name !== "intro") return;
    hudLast = elapsed;

    var ready = reduce || elapsed >= T_INTRO - 200;
    document.body.classList.toggle("is-ready", ready);
    document.body.classList.toggle("is-locked", ph.name === "hold");
    document.body.classList.toggle("is-static", !!reduce);

    typeWordmark(ph.name === "intro" ? ph.t : 99999);

    if (scanEl) {
      if (ph.name === "intro" && ph.t > 260 && ph.t < 1500) {
        var u = (ph.t - 260) / 1240;
        scanEl.style.opacity = String(Math.sin(u * Math.PI) * 0.95);
        scanEl.style.top = (u * 100) + "vh";
      } else {
        scanEl.style.opacity = "0";
      }
    }

    var fieldOp = 1;
    if (!reduce && ph.name === "intro") fieldOp = clamp((ph.t - 860) / 1100, 0, 1);
    field.style.opacity = String(fieldOp);
    if (overlay) overlay.style.opacity = String(fieldOp);

    var state = "STANDBY";
    var mode = "FIELD  ·  IDLE";
    if (ph.name === "intro") { state = "BOOT"; mode = "FIELD  ·  INIT"; }
    else if (ph.name === "chaos") { state = "LIVE"; mode = "FIELD  ·  CHAOS"; }
    else if (ph.name === "gather") { state = "ACQUIRE"; mode = "FIELD  ·  CONVERGE"; }
    else if (ph.name === "hold") { state = "LOCK"; mode = "FIELD  ·  SIGNAL"; }
    else if (ph.name === "release") { state = "RELEASE"; mode = "FIELD  ·  DISPERSE"; }
    if (telState) telState.textContent = state;
    if (telMode) telMode.textContent = mode;
    if (telSnr) telSnr.textContent = decorativeSnr(ph, elapsed).toFixed(3);

    if (telClock) {
      var d = new Date();
      telClock.textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    }
  }

  function updateCrosshair() {
    if (!crossEl) return;
    var targetX = mouse.on ? mouse.x : w * 0.5;
    var targetY = mouse.on ? mouse.y : h * 0.5;
    mouse.cx = lerp(mouse.cx || targetX, targetX, 0.22);
    mouse.cy = lerp(mouse.cy || targetY, targetY, 0.22);
    crossEl.style.transform = "translate(" + mouse.cx + "px," + mouse.cy + "px)";
    crossEl.classList.toggle("is-on", mouse.on);
  }

  function draw(now) {
    var elapsed = frozen != null ? frozen : now - start;
    var ph = phaseAt(elapsed);
    if (renderer) renderer.draw(ph);
    drawStroke(ph);
    updateHud(ph, elapsed, false);
    updateCrosshair();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, window.innerWidth);
    h = Math.max(1, window.innerHeight);
    function sizeCanvas(c) {
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      c.style.width = w + "px";
      c.style.height = h + "px";
    }
    sizeCanvas(field);
    if (overlay) sizeCanvas(overlay);
    if (!renderer) {
      renderer = createWebGL(field) || createCanvas2D(field);
    } else if (renderer.resize) {
      renderer.resize();
    }
    alloc();
    seedParticles();
    if (reduce) {
      snapLocked();
      frozen = T_INTRO + T_CHAOS + T_GATHER + 400;
    }
  }

  function seek(ms) {
    frozen = null;
    rngState = 0xC0FFEE;
    seedParticles();
    start = 0;
    last = 0;
    var dt = 1000 / 60;
    var t = 0;
    while (t < ms) {
      step(dt, t);
      t += dt;
    }
    frozen = ms;
    if (reduce) snapLocked();
    draw(ms);
    updateHud(phaseAt(ms), ms, true);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    if (frozen != null) {
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
    mouse.x = p.clientX;
    mouse.y = p.clientY;
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

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var keep = frozen;
      resize();
      if (keep != null) seek(keep);
      else if (!reduce) { start = performance.now(); last = 0; }
    }, 80);
  });

  function parseFreeze(val) {
    if (!val) return null;
    if (val === "intro" || val === "boot") return 1100;
    if (val === "chaos") return T_INTRO + 2200;
    if (val === "mid" || val === "gather") return T_INTRO + T_CHAOS + T_GATHER * 0.55;
    if (val === "locked" || val === "resolved" || val === "lock") return T_INTRO + T_CHAOS + T_GATHER + 600;
    var n = parseFloat(val);
    return isFinite(n) ? n : null;
  }

  window.__signalHillV2 = {
    freeze: function (name) {
      var ms = parseFreeze(String(name));
      if (ms == null) { frozen = null; start = performance.now(); last = 0; return; }
      seek(ms);
    },
    times: { intro: T_INTRO, chaos: T_CHAOS, gather: T_GATHER, hold: T_HOLD, release: T_RELEASE, cycle: T_CYCLE }
  };

  prepWordmark();
  resize();
  var query = new URLSearchParams(window.location.search).get("freeze");
  var want = parseFreeze(query);
  if (reduce) {
    snapLocked();
    draw(frozen || 1);
    updateHud(phaseAt(frozen || 1), frozen || 1, true);
  } else if (want != null) {
    seek(want);
    play();
  } else {
    start = performance.now();
    play();
  }
})();
