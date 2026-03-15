// ============================================================
// Kalma - Combined Ameba/Magma/Plazma particle animation
// Converted from VB6/DirectX7 Sensory Software originals
// Three modes switchable via UI buttons or gamepad bumpers
// ============================================================
(function () {
  'use strict';

  const RENDER_W = 320;
  const RENDER_H = 240;
  const MODES = ['magma', 'plazma', 'ameba'];
  const MODE_LABELS = ['Magma', 'Plazma', 'Ameba'];

  let currentMode = 0;
  let running = false;
  let mx = RENDER_W / 3, my = RENDER_H * 2 / 3;
  let lastActivityTime = performance.now();
  let isIdle = false;
  const IDLE_THRESHOLDS = { magma: 500, plazma: 5000 };

  // Visible canvas (screen-sized) and offscreen canvas (640x480 rendering)
  const canvas = document.getElementById('kalma-canvas');
  const displayCtx = canvas.getContext('2d');
  const offCanvas = document.createElement('canvas');
  offCanvas.width = RENDER_W;
  offCanvas.height = RENDER_H;
  const ctx = offCanvas.getContext('2d');
  let imgData, rgbaPixels, indexBuf;
  let displayScaleX = 1, displayScaleY = 1;

  function initCanvas() {
    imgData = ctx.createImageData(RENDER_W, RENDER_H);
    rgbaPixels = new Uint32Array(imgData.data.buffer);
    indexBuf = new Uint8Array(RENDER_W * RENDER_H);
    indexBuf.fill(0);
  }

  // ============================================================
  // SHARED UTILITIES
  // ============================================================

  function clamp(v) { return Math.max(0, Math.min(255, v | 0)); }

  function packRGBA(r, g, b) {
    return (255 << 24) | (clamp(b) << 16) | (clamp(g) << 8) | clamp(r);
  }

  function hslPack(h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    let r, g, b2;
    if (h < 60) { r = c; g = x; b2 = 0; } else if (h < 120) { r = x; g = c; b2 = 0; }
    else if (h < 180) { r = 0; g = c; b2 = x; } else if (h < 240) { r = 0; g = x; b2 = c; }
    else if (h < 300) { r = x; g = 0; b2 = c; } else { r = c; g = 0; b2 = x; }
    return packRGBA((r + m) * 255, (g + m) * 255, (b2 + m) * 255);
  }

  function sharedBlur1(blurFactor) {
    if (blurFactor <= 0) return;
    const w = RENDER_W, h = RENDER_H, buf = indexBuf;
    const passes = Math.max(1, blurFactor - 1);
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          buf[i] = ((buf[i-w-1]+buf[i-w]+buf[i-w+1]+buf[i-1]+buf[i]+buf[i+1]+buf[i+w-1]+buf[i+w]+buf[i+w+1]) / 9) | 0;
        }
      }
    }
  }

  function sharedBlur3(blurFactor, direction) {
    if (blurFactor <= 0) return;
    const w = RENDER_W, h = RENDER_H, buf = indexBuf;
    const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
    const [dx, dy] = dirs[direction % 8];
    const passes = Math.max(1, blurFactor - 1);
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const nx = x + dx, ny = y + dy, px2 = x - dx, py2 = y - dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && px2 >= 0 && px2 < w && py2 >= 0 && py2 < h) {
            buf[y * w + x] = ((buf[py2*w+px2] + buf[y*w+x] + buf[ny*w+nx]) / 3) | 0;
          }
        }
      }
    }
  }

  function sharedBlur4(blurFactor) {
    if (blurFactor <= 0) return;
    const w = RENDER_W, h = RENDER_H, buf = indexBuf;
    const passes = Math.max(1, blurFactor - 1);
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          buf[i] = ((buf[i-w-1]+buf[i-w]+buf[i-w+1]+buf[i-1]+buf[i]*4+buf[i+1]+buf[i+w-1]+buf[i+w]+buf[i+w+1]) / 12) | 0;
        }
      }
    }
  }

  function sharedMirror(mode) {
    if (mode === 0) return;
    const w = RENDER_W, h = RENDER_H, buf = indexBuf;
    switch (mode) {
      case 1:
        for (let y = 0; y < h; y++) for (let x = 0; x < w/2; x++) buf[y*w+(w-1-x)] = buf[y*w+x];
        break;
      case 2:
        for (let y = 0; y < h/2; y++) for (let x = 0; x < w; x++) buf[(h-1-y)*w+x] = buf[y*w+x];
        break;
      case 3:
        for (let y = 0; y < h/2; y++) for (let x = 0; x < w/2; x++) {
          const v = buf[y*w+x]; buf[y*w+(w-1-x)] = v; buf[(h-1-y)*w+x] = v; buf[(h-1-y)*w+(w-1-x)] = v;
        }
        break;
      case 4:
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (y > Math.floor(x*h/w)) {
            const sy = Math.floor(x*h/w), sx = Math.floor(y*w/h);
            if (sx < w && sy < h) buf[y*w+x] = buf[sy*w+sx];
          }
        }
        break;
    }
  }

  function mapToRGBA(pal) {
    const n = RENDER_W * RENDER_H;
    for (let i = 0; i < n; i++) {
      rgbaPixels[i] = indexBuf[i] > 0 ? pal[indexBuf[i]] : 0xFF000000;
    }
  }

  // ============================================================
  // AMEBA ENGINE
  // ============================================================
  const amebaEngine = (() => {
    const MAX_P = 2000;
    const palettes = [];
    const st = {
      particleCount: 1000, particles: [],
      style: 0, position: 0, blurFactor: 6,
      palIndex: 0, paletteCycle: 2, stepNo: 1,
      border: 0, crosshairs: 0, lightning: 0, halfLifeStyle: 0,
    };

    function initPalettes() {
      for (let p = 0; p < 7; p++) palettes[p] = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        const t = i / 256;
        // Pal 0: Full rainbow loop
        palettes[0][i] = hslPack(t * 360, 90, 50);
        // Pal 1: Fire & Ice (red/orange → blue/purple → loop, brightened)
        palettes[1][i] = hslPack(t < 0.5 ? 30 - t * 60 : 200 + (t - 0.5) * 320, 85, 45 + 20 * Math.sin(t * Math.PI * 2));
        // Pal 2: Ocean & Forest (green → teal → blue → green loop, brightened)
        palettes[2][i] = hslPack(120 + Math.sin(t * Math.PI * 2) * 90, 80, 50 + 12 * Math.sin(t * Math.PI * 2));
        // Pal 3: Neon (pink → yellow → cyan → pink loop)
        palettes[3][i] = hslPack(320 + t * 360, 100, 55);
        // Pal 4: Aurora (green → purple → blue → teal loop, brightened)
        palettes[4][i] = hslPack((120 + t * 240) % 360, 75, 50 + 12 * Math.sin(t * Math.PI * 2));
        // Pal 5: Pastel Rainbow (soft pastels)
        palettes[5][i] = hslPack(t * 360, 50, 75);
        // Pal 6: Pastel Warm (pink → peach → lavender → rose loop)
        palettes[6][i] = hslPack(330 + t * 120, 55, 78);
        // Apply striped effect for stepNo === 2
        if (st.stepNo === 2 && i % 2 === 0) {
          for (let p = 0; p < 7; p++) {
            const v = palettes[p][i]; const r = (v & 0xFF) >> 2; const g = ((v >> 8) & 0xFF) >> 2; const b = ((v >> 16) & 0xFF) >> 2;
            palettes[p][i] = (255 << 24) | (b << 16) | (g << 8) | r;
          }
        }
      }
    }

    function getHalfLife() {
      switch (st.halfLifeStyle) {
        case 0: return Math.random() * 0.05;
        case 1: return 0.1;
        case 2: return 0.25;
        default: return 0.1;
      }
    }

    function getOriginX() {
      let x = mx;
      switch (st.position) {
        case 0: break;
        case 1: break;
        case 2: x = [RENDER_W * 0.25, RENDER_W * 0.5, RENDER_W * 0.75][Math.floor(Math.random() * 3)]; break;
        case 3: x = [RENDER_W * 0.2, RENDER_W * 0.8, RENDER_W * 0.2, RENDER_W * 0.8][Math.floor(Math.random() * 4)]; break;
        case 4: x = RENDER_W / 2 + Math.cos(Math.floor(Math.random() * 6) * Math.PI / 3) * 60; break;
      }
      if (st.lightning === 2) x = Math.random() * RENDER_W;
      return x;
    }

    function getOriginY() {
      let y = my;
      switch (st.position) {
        case 0: break;
        case 1: y = [RENDER_H * 0.3, RENDER_H * 0.7][Math.floor(Math.random() * 2)]; break;
        case 2: y = RENDER_H / 2; break;
        case 3: y = [RENDER_H * 0.2, RENDER_H * 0.2, RENDER_H * 0.8, RENDER_H * 0.8][Math.floor(Math.random() * 4)]; break;
        case 4: y = RENDER_H / 2 + Math.sin(Math.floor(Math.random() * 6) * Math.PI / 3) * 45; break;
      }
      if (st.lightning === 1) y = Math.random() * RENDER_H;
      return y;
    }

    function initParticles() {
      st.particles = [];
      for (let i = 0; i < MAX_P; i++) {
        const speed = 1 + Math.floor(Math.random() * 3);
        let angle, angleAdj;
        if (st.style === 0) {
          angle = Math.random() * Math.PI * 2;
          angleAdj = (Math.random() - 0.5) * 0.1;
        } else {
          const dirs = st.style + 2;
          angle = (Math.PI * 2 / dirs) * Math.floor(Math.random() * dirs);
          angleAdj = (Math.random() < 0.06) ? (Math.random() - 0.5) * 0.2 : 0;
        }
        st.particles.push({ x: getOriginX(), y: getOriginY(), speed, angle, angleAdj, decay: 1, halfLife: getHalfLife() });
      }
    }

    function cyclePalette() {
      const pal = palettes[st.palIndex];
      const pe1 = pal[0], pe2 = pal[1];
      for (let i = 0; i < 256 - st.stepNo; i++) pal[i] = pal[i + st.stepNo];
      if (st.stepNo > 1) { pal[254] = pe1; pal[255] = pe2; }
      else { pal[255] = pe1; }
    }

    function renderFrame() {
      const pal = palettes[st.palIndex];
      const count = st.particleCount;
      const w = RENDER_W, h = RENDER_H;
      for (let i = 0; i < count; i++) {
        const p = st.particles[i];
        p.decay -= p.halfLife;
        if (p.decay <= 0 || p.x < 0 || p.x >= w || p.y < 0 || p.y >= h) {
          p.x = getOriginX(); p.y = getOriginY();
          p.decay = 1; p.halfLife = getHalfLife();
          if (st.style === 0) { p.angle = Math.random() * Math.PI * 2; p.angleAdj = (Math.random() - 0.5) * 0.1; }
          else { const dirs = st.style + 2; p.angle = (Math.PI * 2 / dirs) * Math.floor(Math.random() * dirs); p.angleAdj = (Math.random() < 0.06) ? (Math.random() - 0.5) * 0.2 : 0; }
          p.speed = 1 + Math.floor(Math.random() * 3);
        }
        p.angle += p.angleAdj;
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed;
        const px2 = Math.floor(p.x), py2 = Math.floor(p.y);
        if (px2 >= 0 && px2 < w && py2 >= 0 && py2 < h) {
          const idx = Math.min(255, Math.floor(p.decay * 200) + 55);
          indexBuf[py2 * w + px2] = Math.max(indexBuf[py2 * w + px2], idx);
        }
      }
      // Borders
      if (st.border === 0) {
        for (let x = 0; x < w; x++) { indexBuf[x] = 200; indexBuf[w+x] = 200; indexBuf[(h-1)*w+x] = 200; indexBuf[(h-2)*w+x] = 200; }
        for (let y = 0; y < h; y++) { indexBuf[y*w] = 200; indexBuf[y*w+1] = 200; indexBuf[y*w+w-1] = 200; indexBuf[y*w+w-2] = 200; }
      } else if (st.border === 2) {
        for (let x = 0; x < w; x++) { indexBuf[x] = 0; indexBuf[w+x] = 0; indexBuf[(h-1)*w+x] = 0; indexBuf[(h-2)*w+x] = 0; }
        for (let y = 0; y < h; y++) { indexBuf[y*w] = 0; indexBuf[y*w+1] = 0; indexBuf[y*w+w-1] = 0; indexBuf[y*w+w-2] = 0; }
      }
      // Crosshairs
      if (st.crosshairs === 1 || st.crosshairs === 3) {
        const hy = Math.floor(my);
        if (hy > 0 && hy < h) for (let x = 0; x < w; x++) indexBuf[hy * w + x] = 128;
      }
      if (st.crosshairs === 2 || st.crosshairs === 3) {
        const hx = Math.floor(mx);
        if (hx > 0 && hx < w) for (let y = 0; y < h; y++) indexBuf[y * w + hx] = 128;
      }
      sharedBlur1(st.blurFactor);
      mapToRGBA(pal);
      if (st.paletteCycle >= 1) {
        cyclePalette();
        if (st.paletteCycle === 1) st.paletteCycle = 0;
      }
      ctx.putImageData(imgData, 0, 0);
    }

    function triggerEffect(n) {
      switch (n) {
        case 0: st.palIndex = (st.palIndex + 1) % 7; break;
        case 1: st.style = (st.style + 1) % 9; break;
        case 2: st.palIndex = (st.palIndex + 2) % 7; break;
        case 3: st.position = (st.position + 1) % 5; break;
        case 4: st.blurFactor = 0; break;
        case 5: st.lightning = (st.lightning + 1) % 3; break;
        case 6: st.palIndex = 0; st.paletteCycle = 2; break;
        case 7: st.style = 0; st.blurFactor = 6; break;
        case 8: st.crosshairs = (st.crosshairs + 1) % 4; break;
        case 9: st.blurFactor = Math.min(8, st.blurFactor + 2); break;
      }
    }

    function handleKeyDown(e) {
      const key = e.key;
      if (key >= '0' && key <= '9') { triggerEffect(parseInt(key)); return true; }
      switch (key) {
        case ' ': st.palIndex = (st.palIndex + 1) % 7; return true;
        case 'F1': st.style = 0; return true;
        case 'F2': st.style = (st.style + 1) % 9; return true;
        case 'F3': st.position = (st.position + 1) % 5; return true;
        case 'F4': st.border = (st.border + 1) % 3; return true;
        case 'F9': st.paletteCycle = st.paletteCycle === 2 ? 0 : 2; return true;
        case 'Tab': e.preventDefault(); st.lightning = (st.lightning + 1) % 3; return true;
        case 'Enter': st.stepNo = st.stepNo === 1 ? 2 : 1; initPalettes(); return true;
        case 'Home': st.particleCount = Math.min(MAX_P, st.particleCount * 2); return true;
        case 'End': st.particleCount = Math.max(100, Math.floor(st.particleCount / 2)); return true;
        case 'PageUp': st.blurFactor = Math.min(8, st.blurFactor + 1); return true;
        case 'PageDown': st.blurFactor = Math.max(0, st.blurFactor - 1); return true;
        case 'ArrowUp': my = Math.max(0, my - 5); return true;
        case 'ArrowDown': my = Math.min(RENDER_H, my + 5); return true;
        case 'ArrowLeft': mx = Math.max(0, mx - 5); return true;
        case 'ArrowRight': mx = Math.min(RENDER_W, mx + 5); return true;
      }
      return false;
    }

    function updateControls() {}

    return {
      st, init() { initPalettes(); initParticles(); },
      renderFrame, effectPress: triggerEffect, effectRelease() {},
      onMouseDown(btn) { if (btn === 0) triggerEffect(0); else triggerEffect(6); },
      onMouseUp() {},
      onTouch() { triggerEffect(Math.floor(Math.random() * 10)); },
      handleKeyDown, handleKeyUp() { return false; },
      updateControls, frameSpeed: 100,
    };
  })();

  // ============================================================
  // MAGMA ENGINE
  // ============================================================
  const magmaEngine = (() => {
    const MAX_P = 8000;
    const palettes = [];
    const st = {
      particleCount: 8000, particles: [],
      yStore: RENDER_H / 2, position: 1,
      blurFactor: 5, palIndex: 0, paletteCycle: 2, stepNo: 1,
      border: 0, halfLifeStyle: 0, extraRandom: 0,
      smoothDirection: 8, smoothStyle: 0, mirror: 0, frameSpeed: 50,
      shadeStyle: 0,
      redShade: 128, greenShade: 64, blueShade: 128,
      redStart: 128, greenStart: 64, blueStart: 128,
      redStep: 0, greenStep: 0, blueStep: 0,
      randomiseShades: false,
    };

    function buildPal0() {
      const p = palettes[0];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(i*4+20, 10, i*3+16);
        p[i+32]    = packRGBA(127+i*4, 10, 96+i*3);
        p[i+64]    = packRGBA(256-i*8, 10, 192-i*6);
        p[i+96]    = packRGBA(10, i*4+20, i*4+20);
        p[i+128]   = packRGBA(10, 127+i*4, 127+i*4);
        p[i+160]   = packRGBA(10, Math.max(20, 256-i*8), Math.max(20, 256-i*8));
        p[i+192]   = packRGBA(i*8-1, 10, i*6+10);
        if (i+223 < 256) p[i+223] = packRGBA(Math.max(20, 256-i*8), 10, Math.max(16, 192-i*6));
      }
      p[0] = packRGBA(20, 10, 16);
    }
    function buildPal1() {
      const p = palettes[1];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(0, 0, i*8-1);
        p[i+32]    = packRGBA(0, i*4, 128+i*4);
        p[i+64]    = packRGBA(0, 128+i*4-1, 256-i*8);
        p[i+96]    = packRGBA(i*8-1, 255, 0);
        p[i+128]   = packRGBA(255, 256-i*4, 0);
        p[i+160]   = packRGBA(255, 128-i*4, 0);
        p[i+192]   = packRGBA(256-i*4, 0, i*4);
        if (i+223 < 256) p[i+223] = packRGBA(128-i*4, 0, 128+i*4-1);
      }
      p[0] = packRGBA(0, 0, 8);
    }
    function buildPal2() {
      const p = palettes[2];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(0, 64-i*2, 32-i);
        p[i+32]    = packRGBA(0, i*4, 0);
        p[i+64]    = packRGBA(i*4, 127+i*4, i);
        p[i+96]    = packRGBA(128, 255-i*4, 32-i);
        p[i+128]   = packRGBA(128-i*4, 128, i);
        p[i+160]   = packRGBA(0, 128-i*4, 32-i);
        p[i+192]   = packRGBA(i*4, i*2, i);
        if (i+223 < 256) p[i+223] = packRGBA(128-i*4, 64, 32);
      }
      p[0] = packRGBA(0, 64, 32);
    }
    function buildPal3() {
      const p = palettes[3];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(256-i*8, i*8-1, i*8-1);
        p[i+32]    = packRGBA(i*4, 253-i*4, 253);
        p[i+64]    = packRGBA(i*8-2, 256-i*8+1, 256-i*8+1);
        p[i+96]    = packRGBA(252, i*4, i*8-4);
        p[i+128]   = packRGBA(250, 0, 256-i*8);
        p[i+160]   = packRGBA(256-i*8+1, i*4, 0);
        p[i+192]   = packRGBA(i*8-1, i*8-3, i*8-3);
        if (i+223 < 256) p[i+223] = packRGBA(255, 256-i*8, 256-i*8);
      }
      p[0] = packRGBA(255, 0, 0);
    }
    function buildPal4() {
      const p = palettes[4];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(i*3, 0, i*4);
        p[i+32]    = packRGBA(96+i*3, 0, 127+i*4);
        p[i+64]    = packRGBA(192-i*6, 0, 256-i*8);
        p[i+96]    = packRGBA(i*4, i*4, 0);
        p[i+128]   = packRGBA(127+i*4, 127+i*4, 0);
        p[i+160]   = packRGBA(256-i*8, 256-i*8, 0);
        p[i+192]   = packRGBA(i*6, 0, i*8-1);
        if (i+223 < 256) p[i+223] = packRGBA(192-i*6, 0, 256-i*8);
      }
      p[0] = packRGBA(0, 0, 0);
    }

    function initShades(r, g, b) {
      const step = 3;
      st.redShade = r; st.redStart = r;
      st.greenShade = g; st.greenStart = g;
      st.blueShade = b; st.blueStart = b;
      st.redStep = r < 25 ? 0 : -step;
      st.greenStep = g < 25 ? 0 : -step;
      st.blueStep = b < 25 ? 0 : -step;
    }
    function setShade() {
      const step = 3;
      if (st.redShade >= st.redStart && st.redStep > 0) st.redStep = -step;
      if (st.blueShade >= st.blueStart && st.blueStep > 0) st.blueStep = -step;
      if (st.greenShade >= st.greenStart && st.greenStep > 0) st.greenStep = -step;
      if (st.redShade < step && st.redStep < 0) st.redStep = step;
      if (st.greenShade < step && st.greenStep < 0) st.greenStep = step;
      if (st.blueShade < step && st.blueStep < 0) st.blueStep = step;
      st.redShade = Math.min(st.redStart, st.redShade + st.redStep);
      st.greenShade = Math.min(st.greenStart, st.greenShade + st.greenStep);
      st.blueShade = Math.min(st.blueStart, st.blueShade + st.blueStep);
    }
    function buildShadePalette() {
      const p = palettes[5];
      for (let i = 0; i <= 255; i++) { setShade(); p[i] = packRGBA(st.redShade, st.greenShade, st.blueShade); }
    }

    function initPalettes() {
      for (let p = 0; p < 6; p++) palettes[p] = new Uint32Array(256);
      buildPal0(); buildPal1(); buildPal2(); buildPal3(); buildPal4();
      initShades(Math.random()*255, Math.random()*255, Math.random()*255);
      buildShadePalette();
    }

    function getXpos() {
      const w = RENDER_W;
      let x;
      switch (st.position) {
        case 1: {
          const c = Math.floor(Math.random() * 5);
          switch (c) {
            case 0: case 4: x = mx; st.yStore = my; break;
            case 1: x = w - mx; st.yStore = my; break;
            case 2: x = mx; st.yStore = (RENDER_H - my) / 2; break;
            case 3: x = w - mx; st.yStore = (RENDER_H - my) / 2; break;
          }
          break;
        }
        case 2: {
          const c = Math.floor(Math.random() * 5);
          switch (c) {
            case 0: case 4: x = mx; st.yStore = my / 2; break;
            case 1: x = mx / 2; st.yStore = RENDER_H - my; break;
            case 2: x = w - mx / 2; st.yStore = my; break;
            case 3: x = w - mx; st.yStore = RENDER_H - my / 2; break;
          }
          break;
        }
        case 3: {
          const c = Math.floor(Math.random() * 5);
          switch (c) {
            case 0: case 4: x = Math.floor(w / 3 + mx / 3); st.yStore = Math.floor(my / 4); break;
            case 1: x = mx; st.yStore = Math.floor(RENDER_H / 2 + my / 3); break;
            case 2: x = w - mx; st.yStore = Math.floor(RENDER_H / 2 - my / 3); break;
            case 3: x = Math.floor(2 * w / 3 - mx / 3); st.yStore = Math.floor(RENDER_H - my / 4); break;
          }
          break;
        }
        default: x = mx; st.yStore = my;
      }
      return x;
    }
    function getYpos() { return st.yStore; }

    function getHalfLife() {
      switch (st.halfLifeStyle) {
        case 0: return Math.random() / 16;
        case 1: return 0.1;
        case 2: return 0.5;
        case 3: return Math.random() * 2;
        default: return 0.1;
      }
    }

    const REFRESH_PER_FRAME = 500;
    let refreshCursor = 0;

    function initParticles() {
      st.particles = [];
      for (let i = 0; i < MAX_P; i++) {
        st.particles.push({ x: RENDER_W / 2, y: RENDER_H / 2, decay: 1, halfLife: 0.1, hue: (i * 256 / MAX_P) | 0 });
      }
    }

    function refreshParticles() {
      for (let n = 0; n < REFRESH_PER_FRAME; n++) {
        const p = st.particles[refreshCursor];
        p.x = RENDER_W / 2; p.y = RENDER_H / 2;
        p.decay = 1; p.halfLife = 0.1;
        refreshCursor = (refreshCursor + 1) % st.particles.length;
      }
    }

    function cyclePalette() {
      const pal = palettes[st.palIndex];
      if (st.palIndex < 5) {
        const pe1 = pal[0], pe2 = pal[1];
        for (let i = 0; i < 256 - st.stepNo; i++) pal[i] = pal[i + st.stepNo];
        if (st.stepNo > 1) { pal[254] = pe1; pal[255] = pe2; }
        else { pal[255] = pe1; }
      } else {
        for (let i = 0; i < 255; i++) pal[i] = pal[i + 1];
        setShade();
        pal[255] = packRGBA(st.redShade, st.greenShade, st.blueShade);
      }
    }

    function renderFrame() {
      refreshParticles();
      const pal = palettes[st.palIndex];
      const count = st.particleCount;
      const w = RENDER_W, h = RENDER_H;
      for (let i = 0; i < count; i++) {
        const p = st.particles[i];
        p.decay -= p.halfLife + Math.random() / 4000;
        if (p.decay <= 0) { p.decay = 1; p.x = getXpos(); p.y = getYpos(); p.halfLife = getHalfLife(); }
        const ox = getXpos(), oy = getYpos();
        switch (st.extraRandom) {
          case 0: p.x = Math.abs(ox + p.x) / 2; p.y = Math.abs(oy + p.y) / 2; break;
          case 1: p.x = Math.abs(ox - p.x);     p.y = Math.abs(oy + p.y) / 2; break;
          case 2: p.x = Math.abs(ox + p.x) / 2; p.y = Math.abs(oy - p.y);     break;
          case 3: p.x = Math.abs(2*ox + p.x) / 3; p.y = Math.abs(2*oy + p.y) / 3; break;
          case 4: p.x = Math.abs(ox + 2*p.x) / 3; p.y = Math.abs(oy + 2*p.y) / 3; break;
        }
        if (p.x > w - 2 || p.x < 2 || p.y > h - 2 || p.y < 2) { p.x = getXpos(); p.y = getYpos(); p.halfLife = getHalfLife(); }
        const px2 = Math.floor(p.x), py2 = Math.floor(p.y);
        if (px2 >= 0 && px2 < w && py2 >= 0 && py2 < h) {
          indexBuf[py2 * w + px2] = 200;
        }
      }
      // Borders
      switch (st.border) {
        case 1:
          for (let x = 0; x < w; x++) { indexBuf[x] = 128; indexBuf[w+x] = 128; indexBuf[(h-1)*w+x] = 128; indexBuf[(h-2)*w+x] = 128; indexBuf[6*w+x] = 128; indexBuf[(h-7)*w+x] = 128; indexBuf[7*w+x] = 128; indexBuf[(h-8)*w+x] = 128; }
          for (let y = 0; y < h; y++) { indexBuf[y*w] = 128; indexBuf[y*w+1] = 128; indexBuf[y*w+w-1] = 128; indexBuf[y*w+w-2] = 128; indexBuf[y*w+12] = 128; indexBuf[y*w+13] = 128; indexBuf[y*w+w-13] = 128; indexBuf[y*w+w-14] = 128; }
          break;
        case 2:
          for (let x = 0; x < w; x++) { indexBuf[x] = 0; indexBuf[w+x] = 0; indexBuf[(h-1)*w+x] = 0; indexBuf[(h-2)*w+x] = 0; indexBuf[6*w+x] = 0; indexBuf[(h-7)*w+x] = 0; indexBuf[7*w+x] = 0; indexBuf[(h-8)*w+x] = 0; }
          for (let y = 0; y < h; y++) { indexBuf[y*w] = 0; indexBuf[y*w+1] = 0; indexBuf[y*w+w-1] = 0; indexBuf[y*w+w-2] = 0; indexBuf[y*w+6] = 0; indexBuf[y*w+7] = 0; indexBuf[y*w+w-7] = 0; indexBuf[y*w+w-8] = 0; }
          break;
      }
      // Blur
      if (st.smoothStyle === 0) { sharedBlur1(st.blurFactor); }
      else { if (st.smoothDirection < 8) sharedBlur3(st.blurFactor, st.smoothDirection); else sharedBlur1(st.blurFactor); }
      sharedMirror(st.mirror);
      mapToRGBA(pal);
      if (st.paletteCycle > 0) { cyclePalette(); if (st.paletteCycle === 1) st.paletteCycle = 0; }
      ctx.putImageData(imgData, 0, 0);
    }

    function effectOn(n) {
      switch (n) {
        case 0: st.palIndex = (st.palIndex + 1) % 6; if (st.paletteCycle === 0) st.paletteCycle = 1; break;
        case 1: st.extraRandom = (st.extraRandom + 1) % 5; break;
        case 2: st.palIndex = 5; initShades(Math.random()*255, Math.random()*255, Math.random()*255); buildShadePalette(); if (st.paletteCycle === 0) st.paletteCycle = 1; break;
        case 3: st.position = (st.position + 1) % 4; break;
        case 4: st.mirror = (st.mirror + 1) % 5; break;
        case 5: st.border = (st.border + 1) % 3; break;
        case 6: st.stepNo = st.stepNo === 1 ? 2 : 1; if (st.paletteCycle === 0) st.paletteCycle = 1; break;
        case 7: st.smoothStyle = 1; st.smoothDirection = (st.smoothDirection + 1) % 8; break;
      }
      updateControls();
    }

    function handleKeyDown(e) {
      if (e.key >= '1' && e.key <= '8') { effectOn(parseInt(e.key) - 1); return true; }
      switch (e.code) {
        case 'Space': effectOn(0); return true;
        case 'PageUp': st.blurFactor = Math.min(16, st.blurFactor + (st.blurFactor < 4 ? 1 : 2)); updateControls(); return true;
        case 'PageDown': st.blurFactor = Math.max(0, st.blurFactor - (st.blurFactor > 5 ? 2 : 1)); updateControls(); return true;
        case 'Home': st.particleCount = Math.min(MAX_P, st.particleCount * 2); updateControls(); return true;
        case 'End': st.particleCount = Math.max(400, Math.floor(st.particleCount / 2)); updateControls(); return true;
        case 'ArrowLeft': st.smoothStyle = 1; st.smoothDirection = 3; return true;
        case 'ArrowRight': st.smoothStyle = 1; st.smoothDirection = 4; return true;
        case 'ArrowUp': st.smoothStyle = 1; st.smoothDirection = 1; return true;
        case 'ArrowDown': st.smoothStyle = 1; st.smoothDirection = 6; return true;
      }
      return false;
    }

    function updateControls() {}

    return {
      st, init() { initPalettes(); initParticles(); },
      renderFrame, effectPress: effectOn, effectRelease() {},
      onMouseDown(btn) { if (btn === 0) effectOn(0); else effectOn(5); },
      onMouseUp() {},
      onTouch() { effectOn(Math.floor(Math.random() * 8)); },
      handleKeyDown, handleKeyUp() { return false; },
      updateControls, get frameSpeed() { return st.frameSpeed; },
    };
  })();

  // ============================================================
  // PLAZMA ENGINE
  // ============================================================
  const plazmaEngine = (() => {
    const MAX_P = 4000;
    const palettes = [];
    const st = {
      particleCount: 2000, particles: [],
      yStore: RENDER_H / 2, style: 0, position: 0,
      blurFactor: 8, palIndex: 0, paletteCycle: 2, stepNo: 1,
      border: 0, halfLifeStyle: 0, makeCircular: 0, forceCircular: false,
      extraRandom: 0, smoothDirection: 8, smoothStyle: 0,
      useBlur4: false, mirror: 0, frameSpeed: 60, lowResPalette: false,
      shadeStyle: 0, redShade: 255, greenShade: 0, blueShade: 255,
      redStep: 0, greenStep: 0, blueStep: 0, randomiseShades: false,
    };

    function buildPal0() {
      const p = palettes[0];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(i*8-1, i*2, 256-i*8);
        p[i+32]    = packRGBA(256-i*8, 64-i*2, 0);
        p[i+64]    = packRGBA(0, 0, i*4);
        p[i+96]    = packRGBA(i*8-1, i*2, 128);
        p[i+128]   = packRGBA(256-i*8, 64-i*2, 128);
        p[i+160]   = packRGBA(i*8-1, i*2, 128-i*4);
        p[i+192]   = packRGBA(255, 64, i*8-1);
        if (i+223 < 256) p[i+223] = packRGBA(256-i*8, 64-i*2, 255);
      }
      p[0] = packRGBA(0, 0, 255);
    }
    function buildPal1() {
      const p = palettes[1];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(i*2-1, 256-i*8, 256-i*8);
        p[i+32]    = packRGBA(64+i*4, i*6, i*4);
        p[i+64]    = packRGBA(128-i*4, i*8-2, i*8-2);
        p[i+96]    = packRGBA(i*4, 256-i*8, 252);
        p[i+128]   = packRGBA(128+i*4-1, i*8-2, 250);
        p[i+160]   = packRGBA(256-i*6, 256-i*8, i*4);
        p[i+192]   = packRGBA(i*4, i*8-2, 128-i*4);
        if (i+223 < 256) p[i+223] = packRGBA(0, 255, i*8-2);
      }
      p[0] = packRGBA(0, 255, 255);
    }
    function buildPal2() {
      const p = palettes[2];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(i*4, i*8-1, 256-i*8);
        p[i+32]    = packRGBA(128-i*2, 253-i*2, i*8);
        p[i+64]    = packRGBA(128-i*4, 256-i*8, i*8-1);
        p[i+96]    = packRGBA(i*4-2, i*8-1, 252);
        p[i+128]   = packRGBA(128-i*4, 256-i*8, 256-i*8);
        p[i+160]   = packRGBA(i*8-1, 0, i*4);
        p[i+192]   = packRGBA(255, i*4, 126+i*4);
        if (i+223 < 256) p[i+223] = packRGBA(256-i*8, 0, 255);
      }
      p[0] = packRGBA(0, 0, 255);
    }
    function buildPal3() {
      const p = palettes[3];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(256-i*8, i*8-1, i*8-1);
        p[i+32]    = packRGBA(i*4, 253-i*4, 253);
        p[i+64]    = packRGBA(i*8-2, 256-i*8+1, 256-i*8+1);
        p[i+96]    = packRGBA(252, i*4, i*8-4);
        p[i+128]   = packRGBA(250, 0, 256-i*8);
        p[i+160]   = packRGBA(256-i*8+1, i*4, 0);
        p[i+192]   = packRGBA(i*8-1, i*8-3, i*8-3);
        if (i+223 < 256) p[i+223] = packRGBA(255, 256-i*8, 256-i*8);
      }
      p[0] = packRGBA(255, 0, 0);
    }
    function buildPal4() {
      const p = palettes[4];
      for (let i = 1; i <= 32; i++) {
        p[i]       = packRGBA(i*3, 0, i*4);
        p[i+32]    = packRGBA(96+i*3, 0, 127+i*4);
        p[i+64]    = packRGBA(192-i*6, 0, 256-i*8);
        p[i+96]    = packRGBA(i*4, i*4, 0);
        p[i+128]   = packRGBA(127+i*4, 127+i*4, 0);
        p[i+160]   = packRGBA(256-i*8, 256-i*8, 0);
        p[i+192]   = packRGBA(i*6, 0, i*8-1);
        if (i+223 < 256) p[i+223] = packRGBA(192-i*6, 0, 256-i*8);
      }
      p[0] = packRGBA(0, 0, 0);
    }

    function initShades(r, g, b) {
      const step = st.shadeStyle === 1 ? 8 : 4;
      const si = Math.max(1, st.shadeStyle);
      st.redShade = r; st.greenShade = g; st.blueShade = b;
      st.redStep = r < 127 ? step : -step;
      st.greenStep = g < 127 ? step : -step;
      st.blueStep = b < 127 ? step / si : -step / si;
    }
    function setShade() {
      const step = st.shadeStyle === 1 ? 8 : 4;
      if (st.redShade > (255 - step) && st.redStep > 0) { st.redStep = -step; if (st.randomiseShades) st.redStep += Math.random() * 2; }
      if (st.blueShade > (255 - step) && st.blueStep > 0) { const si = Math.max(1, st.shadeStyle); st.blueStep = -step / si; if (st.randomiseShades) st.greenStep += Math.random() * 2; }
      if (st.greenShade > (255 - step) && st.greenStep > 0) { st.greenStep = -step; if (st.randomiseShades) st.greenStep += Math.random() * 2; }
      if (st.redShade < step && st.redStep < 0) st.redStep = step;
      if (st.greenShade < step && st.greenStep < 0) st.greenStep = step;
      if (st.blueShade < step && st.blueStep < 0) { const si = Math.max(1, st.shadeStyle); st.blueStep = step / si; }
      st.redShade = ((st.redShade + st.redStep) % 256 + 256) % 256;
      st.greenShade = ((st.greenShade + st.greenStep) % 256 + 256) % 256;
      st.blueShade = ((st.blueShade + st.blueStep) % 256 + 256) % 256;
    }
    function buildShadePalette() {
      const p = palettes[5];
      for (let i = 0; i <= 255; i += st.stepNo) { setShade(); p[i] = packRGBA(st.redShade, st.greenShade, st.blueShade); }
    }
    function applyStepNo() {
      if (st.stepNo !== 2) return;
      for (let palIdx = 0; palIdx < 6; palIdx++) {
        const p = palettes[palIdx];
        for (let i = 1; i <= 255; i += 2) {
          const v = p[i]; const r = (v & 0xFF) >> 2; const g = ((v >> 8) & 0xFF) >> 2; const b = ((v >> 16) & 0xFF) >> 2;
          p[i] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
    }

    function initPalettes() {
      for (let p = 0; p < 6; p++) palettes[p] = new Uint32Array(256);
      buildPal0(); buildPal1(); buildPal2(); buildPal3(); buildPal4();
      initShades(255, 0, 255);
      buildShadePalette();
      applyStepNo();
    }

    function getXpos() {
      let x;
      switch (st.position) {
        case 0: x = mx; st.yStore = my; break;
        case 1:
          x = mx;
          st.yStore = Math.random() < 0.5 ? 7 * RENDER_H / 16 - my / 3 : 9 * RENDER_H / 16 + my / 3;
          break;
        case 2:
          if (Math.random() < 0.5) { st.yStore = 7 * RENDER_H / 16 - my / 3; x = mx; }
          else { st.yStore = 9 * RENDER_H / 16 + my / 3; x = RENDER_W - mx; }
          break;
        case 3: {
          const t = Math.random();
          if (t < 0.33) { x = mx; st.yStore = my / 3; }
          else if (t < 0.66) { x = RENDER_W / 2; st.yStore = RENDER_H / 2; }
          else { x = RENDER_W - mx; st.yStore = RENDER_H - my / 3; }
          break;
        }
        case 4: {
          const c = Math.floor(Math.random() * 5);
          switch (c) {
            case 0: case 4: x = RENDER_W / 3 + mx / 3; st.yStore = my / 4; break;
            case 1: x = mx; st.yStore = RENDER_H / 2 + my / 3; break;
            case 2: x = RENDER_W - mx; st.yStore = RENDER_H / 2 - my / 3; break;
            case 3: x = 2 * RENDER_W / 3 - mx / 3; st.yStore = RENDER_H - my / 4; break;
          }
          break;
        }
        default: x = mx; st.yStore = my;
      }
      return x;
    }
    function getYpos() { return st.yStore; }

    function getHalfLife() {
      switch (st.halfLifeStyle) {
        case 0: return Math.random() / 16;
        case 1: return 0.01;
        case 2: return Math.random() * 0.05 + 0.05;
        case 3: return 0.02;
        default: return 0.01;
      }
    }

    function initParticles() {
      st.particles = [];
      for (let i = 0; i < MAX_P; i++) {
        st.particles.push({
          x: RENDER_W / 2, y: RENDER_H / 2,
          speed: (i % 2) * 2 - 1,
          angle: (6.28 / 8) * st.style + Math.random() / 4,
          decay: Math.random(), halfLife: getHalfLife(), angleAdj: 0,
        });
      }
    }

    function cyclePalette() {
      const pal = palettes[st.palIndex];
      if (st.palIndex < 5) {
        const pe1 = pal[0], pe2 = pal[1];
        for (let i = 0; i < 256 - st.stepNo; i++) pal[i] = pal[i + st.stepNo];
        if (st.stepNo === 2) { pal[254] = pe1; pal[255] = pe2; }
        else { pal[255] = pe1; }
      } else {
        for (let i = 0; i < 256 - st.stepNo; i++) pal[i] = pal[i + st.stepNo];
        setShade();
        pal[255] = packRGBA(st.redShade, st.greenShade, st.blueShade);
        if (st.stepNo === 2) { setShade(); pal[254] = packRGBA(st.redShade, st.greenShade / 4, st.blueShade); }
      }
    }

    function applyLowResPalette() {
      for (let palIdx = 0; palIdx < 6; palIdx++) {
        const p = palettes[palIdx];
        for (let i = 0; i <= 250; i += 12) for (let j = 1; j < 12 && i + j < 256; j++) p[i + j] = p[i];
      }
    }
    function rebuildAllPalettes() {
      buildPal0(); buildPal1(); buildPal2(); buildPal3(); buildPal4();
      buildShadePalette(); applyStepNo();
    }

    function renderFrame() {
      const pal = palettes[st.palIndex];
      const count = st.particleCount;
      const w = RENDER_W, h = RENDER_H;
      if (st.style <= 10) {
        for (let i = 0; i < count; i++) {
          const p = st.particles[i];
          p.decay -= p.halfLife + Math.random() / 4000;
          if (p.decay <= 0) {
            p.decay = 1; p.x = getXpos(); p.y = getYpos(); p.halfLife = getHalfLife();
            p.angle = (6.28 / 8) * st.style + Math.random() / 4;
            p.angleAdj = st.makeCircular / 9;
            if (p.angleAdj === 0) p.angle = (6.28 / 8) * st.style + Math.random() / 4;
          }
          if (st.forceCircular) p.angle += 0.3; else p.angle += p.angleAdj;
          if (p.angle >= 6.28) p.angle = 0;
          if (st.extraRandom === 0) {
            p.x += Math.cos(p.angle) * p.speed + Math.round(Math.random() * 1.06 - 0.503);
            p.y += Math.sin(p.angle) * p.speed + Math.round(Math.random() * 1.06 - 0.503);
          } else {
            p.x += Math.cos(p.angle) * p.speed + (Math.round(Math.random() * 4) - 2);
            p.y += Math.sin(p.angle) * p.speed + (Math.round(Math.random() * 4.5) - 2);
          }
          if (p.x > w - 2 || p.x < 2) { p.x = getXpos(); p.y = getYpos(); p.angle = (6.28 / 8) * st.style + Math.random() / 4; p.halfLife = getHalfLife(); }
          else if (p.y > h - 2 || p.y < 2) { p.x = getXpos(); p.y = getYpos(); p.halfLife = getHalfLife(); }
          const px2 = Math.floor(p.x), py2 = Math.floor(p.y);
          if (px2 >= 0 && px2 < w && py2 >= 0 && py2 < h) indexBuf[py2 * w + px2] = clamp(p.speed * 16 + 186);
        }
      } else {
        for (let i = 0; i < count; i++) {
          const p = st.particles[i];
          p.decay -= p.halfLife;
          if (p.decay <= 0) {
            p.decay = 1; p.x = getXpos(); p.y = getYpos();
            p.angle = 6.28 / (st.style + 2); if (p.speed < 0) p.angle = 6.28 - p.angle;
            p.halfLife = 1; p.angleAdj = 0;
          }
          p.x += Math.cos(p.angle) * p.speed; p.y += Math.sin(p.angle) * p.speed;
          if (p.x > w - 2 || p.x < 2 || p.y > h - 2 || p.y < 2) { p.x = getXpos(); p.y = getYpos(); }
          const px2 = Math.floor(p.x), py2 = Math.floor(p.y);
          if (px2 >= 0 && px2 < w && py2 >= 0 && py2 < h) indexBuf[py2 * w + px2] = clamp(p.speed * 16 + 186);
        }
      }
      // Borders
      switch (st.border) {
        case 0:
          for (let x = 0; x < w; x++) { indexBuf[x] = 32; indexBuf[w+x] = 32; indexBuf[(h-1)*w+x] = 32; indexBuf[(h-2)*w+x] = 32; indexBuf[6*w+x] = 32; indexBuf[7*w+x] = 32; indexBuf[(h-7)*w+x] = 32; indexBuf[(h-8)*w+x] = 32; }
          for (let y = 0; y < h; y++) { indexBuf[y*w] = 128; indexBuf[y*w+1] = 128; indexBuf[y*w+w-1] = 128; indexBuf[y*w+w-2] = 128; indexBuf[y*w+12] = 64; indexBuf[y*w+13] = 64; indexBuf[y*w+w-13] = 64; indexBuf[y*w+w-14] = 64; }
          break;
        case 2:
          for (let x = 0; x < w; x++) { indexBuf[x] = 0; indexBuf[w+x] = 0; indexBuf[(h-1)*w+x] = 0; indexBuf[(h-2)*w+x] = 0; indexBuf[6*w+x] = 0; indexBuf[7*w+x] = 0; indexBuf[(h-7)*w+x] = 0; indexBuf[(h-8)*w+x] = 0; }
          for (let y = 0; y < h; y++) { indexBuf[y*w] = 64; indexBuf[y*w+1] = 64; indexBuf[y*w+w-1] = 64; indexBuf[y*w+w-2] = 64; indexBuf[y*w+6] = 64; indexBuf[y*w+7] = 64; indexBuf[y*w+w-7] = 64; indexBuf[y*w+w-8] = 64; }
          break;
      }
      // Blur
      if (st.smoothStyle === 0) { if (st.useBlur4) sharedBlur4(st.blurFactor); else sharedBlur1(st.blurFactor); }
      else { if (st.smoothDirection < 8) sharedBlur3(st.blurFactor, st.smoothDirection); else sharedBlur1(st.blurFactor); }
      sharedMirror(st.mirror);
      mapToRGBA(pal);
      if (st.paletteCycle > 0) { cyclePalette(); if (st.paletteCycle === 1) st.paletteCycle = 0; }
      ctx.putImageData(imgData, 0, 0);
    }

    function effectOn(n) {
      switch (n) {
        case 0: st.makeCircular = 0; st.smoothDirection = 8; st.smoothStyle = 0; st.blurFactor = 11; st.stepNo = 1; st.palIndex = (st.palIndex + 1) % 6; if (st.paletteCycle === 0) st.paletteCycle = 1; st.useBlur4 = false; break;
        case 1: st.style = (st.style + 1) % 17; initParticles(); break;
        case 2: st.palIndex = 5; st.shadeStyle = 0; st.randomiseShades = true; initShades(Math.random()*255, Math.random()*255, Math.random()*255); buildShadePalette(); if (st.paletteCycle === 0) st.paletteCycle = 1; st.useBlur4 = !st.useBlur4; break;
        case 3: st.position = (st.position + 1) % 5; break;
        case 4: st.mirror = (st.mirror + 1) % 5; break;
        case 5: st.lowResPalette = !st.lowResPalette; if (st.lowResPalette) applyLowResPalette(); else rebuildAllPalettes(); st.border = (st.border + 1) % 3; break;
        case 6: st.stepNo = 2; st.palIndex = 5; st.shadeStyle = 1; st.randomiseShades = false; initShades(Math.random()*255, Math.random()*255, Math.random()*255); buildShadePalette(); if (st.paletteCycle === 0) st.paletteCycle = 1; break;
        case 7: st.smoothStyle = 1; st.smoothDirection = (st.smoothDirection + 1) % 8; break;
        case 8: st.extraRandom = (st.extraRandom + 1) % 2; break;
        case 9: st.forceCircular = true; break;
        case 10: st.makeCircular = (st.makeCircular + 1) % 3; break;
      }
      updateControls();
    }

    function effectOff(n) {
      switch (n) {
        case 2: if (st.paletteCycle === 0) st.paletteCycle = 2; else st.paletteCycle = 1; break;
        case 4: st.border = (st.border + 1) % 3; break;
        case 6: st.stepNo = 1; rebuildAllPalettes(); if (st.paletteCycle === 0) st.paletteCycle = 1; break;
        case 9: st.forceCircular = false; break;
      }
      updateControls();
    }

    function handleKeyDown(e) {
      const key = e.key, code = e.code;
      if (key >= '1' && key <= '9') { effectOn(parseInt(key) - 1); return true; }
      if (key === '0') { effectOn(9); return true; }
      if (key >= 'a' && key <= 'z' && !e.shiftKey && !e.ctrlKey) {
        st.palIndex = (key.charCodeAt(0) - 97) % 6;
        if (st.paletteCycle === 0) st.paletteCycle = 1;
        return true;
      }
      switch (code) {
        case 'Space': effectOn(0); return true;
        case 'Enter': effectOn(5); return true;
        case 'F11': effectOn(10); e.preventDefault(); return true;
        case 'PageUp': if (st.blurFactor < 4) st.blurFactor++; else st.blurFactor = Math.min(16, st.blurFactor + 2); updateControls(); return true;
        case 'PageDown': if (st.blurFactor > 5) st.blurFactor -= 2; else if (st.blurFactor > 1) st.blurFactor--; updateControls(); return true;
        case 'Home': st.particleCount = Math.min(MAX_P, st.particleCount * 2); updateControls(); return true;
        case 'End': st.particleCount = Math.max(400, Math.floor(st.particleCount / 2)); updateControls(); return true;
        case 'Period': case 'NumpadDecimal': st.stepNo = 3 - st.stepNo; rebuildAllPalettes(); if (st.paletteCycle === 0) st.paletteCycle = 1; return true;
        case 'NumpadMultiply': st.makeCircular = 0; st.palIndex = (st.palIndex + 1) % 5; if (st.paletteCycle === 0) st.paletteCycle = 1; return true;
        case 'Tab': e.preventDefault(); st.makeCircular = (st.makeCircular + 1) % 3; return true;
        case 'ArrowLeft': st.smoothStyle = 1; st.smoothDirection = 3; return true;
        case 'ArrowRight': st.smoothStyle = 1; st.smoothDirection = 4; return true;
        case 'ArrowUp': st.smoothStyle = 1; st.smoothDirection = 1; return true;
        case 'ArrowDown': st.smoothStyle = 1; st.smoothDirection = 6; return true;
      }
      return false;
    }

    function handleKeyUp(e) {
      const key = e.key;
      if (key >= '1' && key <= '9') { effectOff(parseInt(key) - 1); return true; }
      if (key === '0') { effectOff(9); return true; }
      if (e.code === 'Space') { effectOff(0); return true; }
      if (e.code === 'Enter') { effectOff(5); return true; }
      return false;
    }

    function updateControls() {}

    return {
      st, init() { initPalettes(); initParticles(); },
      renderFrame, effectPress: effectOn, effectRelease: effectOff,
      onMouseDown(btn) { if (btn === 0) effectOn(0); else effectOn(5); },
      onMouseUp(btn) { if (btn === 0) effectOff(0); else effectOff(5); },
      onTouch() { effectOn(Math.floor(Math.random() * 10)); },
      handleKeyDown, handleKeyUp, updateControls,
      get frameSpeed() { return st.frameSpeed; },
    };
  })();

  // ============================================================
  // ENGINE REGISTRY & MODE SWITCHING
  // ============================================================
  const engines = [magmaEngine, plazmaEngine, amebaEngine];
  function currentEngine() { return engines[currentMode]; }

  function switchMode(delta) {
    currentMode = ((currentMode + delta) % 3 + 3) % 3;
    indexBuf.fill(0);
    updateCSSBlur();
    isIdle = false;
    lastActivityTime = performance.now();
  }

  function markActivity() {
    lastActivityTime = performance.now();
    if (isIdle) {
      isIdle = false;
      const mode = MODES[currentMode];
      if (mode === 'magma' || mode === 'plazma') {
        currentEngine().init();
      }
    }
  }

  // ============================================================
  // MAIN LOOP
  // ============================================================
  let lastFrame = 0;
  function mainLoop(timestamp) {
    if (!running) return;
    const engine = currentEngine();
    const speed = engine.frameSpeed || 50;
    if (timestamp - lastFrame >= speed) {
      const threshold = IDLE_THRESHOLDS[MODES[currentMode]] || 5000;
      if (false && !isIdle && performance.now() - lastActivityTime > threshold) {
        isIdle = true;
      }
      pollGamepad();
      engine.renderFrame();
      // Scale offscreen 640x480 to visible canvas
      displayCtx.drawImage(offCanvas, 0, 0, canvas.width, canvas.height);
      lastFrame = timestamp;
    }
    requestAnimationFrame(mainLoop);
  }

  // ============================================================
  // GAMEPAD SUPPORT
  // ============================================================
  let gpPrev = [];
  function pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let gi = 0; gi < gamepads.length; gi++) {
      const gp = gamepads[gi];
      if (!gp) continue;
      const deadzone = 0.15;
      const engine = currentEngine();
      // Left stick - move cursor relative
      const lx = Math.abs(gp.axes[0]) > deadzone ? gp.axes[0] : 0;
      const ly = Math.abs(gp.axes[1]) > deadzone ? gp.axes[1] : 0;
      if (lx || ly) {
        mx = Math.max(0, Math.min(RENDER_W, mx + lx * 4));
        my = Math.max(0, Math.min(RENDER_H, my + ly * 4));
        markActivity();
      }
      // Right stick - also move cursor relative
      if (gp.axes.length >= 4) {
        const rx = Math.abs(gp.axes[2]) > deadzone ? gp.axes[2] : 0;
        const ry = Math.abs(gp.axes[3]) > deadzone ? gp.axes[3] : 0;
        if (rx || ry) {
          mx = Math.max(0, Math.min(RENDER_W, mx + rx * 4));
          my = Math.max(0, Math.min(RENDER_H, my + ry * 4));
        }
      }
      // D-pad (buttons 12-15)
      if (gp.buttons.length > 15) {
        if (gp.buttons[12].pressed) my = Math.max(0, my - 3);
        if (gp.buttons[13].pressed) my = Math.min(RENDER_H, my + 3);
        if (gp.buttons[14].pressed) mx = Math.max(0, mx - 3);
        if (gp.buttons[15].pressed) mx = Math.min(RENDER_W, mx + 3);
      }
      // Bumpers (LB=4, RB=5) - mode switching
      if (gp.buttons.length > 5) {
        if (gp.buttons[4].pressed && !gpPrev[4]) switchMode(-1);
        if (gp.buttons[5].pressed && !gpPrev[5]) switchMode(1);
      }
      // Face buttons + triggers -> effects (skip 4,5 = bumpers)
      const effectMap = [0, 1, 2, 3, -1, -1, 4, 5, 6, 7, 8, 9];
      for (let b = 0; b < Math.min(gp.buttons.length, effectMap.length); b++) {
        if (effectMap[b] >= 0) {
          if (gp.buttons[b].pressed && !gpPrev[b]) engine.effectPress(effectMap[b]);
          if (!gp.buttons[b].pressed && gpPrev[b]) engine.effectRelease(effectMap[b]);
        }
      }
      gpPrev = [];
      for (let b = 0; b < gp.buttons.length; b++) gpPrev[b] = gp.buttons[b].pressed;
      break; // Use first connected gamepad
    }
  }

  // ============================================================
  // INPUT HANDLING
  // ============================================================
  function screenToRender(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(RENDER_W, (clientX - rect.left) / displayScaleX)),
      Math.max(0, Math.min(RENDER_H, (clientY - rect.top) / displayScaleY))
    ];
  }

  canvas.addEventListener('mousemove', (e) => {
    [mx, my] = screenToRender(e.clientX, e.clientY);
    markActivity();
  });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    [mx, my] = screenToRender(e.touches[0].clientX, e.touches[0].clientY);
    markActivity();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => { markActivity(); currentEngine().onMouseDown(e.button); });
  canvas.addEventListener('mouseup', (e) => { currentEngine().onMouseUp(e.button); });
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    [mx, my] = screenToRender(e.touches[0].clientX, e.touches[0].clientY);
    markActivity();
    currentEngine().onMouseDown(0);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (!running) return;
    markActivity();
    currentEngine().handleKeyDown(e);
  });
  document.addEventListener('keyup', (e) => {
    if (!running) return;
    currentEngine().handleKeyUp(e);
  });

  // ============================================================
  // UI
  // ============================================================
  const $ = id => document.getElementById(id);

  // Mode buttons
  $('btn-prev-mode').addEventListener('click', () => switchMode(-1));
  $('btn-next-mode').addEventListener('click', () => switchMode(1));

  // Per-mode CSS blur (ameba and plazma get extra screen blur)
  const MODE_BLUR = { magma: 0.8, plazma: 0.8, ameba: 1.2 };
  function updateCSSBlur() {
    const scale = Math.max(displayScaleX, displayScaleY);
    const mult = MODE_BLUR[MODES[currentMode]] || 0.3;
    canvas.style.filter = 'blur(' + Math.max(0.5, scale * mult) + 'px)';
  }

  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = vw * dpr;
    canvas.height = vh * dpr;
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';

    // Stretch-to-fill: separate X and Y scales, no offset
    displayScaleX = vw / RENDER_W;
    displayScaleY = vh / RENDER_H;

    displayCtx.fillStyle = '#000';
    displayCtx.fillRect(0, 0, canvas.width, canvas.height);
    updateCSSBlur();
  }

  // ============================================================
  // SPLASH WITH PARTICLE TEXT
  // ============================================================
  const splashOverlay = $('splash-overlay');
  const splashCanvas = $('splash-canvas');
  const splashCtx = splashCanvas.getContext('2d');
  let splashDone = false;
  let splashParticles = [];
  let splashScattering = false;
  let splashStartTime = 0;
  const SPLASH_HOLD = 2500; // hold text still for 2.5s before drifting

  function initSplashParticles() {
    const sw = window.innerWidth, sh = window.innerHeight;
    splashCanvas.width = sw;
    splashCanvas.height = sh;

    // Render text to temp canvas to sample pixel positions
    const tmp = document.createElement('canvas');
    tmp.width = sw; tmp.height = sh;
    const tc = tmp.getContext('2d');
    const fontSize = Math.min(sw * 0.18, 140);
    tc.font = 'bold ' + fontSize + 'px Comfortaa, sans-serif';
    tc.fillStyle = '#fff';
    tc.textAlign = 'center';
    tc.textBaseline = 'middle';
    tc.fillText('Kalma', sw / 2, sh / 2);

    const imgD = tc.getImageData(0, 0, sw, sh);
    const data = imgD.data;
    const step = Math.max(2, Math.floor(fontSize / 35));

    splashParticles = [];
    splashStartTime = performance.now();
    for (let y = 0; y < sh; y += step) {
      for (let x = 0; x < sw; x += step) {
        if (data[(y * sw + x) * 4 + 3] > 128) {
          splashParticles.push({
            x: x, y: y, origX: x, origY: y,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            alpha: 0.6 + Math.random() * 0.4,
            size: step * 0.8 + Math.random() * step * 0.4,
            hue: 15 + Math.random() * 45,
            light: 55 + Math.random() * 25,
          });
        }
      }
    }
  }

  function renderSplashFrame() {
    if (splashParticles.length === 0) return;
    const sw = splashCanvas.width, sh = splashCanvas.height;
    splashCtx.clearRect(0, 0, sw, sh);

    let allGone = true;
    const holding = performance.now() - splashStartTime < SPLASH_HOLD;
    for (const p of splashParticles) {
      if (splashScattering) {
        const dx = p.x - sw / 2, dy = p.y - sh / 2;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        p.vx += dx / dist * 0.25;
        p.vy += dy / dist * 0.25;
        p.alpha -= 0.004;
        p.x += p.vx * 2;
        p.y += p.vy * 2;
      } else if (!holding) {
        // Gentle drift with pull back to origin
        p.x += p.vx * 2;
        p.y += p.vy * 2;
        p.x += (p.origX - p.x) * 0.02;
        p.y += (p.origY - p.y) * 0.02;
      }

      if (p.alpha > 0.01) {
        allGone = false;
        splashCtx.globalAlpha = Math.max(0, p.alpha);
        splashCtx.fillStyle = 'hsl(' + p.hue + ', 100%, ' + p.light + '%)';
        splashCtx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    splashCtx.globalAlpha = 1;

    if (!allGone) requestAnimationFrame(renderSplashFrame);
    else { splashOverlay.style.display = 'none'; }
  }

  function dismissSplash() {
    if (splashDone) return;
    splashDone = true;
    splashScattering = true;
    splashOverlay.classList.add('fade-out');
  }

  function startApp() {
    initCanvas();
    resize();
    window.addEventListener('resize', resize);

    engines.forEach(e => e.init());

    running = true;
    requestAnimationFrame(mainLoop);

    // Init particle text after font loads
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        initSplashParticles();
        requestAnimationFrame(renderSplashFrame);
      });
    } else {
      setTimeout(() => {
        initSplashParticles();
        requestAnimationFrame(renderSplashFrame);
      }, 200);
    }
  }

  // Start immediately so Magma animates behind the splash overlay
  startApp();

  // Auto-dismiss splash after 5 seconds, or on click/tap/gamepad
  setTimeout(dismissSplash, 5000);
  splashOverlay.addEventListener('click', dismissSplash);
  splashOverlay.addEventListener('touchstart', (e) => { e.preventDefault(); dismissSplash(); });

  // Gamepad to dismiss splash
  function checkGamepadForSplash() {
    if (splashDone) return;
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (!gp) continue;
      for (let b = 0; b < gp.buttons.length; b++) {
        if (gp.buttons[b].pressed) { dismissSplash(); return; }
      }
    }
    requestAnimationFrame(checkGamepadForSplash);
  }
  requestAnimationFrame(checkGamepadForSplash);

})();
