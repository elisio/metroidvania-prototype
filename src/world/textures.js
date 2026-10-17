/*
 * Texturas: devolve a imagem do contrato de assets se ela carregou, senão gera
 * um placeholder procedural nas cores da referência (cidade gótica noturna).
 * Uso: Game.Tex.get('tile_brick') -> HTMLImageElement | HTMLCanvasElement (nunca null).
 */
(function () {
  'use strict';
  const U = Game.U;

  const PAL = Game.PALETTE = {
    skyTop: '#121828', skyMid: '#222c46', skyLow: '#3a4868',
    cloud: '#2a3350', brick: '#4a3a31', brickDark: '#29222a', mortar: '#1a1416',
    iron: '#2a2932', ironHi: '#5b5966', ironDark: '#141319',
    copper: '#6b4a2e', wood: '#5a3d27',
    neonCyan: '#55e6f2', neonPurple: '#b552e8', lamp: '#ffcf7a',
    whipCore: '#fff6dc', whipGlow: '#ffcf6a',
    hp: '#d8322f', manaA: '#9b46d8', manaB: '#2fb7e8'
  };

  const T = Game.Tex = { cache: {} };

  T.get = function (name) {
    const im = Game.Assets.img(name);
    if (im) return im;
    if (!T.cache[name]) T.cache[name] = makePlaceholder(name);
    return T.cache[name];
  };
  /** true se a arte real do contrato está disponível. */
  T.real = (name) => !!Game.Assets.img(name);

  /** Padrão de repetição (criado uma vez por nome). */
  const patCache = {};
  const scratch = document.createElement('canvas').getContext('2d');
  T.pattern = function (name) {
    if (!patCache[name]) patCache[name] = scratch.createPattern(T.get(name), 'repeat');
    return patCache[name];
  };

  /* ---------------- Placeholders procedurais ---------------- */
  function bricks(w, h, base, mortar, seed, bw, bh) {
    const { c, g } = U.canvas(w, h);
    const R = U.seeded(seed);
    g.fillStyle = mortar; g.fillRect(0, 0, w, h);
    bw = bw || 32; bh = bh || 16;
    for (let y = 0, row = 0; y < h; y += bh, row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < w + bw; x += bw) {
        const v = 0.75 + R() * 0.4;
        const col = hexMul(base, v);
        g.fillStyle = col;
        const bx = x + off;
        // a repetição horizontal precisa casar: desenha também o espelho na borda
        g.fillRect(bx + 1, y + 1, bw - 2, bh - 2);
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(bx + 1, y + 1, bw - 2, 2);
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(bx + 1, y + bh - 4, bw - 2, 3);
      }
    }
    return c;
  }
  function hexMul(hex, v) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 255) * v), gg = Math.min(255, ((n >> 8) & 255) * v), b = Math.min(255, (n & 255) * v);
    return 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (b | 0) + ')';
  }
  T.hexMul = hexMul;

  function lattice(g, x, y, w, h, col, lw) {
    g.strokeStyle = col; g.lineWidth = lw || 2;
    g.beginPath();
    const n = Math.max(1, Math.round(w / h));
    const cw = w / n;
    for (let i = 0; i < n; i++) {
      g.moveTo(x + i * cw, y); g.lineTo(x + (i + 1) * cw, y + h);
      g.moveTo(x + (i + 1) * cw, y); g.lineTo(x + i * cw, y + h);
    }
    g.stroke();
  }
  T.lattice = lattice;

  function makePlaceholder(name) {
    let r;
    switch (name) {
      case 'tile_brick': return bricks(128, 128, PAL.brick, PAL.mortar, 3);
      case 'tile_brick_dark': return bricks(128, 128, PAL.brickDark, '#100c10', 7);
      case 'tile_deck': {
        r = U.canvas(128, 56);
        const g = r.g;
        g.fillStyle = PAL.ironDark; g.fillRect(0, 0, 128, 56);
        g.fillStyle = PAL.iron; g.fillRect(0, 0, 128, 12);
        g.fillStyle = PAL.ironHi; g.fillRect(0, 0, 128, 2);
        g.fillStyle = '#1e1d25'; g.fillRect(0, 12, 128, 4);
        lattice(g, 0, 16, 128, 32, '#3a3844', 4);
        g.fillStyle = PAL.iron; g.fillRect(0, 46, 128, 6);
        for (let x = 6; x < 128; x += 16) { g.fillStyle = '#6a6876'; g.fillRect(x, 5, 2, 2); }
        return r.c;
      }
      case 'tile_girder_v': {
        r = U.canvas(34, 120);
        const g = r.g;
        g.fillStyle = PAL.ironDark; g.fillRect(4, 0, 26, 120);
        g.fillStyle = PAL.iron; g.fillRect(0, 0, 6, 120); g.fillRect(28, 0, 6, 120);
        for (let y = 0; y < 120; y += 30) lattice(g, 6, y, 22, 30, '#3c3a47', 3);
        return r.c;
      }
      case 'tile_girder_x': {
        r = U.canvas(62, 61);
        const g = r.g;
        g.fillStyle = PAL.ironDark; g.fillRect(0, 0, 62, 61);
        lattice(g, 4, 4, 54, 53, '#3a3844', 5);
        g.strokeStyle = PAL.iron; g.lineWidth = 6; g.strokeRect(3, 3, 56, 55);
        return r.c;
      }
      case 'tile_stairs': {
        r = U.canvas(120, 100);
        const g = r.g;
        for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? PAL.iron : '#34323d'; g.fillRect(i * 20, 100 - (i + 1) * 16, 120 - i * 20, 8); }
        return r.c;
      }
      case 'bg_far': return makeCity(451, 620, 11);
      case 'bg_mid': return makeMid(900, 488);
      case 'bg_interior': {
        const c = bricks(260, 259, '#2b2429', '#120e12', 5, 26, 13);
        const g = c.getContext('2d');
        g.fillStyle = '#0b0a10'; g.fillRect(30, 40, 60, 110);
        g.strokeStyle = '#3d3540'; g.lineWidth = 4;
        for (let x = 30; x <= 90; x += 15) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, 150); g.stroke(); }
        g.strokeRect(30, 40, 60, 110);
        g.fillStyle = '#5b4030'; g.fillRect(190, 0, 10, 259);
        return c;
      }
      case 'prop_gargoyle': {
        r = U.canvas(107, 120);
        const g = r.g;
        g.fillStyle = '#25242b';
        g.beginPath();
        g.moveTo(53, 8); g.lineTo(70, 30); g.lineTo(104, 10); g.lineTo(92, 60); g.lineTo(78, 64);
        g.lineTo(84, 100); g.lineTo(22, 100); g.lineTo(28, 64); g.lineTo(14, 60); g.lineTo(3, 10); g.lineTo(36, 30);
        g.closePath(); g.fill();
        g.fillStyle = '#34333c'; g.fillRect(16, 98, 76, 22);
        g.fillStyle = '#4a4855'; g.fillRect(16, 98, 76, 4);
        return r.c;
      }
      case 'prop_lamp': {
        r = U.canvas(40, 40);
        const g = r.g;
        g.fillStyle = '#2a2520'; g.fillRect(14, 4, 12, 4); g.fillRect(12, 32, 16, 4);
        g.fillStyle = '#ffd88a'; g.fillRect(14, 9, 12, 22);
        g.strokeStyle = '#4a3a20'; g.lineWidth = 2; g.strokeRect(14, 9, 12, 22);
        return r.c;
      }
      case 'prop_fence': {
        r = U.canvas(92, 50);
        const g = r.g;
        g.fillStyle = '#1c2220';
        g.fillRect(0, 10, 92, 4); g.fillRect(0, 36, 92, 3);
        for (let x = 3; x < 92; x += 11) { g.fillRect(x, 4, 3, 46); g.beginPath(); g.moveTo(x - 2, 6); g.lineTo(x + 1.5, 0); g.lineTo(x + 5, 6); g.fill(); }
        return r.c;
      }
      case 'prop_neon_cyan': case 'prop_neon_purple': {
        const cyan = name === 'prop_neon_cyan';
        r = U.canvas(cyan ? 34 : 28, cyan ? 62 : 76);
        const g = r.g, w = r.c.width, h = r.c.height;
        g.fillStyle = '#101018'; g.fillRect(0, 0, w, h);
        g.strokeStyle = cyan ? PAL.neonCyan : PAL.neonPurple; g.lineWidth = 3;
        g.strokeRect(3, 3, w - 6, h - 6);
        g.font = 'bold 12px monospace'; g.fillStyle = g.strokeStyle; g.textAlign = 'center';
        const txt = cyan ? 'COC' : 'HOTEL';
        for (let i = 0; i < txt.length; i++) g.fillText(txt[i], w / 2, 18 + i * 12);
        return r.c;
      }
      case 'prop_window_bars': {
        r = U.canvas(61, 160);
        const g = r.g;
        g.fillStyle = '#0a0c14'; g.fillRect(4, 4, 53, 152);
        g.fillStyle = 'rgba(70,90,140,0.35)'; g.fillRect(8, 8, 45, 144);
        g.fillStyle = '#3a3036';
        for (let x = 4; x <= 57; x += 13) g.fillRect(x, 4, 4, 152);
        g.fillRect(4, 4, 53, 5); g.fillRect(4, 80, 53, 4); g.fillRect(4, 151, 53, 5);
        return r.c;
      }
      case 'prop_fluorescent': {
        r = U.canvas(75, 19);
        const g = r.g;
        g.fillStyle = '#2b2a30'; g.fillRect(0, 0, 75, 8);
        g.fillStyle = '#f4f1dc'; g.fillRect(4, 8, 67, 6);
        return r.c;
      }
      case 'prop_pipes': {
        r = U.canvas(91, 224);
        const g = r.g;
        const grad = g.createLinearGradient(0, 0, 24, 0);
        grad.addColorStop(0, '#2a1d14'); grad.addColorStop(0.5, '#7a5634'); grad.addColorStop(1, '#22170f');
        g.fillStyle = grad;
        g.fillRect(10, 0, 22, 224); g.fillRect(52, 40, 18, 184);
        g.fillStyle = '#1a120c';
        for (let y = 20; y < 224; y += 60) { g.fillRect(6, y, 30, 6); g.fillRect(48, y + 30, 26, 5); }
        return r.c;
      }
      case 'prop_water_tower': {
        r = U.canvas(87, 112);
        const g = r.g;
        g.fillStyle = '#3d2a1c'; g.fillRect(8, 10, 71, 60);
        g.fillStyle = '#2a1c12'; g.beginPath(); g.moveTo(4, 12); g.lineTo(43, 0); g.lineTo(83, 12); g.fill();
        g.fillStyle = '#18141a'; g.fillRect(14, 70, 6, 42); g.fillRect(67, 70, 6, 42);
        lattice(g, 20, 72, 47, 40, '#2a2630', 3);
        return r.c;
      }
      case 'hero_portrait': {
        r = U.canvas(77, 77);
        const g = r.g;
        g.fillStyle = '#1b2236'; g.fillRect(0, 0, 77, 77);
        g.fillStyle = '#e9b99a'; g.beginPath(); g.ellipse(40, 44, 17, 21, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#b8401e'; g.beginPath(); g.ellipse(38, 30, 24, 18, 0, Math.PI, Math.PI * 2); g.fill();
        g.fillRect(14, 28, 12, 30); g.fillRect(52, 28, 10, 22);
        g.fillStyle = '#151820'; g.fillRect(14, 62, 50, 15);
        return r.c;
      }
      case 'icon_book': {
        r = U.canvas(31, 31);
        const g = r.g;
        g.fillStyle = '#6a3f24'; g.fillRect(5, 4, 21, 24);
        g.fillStyle = '#c9a36a'; g.fillRect(8, 7, 15, 3); g.fillRect(8, 20, 15, 2);
        g.fillStyle = '#ece0c6'; g.fillRect(24, 6, 3, 21);
        return r.c;
      }
      case 'icon_potion': {
        r = U.canvas(18, 30);
        const g = r.g;
        g.fillStyle = '#8a6a50'; g.fillRect(6, 0, 6, 5);
        g.fillStyle = '#b8c6dc'; g.fillRect(6, 5, 6, 6);
        g.beginPath(); g.arc(9, 20, 8, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#c4202e'; g.beginPath(); g.arc(9, 21, 6, 0, Math.PI * 2); g.fill();
        return r.c;
      }
      case 'hud_heart_full': case 'hud_heart_empty': {
        r = U.canvas(26, 24);
        const g = r.g;
        U.heartPath(g, 13, 13, 24);
        if (name === 'hud_heart_full') { g.fillStyle = '#d8322f'; g.fill(); g.fillStyle = 'rgba(255,190,170,0.6)'; g.fillRect(6, 6, 4, 3); }
        g.lineWidth = 2; g.strokeStyle = '#0d0d14'; U.heartPath(g, 13, 13, 24); g.stroke();
        return r.c;
      }
      default: {
        r = U.canvas(32, 32);
        r.g.fillStyle = '#ff00ff'; r.g.fillRect(0, 0, 32, 32);
        return r.c;
      }
    }
  }

  /** Silhueta procedural da cidade (placeholder de bg_far). */
  function makeCity(w, h, seed) {
    const { c, g } = U.canvas(w, h);
    const R = U.seeded(seed);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, PAL.skyTop); sky.addColorStop(0.55, PAL.skyMid); sky.addColorStop(1, PAL.skyLow);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    // nuvens
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(40,48,74,' + (0.25 + R() * 0.3) + ')';
      const x = R() * w, y = R() * h * 0.45, rw = 40 + R() * 90;
      for (const dx of [-w, 0, w]) { g.beginPath(); g.ellipse(x + dx, y, rw, rw * 0.3, 0, 0, Math.PI * 2); g.fill(); }
    }
    // prédios
    const layers = [['#1d2236', 0.45, 8], ['#151a2a', 0.6, 6], ['#0f1320', 0.75, 5]];
    for (const [col, base, n] of layers) {
      for (let i = 0; i < n; i++) {
        const bw = 30 + R() * 60, bx = R() * w, bh = h * (base - 0.05 + R() * 0.35);
        const by = h - bh;
        for (const dx of [-w, 0, w]) {
          g.fillStyle = col;
          g.fillRect(bx + dx, by, bw, bh);
          g.beginPath(); g.moveTo(bx + dx, by); g.lineTo(bx + dx + bw / 2, by - 30 - R() * 60); g.lineTo(bx + dx + bw, by); g.fill();
          g.fillStyle = 'rgba(255,190,110,0.5)';
          for (let wy = by + 10; wy < h - 10; wy += 14) {
            for (let wx = bx + 5; wx < bx + bw - 5; wx += 9) if (R() < 0.18) g.fillRect(wx + dx, wy, 3, 6);
          }
        }
      }
    }
    return c;
  }

  function makeMid(w, h) {
    const { c, g } = U.canvas(w, h);
    g.fillStyle = '#16141a';
    g.fillRect(0, h * 0.25, 60, h); g.fillRect(70, h * 0.4, 28, h); g.fillRect(36, h * 0.15, 14, h);
    g.fillRect(w - 60, h * 0.1, 10, h); g.fillRect(w - 20, h * 0.1, 10, h);
    lattice(g, w - 60, h * 0.1, 50, h * 0.9, '#16141a', 4);
    return c;
  }
})();
