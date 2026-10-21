/* =========================================================
   ink.js — vector plate engine
   - builds an SVG scene out of traced ink separations
   - prints it shape by shape through configurable waves
   - draws character-specific vector action choreography
   ========================================================= */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const NS = 'http://www.w3.org/2000/svg';

  const EASE = {
    out: 'cubic-bezier(.16,1,.3,1)',
    out4: 'cubic-bezier(.165,.84,.44,1)',
    inOut: 'cubic-bezier(.76,0,.24,1)',
    inOutQuint: 'cubic-bezier(.83,0,.17,1)',
    back: 'cubic-bezier(.34,1.56,.64,1)',
    in: 'cubic-bezier(.7,0,.84,0)',
    linear: 'linear',
    // --- softer motion language -------------------------------------------
    glide: 'cubic-bezier(.22,.61,.28,1)',
    breath: 'cubic-bezier(.42,0,.32,1)',
    settle: 'cubic-bezier(.26,1.22,.34,1)',
    drift: 'cubic-bezier(.32,.02,.24,1)',
    calm: 'cubic-bezier(.36,.01,.16,1)'
  };
  function smoothstep(p) {
    p = p < 0 ? 0 : (p > 1 ? 1 : p);
    return p * p * (3 - 2 * p);
  }
  function smootherstep(p) {
    p = p < 0 ? 0 : (p > 1 ? 1 : p);
    return p * p * p * (p * (p * 6 - 15) + 10);
  }

  const COLORS = {
    cream: '#f2e4d1',
    paper: '#ecdcc4',
    blue: '#2f6cff',
    blueDeep: '#0a3a9e',
    ink: '#0b0b0d',
    pale: 'rgba(242,228,209,.55)'
  };

  /* ---------------- tiny utils ---------------- */
  function anim(target, frames, opts) {
    if (!target) return null;
    const o = Object.assign({ fill: 'both', easing: EASE.out }, opts || {});
    return target.animate(frames, o);
  }
  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function f(n) { return Math.round(n * 10) / 10; }
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* wave ordering -------------------------------------------------- */
  function projectionRange(ux, uy) {
    let mn = Infinity, mx = -Infinity;
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([x, y]) => {
      const p = x * ux + y * uy;
      mn = Math.min(mn, p); mx = Math.max(mx, p);
    });
    return [mn, mx];
  }
  function waveRank(cfg, nx, ny) {
    switch (cfg.kind) {
      case 'radial': {
        const cx = cfg.cx == null ? .5 : cfg.cx;
        const cy = cfg.cy == null ? .5 : cfg.cy;
        const d = Math.hypot(nx - cx, (ny - cy) * 1.5);
        const mx = Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy) * 1.5);
        let r = d / (mx || 1);
        r = clamp(r, 0, 1);
        return cfg.flip ? 1 - r : r;
      }
      case 'angular': {
        const cx = cfg.cx == null ? .5 : cfg.cx;
        const cy = cfg.cy == null ? .5 : cfg.cy;
        let a = Math.atan2((ny - cy) * 1.5, nx - cx);
        let t = (a + Math.PI) / TAU;
        const start = cfg.start || 0;
        t = (t - start + 1) % 1;
        return cfg.flip ? 1 - t : t;
      }
      default: {
        const ang = (cfg.angle || 0) * Math.PI / 180;
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const [mn, mx] = projectionRange(ux, uy);
        let r = ((nx * ux + ny * uy) - mn) / ((mx - mn) || 1);
        r = clamp(r, 0, 1);
        return cfg.flip ? 1 - r : r;
      }
    }
  }
  function waveDir(cfg, nx, ny) {
    if (cfg.kind === 'radial') {
      const cx = cfg.cx == null ? .5 : cfg.cx, cy = cfg.cy == null ? .5 : cfg.cy;
      let dx = nx - cx, dy = (ny - cy) * 1.5;
      const l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l * 0.6667];
    }
    if (cfg.kind === 'angular') {
      const cx = cfg.cx == null ? .5 : cfg.cx, cy = cfg.cy == null ? .5 : cfg.cy;
      let dx = -(ny - cy) * 1.5, dy = nx - cx;
      const l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l * 0.6667];
    }
    const ang = (cfg.angle || 0) * Math.PI / 180;
    return [Math.cos(ang), Math.sin(ang)];
  }

  /* =========================================================
     raster layer cache: every ink layer is baked once into an
     SVG image, so the printing animation only composites a few
     images per frame instead of animating thousands of paths.
     the vector scene stays untouched underneath and is revealed
     when the printing has finished.
     ========================================================= */
  const PRINT_HOLD = (function () {
    const m = /[?&]printhold=([\d.]+)/.exec(location.search);
    return m ? parseFloat(m[1]) : null;
  })();
  const PRINT_SLOW = (function () {
    const m = /[?&]printslow=([\d.]+)/.exec(location.search);
    return m ? Math.max(1, Math.min(8, parseFloat(m[1]))) : 1;
  })();
  const RST = {};
  const RASTER_W = 768, RASTER_H = 1152;

  function layerSvg(color, d) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + RASTER_W + '" height="' + RASTER_H +
      '" viewBox="0 0 1024 1536"><path fill="' + color + '" fill-rule="evenodd" d="' + d + '"/></svg>';
  }
  function ghostSvg(layers) {
    let body = '';
    for (const L of layers) {
      body += '<path fill="' + L.c + '" fill-rule="evenodd" d="' + L.s.map((x) => x[0]).join('') + '"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + RASTER_W + '" height="' + RASTER_H +
      '" viewBox="0 0 1024 1536">' + body + '</svg>';
  }
  function ensureRaster(plate) {
    if (RST[plate.id]) return RST[plate.id];
    const layers = plate.layers || [];
    const mk = (svg) => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const entry = { layers: [], ghost: null };
    for (const L of layers) {
      const url = mk(layerSvg(L.c, L.s.map((x) => x[0]).join('')));
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      entry.layers.push({ url: url, img: img, color: L.c });
    }
    entry.ghostUrl = mk(ghostSvg(layers));
    entry.ghost = new Image();
    entry.ghost.decoding = 'async';
    entry.ghost.src = entry.ghostUrl;
    RST[plate.id] = entry;
    return entry;
  }
  function warmRaster(plate) {
    const e = ensureRaster(plate);
    const imgs = e.layers.map((L) => L.img).concat(e.ghost);
    imgs.forEach((img) => { try { img.decode().catch(() => { }); } catch (err) { } });
    return e;
  }

  /* canvas wave geometry ------------------------------------------ */
  function bandPolygonLinear(angle, f0, f1, teeth) {
    // line direction u; band between projections f0..f1 of the plate
    const a = angle * Math.PI / 180;
    const ux = Math.cos(a), uy = Math.sin(a);
    const corners = [[0, 0], [1024, 0], [0, 1536], [1024, 1536]];
    let mn = Infinity, mx = -Infinity;
    for (const c of corners) { const p = c[0] * ux + c[1] * uy; mn = Math.min(mn, p); mx = Math.max(mx, p); }
    const front = mn + f1 * (mx - mn);
    const back = mn + f0 * (mx - mn);
    // perpendicular direction
    const px = -uy, py = ux;
    const L = 2400;
    const pts = [];
    const n = teeth || 34;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      // along the front line, from -L to +L in perpendicular direction
      const along = (t - .5) * 2 * L;
      // ragged edge
      const jag = (hash(k * 3.17) - .5) * 26;
      const fx = ux * (front + jag) + px * along;
      const fy = uy * (front + jag) + py * along;
      pts.push([fx, fy]);
    }
    for (let k = n; k >= 0; k--) {
      const t = k / n;
      const along = (t - .5) * 2 * L;
      const bx = ux * back + px * along;
      const by = uy * back + py * along;
      pts.push([bx, by]);
    }
    return pts;
  }
  function bandPolygonRadial(cx, cy, r0, r1, teeth) {
    const pts = [];
    const n = teeth || 72;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const rr = r1 + (hash(k * 2.9) - .5) * 16;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    for (let k = n - 1; k >= 0; k--) {
      const a = (k / n) * TAU;
      pts.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]);
    }
    return pts;
  }
  function bandPolygonAngular(cx, cy, a0, a1, teeth) {
    const pts = [[cx, cy]];
    const n = teeth || 18;
    for (let k = 0; k <= n; k++) {
      const a = a0 + (a1 - a0) * (k / n);
      const rr = 2400 + (hash(k * 5.3) - .5) * 30;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
  }
  function tracePoly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.closePath();
  }

  /* ---------------- scene ---------------- */
  class InkScene {
    constructor(plate) {
      this.plate = plate;
      this.speed = 1;
      this.root = document.createElement('div');
      this.root.className = 'scene';
      this.anims = [];
      this.fxAnims = [];
      this.printEnd = 0;
      this.build();
    }

    build() {
      const plate = this.plate;
      const W = plate.w || 1024, H = plate.h || 1536;
      this.W = W; this.H = H;
      const layers = plate.layers || [];
      const parts = [];
      for (const layer of layers) {
        const d = layer.s.map((sh) => sh[0]).join('');
        parts.push('<g class="layer" data-layer="' + layer.n + '" fill="' + layer.c +
          '" stroke="' + layer.c + '" stroke-width="1.15" stroke-linejoin="round" fill-rule="evenodd">' +
          '<path class="s" d="' + d + '"/></g>');
      }
      let objSvg = '';
      const objs = plate.objects || [];
      if (objs.length) {
        const groups = [];
        const defs = [];
        for (const o of objs) {
          const cols = [];
          for (const L of (o.layers || [])) {
            const d = L.s.map((x) => x[0]).join('');
            if (d) cols.push('<path d="' + d + '" fill="' + L.c + '" stroke="' + L.c +
              '" stroke-width="1.15" stroke-linejoin="round" fill-rule="evenodd"/>');
          }
          if (cols.length) {
            const pv = o.pivot || [512, 768];
            let clipAttr = '';
            let clip = o.clip;
            if (clip) {
              const cid = 'objclip-' + o.id;
              if (clip.circle) {
                defs.push('<clipPath id="' + cid + '"><circle cx="' + clip.circle[0] + '" cy="' +
                  clip.circle[1] + '" r="' + clip.circle[2] + '"/></clipPath>');
              } else {
                const polys = (clip.length && typeof clip[0][0] === 'number') ? [clip] : clip;
                defs.push('<clipPath id="' + cid + '">' + polys.map((poly) =>
                  '<polygon points="' + poly.map((q) => q[0] + ',' + q[1]).join(' ') + '"/>').join('') + '</clipPath>');
              }
              clipAttr = ' clip-path="url(#' + cid + ')"';
            }
            groups.push('<g class="scene-obj" data-obj="' + o.id + '" data-pivot="' +
              pv[0] + ',' + pv[1] + '"' + clipAttr + '>' + cols.join('') + '</g>');
          }
        }
        if (groups.length) objSvg = '<svg class="obj-svg" viewBox="0 0 ' + W + ' ' + H +
          '" xmlns="' + NS + '" aria-hidden="true">' + (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') +
          groups.join('') + '</svg>';
      }
      let titleSvg = '';
      const tsh = plate.titleShapes || [];
      if (tsh.length) {
        const tp = plate.titlePivot || [250, 240];
        const glyphs = tsh.map((sh, i) => '<path class="tglyph" data-i="' + i + '" d="' + sh.d +
          '" fill="' + sh.c + '"/>').join('');
        titleSvg = '<svg class="title-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="' + NS +
          '" aria-hidden="true"><g class="title-asset" data-pivot="' + tp[0] + ',' + tp[1] +
          '">' + glyphs + '</g></svg>';
      }
      this.root.innerHTML = '<svg class="scene-svg" viewBox="0 0 ' + W + ' ' + H +
        '" xmlns="' + NS + '" aria-hidden="true">' + parts.join('') + '</svg>' + titleSvg + objSvg;
      this.svg = this.root.querySelector('svg.scene-svg');
      this.titleAssetRoot = this.root.querySelector('svg.title-svg');
      this.titleGroup = this.root.querySelector('.title-asset');
      this.objRoot = this.root.querySelector('svg.obj-svg');
      this.layerEls = {};
      this.svg.querySelectorAll('.layer').forEach((g) => {
        this.layerEls[g.getAttribute('data-layer')] = g;
      });
    }

    /* print timing per ink layer */
    schedule(recipe, speed) {
      this.speed = speed;
      const p = recipe.print || {};
      const layers = this.plate.layers || [];
      const base = p.wave || { kind: 'linear', angle: 0 };
      const slow = PRINT_SLOW;
      const dur = (p.dur == null ? .3 : p.dur) * speed * slow;
      const gap = (p.gap == null ? .05 : p.gap) * speed * slow;
      const start = (p.start == null ? .14 : p.start) * speed * slow;
      const plan = [];
      layers.forEach((L, li) => {
        let wave = base;
        if (p.alt && li % 2 === 1) { wave = Object.assign({}, base); wave.flip = !base.flip; }
        // hand-timed feel: each layer breathes a little differently
        const wob = 1 + (((li * 37) % 11) - 5) / 90;
        plan.push({ layer: L, li: li, start: start + li * gap, dur: dur * wob, wave: wave });
      });
      this.layerPlan = plan;
      let end = 0;
      for (const st of plan) end = Math.max(end, st.start + st.dur);
      this.printEnd = end || .9;
      return this.printEnd;
    }

    play(recipe) {
      this.recipe = recipe;
      const speed = this.speed;
      this.buildFx(recipe, speed);
      const e = recipe.enter;
      const enterDur = Math.max(680, this.printEnd * 1000 + 320);
      if (e && e.from) {
        this.anims.push(anim(this.root, [
          { transform: e.from, easing: EASE.glide },
          { transform: 'translate3d(0,0,0) rotate(0deg) scale(1.0035)', offset: .76, easing: EASE.calm },
          { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' }
        ], { duration: enterDur, easing: 'linear', fill: 'both' }));
      } else {
        this.anims.push(anim(this.root, [
          { transform: 'scale(1.012)', easing: EASE.glide },
          { transform: 'scale(.9996)', offset: .8, easing: EASE.calm },
          { transform: 'scale(1)' }
        ], { duration: enterDur, easing: 'linear', fill: 'both' }));
      }
      this.startPrintCanvas(recipe);
      return this.printEnd;
    }

    /* canvas printing: composite a few baked layer images, then swap to vector */
    startPrintCanvas(recipe) {
      if (!this.layerPlan || !this.layerPlan.length) return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.svg.style.opacity = '';
        this.printed = true;
        this.root.classList.add('printed');
        if (this.onPrinted) { try { this.onPrinted(this); } catch (e) { } }
        return;
      }
      const plate = this.plate;
      const rst = ensureRaster(plate);
      const cv = document.createElement('canvas');
      cv.className = 'plate-canvas';
      cv.width = 1024; cv.height = 1536;
      this.canvas = cv;
      cv.style.opacity = '0';
      this.root.appendChild(cv);
      anim(cv, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE.breath });
      this.svg.style.opacity = '0';
      const ctx = cv.getContext('2d');
      this.ctx = ctx;
      const imgs = rst.layers.map((L) => L.img);
      const ghost = rst.ghost;
      this.front = this.layerPlan.map(() => 0);
      this.printed = false;
      const ready = Promise.all(
        imgs.concat(ghost).map((im) => (im.decode ? im.decode().catch(() => { }) : Promise.resolve()))
      );
      let started = false;
      const begin = () => {
        if (started || this.destroyed) return;
        started = true;
        // ghost impression of the whole plate
        try {
          ctx.clearRect(0, 0, 1024, 1536);
          ctx.globalAlpha = .085;
          ctx.drawImage(ghost, 0, 0, 1024, 1536);
          ctx.globalAlpha = 1;
        } catch (err) { }
        const waitMs = 90;
        this.printStart = performance.now() + waitMs;
        const loop = (now) => {
          if (this.destroyed || this.printed) return;
          const t = (now - this.printStart) / 1000;
          if (t < 0) { this.raf = requestAnimationFrame(loop); return; }
          const plans = this.layerPlan;
          for (let i = 0; i < plans.length; i++) {
            const st = plans[i];
            const pRaw = clamp((t - st.start) / st.dur, 0, 1);
            const p = smootherstep(pRaw);
            if (p <= this.front[i]) continue;
            this.drawBand(ctx, imgs[i], st.wave, this.front[i], p);
            this.front[i] = p;
          }
          if (PRINT_HOLD != null && t >= PRINT_HOLD) { this.raf = null; return; }
          if (t >= this.printEnd) {
            this.finishPrint();
            return;
          }
          this.raf = requestAnimationFrame(loop);
        };
        this.raf = requestAnimationFrame(loop);
      };
      ready.then(begin).catch(() => { this.fallbackPrint(); });
      // if images take too long, fall back to a simple vector reveal
      setTimeout(() => { if (!started && !this.destroyed) this.fallbackPrint(); }, 700);
    }

    drawBand(ctx, img, wave, f0, f1) {
      if (!img || f1 <= f0) return;
      ctx.save();
      let poly;
      if (wave.kind === 'radial') {
        const cx = (wave.cx == null ? .55 : wave.cx) * this.W;
        const cy = (wave.cy == null ? .5 : wave.cy) * this.H;
        const maxR = Math.hypot(Math.max(cx, this.W - cx), Math.max(cy, this.H - cy)) + 40;
        let a = f0, b = f1;
        if (wave.flip) { a = 1 - f1; b = 1 - f0; }
        poly = bandPolygonRadial(cx, cy, a * maxR, b * maxR);
      } else if (wave.kind === 'angular') {
        const cx = (wave.cx == null ? .42 : wave.cx) * this.W;
        const cy = (wave.cy == null ? .52 : wave.cy) * this.H;
        const a0 = (f0 * TAU) + (wave.start || 0) * TAU;
        const a1 = (f1 * TAU) + (wave.start || 0) * TAU;
        poly = bandPolygonAngular(cx, cy, a0, a1);
      } else {
        let a = f0, b = f1;
        if (wave.flip) { a = 1 - f1; b = 1 - f0; }
        poly = bandPolygonLinear(wave.angle || 0, a, b);
      }
      tracePoly(ctx, poly);
      ctx.clip();
      ctx.drawImage(img, 0, 0, 1024, 1536);
      ctx.restore();
    }

    finishPrint() {
      if (this.printed) return;
      this.printed = true;
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
      const cv = this.canvas;
      this.canvas = null;
      const again = this.plate && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (cv && !again) {
        anim(cv, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: EASE.breath });
        setTimeout(() => { try { cv.remove(); } catch (e) { } }, 260);
      }
      if (this.destroyed) return;
      this.svg.style.opacity = '';
      this.root.classList.add('printed');
      // artwork eases in as the canvas leaves, no hard pop
      if (!again) {
        this.anims.push(anim(this.svg, [{ opacity: 0 }, { opacity: 1 }],
          { duration: 340, easing: EASE.calm, fill: 'both' }));
      }
      if (this.fxRoot) {
        const fr = this.fxRoot;
        this.fxRoot = null; this.fx = null;
        if (!again) {
          anim(fr, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: EASE.breath, fill: 'both' });
          setTimeout(() => { try { fr.remove(); } catch (e) { } }, 280);
        } else { try { fr.remove(); } catch (e) { } }
      }
      if (this.onPrinted) { try { this.onPrinted(this); } catch (e) { } }

    }

    fallbackPrint() {
      if (this.destroyed || this.printed) return;
      if (this.canvas) { this.canvas.remove(); this.canvas = null; }
      this.svg.style.opacity = '';
      const els = Object.keys(this.layerEls).map((k) => this.layerEls[k]);
      els.forEach((g, i) => {
        this.anims.push(anim(g, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 420, delay: i * 70, easing: EASE.glide, fill: 'both' }));
      });
      this.printed = true;
    }

    erase(cfg) {
      cfg = cfg || {};
      const speed = cfg.speed || 1;
      this.stopPrint();
      let end = 0;
      const names = Object.keys(this.layerEls);
      names.forEach((k, i) => {
        const g = this.layerEls[k];
        const delay = i * 22 * speed;
        this.anims.push(anim(g, [
          { opacity: 1, transform: 'translateY(0px)', easing: EASE.calm },
          { opacity: 0, transform: 'translateY(-7px)' }
        ], { duration: 300 * speed, delay: delay, easing: 'linear', fill: 'both' }));
        end = Math.max(end, delay + 300 * speed);
      });
      const ex = cfg.exit;
      if (ex) {
        this.anims.push(anim(this.root, [
          { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)', opacity: 1, easing: EASE.calm },
          { transform: 'translate3d(' + ex.dx + '%,' + ex.dy + '%,0) rotate(' + ex.rot + 'deg) scale(' + ex.scale + ')',
            opacity: .18 }
        ], { duration: 560 * speed, easing: 'linear', fill: 'both' }));
        end = Math.max(end, 560 * speed);
      } else {
        this.anims.push(anim(this.root, [
          { transform: 'translate3d(0,0,0) scale(1)', easing: EASE.calm },
          { transform: 'translate3d(0,-7px,0) scale(.994)' }
        ], { duration: 460 * speed, easing: 'linear', fill: 'both' }));
      }
      this.eraseEnd = end;
      if (this.fxRoot) {
        this.anims.push(anim(this.fxRoot, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 * speed, easing: EASE.in, fill: 'both' }));
      }
      if (this.residueRoot) {
        this.anims.push(anim(this.residueRoot, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 * speed, easing: EASE.in, fill: 'both' }));
      }
      if (this.titleAssetRoot) {
        this.anims.push(anim(this.titleAssetRoot, [{ opacity: 1, transform: 'translateY(0px)' },
          { opacity: 0, transform: 'translateY(-6px)' }], { duration: 320 * speed, easing: EASE.calm, fill: 'both' }));
      }
      if (this.titleRoot) {
        this.anims.push(anim(this.titleRoot, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 * speed, easing: EASE.in, fill: 'both' }));
      }
      if (this.heroRoot) {
        this.anims.push(anim(this.heroRoot, [{ opacity: 1 }, { opacity: 0 }], { duration: 240 * speed, easing: EASE.in, fill: 'both' }));
      }
      if (this.objRoot) {
        this.anims.push(anim(this.objRoot, [{ opacity: 1 }, { opacity: 0 }], { duration: 240 * speed, easing: EASE.in, fill: 'both' }));
      }
      if (this.bgRoot) {
        this.anims.push(anim(this.bgRoot, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 * speed, easing: EASE.in, fill: 'both' }));
      }
    }

    stopPrint() {
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
      if (this.canvas) { try { this.canvas.remove(); } catch (e) { } this.canvas = null; }
      if (this.svg) this.svg.style.opacity = '';
      this.printed = true;
    }

    destroy() {
      this.destroyed = true;
      this.stopPrint();
      this.anims.forEach((a) => { try { a.cancel(); } catch (e) { } });
      this.fxAnims.forEach((a) => { try { a.cancel(); } catch (e) { } });
      if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    }

    setPaper(color) {
      this.root.style.setProperty('--paper', color);
    }

    /* ---- action fx ---- */
    buildFx(recipe, speed) {
      const builder = FX[recipe.fx];
      if (!builder) return;
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'fx-svg');
      svg.setAttribute('viewBox', '0 0 1024 1536');
      svg.setAttribute('aria-hidden', 'true');
      this.fxRoot = svg;
      this.root.appendChild(svg);
      this.fx = { svg: svg, owned: [] };
      builder(this, speed);
    }
  }

  /* ---------------- helpers for fx markup ---------------- */
  function fourStar(x, y, r, rot) {
    const a = (rot || 0) * Math.PI / 180;
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const ang = a + i * Math.PI / 2;
      pts.push((x + Math.cos(ang) * r).toFixed(1) + ' ' + (y + Math.sin(ang) * r).toFixed(1));
      const ang2 = ang + Math.PI / 4;
      pts.push((x + Math.cos(ang2) * r * 0.22).toFixed(1) + ' ' + (y + Math.sin(ang2) * r * 0.22).toFixed(1));
    }
    return pts.join(' ');
  }
  function arrowMarkup(x1, y1, x2, y2, w) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const hw = w * 2.2, hl = w * 6.2;
    const bx = x2 - ux * hl, by = y2 - uy * hl;
    const head = [
      [x2, y2],
      [bx + px * hw, by + py * hw],
      [bx - px * hw, by - py * hw]
    ].map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const fl = w * 3.4;
    const f1 = [
      [x1 + ux * fl, y1 + uy * fl],
      [x1 + ux * fl * 2.2 + px * w * 1.6, y1 + uy * fl * 2.2 + py * w * 1.6],
      [x1 + ux * fl * 1.2, y1 + uy * fl * 1.2]
    ].map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const f2 = [
      [x1 + ux * fl, y1 + uy * fl],
      [x1 + ux * fl * 2.2 - px * w * 1.6, y1 + uy * fl * 2.2 - py * w * 1.6],
      [x1 + ux * fl * 1.2, y1 + uy * fl * 1.2]
    ].map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return {
      head: '<polygon points="' + head + '" fill="' + COLORS.cream + '" stroke="' + COLORS.blue + '" stroke-width="1.6"/>',
      fletch: '<g fill="' + COLORS.blue + '"><polygon points="' + f1 + '"/><polygon points="' + f2 + '"/></g>'
    };
  }
  function diamond(cx, cy, r, rot) {
    const a = (rot || 0) * Math.PI / 180;
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const ang = a + i * Math.PI / 2;
      pts.push((cx + Math.cos(ang) * r).toFixed(1) + ' ' + (cy + Math.sin(ang) * r).toFixed(1));
    }
    return pts.join(' ');
  }
  function skylineMarkup(x0, x1, baseY, maxH, n) {
    let out = '';
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const h = maxH * (0.25 + hash(i * 7.3 + 5) * 0.75);
      const b = baseY - h;
      const bx = x0 + i * w;
      out += '<path d="M' + f(bx) + ' ' + f(baseY) + 'V' + f(b) +
        'h' + f(w * .55) + 'v' + f(-h * .18) + 'h' + f(w * .2) + 'v' + f(h * .18) +
        'h' + f(w * .25) + 'V' + f(baseY) + 'Z"/>';
    }
    return out;
  }

  /* ---------------- fx registry ---------------- */
  const FX = {};

  /* ===== 01 ELYSIA : the arrow ===== */
  FX.elysia = function (scene, s) {
    const T = (t) => t * s * 1000;
    const pts = [
      [852, 508], [-72, 96]
    ];
    const arrow = arrowMarkup(pts[0][0], pts[0][1], pts[1][0], pts[1][1], 4.0);
    let petals = '';
    for (let i = 0; i < 11; i++) {
      const ox = 620 + hash(i * 3.1) * 300;
      const oy = 280 + hash(i * 5.7 + 2) * 560;
      const r = 8 + hash(i * 9.2) * 16;
      const rot = hash(i * 2.2) * 180;
      petals += '<g class="pw" data-i="' + i + '" transform="translate(' + f(ox) + ' ' + f(oy) + ')">' +
        '<polygon class="petal" points="' + diamond(0, 0, r, rot) + '" fill="' +
        (i % 3 === 0 ? COLORS.blue : (i % 3 === 1 ? COLORS.ink : COLORS.cream)) + '" opacity="0"/></g>';
    }
    scene.fxRoot.innerHTML =
      '<g class="ely">' +
        '<g class="ely-bow"><path class="bow1" d="M692 242 C 862 330, 884 574, 806 800" fill="none" stroke="' + COLORS.blue + '" stroke-width="3.4"/>' +
        '<path class="bow2" d="M706 268 C 850 350, 868 566, 800 752" fill="none" stroke="' + COLORS.cream + '" stroke-width="1.1" opacity=".65"/></g>' +
        '<path class="ely-string" d="M692 242 L 668 512 L 806 800" fill="none" stroke="' + COLORS.blue + '" stroke-width="1.2" opacity=".85"/>' +
        '<g class="ely-arrow"><line class="shaft" x1="' + pts[0][0] + '" y1="' + pts[0][1] + '" x2="' + pts[1][0] + '" y2="' + pts[1][1] + '" stroke="' + COLORS.blue + '" stroke-width="5"/>' +
        '<g class="ely-head">' + arrow.head + '</g><g class="ely-fletch">' + arrow.fletch + '</g></g>' +
        '<circle class="ely-ring" cx="852" cy="508" r="34" fill="none" stroke="' + COLORS.blue + '" stroke-width="1.2" opacity="0"/>' +
        '<g class="ely-petals">' + petals + '</g>' +
      '</g>';
    const g = scene.fxRoot.querySelector('.ely');
    const bow1 = g.querySelector('.bow1'), bow2 = g.querySelector('.bow2'), str = g.querySelector('.ely-string');
    [[bow1, 0.06], [bow2, 0.1], [str, 0.14]].forEach(([el, d]) => {
      const L = el.getTotalLength();
      el.style.strokeDasharray = L + ' ' + L;
      scene.fxAnims.push(anim(el, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], {
        duration: T(0.5), delay: T(d), easing: EASE.inOut
      }));
    });
    const shaft = g.querySelector('.shaft');
    const L = shaft.getTotalLength();
    shaft.style.strokeDasharray = L + ' ' + L;
    scene.fxAnims.push(anim(shaft, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], {
      duration: T(0.34), delay: T(0.2), easing: EASE.in
    }));
    scene.fxAnims.push(anim(g.querySelector('.ely-head'), [{ opacity: 0 }, { opacity: 1 }], {
      duration: T(0.12), delay: T(0.42), easing: EASE.out
    }));
    scene.fxAnims.push(anim(g.querySelector('.ely-fletch'), [{ opacity: 0 }, { opacity: 1 }], {
      duration: T(0.18), delay: T(0.28), easing: EASE.out
    }));
    const ring = g.querySelector('.ely-ring');
    scene.fxAnims.push(anim(ring, [
      { opacity: 0, transform: 'scale(.4)', offset: 0 },
      { opacity: .9, transform: 'scale(1)', offset: .22 },
      { opacity: 0, transform: 'scale(2.3)', offset: 1 }
    ], { duration: T(0.55), delay: T(0.5), easing: EASE.out }));
    g.querySelectorAll('.pw').forEach((w) => {
      const p = w.querySelector('.petal');
      const i = +w.dataset.i;
      const d = T(0.24 + hash(i * 4.2) * 0.5);
      scene.fxAnims.push(anim(p, [
        { opacity: 0, transform: 'translate(0,14px) scale(.2) rotate(0deg)', offset: 0 },
        { opacity: .95, transform: 'translate(0,-18px) scale(1) rotate(24deg)', offset: .5 },
        { opacity: 0, transform: 'translate(' + (hash(i) * 120 - 60) + 'px,' + (-100 - hash(i * 2) * 140) + 'px) scale(.7) rotate(80deg)', offset: 1 }
      ], { duration: T(1.15), delay: d, easing: 'cubic-bezier(.2,.7,.3,1)' }));
    });
    fadeGroup(scene, g, T(1.5), T(0.45));
  };

  /* ===== 02 AEMEATH : crystalline resonance ===== */
  FX.aemeath = function (scene, s) {
    const T = (t) => t * s * 1000;
    let shards = '';
    for (let i = 0; i < 9; i++) {
      const cx = 320 + hash(i * 2.7) * 520;
      const cy = 300 + hash(i * 4.1 + 1) * 760;
      const w = 24 + hash(i * 7.7) * 66;
      const h = 90 + hash(i * 3.3) * 250;
      const rot = -40 + hash(i * 8.1) * 80;
      shards += '<g class="sw" data-i="' + i + '" transform="translate(' + f(cx) + ' ' + f(cy) + ') rotate(' + f(rot) + ')">' +
        '<polygon class="ae-shard" points="0 ' + f(-h / 2) + ' ' + f(w / 2) + ' 0 0 ' + f(h / 2) + ' ' + f(-w / 2) + ' 0"' +
        ' fill="' + (i % 2 ? 'rgba(47,108,255,.9)' : 'rgba(242,228,209,.92)') + '"/></g>';
    }
    scene.fxRoot.innerHTML =
      '<g class="ae">' +
        '<g class="ae-rings">' +
          '<polygon class="ring r1" points="' + diamond(560, 760, 330) + '" fill="none" stroke="' + COLORS.blue + '" stroke-width="2" opacity=".85"/>' +
          '<polygon class="ring r2" points="' + diamond(560, 760, 232) + '" fill="none" stroke="' + COLORS.blue + '" stroke-width="2.2" opacity=".95"/>' +
          '<polygon class="ring r3" points="' + diamond(560, 760, 148) + '" fill="none" stroke="' + COLORS.cream + '" stroke-width="1.2" opacity=".9"/>' +
        '</g>' +
        '<g class="ae-shards">' + shards + '</g>' +
        '<path class="ae-wave" d="M20 1256 C 170 1176 300 1330 470 1252 S 760 1184 1004 1262" fill="none" stroke="' + COLORS.blue + '" stroke-width="2" stroke-dasharray="1 10"/>' +
        '<g class="ae-sigil" opacity="0"><circle cx="560" cy="760" r="7" fill="' + COLORS.cream + '"/>' +
        '<path d="M560 690v-34M560 864v-34M470 760h-34M684 760h-34" stroke="' + COLORS.cream + '" stroke-width="1.4"/></g>' +
      '</g>';
    const g = scene.fxRoot.querySelector('.ae');
    const rings = g.querySelectorAll('.ring');
    rings.forEach((r, i) => {
      scene.fxAnims.push(anim(r, [
        { opacity: 0, transform: 'scale(.55) rotate(-14deg)' },
        { opacity: 1, transform: 'scale(1) rotate(0deg)' }
      ], { duration: T(0.62), delay: T(0.06 + i * 0.1), easing: EASE.back }));
    });
    g.querySelectorAll('.ae-shard').forEach((sh, i) => {
      scene.fxAnims.push(anim(sh, [
        { opacity: 0, transform: 'scale(.1)' },
        { opacity: .95, transform: 'scale(1)', offset: .55 },
        { opacity: 0, transform: 'translate(0,-30px) scale(.85)' }
      ], { duration: T(1.25), delay: T(0.12 + hash(i * 3.9) * 0.55), easing: 'cubic-bezier(.2,.8,.25,1)' }));
    });
    const wave = g.querySelector('.ae-wave');
    const wl = wave.getTotalLength();
    wave.style.strokeDasharray = '1 12'; wave.style.strokeDashoffset = '0';
    scene.fxAnims.push(anim(wave, [{ opacity: 0 }, { opacity: .9, offset: .2 }, { opacity: .9, offset: .7 }, { opacity: 0 }], {
      duration: T(1.4), delay: T(0.15), easing: 'linear'
    }));
    scene.fxAnims.push(anim(g.querySelector('.ae-sigil'), [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], {
      duration: T(0.5), delay: T(0.55), easing: EASE.back
    }));
    fadeGroup(scene, g, T(1.55), T(0.4));
  };

  /* ===== 03 BRONYA : velocity ===== */
  FX.bronya = function (scene, s) {
    const T = (t) => t * s * 1000;
    let lines = '';
    for (let i = 0; i < 24; i++) {
      const y = 40 + i * 62 + hash(i * 3.7) * 30;
      const w = 140 + hash(i * 5.1) * 430;
      const x = -30 + hash(i * 9.3) * 700;
      const op = .25 + hash(i * 2.3) * .6;
      const sw = i % 3 === 0 ? 3 : 1.6;
      lines += '<line class="sp" data-i="' + i + '" x1="' + f(x) + '" y1="' + f(y) + '" x2="' + f(x + w) + '" y2="' + f(y) + '" stroke="' + (i % 3 ? COLORS.cream : COLORS.blue) + '" stroke-width="' + sw + '" opacity="' + op.toFixed(2) + '"/>';
    }
    let chev = '';
    for (let i = 0; i < 6; i++) {
      const cx = 120 + i * 150, cy = 1330 - i * 40;
      chev += '<path class="cv" d="M' + cx + ' ' + cy + ' l26 -26 l26 26" fill="none" stroke="' + (i % 2 ? COLORS.cream : COLORS.blue) + '" stroke-width="2"/>';
    }
    scene.fxRoot.innerHTML =
      '<g class="br"><g class="br-speed">' + lines + '</g>' +
        '<g class="br-wheels">' +
          '<circle class="wh wh1" cx="272" cy="1232" r="188" fill="none" stroke="' + COLORS.cream + '" stroke-width="2"/>' +
          '<circle class="wh wh1b" cx="272" cy="1232" r="128" fill="none" stroke="' + COLORS.blue + '" stroke-width="1.2" opacity=".9"/>' +
          '<circle class="wh wh2" cx="852" cy="1268" r="170" fill="none" stroke="' + COLORS.cream + '" stroke-width="2"/>' +
          '<circle class="wh wh2b" cx="852" cy="1268" r="110" fill="none" stroke="' + COLORS.blue + '" stroke-width="1.2" opacity=".9"/>' +
        '</g>' +
        '<g class="br-chev">' + chev + '</g>' +
      '</g>';
    const g = scene.fxRoot.querySelector('.br');
    g.querySelectorAll('.sp').forEach((ln) => {
      const i = +ln.dataset.i;
      const x1 = +ln.getAttribute('x1'), x2 = +ln.getAttribute('x2');
      scene.fxAnims.push(anim(ln, [
        { opacity: 0, transform: 'translateX(' + (i % 2 ? 260 : -260) + 'px)' },
        { opacity: 1, transform: 'translateX(0)', offset: .35 },
        { opacity: 0, transform: 'translateX(' + (i % 2 ? -80 : 80) + 'px)' }
      ], { duration: T(0.95), delay: T(0.03 + (i % 8) * 0.035), easing: 'cubic-bezier(.15,.8,.2,1)' }));
    });
    g.querySelectorAll('.wh').forEach((wh, i) => {
      const L = wh.getTotalLength();
      wh.style.strokeDasharray = L + ' ' + L;
      scene.fxAnims.push(anim(wh, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], {
        duration: T(0.8), delay: T(0.1 + i * 0.07), easing: EASE.inOut
      }));
    });
    scene.fxAnims.push(anim(g.querySelector('.br-wheels'), [{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }], {
      duration: T(1.4), delay: T(0.1), easing: EASE.out
    }));
    g.querySelectorAll('.cv').forEach((c, i) => {
      scene.fxAnims.push(anim(c, [
        { opacity: 0, transform: 'translateX(-40px)' },
        { opacity: 1, transform: 'translateX(0)', offset: .4 },
        { opacity: 0, transform: 'translateX(60px)' }
      ], { duration: T(0.8), delay: T(0.25 + i * 0.06), easing: EASE.out }));
    });
    fadeGroup(scene, g, T(1.5), T(0.4));
  };

  /* ===== 04 LUNA : target & skyline ===== */
  FX.luna = function (scene, s) {
    const T = (t) => t * s * 1000;
    scene.fxRoot.innerHTML =
      '<g class="lu">' +
        '<g class="lu-sky" stroke="' + COLORS.blue + '" stroke-width="1.2" fill="none" opacity=".9">' +
          skylineMarkup(-20, 500, 1520, 360, 18) +
        '</g>' +
        '<path class="lu-traj" d="M706 690 Q 430 436 262 236" fill="none" stroke="' + COLORS.blue + '" stroke-width="2.6" stroke-dasharray="2 9"/>' +
        '<g class="lu-ret" transform="translate(262 236)">' +
          '<circle r="46" fill="none" stroke="' + COLORS.blue + '" stroke-width="2.2"/>' +
          '<circle r="7" fill="none" stroke="' + COLORS.blue + '" stroke-width="1.6"/>' +
          '<path d="M0 -48V-24M0 24v24M-48 0h24M24 0h24" stroke="' + COLORS.blue + '" stroke-width="1.5"/>' +
          '<path d="M-13 -13L-6 -6M13 13l-7 -7M-13 13l7 -7M13 -13l-7 7" stroke="' + COLORS.blue + '" stroke-width="1.2"/>' +
        '</g>' +
        '<line class="lu-bolt" x1="706" y1="690" x2="300" y2="272" stroke="' + COLORS.blue + '" stroke-width="3.2"/>' +
        '<g class="lu-ticks" stroke="' + COLORS.blue + '" stroke-width="1.2">' +
          '<path d="M620 300v-16M620 300h16"/><path d="M860 980v16M860 980h-16"/>' +
          '<path d="M160 940v-16M160 940h-16"/><path d="M760 500v12M760 500h-12"/>' +
        '</g>' +
      '</g>';
    const g = scene.fxRoot.querySelector('.lu');
    const sky = g.querySelector('.lu-sky');
    scene.fxAnims.push(anim(sky, [{ transform: 'translateY(150px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], {
      duration: T(0.9), delay: T(0.08), easing: EASE.out
    }));
    const traj = g.querySelector('.lu-traj');
    const tl = traj.getTotalLength();
    traj.style.strokeDasharray = '2 11';
    scene.fxAnims.push(anim(traj, [{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .75 }, { opacity: 0 }], {
      duration: T(1.2), delay: T(0.1), easing: 'linear'
    }));
    const bolt = g.querySelector('.lu-bolt');
    const bl = bolt.getTotalLength();
    bolt.style.strokeDasharray = bl + ' ' + bl;
    scene.fxAnims.push(anim(bolt, [{ strokeDashoffset: bl }, { strokeDashoffset: 0 }], {
      duration: T(0.3), delay: T(0.35), easing: EASE.in
    }));
    const ret = g.querySelector('.lu-ret');
    scene.fxAnims.push(anim(ret, [
      { opacity: 0, transform: 'translate(262px,236px) scale(1.7) rotate(-30deg)' },
      { opacity: 1, transform: 'translate(262px,236px) scale(.82) rotate(6deg)', offset: .6 },
      { opacity: 1, transform: 'translate(262px,236px) scale(1) rotate(0deg)' }
    ], { duration: T(0.6), delay: T(0.18), easing: EASE.out }));
    scene.fxAnims.push(anim(ret, [{ opacity: 1 }, { opacity: 0 }], { duration: T(0.4), delay: T(1.2), easing: EASE.inOut }));
    g.querySelectorAll('.lu-ticks path').forEach((t, i) => {
      scene.fxAnims.push(anim(t, [{ opacity: 0 }, { opacity: .9, offset: .3 }, { opacity: 0 }], {
        duration: T(0.9), delay: T(0.3 + i * 0.08), easing: 'ease-out'
      }));
    });
    fadeGroup(scene, g, T(1.6), T(0.35));
  };

  /* ===== 05 KIANA : impact sparks around the greatsword (sword is a scene object) ===== */
  FX.kiana = function (scene, s) {
    const T = (t) => t * s * 1000;
    const H = [472, 790], TIP = [148, 1348];
    let sparks = '';
    for (let i = 0; i < 14; i++) {
      const x = 120 + hash(i * 2.9) * 560;
      const y = 700 + hash(i * 5.1) * 700;
      sparks += '<polygon class="kspark" data-i="' + i + '" points="' +
        fourStar(x, y, 8 + hash(i) * 16, hash(i * 7) * 90) + '" fill="' +
        (i % 3 ? COLORS.cream : COLORS.blue) + '"/>';
    }
    scene.fxRoot.innerHTML =
      '<g class="kg">' +
        '<g class="kshock">' +
          '<circle cx="' + TIP[0] + '" cy="' + TIP[1] + '" r="70" fill="none" stroke="' + COLORS.blue + '" stroke-width="4"/>' +
          '<circle cx="' + TIP[0] + '" cy="' + TIP[1] + '" r="140" fill="none" stroke="' + COLORS.blue + '" stroke-width="1.6"/>' +
        '</g>' +
        '<g class="ksparks">' + sparks + '</g>' +
      '</g>';
    const g = scene.fxRoot.querySelector('.kg');
    scene.fxAnims.push(anim(g.querySelector('.kshock'), [
      { opacity: 0, transform: 'scale(.25)' },
      { opacity: .95, transform: 'scale(1)', offset: .28 },
      { opacity: 0, transform: 'scale(2.3)' }
    ], { duration: T(1.1), delay: T(.5), easing: EASE.out }));
    g.querySelectorAll('.kspark').forEach((sp) => {
      const i = +sp.dataset.i;
      const dx = (hash(i * 3.3) - .5) * 260, dy = -60 - hash(i * 4.4) * 240;
      scene.fxAnims.push(anim(sp, [
        { opacity: 0, transform: 'translate(0,0) scale(.2)' },
        { opacity: 1, transform: 'translate(' + f(dx * .35) + 'px,' + f(dy * .35) + 'px) scale(1)', offset: .35 },
        { opacity: 0, transform: 'translate(' + f(dx) + 'px,' + f(dy) + 'px) scale(.2)' }
      ], { duration: T(1.15), delay: T(.5 + hash(i * 9.1) * .2), easing: 'cubic-bezier(.16,1,.3,1)' }));
    });
  };

  /* ===== 06 VYRON : orbit ===== */
  FX.vyron = function (scene, s) {
    const T = (t) => t * s * 1000;
    let stars = '';
    const starPos = [[566, 888], [640, 1010], [846, 894], [944, 700], [700, 1160], [300, 1080], [880, 1180], [200, 860], [520, 1230]];
    starPos.forEach(([x, y], i) => {
      stars += '<polygon class="vstar" data-i="' + i + '" points="' + fourStar(x, y, 9 + hash(i * 3.6) * 13, hash(i * 2.2) * 45) + '" fill="' + (i % 3 === 0 ? COLORS.blue : (i % 3 === 1 ? COLORS.ink : COLORS.cream)) + '" opacity=".0"/>';
    });
    let dust = '';
    for (let i = 0; i < 20; i++) {
      const x = 80 + hash(i * 5.1) * 880;
      const y = 200 + hash(i * 7.7 + 2) * 1150;
      dust += '<circle class="vdust" data-i="' + i + '" cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(1.4 + hash(i * 2.4) * 2.2) + '" fill="' + (i % 2 ? COLORS.cream : COLORS.blue) + '" opacity=".0"/>';
    }
    scene.fxRoot.innerHTML =
      '<g class="vy">' +
        '<g class="vy-orbits" transform="rotate(-24 470 760)">' +
          '<ellipse class="orbit o1" cx="470" cy="760" rx="338" ry="492" fill="none" stroke="' + COLORS.blue + '" stroke-width="2.4"/>' +
          '<ellipse class="orbit o2" cx="470" cy="760" rx="264" ry="392" fill="none" stroke="' + COLORS.blue + '" stroke-width="1.9"/>' +
          '<ellipse class="orbit o3" cx="470" cy="760" rx="408" ry="576" fill="none" stroke="' + COLORS.cream + '" stroke-width="1.2" opacity=".8"/>' +
        '</g>' +
        '<g class="vy-stars">' + stars + '</g>' +
        '<g class="vy-dust">' + dust + '</g>' +
        '<circle class="vy-sat" cx="0" cy="0" r="13" fill="' + COLORS.cream + '"/>' +
        '<path class="vy-shoot" d="M940 120 L 760 300" stroke="' + COLORS.cream + '" stroke-width="1.4" stroke-dasharray="2 8"/>' +
      '</g>';
    const g = scene.fxRoot.querySelector('.vy');
    g.querySelectorAll('.orbit').forEach((e, i) => {
      const L = e.getTotalLength();
      e.style.strokeDasharray = L + ' ' + L;
      scene.fxAnims.push(anim(e, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], {
        duration: T(1.05), delay: T(0.06 + i * 0.09), easing: EASE.inOut
      }));
    });
    g.querySelectorAll('.vstar').forEach((st) => {
      const i = +st.dataset.i;
      scene.fxAnims.push(anim(st, [
        { opacity: 0, transform: 'scale(.2)' },
        { opacity: 1, transform: 'scale(1)', offset: .35 },
        { opacity: .25, transform: 'scale(.75)', offset: .7 },
        { opacity: 0, transform: 'scale(.3)' }
      ], { duration: T(1.5), delay: T(0.1 + hash(i * 6.2) * 0.6), easing: 'ease-in-out' }));
    });
    g.querySelectorAll('.vdust').forEach((d) => {
      const i = +d.dataset.i;
      const dx = (hash(i * 2.8) - .5) * 120;
      const dy = -40 - hash(i * 4.9) * 150;
      scene.fxAnims.push(anim(d, [
        { opacity: 0, transform: 'translate(0,0)' },
        { opacity: .8, transform: 'translate(' + f(dx * .5) + 'px,' + f(dy * .5) + 'px)', offset: .5 },
        { opacity: 0, transform: 'translate(' + f(dx) + 'px,' + f(dy) + 'px)' }
      ], { duration: T(1.5), delay: T(0.15 + hash(i * 3.1) * 0.5), easing: 'linear' }));
    });
    // satellite travelling on orbit 1
    const sat = g.querySelector('.vy-sat');
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = -Math.PI / 2 + i / 40 * TAU;
      const rot = -24 * Math.PI / 180;
      let x = 470 + Math.cos(a) * 338, y = 760 + Math.sin(a) * 492;
      const rx = (x - 470) * Math.cos(rot) - (y - 760) * Math.sin(rot) + 470;
      const ry = (x - 470) * Math.sin(rot) + (y - 760) * Math.cos(rot) + 760;
      pts.push(rx, ry);
    }
    // build keyframes for transform with translate only (approx path)
    const kf = [];
    for (let i = 0; i < 40; i += 2) {
      kf.push({ transform: 'translate(' + f(pts[i * 2]) + 'px,' + f(pts[i * 2 + 1]) + 'px)', offset: i / 40, opacity: i === 0 ? 0 : 1 });
    }
    kf.push({ transform: 'translate(' + f(pts[0]) + 'px,' + f(pts[1]) + 'px)', opacity: 0 });
    scene.fxAnims.push(anim(sat, kf, { duration: T(1.35), delay: T(0.15), easing: 'linear' }));
    const shoot = g.querySelector('.vy-shoot');
    const sl = shoot.getTotalLength();
    shoot.style.strokeDasharray = '2 8';
    scene.fxAnims.push(anim(shoot, [{ opacity: 0 }, { opacity: .9, offset: .3 }, { opacity: 0 }], {
      duration: T(1.0), delay: T(0.2), easing: 'linear'
    }));
    fadeGroup(scene, g, T(1.55), T(0.4));
  };

  function fadeGroup(scene, g, delayT, durT) {
    const end = (scene.printEnd || 0) * 1000;
    const delay = Math.max(delayT, end - 260);
    scene.fxAnims.push(anim(g, [{ opacity: 1 }, { opacity: 0 }], {
      duration: durT, delay: delay, easing: EASE.inOut
    }));
  }

  /* ---------------- global cancel list for the scene ---------------- */

  /* ---------------- recipes ---------------- */
  const RECIPES = {
    elysia: {
      print: { start: .30, gap: .12, spread: .48, dur: .64, jitter: .05, push: 2.6, alt: true,
               wave: { kind: 'linear', angle: -34 } },
      erase: { kind: 'linear', angle: 146 },
      enter: { from: 'translate3d(-2.8%,2.6%,0) rotate(-1deg)' },
      exit: { dx: -4.6, dy: -3.2, rot: -1.2, scale: .986 }
    },
    aemeath: {
      fx: 'aemeath',
      print: { start: .30, gap: .12, spread: .48, dur: .64, jitter: .06, push: 2.2, alt: true,
               wave: { kind: 'radial', cx: .55, cy: .5 } },
      guide: { kind: 'radial', start: .2, end: 1.66 },
      erase: { kind: 'radial', cx: .55, cy: .5, flip: true },
      enter: { from: 'scale(1.03) rotate(1.1deg)' },
      exit: { dx: 2.6, dy: -4.2, rot: .9, scale: .982 }
    },
    bronya: {
      fx: 'bronya',
      print: { start: .30, gap: .12, spread: .44, dur: .64, jitter: .045, push: 3.2, alt: true,
               wave: { kind: 'linear', angle: 0 } },
      guide: { kind: 'linear', angle: 0, start: .24, end: 1.52 },
      erase: { kind: 'linear', angle: 180 },
      enter: { from: 'translate3d(4.4%,0,0)' },
      exit: { dx: -5.2, dy: .6, rot: -.4, scale: .985 }
    },
    luna: {
      fx: 'luna',
      print: { start: .30, gap: .12, spread: .44, dur: .64, jitter: .05, push: 2.4, alt: true,
               wave: { kind: 'linear', angle: -90 } },
      guide: { kind: 'linear', angle: -90, start: .26, end: 1.6 },
      erase: { kind: 'linear', angle: 90 },
      enter: { from: 'translate3d(0,4.2%,0)' },
      exit: { dx: 0, dy: 4.6, rot: .7, scale: .982 }
    },
    kiana: {
      fx: 'kiana',
      print: { start: .30, gap: .12, spread: .48, dur: .64, jitter: .05, push: 2.8, alt: true,
               wave: { kind: 'linear', angle: -52 } },
      guide: { kind: 'linear', angle: -52, start: .24, end: 1.56 },
      erase: { kind: 'linear', angle: 128 },
      enter: { from: 'rotate(1.6deg) scale(1.018)' },
      exit: { dx: -3.6, dy: -2.6, rot: -1, scale: .985 }
    },
    vyron: {
      fx: 'vyron',
      print: { start: .30, gap: .12, spread: .46, dur: .64, jitter: .06, push: 2.4, alt: true,
               wave: { kind: 'angular', cx: .42, cy: .52 } },
      guide: { kind: 'angular', start: .2, end: 1.7 },
      erase: { kind: 'angular', cx: .42, cy: .52, flip: true },
      enter: { from: 'rotate(-1.7deg) scale(1.02)' },
      exit: { dx: 3.6, dy: -2.2, rot: .9, scale: .982 }
    }
  };

  window.INK = {
    InkScene: InkScene,
    RECIPES: RECIPES,
    preloadAll: function (plates) {
      plates.forEach(function (p, i) {
        setTimeout(function () { try { warmRaster(p); } catch (e) { } }, 40 + i * 90);
      });
    },
    warm: function (plate) { try { warmRaster(plate); } catch (e) { } },
    EASE: EASE,
    COLORS: COLORS,
    anim: anim,
    hash: hash,
    f: f,
    wait: wait
  };
})();
