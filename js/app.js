/* =========================================================
   app.js - gallery choreography, chrome, transitions, boot
   ========================================================= */
(function () {
  'use strict';

  const INK = window.INK;
  const PLATES = window.PLATES;
  const { InkScene, RECIPES, EASE, anim } = INK;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mod = (n, m) => ((n % m) + m) % m;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad2 = (n) => String(n).padStart(2, '0');

  const params = new URLSearchParams(location.search);
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DBG = {
    startAt: params.has('scene'),
    scene: params.has('scene') ? clamp(parseInt(params.get('scene'), 10) - 1, 0, PLATES.length - 1) : 0,
    freeze: params.has('freeze') ? parseFloat(params.get('freeze')) : null,
    static: params.has('static'),
    skipboot: params.has('skipboot') || REDUCED,
    noauto: params.has('noauto') || REDUCED,
    nograin: params.has('nograin'),
    bootfreeze: params.has('bootfreeze') ? parseFloat(params.get('bootfreeze')) : null,
    debug: false
  };

  const dom = {};
  const state = {
    idx: 0,
    busy: false,
    pending: null,
    active: null,
    auto: !DBG.noauto,
    autoTimer: 0,
    timers: [],
    guides: [],
    booted: false,
    tilt: { x: 0, y: 0, tx: 0, ty: 0 },
    token: 0
  };

  /* ----------------------------------------------------------
     helpers
     ---------------------------------------------------------- */
  function easeInOutCubic(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function grabDom() {
    const ids = ['frame', 'topIdx', 'inkNote', 'autoToggle', 'railIndex', 'stagewrap', 'stage', 'plate',
      'paper', 'sceneHost', 'fxHost', 'plateFlash', 'plateSheen', 'capLeft', 'capRight', 'info', 'infoTag',
      'infoPlate', 'infoName', 'infoSub', 'infoDesc', 'infoCn', 'spec', 'plateList', 'prevBtn', 'nextBtn',
      'boot', 'bootSheet', 'bootBar', 'bootPct', 'bootStatus', 'bootSwatches', 'bootTitle', 'bootDots',
      'ambient'];
    ids.forEach((id) => { dom[id] = document.getElementById(id); });
    dom.infoKicker = $('.info-kicker');
    dom.infoFoot = $('.info-foot');
    dom.bootCopy = $('.boot-copy');
    dom.bootSide = $('.boot-side');
    dom.bootFoot = $('.boot-foot');
    dom.bootGrid = $('.boot-grid');
    dom.bootEyebrow = $('.boot-eyebrow');
    dom.bootSub = $('.boot-sub');
    dom.bootTrack = $('.boot-track');
    dom.bootDisc = $('.boot-disc');
    dom.bootBand = $('.boot-band');
    dom.bootGhost = $('.boot-ghost');
  }

  function setPaper(color) {
    dom.paper.style.backgroundColor = color;
    dom.plate.style.backgroundColor = color;
  }

  /* ----------------------------------------------------------
     navigation / footer
     ---------------------------------------------------------- */
  function buildNav() {
    dom.plateList.innerHTML = PLATES.map((p, i) =>
      '<li><button class="plate-item" type="button" data-i="' + i + '" aria-label="Show ' + p.name + '">' +
      '<span class="pi-num">' + p.num + '</span><span class="pi-name">' + p.name + '</span></button></li>'
    ).join('');
    dom.plateList.addEventListener('click', (e) => {
      const btn = e.target.closest('.plate-item');
      if (!btn) return;
      const i = +btn.dataset.i;
      if (i === state.idx && !state.busy) return;
      stopAuto(true);
      show(i, { dir: i > state.idx ? 1 : -1 });
    });
  }

  function markNav(i) {
    $$('.plate-item', dom.plateList).forEach((b, k) => {
      b.classList.toggle('is-active', k === i);
      if (k === i) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  }

  /* ----------------------------------------------------------
     chrome (info column + captions + counters)
     ---------------------------------------------------------- */
  function paintChrome(plate) {
    dom.infoTag.textContent = plate.tag;
    dom.infoPlate.textContent = 'PLATE ' + plate.num;
    const ln = dom.infoName.querySelector('.ln');
    ln.innerHTML = Array.from(plate.name).map((ch) => '<span>' + ch + '</span>').join('');
    dom.infoSub.querySelector('span').textContent = plate.sub;
    dom.infoDesc.textContent = plate.desc;
    dom.infoCn.textContent = plate.cn;
    const rows = [
      ['SERIES', plate.series],
      ['PLATE', plate.num + ' / 06'],
      ['INKS', pad2(plate.inks_n || plate.layers.length) + ' / INK + BLUE' +
        ((plate.inks_n || plate.layers.length) > 2 ? ' + SHADES' : '')],
      ['FORMAT', '2 : 3 / 1024 x 1536']
    ];
    dom.spec.innerHTML = rows.map((r) =>
      '<div class="row"><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>').join('');
    dom.capLeft.textContent = 'PLATE ' + plate.num + ' - ' + plate.name + ' / ' + plate.sub;
    dom.capRight.textContent = 'VECTOR INK / 1024 x 1536';
    dom.railIndex.textContent = plate.num;
    dom.topIdx.textContent = plate.num;
    const words = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'];
    dom.inkNote.textContent = (words[plate.inks_n || plate.layers.length] || 'MULTI') + ' INK / VECTOR PLATE';
    markNav(PLATES.indexOf(plate));
    document.title = plate.num + ' ' + plate.name + ' / ' + plate.sub + ' - INK/PLATE';
  }

  function chromeOut(speed) {
    const T = (t) => t * speed * 1000;
    const nameSpans = $$('.info-name .ln span');
    nameSpans.forEach((el, i) => anim(el, [
      { transform: 'translateY(0)', opacity: 1, easing: EASE.calm },
      { transform: 'translateY(-74%)', opacity: 0 }
    ], { duration: T(.3), delay: T(.018 * i), easing: 'linear' }));
    [dom.infoKicker, dom.infoDesc, dom.infoCn, dom.infoSub, dom.spec, dom.infoFoot].forEach((el, i) => {
      if (!el) return;
      anim(el, [
        { opacity: 1, transform: 'translateY(0)', easing: EASE.calm },
        { opacity: 0, transform: 'translateY(-8px)' }
      ], { duration: T(.3), delay: T(.014 * i), easing: 'linear' });
    });
    anim(dom.capLeft, [{ opacity: 1 }, { opacity: 0 }], { duration: T(.16), easing: 'linear' });
    anim(dom.capRight, [{ opacity: 1 }, { opacity: 0 }], { duration: T(.16), easing: 'linear' });
  }

  function chromeIn(speed, baseDelay) {
    const T = (t) => t * speed * 1000;
    const B = T(baseDelay || 0);
    const nameSpans = $$('.info-name .ln span');
    nameSpans.forEach((el, i) => anim(el, [
      { transform: 'translateY(104%)', opacity: 0, easing: EASE.glide },
      { transform: 'translateY(-2%)', opacity: 1, offset: .86, easing: EASE.calm },
      { transform: 'translateY(0)', opacity: 1 }
    ], { duration: T(.78), delay: B + T(.06 + i * .032), easing: 'linear' }));

    anim(dom.infoKicker, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
      { duration: T(.55), delay: B + T(.02), easing: EASE.out });
    anim(dom.infoSub, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: T(.5), delay: B + T(.12), easing: EASE.out });
    [dom.infoDesc, dom.infoCn].forEach((el, i) => {
      if (!el) return;
      anim(el, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
        { duration: T(.55), delay: B + T(.2 + i * .05), easing: EASE.out });
    });
    anim(dom.spec, [{ opacity: 0 }, { opacity: 1 }], { duration: T(.4), delay: B + T(.24), easing: EASE.out });
    $$('.spec .row').forEach((row, i) => {
      anim(row, [
        { transform: 'translateY(9px)', clipPath: 'inset(0 0 100% 0)' },
        { transform: 'none', clipPath: 'inset(0 0 0% 0)' }
      ], { duration: T(.5), delay: B + T(.26 + i * .045), easing: EASE.out });
    });
    anim(dom.infoFoot, [{ opacity: 0 }, { opacity: 1 }], { duration: T(.5), delay: B + T(.42) });
    anim(dom.capLeft, [{ opacity: 0 }, { opacity: 1 }], { duration: T(.4), delay: B + T(.3) });
    anim(dom.capRight, [{ opacity: 0 }, { opacity: 1 }], { duration: T(.4), delay: B + T(.34) });
    anim(dom.railIndex, [
      { opacity: 0, transform: 'translateY(26px)' },
      { opacity: 1, transform: 'none' }
    ], { duration: T(.8), delay: B + T(.1), easing: EASE.out });
    anim(dom.topIdx, [
      { opacity: 0, transform: 'translateY(-70%)' },
      { opacity: 1, transform: 'none' }
    ], { duration: T(.5), delay: B + T(.06), easing: EASE.out });
    anim(dom.inkNote, [{ opacity: 0 }, { opacity: 1 }], { duration: T(.5), delay: B + T(.2) });
  }

  function chromeSettle() {
    [dom.infoKicker, dom.infoDesc, dom.infoCn, dom.infoSub, dom.spec, dom.infoFoot, dom.capLeft, dom.capRight,
      dom.railIndex, dom.topIdx, dom.inkNote].forEach((el) => { if (el) el.style.opacity = '1'; });
    $$('.info-name .ln span').forEach((s) => { s.style.transform = 'none'; s.style.opacity = '1'; });
  }

  /* ----------------------------------------------------------
     stage print guides (squeegee / rings / ray)
     ---------------------------------------------------------- */
  function clearGuides() {
    state.guides.forEach((el) => { if (el && el.parentNode) el.parentNode.removeChild(el); });
    state.guides = [];
  }

  /* ----------------------------------------------------------
     per-character print front: the advancing wave is made of
     the character's own motif (petals / crystal / speed / scan /
     slash / orbit), and travels with the ink front
     ---------------------------------------------------------- */
  const GUIDE_SLOW = (function () {
    const m = /[?&]printslow=([\d.]+)/.exec(location.search);
    return m ? Math.max(1, Math.min(8, parseFloat(m[1]))) : 1;
  })();

  const FRONT = {
    elysia: function () {
      const B = '#2f6cff', C = '#f2e4d1';
      let s = '';
      for (let i = 0; i < 9; i++) {
        const x = 386 + fhash(i * 3.1) * 210;
        const y = 90 + i * 168;
        const r = 15 + fhash(i * 9.7) * 20;
        s += '<polygon points="' + dia(x, y, r, fhash(i * 2.3) * 90) + '" fill="' +
          (i % 3 ? C : B) + '" opacity=".8"/>';
      }
      return s;
    },
    aemeath: function () {
      const B = '#2f6cff', C = '#f2e4d1';
      let s = '<polygon points="' + dia(563, 768, 520, 0) + '" fill="none" stroke="' + B + '" stroke-width="8" opacity=".85"/>' +
        '<polygon points="' + dia(563, 768, 350, 45) + '" fill="none" stroke="' + B + '" stroke-width="5" opacity=".8"/>' +
        '<polygon points="' + dia(563, 768, 205, 18) + '" fill="none" stroke="' + C + '" stroke-width="3.4" opacity=".85"/>';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const x = 563 + Math.cos(a) * 415, y = 768 + Math.sin(a) * 415;
        s += '<polygon points="' + dia(x, y, 24 + fhash(i) * 28, i * 45) + '" fill="' + (i % 2 ? C : B) + '" opacity=".72"/>';
      }
      s += '<circle cx="563" cy="768" r="17" fill="' + C + '"/>';
      return s;
    },
    bronya: function () {
      const B = '#2f6cff', C = '#f2e4d1';
      let s = '';
      for (let i = 0; i < 9; i++) {
        const y = 90 + i * 168;
        const x1 = 350 + fhash(i * 2.7) * 140;
        const len = 180 + fhash(i * 5.3) * 330;
        s += '<line x1="' + fr(x1) + '" y1="' + fr(y) + '" x2="' + fr(x1 + len) + '" y2="' + fr(y) +
          '" stroke="' + (i % 3 ? C : B) + '" stroke-width="' + (i % 3 ? 3 : 6) +
          '" stroke-linecap="round" opacity=".9"/>';
      }
      s += '<g fill="none">' +
        '<circle cx="512" cy="768" r="228" stroke="' + B + '" stroke-width="7" stroke-dasharray="58 42" opacity=".85"/>' +
        '<circle cx="512" cy="768" r="136" stroke="' + C + '" stroke-width="4" stroke-dasharray="28 24" opacity=".8"/>' +
        '<path d="M512 540v-44M512 996v44M284 768h-44M740 768h44" stroke="' + B + '" stroke-width="6"/>' +
        '</g>';
      return s;
    },
    luna: function () {
      const B = '#2f6cff', C = '#f2e4d1';
      let s = '<line x1="110" y1="768" x2="910" y2="768" stroke="' + B + '" stroke-width="3.4" stroke-dasharray="10 22" opacity=".9"/>';
      for (let i = 0; i < 5; i++) {
        const x = 190 + i * 160;
        s += '<path d="M' + x + ' 768l38 -16v32z" fill="' + B + '" opacity=".85"/>';
      }
      s += '<g transform="translate(512 768)" fill="none" stroke="' + C + '" stroke-width="5" opacity=".9">' +
        '<circle r="112"/><circle r="42"/>' +
        '<path d="M0-148v52M0 96v52M-148 0h52M96 0h52"/>' +
        '</g><circle cx="512" cy="768" r="9" fill="' + B + '"/>';
      return s;
    },
    kiana: function () {
      const B = '#2f6cff', C = '#f2e4d1', K = '#0a0a0c';
      let s = '';
      // flame tongues along the sweep line (rotated with the wrapper)
      for (let i = 0; i < 12; i++) {
        const x = 150 + fhash(i * 4.3) * 700;
        const h = 40 + fhash(i * 7.9) * 120;
        const w = 16 + fhash(i * 2.1) * 30;
        s += '<polygon points="' + f(x) + ',768 ' + f(x + w) + ',' + f(768 - h) + ' ' + f(x + w * .35) + ',768 ' +
          f(x + w) + ',' + f(768 + h) + '" fill="' + (i % 3 ? B : C) + '" opacity=".85"/>';
      }
      // a wide blade edge crossing the plate
      s += '<polygon points="120,742 900,712 900,760 120,812" fill="' + C + '" fill-opacity=".6" stroke="' + B + '" stroke-width="2.4"/>' +
        '<line x1="120" y1="777" x2="900" y2="736" stroke="' + K + '" stroke-width="7" opacity=".55"/>' +
        '<line x1="120" y1="777" x2="900" y2="736" stroke="' + B + '" stroke-width="3"/>' +
        '<polygon points="' + dia(800, 748, 62, 18) + '" fill="' + B + '"/>';
      return s;
    },
    vyron: function () {
      const B = '#2f6cff', C = '#f2e4d1', K = '#0a0a0c';
      let s = '<g fill="none" transform="rotate(-24 512 768)">' +
        '<ellipse cx="512" cy="768" rx="460" ry="252" stroke="' + B + '" stroke-width="8" stroke-dasharray="88 58" opacity=".85"/>' +
        '<ellipse cx="512" cy="768" rx="292" ry="148" stroke="' + C + '" stroke-width="3.4" stroke-dasharray="22 28" opacity=".8"/>' +
        '</g><circle cx="512" cy="768" r="20" fill="' + C + '"/><circle cx="512" cy="768" r="30" fill="none" stroke="' + B + '" stroke-width="5"/>';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = 512 + Math.cos(a) * 430, y = 768 + Math.sin(a) * 430;
        s += '<polygon points="' + dia(x, y, 10 + fhash(i) * 14, a * 57.3) + '" fill="' + (i % 2 ? B : C) + '" opacity=".75"/>';
      }
      s += '<polygon points="' + dia(760, 470, 46, 20) + '" fill="' + C + '"/>';
      return s;
    }
  };

  function fr(v) { return Math.round(v * 10) / 10; }
  function f(v) { return Math.round(v * 10) / 10; }
  function fhash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function dia(cx, cy, r, rot) {
    const a = (rot || 0) * Math.PI / 180;
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const ang = a + i * Math.PI / 2;
      const rr = (i % 2 === 0) ? r : r * 0.34;
      pts.push((cx + Math.cos(ang) * rr).toFixed(1) + ' ' + (cy + Math.sin(ang) * rr).toFixed(1));
    }
    return pts.join(' ');
  }

  function buildFront(recipe, speed) {
    const id = recipe.fx;
    const g = recipe.guide;
    const maker = FRONT[id];
    if (!g || !maker || REDUCED) return;
    const start = clamp(g.start || 0, 0, 2) * speed * GUIDE_SLOW * 1000;
    const end = clamp(g.end || 1.1, 0, 2) * speed * GUIDE_SLOW * 1000;
    const dur = Math.max(300, end - start);
    const wrap = document.createElement('div');
    wrap.className = 'plate-front';
    wrap.innerHTML = '<svg viewBox="0 0 1024 1536" aria-hidden="true">' + maker() + '</svg>';
    dom.plate.appendChild(wrap);
    state.guides.push(wrap);
    const svg = wrap.firstElementChild;
    anim(wrap, [
      { opacity: 0, easing: EASE.breath },
      { opacity: .46, offset: .12, easing: EASE.breath },
      { opacity: .46, offset: .78, easing: EASE.breath },
      { opacity: 0 }
    ], { duration: dur * 1.04, delay: start, easing: 'linear', fill: 'both' });
    if (g.kind === 'linear') {
      svg.style.transformOrigin = '50% 50%';
      const a = g.angle || 0;
      anim(svg, [
        { transform: 'rotate(' + a + 'deg) translateX(-116%)', easing: EASE.drift },
        { transform: 'rotate(' + a + 'deg) translateX(0%)', offset: .52, easing: EASE.calm },
        { transform: 'rotate(' + a + 'deg) translateX(116%)' }
      ], { duration: dur * 1.04, delay: start, easing: 'linear', fill: 'both' });
    } else if (g.kind === 'radial') {
      svg.style.transformOrigin = ((g.cx == null ? .55 : g.cx) * 100) + '% ' + ((g.cy == null ? .5 : g.cy) * 100) + '%';
      anim(svg, [
        { transform: 'scale(.28)', easing: EASE.glide },
        { transform: 'scale(1.05)', offset: .6, easing: EASE.breath },
        { transform: 'scale(2.5)' }
      ], { duration: dur * 1.04, delay: start, easing: 'linear', fill: 'both' });
    } else {
      svg.style.transformOrigin = ((g.cx == null ? .42 : g.cx) * 100) + '% ' + ((g.cy == null ? .52 : g.cy) * 100) + '%';
      anim(svg, [
        { transform: 'rotate(-18deg)', easing: EASE.glide },
        { transform: 'rotate(120deg)', offset: .3, easing: EASE.calm },
        { transform: 'rotate(338deg)', offset: .82, easing: EASE.breath },
        { transform: 'rotate(392deg)' }
      ], { duration: dur * 1.04, delay: start, easing: 'linear', fill: 'both' });
    }
  }

  function runGuides(recipe, speed) {
    clearGuides();
    if (REDUCED) return;
    const g = recipe.guide;
    if (!g) return;
    const clip = document.createElement('div');
    clip.className = 'guide-clip';
    dom.plate.appendChild(clip);
    state.guides.push(clip);
    const start = clamp(g.start || 0, 0, 2) * speed * GUIDE_SLOW * 1000;
    const end = clamp(g.end || 1.1, 0, 2) * speed * GUIDE_SLOW * 1000;
    const dur = Math.max(260, end - start);
    if (g.kind === 'linear') {
      const band = document.createElement('div');
      band.className = 'waveband';
      band.style.transform = 'rotate(' + g.angle + 'deg) translate3d(-88%,0,0)';
      clip.appendChild(band);
      state.guides.push(band);
      anim(band, [
        { opacity: 0, easing: EASE.breath },
        { opacity: .95, offset: .14, easing: EASE.breath },
        { opacity: .95, offset: .8, easing: EASE.breath },
        { opacity: 0 }
      ], { duration: dur * 1.06, delay: start, easing: 'linear' });
      anim(band, [
        { transform: 'rotate(' + g.angle + 'deg) translate3d(-92%,0,0)', easing: EASE.drift },
        { transform: 'rotate(' + g.angle + 'deg) translate3d(0%,0,0)', offset: .5, easing: EASE.calm },
        { transform: 'rotate(' + g.angle + 'deg) translate3d(92%,0,0)' }
      ], { duration: dur * 1.06, delay: start, easing: 'linear' });
    } else if (g.kind === 'radial') {
      for (let i = 0; i < 3; i++) {
        const ring = document.createElement('div');
        ring.className = 'guide-ring';
        ring.style.left = '55%';
        ring.style.top = '50%';
        clip.appendChild(ring);
        state.guides.push(ring);
        anim(ring, [
          { opacity: 0, transform: 'translate(-50%,-50%) scale(.12)', easing: EASE.glide },
          { opacity: .8, transform: 'translate(-50%,-50%) scale(.82)', offset: .4, easing: EASE.breath },
          { opacity: 0, transform: 'translate(-50%,-50%) scale(2.5)' }
        ], { duration: dur * .98, delay: start + i * dur * .19, easing: 'linear' });
      }
    } else if (g.kind === 'angular') {
      const ray = document.createElement('div');
      ray.className = 'guide-ray';
      ray.style.left = '42%';
      ray.style.top = '52%';
      clip.appendChild(ray);
      state.guides.push(ray);
      anim(ray, [
        { opacity: 0, transform: 'rotate(-24deg)', easing: EASE.glide },
        { opacity: .85, transform: 'rotate(96deg)', offset: .18, easing: EASE.calm },
        { opacity: .7, transform: 'rotate(292deg)', offset: .78, easing: EASE.breath },
        { opacity: 0, transform: 'rotate(384deg)' }
      ], { duration: dur * 1.04, delay: start, easing: 'linear' });
      const ring = document.createElement('div');
      ring.className = 'guide-ring';
      ring.style.left = '42%';
      ring.style.top = '52%';
      clip.appendChild(ring);
      state.guides.push(ring);
      anim(ring, [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.16)', easing: EASE.glide },
        { opacity: .68, transform: 'translate(-50%,-50%) scale(1.08)', offset: .5, easing: EASE.breath },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(1.85)' }
      ], { duration: dur * .95, delay: start, easing: 'linear' });
    }
    buildFront(recipe, speed);
    state.timers.push(setTimeout(() => {
      if (window.PLATE_APP && window.PLATE_APP.debugFreeze) return;
      clearGuides();
    }, dur + start + 340));
  }

  function finishFlash(speed) {
    if (REDUCED) return;
    anim(dom.plateFlash, [
      { opacity: 0, easing: EASE.breath }, { opacity: .12, offset: .22, easing: EASE.breath }, { opacity: 0 }
    ], { duration: 640 * speed, easing: 'linear' });
    // finishing sheen sweep
    const s = document.createElement('div');
    s.className = 'waveband finish-sweep';
    s.style.transform = 'rotate(-104deg) translate3d(-120%,0,0)';
    const clip = document.createElement('div');
    clip.className = 'guide-clip';
    clip.appendChild(s);
    dom.plate.appendChild(clip);
    state.guides.push(clip, s);
    anim(s, [
      { opacity: 0, transform: 'rotate(-104deg) translate3d(-124%,0,0)', easing: EASE.drift },
      { opacity: .7, offset: .32, easing: EASE.breath },
      { opacity: 0, transform: 'rotate(-104deg) translate3d(124%,0,0)' }
    ], { duration: 1050 * speed, easing: 'linear' });
    state.timers.push(setTimeout(() => {
      if (s.parentNode) s.parentNode.removeChild(s);
    }, 1000 * speed));
  }

  /* ----------------------------------------------------------
     residue: the entrance vectors settle into the scene and stay.
     no fade-out; they become part of the printed composition.
     ---------------------------------------------------------- */
  function kianaSwordGroup(slim) {
    const H = [566, 812], TIP = [148, 1348];
    const dx = TIP[0] - H[0], dy = TIP[1] - H[1];
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    function pt(t, off) { return [H[0] + ux * len * t + px * off, H[1] + uy * len * t + py * off]; }
    const left = [], right = [];
    const N = 9;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const w = (1 - t) * 62 + 7;
      const nl = (k % 2 === 0 ? -1 : 1) * (k === 0 || k === N ? 0 : 7);
      const nr = (k % 2 === 1 ? -1 : 1) * (k === 0 || k === N ? 0 : 7);
      left.push(pt(t, w + nl)); right.push(pt(t, -w + nr));
    }
    const blade = left.concat(right.reverse()).map((p) => f(p[0]) + ',' + f(p[1])).join(' ');
    const G = pt(0.16, 0);
    let flames = '';
    for (let i = 0; i < 7; i++) {
      const t = .12 + i * .12;
      const side = i % 2 === 0 ? 1 : -1;
      const base = pt(t, side * 44), tip = pt(t + .07, side * (96 + fhash(i * 3.7) * 50)), wing = pt(t + .05, side * 18);
      flames += '<polygon points="' + f(base[0]) + ',' + f(base[1]) + ' ' + f(tip[0]) + ',' + f(tip[1]) + ' ' +
        f(wing[0]) + ',' + f(wing[1]) + '" fill="' + (i % 3 ? '#2f6cff' : '#f2e4d1') + '"/>';
    }
    if (slim) {
      let fl = '';
      for (let i = 0; i < 5; i++) {
        const t = .2 + i * .16;
        const side = i % 2 === 0 ? 1 : -1;
        const base = pt(t, side * 30), tip = pt(t + .06, side * 66), wing = pt(t + .04, side * 10);
        fl += '<polygon points="' + f(base[0]) + ',' + f(base[1]) + ' ' + f(tip[0]) + ',' + f(tip[1]) + ' ' +
          f(wing[0]) + ',' + f(wing[1]) + '" fill="' + (i % 2 ? '#2f6cff' : '#f2e4d1') + '"/>';
      }
      return '<g>' +
        '<line x1="' + f(H[0]) + '" y1="' + f(H[1]) + '" x2="' + f(TIP[0]) + '" y2="' + f(TIP[1]) + '" stroke="#2f6cff" stroke-width="2.2" opacity=".8"/>' +
        '<line x1="' + f(H[0]) + '" y1="' + f(H[1]) + '" x2="' + f(TIP[0]) + '" y2="' + f(TIP[1]) + '" stroke="#f2e4d1" stroke-width="0.9" opacity=".9"/>' +
        fl +
        '<polygon points="' + dia(G[0], G[1], 42, 0) + '" fill="#2f6cff" stroke="#f2e4d1" stroke-width="2.5"/>' +
        '<polygon points="' + dia(G[0], G[1], 20, 0) + '" fill="#0a0a0c"/>' +
        '</g>';
    }
    return '<g>' +
      '<polygon points="' + blade + '" fill="#f2e4d1" stroke="#0a0a0c" stroke-width="3" stroke-linejoin="round"/>' +
      '<polygon points="' + blade + '" fill="none" stroke="#2f6cff" stroke-width="1.2" opacity=".85"/>' +
      flames +
      '<line x1="' + f(pt(0.02, 120)[0]) + '" y1="' + f(pt(0.02, 120)[1]) + '" x2="' + f(pt(0.02, -120)[0]) + '" y2="' + f(pt(0.02, -120)[1]) + '" stroke="#0a0a0c" stroke-width="22" stroke-linecap="round"/>' +
      '<line x1="' + f(pt(0.02, 120)[0]) + '" y1="' + f(pt(0.02, 120)[1]) + '" x2="' + f(pt(0.02, -120)[0]) + '" y2="' + f(pt(0.02, -120)[1]) + '" stroke="#f2e4d1" stroke-width="6" stroke-linecap="round"/>' +
      '<line x1="' + f(pt(-.16, 0)[0]) + '" y1="' + f(pt(-.16, 0)[1]) + '" x2="' + f(pt(0, 0)[0]) + '" y2="' + f(pt(0, 0)[1]) + '" stroke="#0a0a0c" stroke-width="26" stroke-linecap="round"/>' +
      '<polygon points="' + dia(G[0], G[1], 52, 0) + '" fill="#2f6cff" stroke="#f2e4d1" stroke-width="3"/>' +
      '<polygon points="' + dia(G[0], G[1], 26, 0) + '" fill="#0a0a0c"/>' +
      '</g>';
  }

  function buildResidue(id) {
    const B = '#2f6cff', C = '#f2e4d1', K = '#0a0a0c';
    const open = '<g fill="none" stroke-linecap="round" stroke-linejoin="round">';
    if (id === 'elysia') {
      let petals = '';
      for (let i = 0; i < 9; i++) {
        const x = 470 + fhash(i * 3.3) * 300, y = 300 + fhash(i * 6.1) * 640;
        petals += '<polygon points="' + dia(x, y, 10 + fhash(i * 2.2) * 14, fhash(i) * 90) + '" fill="' + (i % 2 ? B : C) + '" stroke="none"/>';
      }
      return '<g fill="none" stroke-linejoin="round">' +
        '<path d="M690 430 Q880 760 700 1110" stroke="' + B + '" stroke-width="3" fill="none"/>' +
        '<line x1="812" y1="500" x2="300" y2="1180" stroke="' + B + '" stroke-width="4"/>' +
        '<polygon points="812,500 742,494 768,548" fill="' + B + '"/>' +
        '<path d="M806 506l40-30M806 506l46 12M804 520l44 8" stroke="' + B + '" stroke-width="3" fill="none"/>' +
        petals + '</g>';
    }
    if (id === 'aemeath') {
      let shards = '';
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        const x = 563 + Math.cos(a) * 300, y = 768 + Math.sin(a) * 360;
        shards += '<polygon points="' + dia(x, y, 18 + fhash(i) * 20, i * 40) + '" fill="' + (i % 2 ? B : C) + '" stroke="' + K + '" stroke-width="1.4"/>';
      }
      return '<g fill="none" stroke-linejoin="round">' +
        '<polygon points="' + dia(563, 768, 330, 0) + '" stroke="' + B + '" stroke-width="3"/>' +
        '<polygon points="' + dia(563, 768, 230, 45) + '" stroke="' + B + '" stroke-width="2" opacity=".8"/>' +
        '<polygon points="' + dia(563, 768, 120, 18) + '" stroke="' + C + '" stroke-width="2"/>' +
        shards + '</g>';
    }
    if (id === 'bronya') {
      let streaks = '';
      for (let i = 0; i < 6; i++) {
        const y = 340 + i * 120;
        streaks += '<line x1="120" y1="' + y + '" x2="' + (420 + fhash(i) * 420) + '" y2="' + y + '" stroke="' + (i % 2 ? B : C) + '" stroke-width="' + (i % 2 ? 2 : 3) + '" opacity=".8"/>';
      }
      return '<g fill="none" stroke-linejoin="round">' + streaks +
        '<circle cx="300" cy="1130" r="150" stroke="' + B + '" stroke-width="3" stroke-dasharray="26 20"/>' +
        '<circle cx="300" cy="1130" r="92" stroke="' + C + '" stroke-width="2" stroke-dasharray="16 14"/>' +
        '<circle cx="700" cy="1120" r="120" stroke="' + B + '" stroke-width="2.4" stroke-dasharray="20 18" opacity=".8"/>' +
        '<path d="M760 380l70-24M760 404l70-24M760 428l70-24" stroke="' + B + '" stroke-width="2"/>' +
        '</g>';
    }
    if (id === 'luna') {
      return '<g fill="none" stroke-linejoin="round">' +
        '<circle cx="512" cy="300" r="86" stroke="' + B + '" stroke-width="2.4"/>' +
        '<circle cx="512" cy="300" r="34" stroke="' + C + '" stroke-width="2"/>' +
        '<path d="M512 196v-40M512 404v40M408 300h-40M616 300h40" stroke="' + B + '" stroke-width="2.4"/>' +
        '<path d="M240 940 Q512 520 820 960" stroke="' + B + '" stroke-width="2" stroke-dasharray="8 14" fill="none" opacity=".9"/>' +
        '<line x1="820" y1="960" x2="880" y2="1016" stroke="' + B + '" stroke-width="2"/>' +
        '<path d="M240 1290h60v-70h44v40h50v-96h44v70h60v-40h46v96h60" stroke="' + B + '" stroke-width="2" fill="none" opacity=".85"/>' +
        '</g>';
    }
    if (id === 'kiana') {
      return '<g fill="none" stroke-linejoin="round">' + kianaSwordGroup(true) +
        '<circle cx="214" cy="1338" r="96" stroke="' + B + '" stroke-width="2" fill="none" opacity=".55"/>' +
        '</g>';
    }
    if (id === 'vyron') {
      let stars = '';
      for (let i = 0; i < 6; i++) {
        const x = 180 + fhash(i * 4.7) * 660, y = 240 + fhash(i * 8.1) * 900;
        stars += '<polygon points="' + dia(x, y, 6 + fhash(i) * 8, i * 45) + '" fill="' + (i % 2 ? C : B) + '" stroke="none"/>';
      }
      return '<g fill="none" stroke-linejoin="round">' +
        '<ellipse cx="512" cy="768" rx="420" ry="238" stroke="' + B + '" stroke-width="2.6" stroke-dasharray="46 30" transform="rotate(-22 512 768)"/>' +
        '<ellipse cx="512" cy="768" rx="286" ry="150" stroke="' + C + '" stroke-width="1.8" stroke-dasharray="20 24" transform="rotate(-22 512 768)" opacity=".85"/>' +
        '<polygon points="' + f(512 + Math.cos(-0.6) * 420) + ',' + f(768 + Math.sin(-0.6) * 238) + ' ' +
        f(512 + Math.cos(-0.6) * 470) + ',' + f(768 + Math.sin(-0.6) * 288) + ' ' +
        f(512 + Math.cos(-0.5) * 430) + ',' + f(768 + Math.sin(-0.5) * 250) + '" fill="' + C + '" stroke="' + B + '" stroke-width="1.6"/>' +
        stars + '</g>';
    }
    return '<g></g>';
  }

  const TITLE_VARIANTS = 3;
  const TITLE_DEFAULT = { elysia: 0, aemeath: 1, bronya: 2, luna: 0, kiana: 1, vyron: 2 };

  function titleShapes(plate) {
    if (!plate.title || !plate.title.length) return [];
    const out = [];
    for (const ref of plate.title) {
      const L = plate.layers[ref[0]];
      if (!L) continue;
      const sh = L.s[ref[1]];
      if (sh) out.push(sh[0]);
    }
    return out;
  }

  function buildTitleFx(plate, variant) {
    const ds = titleShapes(plate);
    if (!ds.length) return null;
    const B = '#2f6cff', C = '#f2e4d1', K = '#0a0a0c';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'title-fx');
    svg.setAttribute('viewBox', '0 0 1024 1536');
    svg.setAttribute('aria-hidden', 'true');
    const body = ds.map((d) => '<path d="' + d + '"/>').join('');
    if (variant === 1) {
      // diagonal cut: the name is sliced by one blade and shifted apart
      svg.innerHTML =
        '<defs><clipPath id="tcLeft"><polygon points="0,0 560,0 420,520 0,520"/></clipPath>' +
        '<clipPath id="tcRight"><polygon points="560,0 1024,0 1024,520 420,520"/></clipPath></defs>' +
        '<g clip-path="url(#tcLeft)" transform="translate(-14 -6)" fill="' + K + '">' + body + '</g>' +
        '<g clip-path="url(#tcRight)" transform="translate(16 8)" fill="' + B + '" opacity=".92">' + body + '</g>' +
        '<g clip-path="url(#tcLeft)" transform="translate(-14 -6)" fill="none" stroke="' + C + '" stroke-width="1.2">' + body + '</g>' +
        '<line x1="170" y1="60" x2="520" y2="470" stroke="' + C + '" stroke-width="2.4"/>' +
        '<line x1="182" y1="52" x2="532" y2="462" stroke="' + B + '" stroke-width="1"/>';
    } else if (variant === 2) {
      // outline + registration frame
      svg.innerHTML =
        '<g fill="' + B + '" opacity=".55" transform="translate(6 -6)">' + body + '</g>' +
        '<g fill="none" stroke="' + C + '" stroke-width="2.2">' + body + '</g>' +
        '<g fill="none" stroke="' + K + '" stroke-width="0.8">' + body + '</g>' +
        '<path d="M22 118h54M22 118v54M600 50h-54M600 50v54" stroke="' + B + '" stroke-width="2" fill="none"/>' +
        '<line x1="22" y1="466" x2="470" y2="466" stroke="' + C + '" stroke-width="1.6" stroke-dasharray="16 10"/>';
    } else {
      // ink echo: offset duplicate + rules + ticks
      svg.innerHTML =
        '<g fill="' + B + '" opacity=".5" transform="translate(-8 8)">' + body + '</g>' +
        '<g fill="' + C + '" opacity=".4" transform="translate(5 -5)">' + body + '</g>' +
        '<g fill="' + K + '">' + body + '</g>' +
        '<line x1="26" y1="462" x2="500" y2="462" stroke="' + B + '" stroke-width="2"/>' +
        '<path d="M26 476h10M42 476h10M58 476h10" stroke="' + B + '" stroke-width="1.6"/>';
    }
    return svg;
  }


  /* ----------------------------------------------------------
     hand-drawn scene objects (hero layer)
     Each one is drawn to sit exactly on the object already
     printed in the poster; it flies in as the entrance asset and
     stays in place afterwards, so the settled plate still reads
     like the reference image.
     ---------------------------------------------------------- */
  const HC = { ink: '#0a0a0c', cream: '#f2e4d1', blue: '#3a6bff' };

  function hp(pts, fill, stroke, sw, extra) {
    return '<polygon points="' + pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' ') +
      '" fill="' + (fill || 'none') + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 2) + '"' : '') +
      ' stroke-linejoin="round"' + (extra ? ' ' + extra : '') + '/>';
  }
  function hl(x1, y1, x2, y2, stroke, sw, extra) {
    return '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) +
      '" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round"' + (extra ? ' ' + extra : '') + '/>';
  }
  function hc(cx, cy, r, fill, stroke, sw) {
    return '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) + '" fill="' + (fill || 'none') +
      '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + sw + '"' : '') + '/>';
  }
  function hd(cx, cy, r, fill, stroke, sw) {
    const pts = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
    return hp(pts, fill, stroke, sw || 2);
  }
  function heroGroup(id, pivot, body) {
    return '<g class="hero-obj" data-obj="' + id + '" data-pivot="' + pivot[0] + ',' + pivot[1] + '">' + body + '</g>';
  }

  /* KIANA — broad flame greatsword on the same axis as the printed blade */
  function heroKiana() {
    const G = [452, 852], T = [118, 1462];
    const L = Math.hypot(T[0] - G[0], T[1] - G[1]);
    const u = [(T[0] - G[0]) / L, (T[1] - G[1]) / L];
    const n = [-u[1], u[0]];
    const P = (t, side) => [G[0] + u[0] * t * L + n[0] * side, G[1] + u[1] * t * L + n[1] * side];
    let left = [], right = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const w = 8 + Math.sin(Math.min(1, t * 1.25) * Math.PI) * 96;
      const jag = k === 0 || k === 10 ? 0 : (k % 2 ? 13 : -9);
      left.push(P(t, w + jag));
      right.push(P(t, -w - jag * .55));
    }
    const body = [];
    body.push(hp(left.concat(right.slice().reverse()), HC.cream, HC.ink, 3.4));
    // blue flame tongues on both edges
    const tongues = [[.16, 1], [.3, -1], [.48, 1], [.62, -1], [.78, 1], [.88, -1]];
    tongues.forEach((q, i) => {
      const t = q[0], side = q[1];
      const a = P(t, side * 12), b = P(t + .07, side * (78 + i * 6)), c = P(t + .1, side * 20);
      body.push(hp([a, b, c], i % 2 ? HC.blue : HC.ink, 'none', 0, 'opacity=".95"'));
    });
    // dark notches inside the blade
    for (let i = 0; i < 5; i++) {
      const t = .22 + i * .13;
      const a = P(t, -6), b = P(t + .05, 34), c = P(t + .08, -8);
      body.push(hp([a, b, c], HC.ink, 'none', 0, 'opacity=".9"'));
    }
    // gem, guard, grip, pommel
    body.push(hd(G[0], G[1], 44, HC.blue, HC.cream, 4));
    body.push(hd(G[0], G[1], 20, HC.ink, 'none', 0));
    const g1 = P(-.055, 96), g2 = P(-.055, -96), g3 = P(-.08, -96), g4 = P(-.08, 96);
    body.push(hp([g1, g2, g3, g4], HC.cream, HC.ink, 3.4));
    const h1 = P(-.06, 15), h2 = P(-.06, -15), h3 = P(-.22, -13), h4 = P(-.22, 13);
    body.push(hp([h1, h2, h3, h4], HC.cream, HC.ink, 3));
    body.push(hd(P(-.245, 0)[0], P(-.245, 0)[1], 15, HC.blue, HC.ink, 2.6));
    return heroGroup('sword', G, body.join(''));
  }

  /* ELYSIA — recurve bow, string, heart ornament and arrow */
  function heroElysia() {
    const B = HC.blue, C = HC.cream, K = HC.ink;
    const limb = 'M626 250 Q930 330 900 600 Q870 830 730 940';
    const body = [];
    body.push('<path d="' + limb + '" fill="none" stroke="' + K + '" stroke-width="11" stroke-linecap="round"/>');
    body.push('<path d="' + limb + '" fill="none" stroke="' + C + '" stroke-width="7" stroke-linecap="round"/>');
    body.push('<path d="' + limb + '" fill="none" stroke="' + B + '" stroke-width="1.6" opacity=".85"/>');
    // heart ornament
    body.push('<path d="M748 360c-26-24-40-38-40-58 0-17 14-29 29-29 9 0 14 5 18 12 4-7 9-12 18-12 15 0 29 12 29 29 0 20-14 34-40 58z" fill="none" stroke="' + K + '" stroke-width="9"/>');
    body.push('<path d="M748 360c-26-24-40-38-40-58 0-17 14-29 29-29 9 0 14 5 18 12 4-7 9-12 18-12 15 0 29 12 29 29 0 20-14 34-40 58z" fill="none" stroke="' + C + '" stroke-width="5"/>');
    body.push(hd(748, 300, 10, B, C, 2.4));
    // string + grip
    body.push('<path d="M626 250 L772 600 L730 940" fill="none" stroke="' + B + '" stroke-width="1.8" opacity=".9"/>');
    body.push('<polygon points="860,548 894,556 888,626 854,618" fill="' + C + '" stroke="' + K + '" stroke-width="3"/>');
    // arrow
    body.push(hl(168, 698, 842, 762, K, 7));
    body.push(hl(168, 698, 842, 762, B, 3.2));
    body.push(hp([[842, 748], [884, 762], [842, 778]], B, K, 2.4));
    body.push(hl(176, 700, 150, 682, B, 2.6), hl(176, 700, 148, 708, B, 2.6), hl(196, 703, 170, 683, B, 2.6), hl(196, 703, 168, 712, B, 2.6));
    return heroGroup('bow', [860, 600], body.join(''));
  }

  /* BRONYA — two wheels */
  function heroWheel(cx, cy, r) {
    const body = [];
    body.push(hc(cx, cy, r, HC.ink, HC.blue, 10));
    body.push(hc(cx, cy, r * .88, 'none', HC.cream, 10));
    body.push(hc(cx, cy, r * .66, 'none', HC.blue, 7));
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + .25;
      body.push(hl(cx + Math.cos(a) * r * .16, cy + Math.sin(a) * r * .16,
        cx + Math.cos(a) * r * .78, cy + Math.sin(a) * r * .78, HC.cream, r * .085));
    }
    body.push(hc(cx, cy, r * .16, HC.cream, HC.ink, 4));
    body.push(hc(cx, cy, r * .07, HC.blue, 'none', 0));
    return body.join('');
  }
  function heroBronya() {
    return heroGroup('wheelL', [128, 1160], heroWheel(128, 1160, 188)) +
      heroGroup('wheelR', [944, 1232], heroWheel(944, 1232, 218));
  }

  /* LUNA — skyline of buildings */
  function heroLuna() {
    const C = HC.cream, K = HC.ink, B = HC.blue;
    const body = [];
    const buildings = [
      [16, 1282, 62, 176], [84, 1320, 50, 138], [140, 1248, 72, 210], [218, 1290, 58, 168],
      [282, 1256, 66, 202], [354, 1302, 54, 156], [30, 1206, 20, 76], [250, 1216, 14, 74],
      [320, 1228, 10, 62]
    ];
    buildings.forEach((b, i) => {
      const x = b[0], y = b[1], w = b[2], h = b[3];
      const fill = i % 3 === 0 ? K : (i % 3 === 1 ? B : C);
      body.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" stroke="' + K + '" stroke-width="2"/>');
      const cols = Math.max(2, Math.floor(w / 18)), rows = Math.max(2, Math.floor(h / 26));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if ((r * 7 + c * 5 + i) % 3 === 0) continue;
          const wx = x + 7 + c * ((w - 12) / cols), wy = y + 9 + r * ((h - 14) / rows);
          body.push('<rect x="' + f(wx) + '" y="' + f(wy) + '" width="4" height="6" fill="' + (fill === C ? K : C) + '" opacity=".85"/>');
        }
      }
    });
    body.push(hl(20, 1462, 430, 1462, C, 8));
    body.push(hl(20, 1462, 430, 1462, K, 2));
    return heroGroup('skyline', [220, 1460], body.join(''));
  }

  /* VYRON — earth + orbital station */
  function heroVyron() {
    const C = HC.cream, K = HC.ink, B = HC.blue;
    const ex = 792, ey = 202, er = 204;
    const earth = [];
    earth.push(hc(ex, ey, er, B, K, 5));
    earth.push(hp([[ex - 150, ey - 130], [ex + 150, ey + 120], [ex + 120, ey + 152], [ex - 178, ey - 96]], C, 'none', 0, 'opacity=".95"'));
    earth.push('<path d="M' + (ex - er) + ' ' + ey + ' A' + er + ' ' + er + ' 0 0 1 ' + (ex + er) + ' ' + ey + '" fill="none" stroke="' + C + '" stroke-width="3" opacity=".55"/>');
    earth.push('<g class="hero-spin" style="transform-origin:' + ex + 'px ' + ey + 'px">' +
      '<path d="M' + (ex - 120) + ' ' + (ey - 120) + ' q120 -40 240 10" fill="none" stroke="' + C + '" stroke-width="2" opacity=".45" stroke-dasharray="10 12"/>' +
      '<path d="M' + (ex - 140) + ' ' + (ey + 80) + ' q140 60 250 -10" fill="none" stroke="' + C + '" stroke-width="2" opacity=".35" stroke-dasharray="8 14"/></g>');
    const station = [];
    station.push(hl(96, 356, 498, 268, K, 15));
    station.push(hl(96, 356, 498, 268, C, 6, 'opacity=".8"'));
    for (let i = 0; i < 7; i++) {
      const t = i / 6, x = 96 + (498 - 96) * t, y = 356 + (268 - 356) * t;
      station.push(hc(x, y, 8, C, K, 3));
    }
    station.push('<rect x="118" y="196" width="128" height="74" fill="' + C + '" stroke="' + K + '" stroke-width="4" transform="rotate(-8 182 233)"/>');
    station.push('<path d="M126 206h112M126 228h112M126 250h112M150 200v66M182 200v66M214 200v66" stroke="' + B + '" stroke-width="2.4" fill="none" transform="rotate(-8 182 233)"/>');
    station.push('<rect x="286" y="150" width="96" height="118" fill="' + K + '" stroke="' + C + '" stroke-width="3" transform="rotate(6 334 209)"/>');
    station.push('<path d="M296 168h76M296 196h76M296 224h76M296 252h76" stroke="' + C + '" stroke-width="2.2" fill="none" transform="rotate(6 334 209)"/>');
    station.push('<rect x="428" y="292" width="86" height="58" fill="' + B + '" stroke="' + K + '" stroke-width="3" transform="rotate(-12 471 321)"/>');
    station.push('<path d="M436 306h70M436 328h70" stroke="' + C + '" stroke-width="2.2" fill="none" transform="rotate(-12 471 321)"/>');
    station.push('<rect x="466" y="196" width="48" height="96" rx="10" fill="' + C + '" stroke="' + K + '" stroke-width="4" transform="rotate(-10 490 244)"/>');
    station.push('<path d="M474 214h32M474 238h32M474 262h32" stroke="' + B + '" stroke-width="2.6" fill="none" transform="rotate(-10 490 244)"/>');
    station.push('<path d="M300 120 q60 -34 120 -20" fill="none" stroke="' + C + '" stroke-width="2.4" stroke-dasharray="8 10"/>');
    return heroGroup('earth', [ey, ey], bodyE(earth)) + heroGroup('station', [330, 330], station.join(''));
  }
  function bodyE(parts) { return parts.join(''); }

  /* AEMEATH — crystal cluster and the blue planet */
  function heroAemeath() {
    const C = HC.cream, K = HC.ink, B = HC.blue;
    const body = [];
    body.push(hp([[236, 182], [430, 118], [536, 288], [430, 424], [258, 372]], B, K, 5));
    body.push(hp([[236, 182], [430, 118], [470, 240], [300, 292]], C, K, 3));
    body.push(hp([[150, 282], [286, 222], [332, 404], [214, 470]], C, K, 4));
    body.push(hp([[420, 138], [566, 206], [524, 390], [430, 330]], K, C, 4));
    body.push(hp([[190, 420], [300, 362], [344, 500], [240, 548]], B, K, 4));
    body.push(hp([[344, 452], [470, 414], [498, 560], [404, 610]], C, K, 3));
    body.push(hp([[236, 182], [470, 240], [430, 424]], 'none', C, 2.4));
    body.push(hp([[420, 138], [430, 330], [524, 390]], 'none', C, 2.2));
    // blue planet top right
    body.push(hc(806, 236, 148, B, K, 5));
    body.push(hp([[660, 96], [946, 330], [910, 366], [624, 132]], C, 'none', 0, 'opacity=".95"'));
    body.push(hc(806, 236, 148, 'none', C, 2, 'opacity=".5"'));
    // sparkles
    body.push(hd(620, 200, 16, C, K, 2), hd(258, 600, 12, C, K, 2), hd(520, 560, 9, C, K, 1.6));
    return heroGroup('crystal', [420, 380], body.join(''));
  }

  const HERO_BUILD = {
    elysia: heroElysia, aemeath: heroAemeath, bronya: heroBronya,
    luna: heroLuna, kiana: heroKiana, vyron: heroVyron
  };

  const HERO_OVERLAY = false;
  function ensureHero(scene, plate, animate) {
    if (!HERO_OVERLAY || !plate || !HERO_BUILD[plate.id] || scene.heroRoot) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'hero-svg');
    svg.setAttribute('viewBox', '0 0 1024 1536');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = HERO_BUILD[plate.id]();
    scene.root.appendChild(svg);
    scene.heroRoot = svg;
    if (!animate) return;
    svg.querySelectorAll('.hero-obj').forEach((el) => {
      const cfg = OBJECT_ANIM[el.getAttribute('data-obj')] || { from: 'translate(0px,-90px) scale(.9)', dur: .7, delay: .1 };
      el.style.transform = cfg.from;
      el.style.opacity = '0.001';
    });
  }

  /* ----------------------------------------------------------
     scene objects (sword / bow / wheels / skyline / earth / crystal)
     arrive as entrance assets, then lock back into their exact
     printed position so the final plate still matches the poster.
     ---------------------------------------------------------- */
  const OBJECT_ANIM = {
    sword: { from: 'translate(46px,-120px) rotate(-7deg) scale(.97)', dur: .78, delay: .10 },
    bow: { from: 'translate(70px,-36px) rotate(4deg) scale(.94)', dur: .82, delay: .06 },
    wheelL: { from: 'translate(-78px,44px) rotate(-42deg)', dur: .86, delay: .04 },
    wheelR: { from: 'translate(86px,52px) rotate(48deg)', dur: .9, delay: .09 },
    skyline: { from: 'translate(0px,86px) scaleY(.86)', dur: .78, delay: .24 },
    earth: { from: 'translate(104px,-62px) rotate(-22deg) scale(.9)', dur: .9, delay: .02 },
    station: { from: 'translate(-84px,38px) rotate(-6deg) scale(.95)', dur: .86, delay: .12 },
    crystal: { from: 'translate(-58px,-64px) rotate(-10deg) scale(.9)', dur: .86, delay: .08 },
    bow: { from: 'translate(46px,120px) rotate(6deg) scale(.96)', dur: .92, delay: .12 },
    arrow: { from: 'translate(-160px,-10px)', dur: .8, delay: .28 },
    moto: { from: 'translate(-40px,190px) scale(.96)', dur: 1.0, delay: .12 },
    gear: { from: 'translate(58px,150px) rotate(2.5deg) scale(.96)', dur: 1.0, delay: .10 },
    aura: { from: 'scale(1.32) rotate(-5deg)', dur: .88, delay: .24 },
    arrow: { from: 'translate(-420px,-150px) rotate(-12deg)', dur: 1.45, delay: .32 }
  };

  function startObjects(scene, plate, speed) {
    if (!scene.heroRoot && !scene.objRoot) return;
    const total = Math.max(600, scene.printEnd * 1000);
    const nodes = scene.heroRoot ? scene.heroRoot.querySelectorAll('.hero-obj')
      : scene.objRoot.querySelectorAll('.scene-obj');
    nodes.forEach((el) => {
      const id = el.getAttribute('data-obj');
      const cfg = OBJECT_ANIM[id] || { from: 'translate(0px,-160px) scale(.6)', dur: .7, delay: .1 };
      const pv = (el.getAttribute('data-pivot') || '512,768').split(',').map(Number);
      el.style.transformBox = 'view-box';
      el.style.transformOrigin = pv[0] + 'px ' + pv[1] + 'px';
      if (REDUCED) return;
      el.style.transform = cfg.from;
      el.style.opacity = '0';
      anim(el, [
        { opacity: 0, easing: 'ease-out' },
        { opacity: 1, offset: .2, easing: 'ease-in-out' },
        { opacity: 1 }
      ], {
        duration: Math.max(260, total * cfg.dur * .55), delay: total * cfg.delay, easing: 'linear', fill: 'both'
      });
      anim(el, [
        { transform: cfg.from, easing: EASE.glide },
        { transform: 'translate(0px,0px) rotate(0deg) scale(1.004)', offset: .8, easing: EASE.calm },
        { transform: 'translate(0px,0px) rotate(0deg) scale(1)' }
      ], {
        duration: Math.max(560, total * cfg.dur * 1.08), delay: total * cfg.delay,
        easing: 'linear', fill: 'both'
      });
      if (id === 'bow') {
        // make the bow read clearly in the final plate
        el.style.filter = 'drop-shadow(0 0 5px rgba(242,228,209,.55))';
      }
    });
  }

  /* ----------------------------------------------------------
     background details: independent, looping, always inside the frame
     ---------------------------------------------------------- */
  function bgSquares(list, sizeBase) {
    let out = '';
    list.forEach((q, i) => {
      const fill = q.c || (i % 3 === 0 ? '#2f6cff' : (i % 3 === 1 ? '#0a0a0c' : '#f2e4d1'));
      out += '<rect class="bgq" data-i="' + i + '" x="' + q.x + '" y="' + q.y + '" width="' + q.s +
        '" height="' + q.s + '" fill="' + fill + '" opacity="' + (q.o == null ? .85 : q.o) +
        '" transform="rotate(' + (q.r || 0) + ' ' + (q.x + q.s / 2) + ' ' + (q.y + q.s / 2) + ')"/>';
    });
    return out;
  }

  function svgOrigin(el) {
    let cx = 0, cy = 0;
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') {
      cx = (+el.getAttribute('x') || 0) + (+el.getAttribute('width') || 0) / 2;
      cy = (+el.getAttribute('y') || 0) + (+el.getAttribute('height') || 0) / 2;
    } else if (tag === 'polygon') {
      const nums = ((el.getAttribute('points') || '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      let sx = 0, sy = 0, n = 0;
      for (let k = 0; k + 1 < nums.length; k += 2) { sx += nums[k]; sy += nums[k + 1]; n++; }
      cx = n ? sx / n : 0;
      cy = n ? sy / n : 0;
    } else if (tag === 'g') {
      const r = el.querySelector('rect');
      if (r) { cx = (+r.getAttribute('x') || 0); cy = (+r.getAttribute('y') || 0); }
    }
    el.style.transformBox = 'view-box';
    el.style.transformOrigin = cx + 'px ' + cy + 'px';
    return [cx, cy];
  }

  function buildBgFx(scene, plate) {
    const id = plate.id;
    const B = '#2f6cff', C = '#f2e4d1', K = '#0a0a0c';
    let inner = '';
    if (id === 'luna') {
      let win = '';
      for (let i = 0; i < 12; i++) {
        const x = 18 + (i * 37) % 380;
        const y = 1190 + ((i * 53) % 180);
        win += '<rect class="lwin" data-i="' + i + '" x="' + x + '" y="' + y + '" width="4" height="7" fill="' + (i % 3 ? C : B) + '"/>';
      }
      inner = win;  // reticle is transient (FX only) - it must not stay in the scene
    } else if (id === 'vyron') {
      let sat = '';
      const satPos = [[612, 268], [962, 236], [806, 84]];
      for (let i = 0; i < 3; i++) {
        const p = satPos[i];
        sat += '<g class="vsat" data-i="' + i + '"><rect x="' + (p[0] - 4) + '" y="' + (p[1] - 4) +
          '" width="8" height="8" fill="' + (i % 2 ? C : B) + '"/></g>';
      }
      let lights = '';
      for (let i = 0; i < 6; i++) {
        lights += '<rect class="vlight" data-i="' + i + '" x="' + (80 + (i * 67) % 360) + '" y="' + (170 + (i * 41) % 440) +
          '" width="3" height="3" fill="' + (i % 2 ? C : B) + '"/>';
      }
      inner = '<ellipse class="vorbit" cx="792" cy="202" rx="204" ry="86" fill="none" stroke="' + B +
        '" stroke-width="1.4" stroke-dasharray="10 16" transform="rotate(-24 792 202)"/>' +
        '<g class="vsats">' + sat + '</g>' + lights;
    } else if (id === 'bronya') {
      let ch = '';
      for (let i = 0; i < 6; i++) {
        const y = 300 + i * 150;
        ch += '<path class="bchev" data-i="' + i + '" d="M' + (860 + (i % 2) * 30) + ' ' + y + 'l-34 16 34 16" fill="none" stroke="' + (i % 2 ? C : B) + '" stroke-width="2.4"/>';
      }
      inner = ch;
    } else if (id === 'elysia') {
      let petals = '';
      for (let i = 0; i < 6; i++) {
        const x = 60 + (i * 97) % 900;
        const y = 220 + (i * 131) % 1180;
        petals += '<polygon class="epetal" data-i="' + i + '" points="' + dia(x, y, 5 + (i % 3) * 3, i * 36) +
          '" fill="' + (i % 2 ? B : C) + '" opacity=".75"/>';
      }
      inner = petals +
        '<path d="M70 668 L860 742" stroke="' + C + '" stroke-width="3" fill="none"/>' +
        '<path d="M70 668 L860 742" stroke="' + B + '" stroke-width="1" fill="none" opacity=".8"/>' +
        '<polygon points="880,746 846,728 846,762" fill="' + B + '"/>' +
        '<path d="M96 668l-26-18M96 668l-26 18M126 672l-22-15M126 672l-22 15" stroke="' + B + '" stroke-width="2" fill="none"/>';
    } else if (id === 'kiana') {
      let em = '';
      for (let i = 0; i < 4; i++) {
        const x = 120 + (i * 113) % 760;
        const y = 980 + (i * 71) % 480;
        em += '<polygon class="kember" data-i="' + i + '" points="' + dia(x, y, 3 + (i % 3) * 2, i * 45) + '" fill="' + (i % 2 ? C : B) + '"/>';
      }
      inner = em;
    } else if (id === 'aemeath') {
      let gl = '';
      for (let i = 0; i < 6; i++) {
        const x = 120 + (i * 87) % 840;
        const y = 180 + (i * 149) % 1100;
        gl += '<polygon class="aglint" data-i="' + i + '" points="' + dia(x, y, 4 + (i % 3) * 3, i * 40) + '" fill="' + (i % 2 ? C : B) + '"/>';
      }
      inner = gl;
    }
    const squares = id === 'luna'
      ? [{ x: 60, y: 200, s: 22 }, { x: 130, y: 200, s: 22 }, { x: 200, y: 200, s: 22 },
         { x: 906, y: 980, s: 18 }, { x: 950, y: 1020, s: 14 }, { x: 90, y: 980, s: 12 }]
      : id === 'vyron'
        ? [{ x: 950, y: 340, s: 22 }, { x: 950, y: 386, s: 22 }, { x: 950, y: 432, s: 22 },
           { x: 80, y: 1200, s: 16 }, { x: 120, y: 1240, s: 12 }]
        : id === 'kiana'
          ? [{ x: 60, y: 210, s: 22 }, { x: 60, y: 258, s: 22 }, { x: 60, y: 306, s: 22 },
             { x: 940, y: 780, s: 14 }, { x: 900, y: 820, s: 10 }]
          : id === 'elysia'
            ? [{ x: 60, y: 240, s: 16 }, { x: 60, y: 282, s: 16 }, { x: 60, y: 324, s: 16 }]
            : id === 'bronya'
              ? [{ x: 900, y: 240, s: 20 }, { x: 900, y: 286, s: 20 }, { x: 80, y: 300, s: 14 }]
              : [{ x: 940, y: 200, s: 20 }, { x: 940, y: 246, s: 20 }, { x: 940, y: 292, s: 20 },
                 { x: 70, y: 1200, s: 14 }];
    inner += bgSquares(squares);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'bg-fx');
    svg.setAttribute('viewBox', '0 0 1024 1536');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = inner;
    svg.style.opacity = '0';
    scene.root.appendChild(svg);
    scene.bgRoot = svg;
    if (!REDUCED) {
      anim(svg, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 620, delay: 120, easing: EASE.glide, fill: 'both' });
    }

    // --- looping detail animations (all non-linear, all inside the frame)
    svg.querySelectorAll('.bgq').forEach((el, i) => {
      svgOrigin(el);
      anim(el, [
        { transform: 'rotate(0deg) translate(0px,0px) scale(1)' },
        { transform: 'rotate(' + (i % 2 ? 90 : -90) + 'deg) translate(' + (i % 3 ? 10 : -10) + 'px,' + (i % 2 ? -8 : 8) + 'px) scale(' + (i % 2 ? 1.25 : .82) + ')' }
      ], { duration: 2600 + i * 420, easing: 'cubic-bezier(.45,0,.55,1)', iterations: Infinity, direction: 'alternate' });
    });
    svg.querySelectorAll('.lwin').forEach((el, i) => {
      anim(el, [{ opacity: .25 }, { opacity: 1 }], {
        duration: 1400 + (i % 5) * 380, delay: i * 220, easing: 'ease-in-out', iterations: Infinity, direction: 'alternate'
      });
    });
        svg.querySelectorAll('.vsat').forEach((el, i) => {
      svgOrigin(el);
      anim(el, [
        { transform: 'translate(0px,0px)' },
        { transform: 'translate(' + (i % 2 ? -34 : 30) + 'px,' + (i % 3 ? 26 : -22) + 'px)' }
      ], { duration: 4600 + i * 900, easing: 'cubic-bezier(.4,0,.5,1)', iterations: Infinity, direction: 'alternate' });
    });
    svg.querySelectorAll('.vlight').forEach((el, i) => {
      anim(el, [{ opacity: .15 }, { opacity: .95 }], {
        duration: 900 + (i % 4) * 260, delay: i * 160, easing: 'ease-in-out', iterations: Infinity, direction: 'alternate'
      });
    });
    svg.querySelectorAll('.bchev').forEach((el, i) => {
      anim(el, [
        { transform: 'translateX(0px) scale(1)', opacity: .5 },
        { transform: 'translateX(-26px) scale(1.12)', opacity: .95 }
      ], { duration: 1300 + i * 210, easing: 'cubic-bezier(.3,0,.4,1)', iterations: Infinity, direction: 'alternate' });
    });
    svg.querySelectorAll('.epetal').forEach((el, i) => {
      svgOrigin(el);
      anim(el, [
        { transform: 'translate(0px,0px) rotate(0deg)' },
        { transform: 'translate(' + (i % 2 ? 26 : -22) + 'px,' + (i % 3 ? 40 : 28) + 'px) rotate(120deg)' }
      ], { duration: 4200 + i * 320, easing: 'cubic-bezier(.45,0,.55,1)', iterations: Infinity, direction: 'alternate' });
    });
    svg.querySelectorAll('.kember').forEach((el, i) => {
      svgOrigin(el);
      anim(el, [
        { transform: 'translate(0px,14px) scale(.7)', opacity: .3 },
        { transform: 'translate(' + (i % 2 ? 8 : -8) + 'px,-34px) scale(1)', opacity: .95 }
      ], { duration: 2100 + i * 260, easing: 'cubic-bezier(.4,0,.6,1)', iterations: Infinity, direction: 'alternate' });
    });
    svg.querySelectorAll('.aglint').forEach((el, i) => {
      svgOrigin(el);
      anim(el, [{ opacity: .2, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1.15)' }], {
        duration: 1500 + (i % 5) * 340, delay: i * 180, easing: 'ease-in-out', iterations: Infinity, direction: 'alternate'
      });
    });
  }

  /* leftover entrance vectors that are not part of the printed artwork */
  function buildLeftover(id) {
    // arrows / reticles are either extracted from the poster or transient
    return '';
  }

  /* title asset: extracted from the poster, its own independent entrance */
  function startTitleAnim(scene, plate, speed) {
    if (!scene || !scene.titleGroup || DBG.static) return;
    const g = scene.titleGroup;
    const glyphs = Array.prototype.slice.call(g.querySelectorAll('.tglyph')).sort((a, b) => {
      try {
        const A = a.getBBox(), B = b.getBBox();
        return (A.y - B.y) || (A.x - B.x);
      } catch (e) { return 0; }
    });
    if (scene.titleAnims) scene.titleAnims.forEach((x) => { try { x.cancel(); } catch (e) { } });
    scene.titleAnims = [];
    g.style.clipPath = ''; g.style.opacity = ''; g.style.transform = '';
    glyphs.forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
    if (REDUCED) { scene.titleAnimated = true; return; }
    scene.titleAnimated = true;
    const total = Math.max(1200, (scene.printEnd || 1.5) * 1000);
    const variant = state.titleVariant == null ? (TITLE_DEFAULT[plate.id] || 0) : state.titleVariant;
    const v = ((variant % 3) + 3) % 3;
    if (v === 0) {
      glyphs.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(26px) scale(.95)';
        scene.titleAnims.push(anim(el, [
          { opacity: 0, transform: 'translateY(26px) scale(.95)', easing: EASE.glide },
          { opacity: 1, transform: 'translateY(-2px) scale(1.002)', offset: .78, easing: EASE.calm },
          { opacity: 1, transform: 'none' }
        ], { duration: 620, delay: total * .55 + i * 26, easing: 'linear', fill: 'both' }));
      });
    } else if (v === 1) {
      g.style.clipPath = 'inset(0% 0% 100% 0%)';
      scene.titleAnims.push(anim(g, [
        { clipPath: 'inset(0% 0% 100% 0%)', easing: EASE.drift },
        { clipPath: 'inset(0% 0% 0% 0%)' }
      ], { duration: total * .38, delay: total * .55, easing: 'linear', fill: 'both' }));
    } else {
      g.style.opacity = '0';
      g.style.transform = 'scale(.9)';
      scene.titleAnims.push(anim(g, [
        { opacity: 0, transform: 'scale(.9) rotate(-1.4deg)', easing: EASE.glide },
        { opacity: 1, transform: 'scale(1.012) rotate(0deg)', offset: .8, easing: EASE.calm },
        { opacity: 1, transform: 'none' }
      ], { duration: 780, delay: total * .58, easing: 'linear', fill: 'both' }));
    }
  }

  function dropObjClips(scene) {
    if (!scene.objRoot) return;
    scene.objRoot.querySelectorAll('.scene-obj').forEach((el) => el.removeAttribute('clip-path'));
  }

  /* negative-colour arrow that glides into the printed bow */
  function elysiaArrowFly(scene) {
    if (!scene || !scene.root || REDUCED) return;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'fx-svg arrow-neg');
    svg.setAttribute('viewBox', '0 0 1024 1536');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;' +
      'z-index:6;overflow:visible;filter:invert(1)';
    svg.innerHTML =
      '<g>' +
      '<line x1="352" y1="652" x2="876" y2="628" stroke="#0E0E0E" stroke-width="14"/>' +
      '<line x1="352" y1="652" x2="876" y2="628" stroke="#F4E4CE" stroke-width="6"/>' +
      '<polygon points="946,626 852,594 868,660" fill="#0E0E0E"/>' +
      '<polygon points="362,630 326,614 336,656" fill="#0E0E0E"/>' +
      '<polygon points="362,674 326,690 336,648" fill="#0E0E0E"/>' +
      '</g>';
    scene.root.appendChild(svg);
    anim(svg, [{ transform: 'translate(-52%, -9%) rotate(-6deg)', opacity: .9 },
               { transform: 'translate(0,0) rotate(0deg)', opacity: 1 }],
      { duration: 1500, delay: 260, easing: EASE.drift, fill: 'both' });
    anim(svg, [{ filter: 'invert(1)' }, { filter: 'invert(0)' }],
      { duration: 850, delay: 1450, easing: EASE.calm, fill: 'both' });
    anim(svg, [{ opacity: 1 }, { opacity: 0 }],
      { duration: 260, delay: 2320, easing: EASE.calm, fill: 'both' });
  }

  function settleScene(scene, plate) {
    dropObjClips(scene);

    if (!scene.titleAnimated) {
      startTitleAnim(scene, plate, 1);
    } else if (scene.titleGroup) {
      // already played during the print; lock it in without replaying
      if (scene.titleAnims) scene.titleAnims.forEach((x) => { try { x.cancel(); } catch (e) { } });
      scene.titleAnims = [];
      const g = scene.titleGroup;
      g.style.clipPath = ''; g.style.opacity = ''; g.style.transform = '';
      g.querySelectorAll('.tglyph').forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
    }
    const leftover = buildLeftover(plate.id);
    if (leftover) {
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      r.setAttribute('class', 'fx-svg residue-svg');
      r.setAttribute('viewBox', '0 0 1024 1536');
      r.setAttribute('aria-hidden', 'true');
      r.innerHTML = leftover;
      scene.root.appendChild(r);
      scene.residueRoot = r;
      if (!REDUCED) {
        r.style.opacity = '0';
        anim(r, [{ opacity: 0, transform: 'scale(.988)' }, { opacity: 1, transform: 'none' }],
          { duration: 560, delay: 80, easing: EASE.glide, fill: 'both' });
      }
    }
    buildBgFx(scene, plate);
  }

  /* physics: anything still hanging over the frame edge drops away */
  function endEntrance(scene) {
    const host = dom.sceneHost;
    const shreds = [];
    for (let i = 0; i < 8; i++) {
      const el = document.createElement('i');
      el.className = 'shred';
      const edge = i % 4;
      let x, y;
      if (edge === 0) { x = 20 + Math.random() * 60; y = 60 + Math.random() * 600; }
      else if (edge === 1) { x = 940 + Math.random() * 40; y = 60 + Math.random() * 600; }
      else if (edge === 2) { x = 60 + Math.random() * 800; y = 20 + Math.random() * 40; }
      else { x = 60 + Math.random() * 800; y = 1440 + Math.random() * 40; }
      el.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' +
        (4 + Math.random() * 8) + 'px;height:' + (10 + Math.random() * 16) + 'px;background:' +
        (i % 2 ? '#2f6cff' : '#f2e4d1') + ';z-index:8;pointer-events:none;';
      scene.root.appendChild(el);
      shreds.push(el);
      const dx = (Math.random() - .5) * 60;
      const dy = 40 + Math.random() * 120;
      el.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (Math.random() * 180 - 90) + 'deg)', opacity: 0 }
      ], { duration: 620 + Math.random() * 260, easing: 'cubic-bezier(.3,0,.7,1)', fill: 'both' });
    }
    clearTimeout(host._clipTimer);
    host._clipTimer = setTimeout(() => {
      if (host) host.classList.add('clipped');
      shreds.forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); });
    }, 720);
  }

  /* ----------------------------------------------------------
     scene orchestration
     ---------------------------------------------------------- */
  function show(index, opts) {
    opts = opts || {};
    index = mod(index, PLATES.length);
    if (!opts.force && state.active && index === state.idx && !state.busy) return Promise.resolve();
    if (state.busy) { state.pending = index; return Promise.resolve(); }

    state.busy = true;
    const token = ++state.token;
    const first = !!opts.first;
    const plate = PLATES[index];
    const speed = REDUCED ? .34 : (first ? 1 : .82);
    const oldScene = state.active;
    state.idx = index;
    stopAuto();
    clearGuides();
    if (dom.sceneHost) dom.sceneHost.classList.remove('clipped');

    if (!DBG.static) chromeOut(first ? 1.1 : .62);
    if (oldScene) {
      const oldRecipe = oldScene.plate && RECIPES[oldScene.plate.id];
      oldScene.erase({ speed: REDUCED ? .25 : .95, exit: oldRecipe && oldRecipe.exit });
    }
    dom.paper.style.backgroundColor = plate.cream;
    dom.plate.style.backgroundColor = plate.cream;

    const recipe = RECIPES[plate.id];
    const scene = new InkScene(plate);
    scene.speed = speed;
    scene.schedule(recipe, speed);
    scene.onPrinted = function (sc) { settleScene(sc, plate); endEntrance(sc); };
    scene.root.style.opacity = '0';
    dom.sceneHost.appendChild(scene.root);
    state.active = scene;

    if (DBG.static) {
      scene.root.classList.add('settled');
      scene.root.style.opacity = '';
      if (scene.fxRoot && scene.fxRoot.parentNode) scene.fxRoot.parentNode.removeChild(scene.fxRoot);
      scene.fxRoot = null;
      ensureHero(scene, plate, false);
      settleScene(scene, plate);
      if (dom.sceneHost) dom.sceneHost.classList.add('clipped');
      paintChrome(plate);
      chromeSettle();
      clearGuides();
      dom.frame.style.opacity = '1';
      state.busy = false;
      return Promise.resolve();
    }

    const draw = () => {
      if (token !== state.token) return;
      scene.root.style.opacity = '';
      scene.play(recipe);
      startObjects(scene, plate, speed);
      startTitleAnim(scene, plate, speed);
      runGuides(recipe, speed);
      paintChrome(plate);
      chromeIn(speed, first ? .42 : .06);
      if (!REDUCED) {
        anim(dom.plateFlash, [
          { opacity: 0 }, { opacity: .14, offset: .12 }, { opacity: 0 }
        ], { duration: 460 * speed, easing: EASE.out });
      }
      const end = scene.printEnd;
      state.timers.push(setTimeout(() => finishFlash(speed), Math.max(0, (end - .16) * 1000)));
    };
    const startDelay = first ? 0 : (REDUCED ? 0 : 90);
    if (startDelay) state.timers.push(setTimeout(draw, startDelay));
    else draw();

    if (oldScene) {
      const kill = REDUCED ? 90 : Math.max(620, (oldScene.eraseEnd || 520) + 160);
      state.timers.push(setTimeout(() => { oldScene.destroy(); }, kill));
    }

    const total = startDelay + (scene.printEnd + (first ? .42 : .2)) * 1000;
    return wait(total).then(() => {
      if (token !== state.token) return;
      state.busy = false;
      startAuto();
      try {
        if (window.INK && INK.warm) INK.warm(PLATES[(state.idx + 1) % PLATES.length]);
      } catch (e) { }
      if (state.pending != null) {
        const p = state.pending;
        state.pending = null;
        show(p, { force: true });
      }
    });
  }

  /* ----------------------------------------------------------
     auto tour
     ---------------------------------------------------------- */
  function stopAuto(user) {
    if (state.autoTimer) { clearTimeout(state.autoTimer); state.autoTimer = 0; }
    if (user && state.auto) {
      state.auto = false;
      dom.autoToggle.setAttribute('aria-pressed', 'false');
    }
  }
  function startAuto() {
    if (!state.auto || state.busy) return;
    if (state.autoTimer) clearTimeout(state.autoTimer);
    state.autoTimer = setTimeout(() => {
      if (!state.auto) return;
      if (state.busy) { startAuto(); return; }
      show(state.idx + 1);
    }, 6400);
  }
  function cycleTitle() {
    state.titleVariant = ((state.titleVariant == null ? 0 : state.titleVariant) + 1) % TITLE_VARIANTS;
    const sc = state.active;
    if (sc && sc.plate) { sc.titleAnimated = false; startTitleAnim(sc, sc.plate, 1); }
  }

  function toggleAuto() {
    state.auto = !state.auto;
    dom.autoToggle.setAttribute('aria-pressed', state.auto ? 'true' : 'false');
    if (state.auto) startAuto(); else stopAuto();
  }

  /* ----------------------------------------------------------
     interactions
     ---------------------------------------------------------- */
  function bindUI() {
    dom.prevBtn.addEventListener('click', () => { stopAuto(true); show(state.idx - 1); });
    dom.nextBtn.addEventListener('click', () => { stopAuto(true); show(state.idx + 1); });
    dom.autoToggle.addEventListener('click', toggleAuto);

    document.addEventListener('keydown', (e) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown') { stopAuto(true); show(state.idx + 1); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') { stopAuto(true); show(state.idx - 1); e.preventDefault(); }
      else if (k === 'Home') { stopAuto(true); show(0); }
      else if (k === 'End') { stopAuto(true); show(PLATES.length - 1); }
      else if (k === 'r' || k === 'R') { replay(); }
      else if (k === 'a' || k === 'A') { toggleAuto(); }
      else if (k === 't' || k === 'T') { cycleTitle(); }
    });

    // wheel over stage
    let wheelLock = 0;
    dom.stagewrap.addEventListener('wheel', (e) => {
      const now = performance.now();
      if (now - wheelLock < 700) return;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(d) < 26) return;
      e.preventDefault();
      wheelLock = now;
      stopAuto(true);
      show(state.idx + (d > 0 ? 1 : -1));
    }, { passive: false });

    // drag / swipe
    let drag = null;
    const plate = dom.plate;
    plate.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      plate.classList.add('grabbing');
      try { plate.setPointerCapture(e.pointerId); } catch (err) { }
    });
    plate.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (Math.abs(e.clientX - drag.x) > 8) e.preventDefault();
    });
    const endDrag = (e) => {
      if (!drag) return;
      plate.classList.remove('grabbing');
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const dt = performance.now() - drag.t;
      drag = null;
      if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) {
        stopAuto(true);
        show(state.idx + (dx < 0 ? 1 : -1));
      }
    };
    plate.addEventListener('pointerup', endDrag);
    plate.addEventListener('pointercancel', () => { drag = null; plate.classList.remove('grabbing'); });

    window.addEventListener('resize', () => { /* handled by css */ });
  }

  function replay() {
    if (state.busy) return;
    stopAuto(true);
    const plate = PLATES[state.idx];
    const old = state.active;
    state.busy = true;
    state.token++;
    clearGuides();
    anim(dom.info, [{ opacity: 1 }, { opacity: .2 }], { duration: 300, easing: EASE.inOut });
    if (old) old.erase({ speed: .8 });
    wait(280).then(() => {
      if (old) old.destroy();
      state.active = null;
      const scene = new InkScene(plate);
      dom.sceneHost.appendChild(scene.root);
      state.active = scene;
      const recipe = RECIPES[plate.id];
      const speed = 1;
      scene.speed = speed;
      scene.schedule(recipe, speed);
      scene.onPrinted = function (sc) { settleScene(sc, plate); endEntrance(sc); };
      scene.play(recipe);
      startObjects(scene, plate, speed);
      startTitleAnim(scene, plate, speed);
      runGuides(recipe, speed);
      anim(dom.info, [{ opacity: .2 }, { opacity: 1 }], { duration: 500, delay: 200 });
      paintChrome(plate);
      chromeOut(.01);
      chromeIn(.9, .12);
      const end = (scene.printEnd + .2) * 1000;
      state.timers.push(setTimeout(() => finishFlash(speed), Math.max(0, (scene.printEnd - .14) * 1000)));
      wait(end).then(() => {
        state.busy = false;
        startAuto();
      });
    });
  }

  /* ----------------------------------------------------------
     tilt + sheen
     ---------------------------------------------------------- */
  function initTilt() {
    if (REDUCED) return;
    const wrap = dom.stagewrap;
    wrap.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = dom.plate.getBoundingClientRect();
      const nx = clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth * .42), -1, 1);
      const ny = clamp((e.clientY - (r.top + r.height / 2)) / (window.innerHeight * .42), -1, 1);
      state.tilt.tx = nx;
      state.tilt.ty = ny;
      dom.plate.style.setProperty('--mx', (50 + nx * 34).toFixed(1) + '%');
      dom.plate.style.setProperty('--my', (42 + ny * 34).toFixed(1) + '%');
    });
    wrap.addEventListener('pointerleave', () => { state.tilt.tx = 0; state.tilt.ty = 0; });
    const loop = () => {
      const t = state.tilt;
      t.x += (t.tx - t.x) * .075;
      t.y += (t.ty - t.y) * .075;
      if (Math.abs(t.x) > .001 || Math.abs(t.y) > .001) {
        dom.plate.style.transform = 'rotateX(' + (-t.y * 2.6).toFixed(2) + 'deg) rotateY(' + (t.x * 4.2).toFixed(2) + 'deg)';
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  /* ----------------------------------------------------------
     ambient dust canvas
     ---------------------------------------------------------- */
  function initAmbient() {
    const c = dom.ambient;
    if (!c) return;
    const ctx = c.getContext('2d');
    let W, H, dpr;
    const parts = [];
    const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    function resize() {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      c.width = W * dpr; c.height = H * dpr;
      c.style.width = W + 'px'; c.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);
    const N = 36;
    for (let i = 0; i < N; i++) {
      parts.push({
        x: rng() * W, y: rng() * H,
        vx: (rng() - .5) * .09, vy: -.05 - rng() * .14,
        r: .4 + rng() * 1.5,
        a: .05 + rng() * .17,
        blue: rng() > .62,
        ph: rng() * 6.28
      });
    }
    let last = performance.now();
    let lastPaint = 0;
    function frame(now) {
      // ambient dust only needs a calm 30fps cadence; keeps the main thread free
      if (now - lastPaint < 33) { requestAnimationFrame(frame); return; }
      lastPaint = now;
      const dt = Math.min(50, Math.max(17, now - last)); last = now;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.x += p.vx * dt * .06;
        p.y += p.vy * dt * .06;
        p.ph += dt * .0008;
        if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        const alpha = p.a * (0.55 + 0.45 * Math.sin(p.ph));
        ctx.beginPath();
        ctx.fillStyle = p.blue ? 'rgba(64,122,255,' + alpha.toFixed(3) + ')' : 'rgba(242,228,209,' + alpha.toFixed(3) + ')';
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    if (!REDUCED) requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------
     boot / loading
     ---------------------------------------------------------- */
  function buildBoot() {
    dom.bootSwatches.innerHTML = PLATES.map((p, i) =>
      '<span class="boot-swatch" data-n="' + p.num + '"></span>').join('');
    const sw = $$('.boot-swatch', dom.bootSwatches);
    // random dust halo behind the wordmark
  }

  function bootIntro() {
    const words = $$('.boot-word');
    anim(dom.bootEyebrow, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
      { duration: 640, delay: 140, easing: EASE.out });
    words.forEach((w, i) => {
      anim(w, [{ transform: 'translateY(112%)' }, { transform: 'translateY(0)' }],
        { duration: 900, delay: 220 + i * 120, easing: EASE.out });
      anim(w, [
        { textShadow: '34px 42px 0 #0a3a9e' },
        { textShadow: '6px 7px 0 #0a3a9e' }
      ], { duration: 1250, delay: 300 + i * 110, easing: 'cubic-bezier(.2,.9,.2,1)' });
    });
    anim(dom.bootSub, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
      { duration: 700, delay: 640, easing: EASE.out });
    anim(dom.bootTrack, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: 850, delay: 720, easing: EASE.out, fill: 'both' });
    dom.bootTrack.style.transformOrigin = '0 50%';
    anim(dom.bootBand, [{ opacity: 0, transform: 'rotate(-26deg) translateX(9%)' }, { opacity: 1, transform: 'rotate(-26deg) translateX(0)' }],
      { duration: 1000, delay: 0, easing: EASE.out });
    anim(dom.bootDisc, [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 1100, delay: 120, easing: EASE.back });
    anim($('.boot-grid'), [{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 300 });
    anim(dom.bootSide, [{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' }],
      { duration: 800, delay: 900, easing: EASE.out });
    anim(dom.bootFoot, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 1100 });
    $$('.boot-swatch').forEach((s, i) => {
      anim(s, [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 420, delay: 560 + i * 45, easing: EASE.back });
    });
  }

  function bootProgress() {
    return new Promise((resolve) => {
      const sw = $$('.boot-swatch', dom.bootSwatches);
      const t0 = performance.now();
      const dur = REDUCED ? 500 : 2350;
      let lastStatus = '';
      const statuses = [
        [0, 'SPOOLING PAPER'],
        [12, 'INK / BLACK PLATE'],
        [34, 'INK / BLUE PLATE'],
        [56, 'TRACING CONTOURS'],
        [76, 'REGISTERING PLATES'],
        [90, 'DRAWING VECTORS'],
        [99.9, 'READY TO PRINT']
      ];
      function frame(now) {
        const p = clamp((now - t0) / dur, 0, 1);
        const e = easeInOutCubic(p);
        const pct = Math.min(100, Math.round(e * 100));
        dom.bootPct.textContent = pad2(pct);
        dom.bootBar.style.width = (e * 100).toFixed(2) + '%';
        sw.forEach((s, i) => {
          s.classList.toggle('on', e > (i + .55) / sw.length);
        });
        let st = statuses[0][1];
        for (const [th, txt] of statuses) { if (pct >= th) st = txt; }
        if (st !== lastStatus) { lastStatus = st; dom.bootStatus.textContent = st; }
        if (p < 1) requestAnimationFrame(frame);
        else setTimeout(resolve, REDUCED ? 80 : 300);
      }
      requestAnimationFrame(frame);
    });
  }

  async function exitBoot() {
    // begin the first plate while the sheet is still covering the screen
    show(DBG.startAt ? DBG.scene : 0, { first: true, force: true });
    await wait(REDUCED ? 20 : 40);
    const sheet = dom.bootSheet;
    if (REDUCED) {
      anim(sheet, [{ opacity: 1 }, { opacity: 0 }], { duration: 340, easing: 'linear' });
      dom.boot.style.transition = 'opacity .35s ease';
      await wait(360);
    } else {
      anim(dom.bootCopy, [
        { opacity: 1, transform: 'translateY(-50%)' },
        { opacity: 0, transform: 'translateY(-58%)' }
      ], { duration: 520, easing: 'cubic-bezier(.6,0,.4,1)' });
      anim(dom.bootSide, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'linear' });
      anim(dom.bootFoot, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'linear' });
      anim(dom.bootDisc, [
        { opacity: 1, transform: 'scale(1) rotate(0deg)' },
        { opacity: 0, transform: 'scale(1.12) rotate(10deg)' }
      ], { duration: 720, delay: 60, easing: 'cubic-bezier(.6,0,.4,1)' });
      anim(dom.bootBand, [
        { opacity: 1, transform: 'rotate(-26deg) translateX(0)' },
        { opacity: 0, transform: 'rotate(-26deg) translateX(-10%)' }
      ], { duration: 700, delay: 80, easing: 'cubic-bezier(.5,0,.6,1)' });
      anim(sheet, [
        {
          clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)',
          transform: 'translateY(0)'
        },
        {
          clipPath: 'polygon(0 0, 100% 0, 100% 0%, 0 0%)',
          transform: 'translateY(-2%)'
        }
      ], { duration: 820, delay: 30, easing: 'cubic-bezier(.83,0,.17,1)' });
      await wait(860);
    }
    if (dom.boot && dom.boot.parentNode) dom.boot.parentNode.removeChild(dom.boot);
    document.body.classList.add('ready');
    state.booted = true;
    if (DBG.freeze != null) {
      await wait(60);
      freezeFrame(DBG.freeze);
    }
  }

  function freezeFrame(t) {
    dom.frame.style.opacity = '1';
    if (window.PLATE_APP) window.PLATE_APP.debugFreeze = true;
    const list = document.getAnimations ? document.getAnimations() : [];
    list.forEach((a) => {
      try { a.pause(); a.currentTime = t * 1000; } catch (e) { }
    });
  }

  /* ----------------------------------------------------------
     boot sequence
     ---------------------------------------------------------- */
  async function boot() {
    grabDom();
    buildNav();
    buildBoot();
    initAmbient();
    initTilt();
    bindUI();
    if (DBG.nograin) document.body.classList.add('no-tex');
    if (DBG.static || DBG.freeze != null) document.body.classList.add('no-transitions');
    dom.plate.style.backgroundColor = PLATES[0].cream;
    dom.paper.style.backgroundColor = PLATES[0].cream;
    dom.bootPct.textContent = '00';

    if (DBG.skipboot) {
      if (dom.boot) dom.boot.parentNode.removeChild(dom.boot);
      dom.frame.classList.add('is-live');
      document.body.classList.add('ready');
      state.booted = true;
      show(DBG.startAt ? DBG.scene : 0, { first: true, force: true });
      if (DBG.freeze != null) {
        // wait for the incoming scene to exist, then freeze the whole timeline
        for (let i = 0; i < 120 && !state.active; i++) await wait(16);
        await wait(80);
        freezeFrame(DBG.freeze);
      }
      return;
    }

    bootIntro();
    try { if (window.INK && INK.preloadAll) INK.preloadAll(PLATES.slice(0, 2)); } catch (e) { }
    if (DBG.bootfreeze != null) {
      dom.bootPct.textContent = '64';
      dom.bootBar.style.width = '64%';
      dom.bootStatus.textContent = 'REGISTERING PLATES';
      $$('.boot-swatch').forEach((el, i) => el.classList.toggle('on', i < 4));
      dom.frame.classList.add('is-live');
      await wait(60);
      freezeFrame(DBG.bootfreeze);
      return;
    }
    await bootProgress();
    dom.frame.classList.add('is-live');
    await exitBoot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* debug / automation hook */
  window.PLATE_APP = {
    show, replay, state, freezeFrame, cycleTitle,
    plates: PLATES
  };
})();

