/*
 * Renderização do terreno e do cenário.
 *  - Cada sala tem um cache (canvas do tamanho da sala) com tiles estáticos e
 *    decoração; é refeito quando uma parede rachada quebra.
 *  - Tiles animados (grade de energia, água) e luzes são desenhados por quadro.
 *  - Fundos: céu + bg_far + holofotes + bg_mid (exterior) ou parede interna.
 */
(function () {
  'use strict';
  const C = Game.CONFIG, U = Game.U, T = Game.T, TS = C.TILE;
  const Tex = Game.Tex, PAL = Game.PALETTE;

  const R = Game.Terrain = {};

  const isExteriorTheme = (th) => th === 'exterior' || th === 'scaffold';
  R.isExterior = (room) => isExteriorTheme(room.theme);

  // Decoração desenhada atrás dos tiles / na frente dos tiles (no cache)
  const BACK_DECO = { window: 1, pipes: 1, tower: 1, fluor: 1, lamp: 1, neon: 1, fence: 1, vent: 1 };
  const FRONT_DECO = { girder: 1, girder_v: 1, gargoyle: 1 };

  /* ---------------- Cache de sala ---------------- */
  R.getCache = function (room) {
    if (!room.cache || room.cacheDirty) {
      room.cache = buildCache(room, room.cache);
      room.cacheDirty = false;
    }
    return room.cache;
  };

  function solidAt(room, x, y) {
    const t = Game.World.tileAt(room, x, y);
    return Game.TILE_SOLID[t] === 1;
  }

  function buildCache(room, reuse) {
    let c = reuse;
    if (!c || c.width !== room.pw || c.height !== room.ph) {
      c = document.createElement('canvas');
      c.width = room.pw; c.height = room.ph;
    }
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true;

    // 1) decoração de fundo
    for (const d of room.deco) if (BACK_DECO[d[0]]) drawDeco(g, room, d);

    // 2) tiles
    const brickPat = g.createPattern(Tex.get('tile_brick'), 'repeat');
    const darkPat = g.createPattern(Tex.get('tile_brick_dark'), 'repeat');
    const girderPat = g.createPattern(Tex.get('tile_girder_x'), 'repeat');
    const interior = !isExteriorTheme(room.theme);

    for (let ty = 0; ty < room.th; ty++) {
      for (let tx = 0; tx < room.tw; tx++) {
        const t = room.tiles[ty * room.tw + tx];
        const x = tx * TS, y = ty * TS;
        switch (t) {
          case T.BRICK: case T.CRACK:
            g.fillStyle = interior && room.theme !== 'factory' ? darkPat : brickPat;
            if (room.theme === 'cathedral' || room.theme === 'tower') g.fillStyle = darkPat;
            g.fillRect(x, y, TS, TS);
            break;
          case T.BRICKB:
            g.fillStyle = darkPat; g.fillRect(x, y, TS, TS);
            g.fillStyle = 'rgba(8,8,16,0.35)'; g.fillRect(x, y, TS, TS);
            break;
          case T.DECK:
            g.fillStyle = '#16151b'; g.fillRect(x, y, TS, TS);
            break;
          case T.IRON:
            g.fillStyle = '#121118'; g.fillRect(x, y, TS, TS);
            g.fillStyle = girderPat; g.fillRect(x, y, TS, TS);
            g.fillStyle = 'rgba(10,10,20,0.35)'; g.fillRect(x, y, TS, TS);
            break;
          case T.PIPE: drawPipeTile(g, room, tx, ty); break;
          case T.STAIR: drawStair(g, room, tx, ty); break;
          case T.GRATE: drawGrate(g, x, y); break;
          case T.PLANK: drawPlank(g, room, tx, ty); break;
          case T.SPIKE: drawSpikes(g, x, y); break;
        }
      }
    }
    // 3) sombreamento das bordas de tijolo + profundidade
    for (let ty = 0; ty < room.th; ty++) {
      for (let tx = 0; tx < room.tw; tx++) {
        const t = room.tiles[ty * room.tw + tx];
        if (t !== T.BRICK && t !== T.BRICKB && t !== T.CRACK) continue;
        const x = tx * TS, y = ty * TS;
        const up = solidAt(room, tx, ty - 1), dn = solidAt(room, tx, ty + 1);
        const lf = solidAt(room, tx - 1, ty), rt = solidAt(room, tx + 1, ty);
        // massa interna mais escura: ajuda a ler o que é chão "jogável"
        let depth = 0;
        for (let k = 1; k <= 3; k++) {
          if (solidAt(room, tx, ty - k) && solidAt(room, tx - k, ty) && solidAt(room, tx + k, ty) && solidAt(room, tx, ty + k)) depth = k; else break;
        }
        if (depth) { g.fillStyle = 'rgba(6,6,12,' + (0.18 * depth) + ')'; g.fillRect(x, y, TS, TS); }
        if (!up) {
          g.fillStyle = '#5d5048'; g.fillRect(x, y, TS, 5);
          g.fillStyle = '#867466'; g.fillRect(x, y, TS, 2);
          g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + 5, TS, 3);
        }
        if (!dn) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, y + TS - 4, TS, 4); }
        if (!lf) { g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x, y, 3, TS); }
        if (!rt) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + TS - 3, y, 3, TS); }
      }
    }
    // 4) passarelas: textura do deck por corrida contínua
    const deck = Tex.get('tile_deck');
    for (let ty = 0; ty < room.th; ty++) {
      let tx = 0;
      while (tx < room.tw) {
        if (room.tiles[ty * room.tw + tx] !== T.DECK) { tx++; continue; }
        const start = tx;
        while (tx < room.tw && room.tiles[ty * room.tw + tx] === T.DECK) tx++;
        const x0 = start * TS, x1 = tx * TS;
        const dh = deck.height;
        for (let x = x0; x < x1; x += deck.width) {
          const w = Math.min(deck.width, x1 - x);
          g.drawImage(deck, 0, 0, w, dh, x, ty * TS, w, dh);
        }
        // sombra sob a treliça
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x0, ty * TS + dh - 4, x1 - x0, 6);
      }
    }
    // 5) paredes rachadas (desenho por cima do tijolo)
    for (const grp of room.cracks) if (!grp.broken) drawCrack(g, grp);
    // 6) decoração da frente
    for (const d of room.deco) if (FRONT_DECO[d[0]]) drawDeco(g, room, d);
    return c;
  }

  function drawPipeTile(g, room, tx, ty) {
    const x = tx * TS, y = ty * TS;
    const leftIsPipe = Game.World.tileAt(room, tx - 1, ty) === T.PIPE;
    // dois canos verticais por bloco de 2 tiles
    const px = x + (leftIsPipe ? 2 : 6), pw = leftIsPipe ? 24 : 22;
    g.fillStyle = '#0d0b0c'; g.fillRect(x, y, TS, TS);
    const gr = g.createLinearGradient(px, 0, px + pw, 0);
    gr.addColorStop(0, '#2a1a10'); gr.addColorStop(0.35, '#8a6038'); gr.addColorStop(0.55, '#b88a55'); gr.addColorStop(1, '#24160d');
    g.fillStyle = gr; g.fillRect(px, y, pw, TS);
    if ((ty % 3) === 0) { g.fillStyle = '#1b120c'; g.fillRect(px - 3, y + 10, pw + 6, 6); g.fillStyle = '#6d4a2c'; g.fillRect(px - 3, y + 10, pw + 6, 2); }
    if (Game.World.tileAt(room, tx, ty + 1) !== T.PIPE) {
      g.fillStyle = '#1b120c'; g.fillRect(px - 4, y + TS - 8, pw + 8, 8);
      g.fillStyle = '#7a5532'; g.fillRect(px - 4, y + TS - 8, pw + 8, 2);
    }
  }

  function drawStair(g, room, tx, ty) {
    const x = tx * TS, y = ty * TS;
    const top = Game.World.tileAt(room, tx, ty - 1) !== T.STAIR;
    g.fillStyle = '#1a1920'; g.fillRect(x, y, TS, TS);
    g.strokeStyle = '#2e2c37'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x, y + TS); g.lineTo(x + TS, y); g.moveTo(x, y); g.lineTo(x + TS, y + TS); g.stroke();
    if (top) {
      g.fillStyle = '#4a4856'; g.fillRect(x, y, TS, 7);
      g.fillStyle = '#77758a'; g.fillRect(x, y, TS, 2);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, y + 7, TS, 3);
    }
  }

  function drawGrate(g, x, y) {
    g.fillStyle = 'rgba(10,10,16,0.55)'; g.fillRect(x, y + 6, TS, 10);
    g.strokeStyle = '#34323e'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y + 6); g.lineTo(x + 16, y + 16); g.lineTo(x + 32, y + 6);
    g.stroke();
    g.fillStyle = '#3d3b48'; g.fillRect(x, y, TS, 6);
    g.fillStyle = '#6a687a'; g.fillRect(x, y, TS, 2);
    g.fillStyle = '#222029'; g.fillRect(x, y + 15, TS, 2);
    g.fillStyle = '#8c8a9c'; g.fillRect(x + 4, y + 3, 2, 2); g.fillRect(x + 26, y + 3, 2, 2);
  }

  function drawPlank(g, room, tx, ty) {
    const x = tx * TS, y = ty * TS;
    g.fillStyle = '#3c2818'; g.fillRect(x, y, TS, 9);
    g.fillStyle = '#6a4a2e'; g.fillRect(x, y, TS, 3);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + ((tx * 7) % 20) + 4, y + 4, 8, 1);
    g.fillStyle = '#1a120c'; g.fillRect(x + TS - 1, y, 1, 9);
    const L = Game.World.tileAt(room, tx - 1, ty) !== T.PLANK, Rt = Game.World.tileAt(room, tx + 1, ty) !== T.PLANK;
    if (L || Rt) { // suportes de ferro nas pontas
      const bx = L ? x + 3 : x + TS - 7;
      g.fillStyle = '#2b2a33'; g.fillRect(bx, y + 9, 4, 14);
      g.beginPath(); g.moveTo(bx, y + 9); g.lineTo(bx + (L ? 14 : -10), y + 9); g.lineTo(bx + (L ? 0 : 4), y + 22); g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + 9, TS, 4);
  }

  function drawSpikes(g, x, y) {
    g.fillStyle = '#121016'; g.fillRect(x, y + TS - 6, TS, 6);
    for (let i = 0; i < 4; i++) {
      const sx = x + i * 8;
      const gr = g.createLinearGradient(sx, 0, sx + 8, 0);
      gr.addColorStop(0, '#3a3844'); gr.addColorStop(0.5, '#a9a6b8'); gr.addColorStop(1, '#2a2832');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(sx, y + TS - 5); g.lineTo(sx + 4, y + 8); g.lineTo(sx + 8, y + TS - 5); g.fill();
    }
    g.fillStyle = 'rgba(150,20,20,0.5)'; g.fillRect(x + 3, y + 10, 2, 4); g.fillRect(x + 19, y + 11, 2, 3);
  }

  function drawCrack(g, grp) {
    const x = grp.x * TS, y = grp.y * TS, w = grp.w * TS, h = grp.h * TS;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = 'rgba(120,90,60,0.18)'; g.fillRect(x, y, w, h);
    const Rn = U.seeded(grp.x * 31 + grp.y * 17);
    g.strokeStyle = '#0b0809'; g.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      let cx = x + w * (0.2 + Rn() * 0.6), cy = y + 4;
      g.beginPath(); g.moveTo(cx, cy);
      while (cy < y + h) { cx += (Rn() - 0.5) * 26; cy += 10 + Rn() * 18; g.lineTo(cx, cy); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,220,170,0.18)'; g.lineWidth = 1;
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    g.restore();
  }

  /* ---------------- Decoração ---------------- */
  function drawDeco(g, room, d) {
    const [type, tx, ty] = d;
    const x = tx * TS, y = ty * TS;
    let im;
    switch (type) {
      case 'lamp': im = Tex.get('prop_lamp'); g.drawImage(im, x + 16 - im.width / 2, y + 4); break;
      case 'fence': im = Tex.get('prop_fence'); g.drawImage(im, x - 30, y + TS - im.height); g.drawImage(im, x + 60, y + TS - im.height); break;
      case 'neon': {
        im = Tex.get((tx + ty) % 2 ? 'prop_neon_purple' : 'prop_neon_cyan');
        g.drawImage(im, x + 16 - im.width / 2, y);
        break;
      }
      case 'window':
        if (room.theme === 'cathedral' || room.theme === 'tower') drawStainedGlass(g, x + 16, y, room.theme === 'tower');
        else { im = Tex.get('prop_window_bars'); g.drawImage(im, x + 16 - im.width / 2, y - 20); }
        break;
      case 'fluor': im = Tex.get('prop_fluorescent'); g.drawImage(im, x + 16 - im.width / 2, y + 2); break;
      case 'pipes': im = Tex.get('prop_pipes'); g.drawImage(im, x + 16 - im.width / 2, y + TS - im.height); break;
      case 'tower': im = Tex.get('prop_water_tower'); g.drawImage(im, x + 16 - im.width / 2, y + TS - im.height); break;
      case 'vent':
        g.fillStyle = '#17141a'; g.fillRect(x + 4, y + 18, 24, 14);
        g.fillStyle = '#4b3a2c'; g.fillRect(x + 2, y + 16, 28, 4);
        g.fillStyle = '#0a0809'; for (let i = 0; i < 3; i++) g.fillRect(x + 8 + i * 6, y + 22, 3, 8);
        break;
      case 'gargoyle': {
        im = Tex.get('prop_gargoyle');
        const s = 0.8;
        g.drawImage(im, x + 16 - im.width * s / 2, y + 2, im.width * s, im.height * s);
        break;
      }
      case 'girder': case 'girder_v': {
        im = Tex.get('tile_girder_v');
        const top = y + (type === 'girder' ? 18 : 0);
        for (let yy = top; yy < room.ph; yy += im.height) {
          const h = Math.min(im.height, room.ph - yy);
          g.drawImage(im, 0, 0, im.width, h, x + 16 - im.width / 2, yy, im.width, h);
        }
        break;
      }
    }
  }

  function drawStainedGlass(g, cx, y, round) {
    const w = 52, h = 120;
    g.save();
    g.beginPath();
    g.moveTo(cx - w / 2, y + h);
    g.lineTo(cx - w / 2, y + 30);
    if (round) g.arc(cx, y + 30, w / 2, Math.PI, 0);
    else g.quadraticCurveTo(cx - w / 2, y, cx, y - 6), g.quadraticCurveTo(cx + w / 2, y, cx + w / 2, y + 30);
    g.lineTo(cx + w / 2, y + h);
    g.closePath();
    g.fillStyle = '#0b0d18'; g.fill();
    g.clip();
    const cols = round ? ['#2c4a7a', '#3a6aa0', '#1d2d55', '#5a3a7a'] : ['#7a2a3a', '#2a4a8a', '#a07a2a', '#4a2a7a', '#2a6a6a'];
    const Rn = U.seeded(cx | 0);
    for (let yy = y - 10; yy < y + h; yy += 14) {
      for (let xx = cx - w / 2; xx < cx + w / 2; xx += 13) {
        g.fillStyle = cols[(Rn() * cols.length) | 0];
        g.globalAlpha = 0.55 + Rn() * 0.3;
        g.fillRect(xx + 1, yy + 1, 12, 13);
      }
    }
    g.globalAlpha = 1;
    g.restore();
    g.strokeStyle = '#2a2630'; g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx - w / 2, y + h); g.lineTo(cx - w / 2, y + 30);
    if (round) g.arc(cx, y + 30, w / 2, Math.PI, 0);
    else g.quadraticCurveTo(cx - w / 2, y, cx, y - 6), g.quadraticCurveTo(cx + w / 2, y, cx + w / 2, y + 30);
    g.lineTo(cx + w / 2, y + h); g.closePath(); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(cx, y); g.lineTo(cx, y + h); g.moveTo(cx - w / 2, y + 70); g.lineTo(cx + w / 2, y + 70); g.stroke();
  }

  /** Lista de luzes da sala (cor, raio, posição), derivada da decoração. */
  R.lightsFor = function (room) {
    if (room._lights) return room._lights;
    const L = [];
    for (const [type, tx, ty] of room.deco) {
      const x = tx * TS + 16, y = ty * TS;
      if (type === 'lamp') L.push({ x, y: y + 20, r: 120, col: 'lamp', a: 0.75, flick: 1 });
      else if (type === 'neon') L.push({ x, y: y + 34, r: 110, col: (tx + ty) % 2 ? 'purple' : 'cyan', a: 0.7, flick: 2 });
      else if (type === 'fluor') L.push({ x, y: y + 12, r: 150, col: 'white', a: 0.55, flick: 3, cone: true });
      else if (type === 'window' && (room.theme === 'cathedral' || room.theme === 'tower')) L.push({ x, y: y + 60, r: 120, col: 'blue', a: 0.35, flick: 0 });
    }
    room._lights = L;
    return L;
  };

  /** Pontos de vapor (canos/ventilações) para o sistema de partículas. */
  R.steamFor = function (room) {
    if (room._steam) return room._steam;
    const S = [];
    for (const [type, tx, ty] of room.deco) {
      if (type === 'vent') S.push({ x: tx * TS + 16, y: ty * TS + 18, rate: 9 });
      if (type === 'pipes') S.push({ x: tx * TS + 6, y: ty * TS + TS - 180, rate: 4 });
    }
    // feixes de canos soltam vapor pela ponta
    for (let ty = 0; ty < room.th; ty++) for (let tx = 0; tx < room.tw; tx++) {
      if (room.tiles[ty * room.tw + tx] === T.PIPE && Game.World.tileAt(room, tx, ty + 1) !== T.PIPE && Game.World.tileAt(room, tx - 1, ty) === T.PIPE) {
        S.push({ x: tx * TS, y: ty * TS + TS, rate: 7, down: true });
      }
    }
    room._steam = S;
    return S;
  };

  /* ---------------- Fundos ---------------- */
  let skyCache = null;
  function sky() {
    if (!skyCache) {
      const { c, g } = U.canvas(4, C.VIEW_H);
      const gr = g.createLinearGradient(0, 0, 0, C.VIEW_H);
      gr.addColorStop(0, PAL.skyTop); gr.addColorStop(0.6, PAL.skyMid); gr.addColorStop(1, PAL.skyLow);
      g.fillStyle = gr; g.fillRect(0, 0, 4, C.VIEW_H);
      skyCache = c;
    }
    return skyCache;
  }

  /** Desenha uma imagem repetida na horizontal com deslocamento (parallax). */
  function tileH(g, im, offX, y, scale) {
    const w = im.width * scale, h = im.height * scale;
    let x = -(((offX % w) + w) % w);
    for (; x < C.VIEW_W; x += w) g.drawImage(im, x, y, w + 0.5, h);
  }

  /**
   * Fundo exterior: céu, bg_far (lento), holofotes, bg_mid (médio).
   * cam = posição da câmera (px da sala); room para a profundidade vertical.
   */
  R.drawExteriorBg = function (g, cam, room, time, flash) {
    g.drawImage(sky(), 0, 0, C.VIEW_W, C.VIEW_H);
    const far = Tex.get('bg_far');
    const wx = room.ox + cam.x, wy = room.oy + cam.y;
    // escala para cobrir a altura da tela com folga para o parallax vertical
    const s = Math.max(1, (C.VIEW_H + 80) / far.height);
    const vy = U.clamp(-40 - (wy - 3 * C.CELL_H * TS) * 0.04, -120, 0);
    tileH(g, far, wx * 0.1, vy + (C.VIEW_H + 80 - far.height * s), s);
    Game.FX.drawSearchlights(g, time);
    if (flash > 0) { g.fillStyle = 'rgba(200,215,255,' + (flash * 0.35) + ')'; g.fillRect(0, 0, C.VIEW_W, C.VIEW_H); }
    const mid = Tex.get('bg_mid');
    const ms = Math.max(1, (C.VIEW_H * 0.95) / mid.height);
    const my = C.VIEW_H - mid.height * ms + U.clamp(-(wy - 3 * C.CELL_H * TS) * 0.12, -60, 140);
    g.globalAlpha = 0.85;
    tileH(g, mid, wx * 0.3, my, ms);
    g.globalAlpha = 1;
    // névoa azulada sobre o fundo para separar as camadas do primeiro plano
    g.fillStyle = 'rgba(26,32,54,0.28)';
    g.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
  };

  /** Fundo interno: parede de tijolo com janelas, em parallax leve. */
  R.drawInteriorBg = function (g, cam, room, time) {
    const im = Tex.get('bg_interior');
    const pat = Tex.pattern('bg_interior');
    const k = 0.75;
    g.save();
    g.fillStyle = '#0b0a0e'; g.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
    const ox = -((cam.x * k) % im.width), oy = -((cam.y * k) % im.height);
    g.translate(ox, oy);
    g.fillStyle = pat;
    g.fillRect(-ox, -oy, C.VIEW_W, C.VIEW_H);
    g.restore();
    let tint = 'rgba(8,8,14,0.55)';
    if (room.theme === 'factory') tint = 'rgba(20,12,8,0.5)';
    if (room.theme === 'cathedral') tint = 'rgba(10,8,20,0.6)';
    if (room.theme === 'tower') tint = 'rgba(8,10,20,0.6)';
    g.fillStyle = tint; g.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
    if (room.theme === 'tower') drawClockFace(g, cam, room, time);
  };

  /** Mostrador gigante de relógio ao fundo da torre. */
  function drawClockFace(g, cam, room, time) {
    const cx = C.VIEW_W / 2 + (room.pw / 2 - cam.x - C.VIEW_W / 2) * 0.5;
    const cy = 520 + (0 - cam.y) * 0.5 + 300;
    const r = 210;
    g.save();
    g.globalAlpha = 0.55;
    g.fillStyle = '#141522'; g.beginPath(); g.arc(cx, cy, r + 18, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a3546'; g.lineWidth = 10; g.stroke();
    g.fillStyle = 'rgba(190,170,110,0.12)'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#4a4458'; g.lineWidth = 6;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 30), cy + Math.sin(a) * (r - 30)); g.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); g.stroke();
    }
    const am = time * 0.05, ah = time * 0.004 - 1;
    g.lineWidth = 10; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ah) * r * 0.5, cy + Math.sin(ah) * r * 0.5); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(am) * r * 0.8, cy + Math.sin(am) * r * 0.8); g.stroke();
    g.restore();
  }

  /** Tiles animados: grades de energia e água rasa. */
  R.drawDynamic = function (g, room, cam, time, playerDashing) {
    const tx0 = Math.max(0, Math.floor(cam.x / TS)), tx1 = Math.min(room.tw - 1, Math.floor((cam.x + C.VIEW_W) / TS));
    const ty0 = Math.max(0, Math.floor(cam.y / TS)), ty1 = Math.min(room.th - 1, Math.floor((cam.y + C.VIEW_H) / TS));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = room.tiles[ty * room.tw + tx];
        if (t === T.ENERGY) drawEnergy(g, room, tx, ty, time, playerDashing);
        else if (t === T.WATER) drawWater(g, room, tx, ty, time);
      }
    }
  };

  function drawEnergy(g, room, tx, ty, time, dashing) {
    const x = tx * TS, y = ty * TS;
    const top = Game.World.tileAt(room, tx, ty - 1) !== T.ENERGY;
    const bot = Game.World.tileAt(room, tx, ty + 1) !== T.ENERGY;
    // emissores
    if (top) { g.fillStyle = '#2a2833'; g.fillRect(x + 4, y - 6, 24, 10); g.fillStyle = '#7ff3ff'; g.fillRect(x + 10, y + 2, 12, 2); }
    if (bot) { g.fillStyle = '#2a2833'; g.fillRect(x + 4, y + TS - 4, 24, 8); }
    g.save();
    g.globalCompositeOperation = 'lighter';
    const a = 0.35 + 0.15 * Math.sin(time * 20 + ty);
    const gr = g.createLinearGradient(x, 0, x + TS, 0);
    gr.addColorStop(0, 'rgba(60,200,255,0)'); gr.addColorStop(0.5, 'rgba(120,230,255,' + a + ')'); gr.addColorStop(1, 'rgba(60,200,255,0)');
    g.fillStyle = gr; g.fillRect(x - 8, y, TS + 16, TS);
    g.strokeStyle = 'rgba(210,250,255,0.85)'; g.lineWidth = 1.5;
    g.beginPath();
    for (let k = 0; k < 2; k++) {
      let px = x + 16, py = y;
      g.moveTo(px, py);
      for (let s = 1; s <= 4; s++) {
        px = x + 16 + Math.sin(time * 37 + s * 2.3 + k * 5 + ty * 3) * 9;
        py = y + s * 8;
        g.lineTo(px, py);
      }
    }
    g.stroke();
    g.restore();
  }

  function drawWater(g, room, tx, ty, time) {
    const x = tx * TS, y = ty * TS;
    const surface = Game.World.tileAt(room, tx, ty - 1) !== T.WATER;
    g.fillStyle = 'rgba(40,70,110,0.45)';
    g.fillRect(x, y + (surface ? 10 : 0), TS, TS - (surface ? 10 : 0));
    if (surface) {
      const w = Math.sin(time * 2 + tx * 0.8) * 2;
      g.fillStyle = 'rgba(150,200,240,0.35)';
      g.fillRect(x, y + 9 + w, TS, 2);
    }
  }

  /** Vinheta para dar profundidade (pré-renderizada). */
  let vig = null;
  R.drawVignette = function (g, strength) {
    if (!vig) {
      const { c, g: v } = U.canvas(C.VIEW_W / 2, C.VIEW_H / 2);
      const gr = v.createRadialGradient(C.VIEW_W / 4, C.VIEW_H / 4, C.VIEW_H * 0.18, C.VIEW_W / 4, C.VIEW_H / 4, C.VIEW_W * 0.32);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,8,0.75)');
      v.fillStyle = gr; v.fillRect(0, 0, C.VIEW_W / 2, C.VIEW_H / 2);
      vig = c;
    }
    g.globalAlpha = strength;
    g.drawImage(vig, 0, 0, C.VIEW_W, C.VIEW_H);
    g.globalAlpha = 1;
  };
})();
