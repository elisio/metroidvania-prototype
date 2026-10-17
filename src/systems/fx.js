/*
 * Efeitos: partículas (pool fixo), chuva com respingos, névoa, holofotes,
 * vapor, relâmpago, brilho aditivo das luzes e pós-imagens do dash.
 */
(function () {
  'use strict';
  const C = Game.CONFIG, U = Game.U, TS = C.TILE;

  const FX = Game.FX = { parts: [], rain: [], after: [], flash: 0, nextBolt: 8, bolt: null, fog: null };

  /* ---------- sprites de brilho pré-renderizados ---------- */
  const GLOW_COLS = {
    whip: [255, 214, 140], lamp: [255, 190, 100], cyan: [80, 230, 255], purple: [190, 90, 255],
    white: [230, 240, 255], blue: [90, 130, 255], red: [255, 70, 60], gold: [255, 200, 90], green: [120, 255, 170]
  };
  const glowCache = {};
  function glowSprite(col) {
    if (glowCache[col]) return glowCache[col];
    const { c, g } = U.canvas(128, 128);
    const rgb = GLOW_COLS[col] || GLOW_COLS.white;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, U.rgba(rgb, 1));
    gr.addColorStop(0.25, U.rgba(rgb, 0.45));
    gr.addColorStop(0.6, U.rgba(rgb, 0.12));
    gr.addColorStop(1, U.rgba(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    glowCache[col] = c;
    return c;
  }
  /** Desenha um brilho radial (o chamador define o modo de composição). */
  FX.glow = function (g, x, y, r, col, a) {
    g.globalAlpha = a === undefined ? 1 : a;
    g.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1;
  };

  let puff = null;
  function puffSprite() {
    if (!puff) {
      const { c, g } = U.canvas(64, 64);
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(200,205,225,0.55)'); gr.addColorStop(0.5, 'rgba(190,195,215,0.25)'); gr.addColorStop(1, 'rgba(190,195,215,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      puff = c;
    }
    return puff;
  }

  /* ---------- partículas ---------- */
  FX.clear = function () { FX.parts.length = 0; FX.after.length = 0; };

  function add(o) {
    if (FX.parts.length >= C.MAX_PARTICLES) FX.parts.shift();
    FX.parts.push(o);
  }

  FX.burst = function (x, y, kind, n, dir) {
    for (let i = 0; i < n; i++) {
      switch (kind) {
        case 'dust':
          add({ x: x + U.rand(-14, 14), y: y - 2, vx: U.rand(-90, 90), vy: U.rand(-80, -10), g: 200, life: U.rand(0.3, 0.55), t: 0, size: U.rand(3, 7), col: 'rgba(150,150,170,', kind: 'puff' });
          break;
        case 'splash':
          add({ x: x + U.rand(-8, 8), y: y - 2, vx: U.rand(-70, 70), vy: U.rand(-160, -60), g: 900, life: U.rand(0.25, 0.4), t: 0, size: 1.6, col: 'rgba(170,200,255,', kind: 'drop' });
          break;
        case 'double':
          add({ x: x + U.rand(-10, 10), y: y + U.rand(-4, 4), vx: U.rand(-160, 160), vy: U.rand(20, 120), g: 0, life: U.rand(0.25, 0.5), t: 0, size: U.rand(2, 4), col: 'rgba(255,230,170,', kind: 'spark', add: true });
          break;
        case 'spark':
          add({ x, y, vx: U.rand(-160, 160) + (dir || 0) * 120, vy: U.rand(-200, 60), g: 600, life: U.rand(0.2, 0.45), t: 0, size: U.rand(1.5, 3), col: 'rgba(255,220,140,', kind: 'spark', add: true });
          break;
        case 'dash':
          add({ x: x + U.rand(-6, 6), y: y + U.rand(-40, 30), vx: -dir * U.rand(60, 200), vy: U.rand(-20, 20), g: 0, life: U.rand(0.2, 0.35), t: 0, size: U.rand(2, 3.5), col: 'rgba(140,220,255,', kind: 'spark', add: true });
          break;
        case 'rubble':
          add({ x: x + U.rand(-20, 20), y: y + U.rand(-30, 30), vx: U.rand(-260, 260), vy: U.rand(-420, -60), g: 1500, life: U.rand(0.6, 1.1), t: 0, size: U.rand(4, 10), col: 'rgba(90,70,60,', kind: 'chunk', rot: U.rand(0, 6), vr: U.rand(-10, 10) });
          break;
        case 'pickup':
          add({ x, y, vx: Math.cos(i / n * 6.28) * U.rand(80, 160), vy: Math.sin(i / n * 6.28) * U.rand(80, 160), g: 0, life: U.rand(0.4, 0.7), t: 0, size: U.rand(2, 4), col: dir || 'rgba(255,230,160,', kind: 'spark', add: true });
          break;
        case 'save':
          add({ x: x + U.rand(-20, 20), y: y + U.rand(-10, 10), vx: U.rand(-20, 20), vy: U.rand(-140, -60), g: -20, life: U.rand(0.8, 1.4), t: 0, size: U.rand(2, 4), col: 'rgba(120,200,255,', kind: 'spark', add: true });
          break;
        case 'steam':
          add({ x: x + U.rand(-4, 4), y, vx: U.rand(-12, 12) + 10, vy: dir > 0 ? U.rand(30, 60) : U.rand(-70, -35), g: dir > 0 ? -40 : -10, life: U.rand(1.4, 2.4), t: 0, size: U.rand(10, 16), grow: 26, col: 'rgba(190,195,215,', kind: 'puff', a0: 0.16 });
          break;
        case 'ember':
          add({ x: x + U.rand(-30, 30), y, vx: U.rand(-20, 20), vy: U.rand(-60, -20), g: -10, life: U.rand(1, 2), t: 0, size: U.rand(1, 2.2), col: 'rgba(255,190,110,', kind: 'spark', add: true });
          break;
      }
    }
  };

  FX.afterimage = function (p) {
    const fr = Game.Player.currentFrame(p);
    FX.after.push({ x: p.x, y: p.y, w: p.w, h: p.h, facing: p.facing, fr, t: 0, life: 0.22 });
    if (FX.after.length > 10) FX.after.shift();
  };

  /* ---------- chuva ---------- */
  FX.resetRain = function () {
    FX.rain.length = 0;
    for (let i = 0; i < C.RAIN_DROPS; i++) {
      FX.rain.push({ x: U.rand(0, C.VIEW_W + 200), y: U.rand(-C.VIEW_H, C.VIEW_H), v: U.rand(780, 1100), l: U.rand(10, 22), z: U.rand(0.4, 1) });
    }
  };

  FX.update = function (dt, room, cam, exterior) {
    // partículas
    for (let i = FX.parts.length - 1; i >= 0; i--) {
      const p = FX.parts[i];
      p.t += dt;
      if (p.t >= p.life) { FX.parts.splice(i, 1); continue; }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.grow) p.size += p.grow * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
    for (let i = FX.after.length - 1; i >= 0; i--) {
      FX.after[i].t += dt;
      if (FX.after[i].t > FX.after[i].life) FX.after.splice(i, 1);
    }
    if (!room) return;
    // chuva (em coordenadas de tela) + respingos no chão (mundo)
    if (exterior) {
      for (const d of FX.rain) {
        d.y += d.v * dt * d.z;
        d.x -= d.v * C.RAIN_ANGLE * dt * d.z;
        if (d.y > C.VIEW_H || d.x < -40) { d.y = U.rand(-80, -10); d.x = U.rand(0, C.VIEW_W + 200); }
      }
      FX.splashAcc = (FX.splashAcc || 0) + dt * C.SPLASHES_PER_SEC;
      while (FX.splashAcc >= 1) {
        FX.splashAcc -= 1;
        const wx = cam.x + U.rand(0, C.VIEW_W);
        const tx = Math.floor(wx / TS);
        // encontra a primeira superfície sólida/plataforma visível nesta coluna
        const ty0 = Math.max(0, Math.floor(cam.y / TS)), ty1 = Math.min(room.th - 1, Math.floor((cam.y + C.VIEW_H) / TS));
        for (let ty = ty0; ty <= ty1; ty++) {
          const t = room.tiles[ty * room.tw + tx];
          if (Game.TILE_SOLID[t] || Game.TILE_ONEWAY[t]) {
            if (ty > 0 && room.tiles[(ty - 1) * room.tw + tx] === Game.T.EMPTY) {
              add({ x: wx, y: ty * TS, vx: U.rand(-40, 40), vy: U.rand(-110, -50), g: 700, life: 0.22, t: 0, size: 1.3, col: 'rgba(170,200,255,', kind: 'drop' });
            }
            break;
          }
        }
      }
      // relâmpago
      FX.nextBolt -= dt;
      if (FX.nextBolt <= 0) {
        FX.nextBolt = U.rand(C.LIGHTNING_MIN, C.LIGHTNING_MAX);
        FX.flash = 1;
        FX.bolt = { x: U.rand(100, C.VIEW_W - 100), t: 0, seed: Math.random() * 1000 };
        setTimeout(() => { try { if (Game.Audio && Game.Audio.thunder) Game.Audio.thunder(); } catch (e) { /* opcional */ } }, U.rand(300, 1100));
      }
    }
    if (FX.flash > 0) FX.flash = Math.max(0, FX.flash - dt * 2.6);
    if (FX.bolt) { FX.bolt.t += dt; if (FX.bolt.t > 0.25) FX.bolt = null; }
    // vapor
    const steam = Game.Terrain.steamFor(room);
    for (const s of steam) {
      if (s.x < cam.x - 100 || s.x > cam.x + C.VIEW_W + 100 || s.y < cam.y - 200 || s.y > cam.y + C.VIEW_H + 200) continue;
      s.acc = (s.acc || 0) + dt * s.rate;
      while (s.acc >= 1) { s.acc -= 1; FX.burst(s.x, s.y, 'steam', 1, s.down ? 1 : -1); }
    }
  };

  /* ---------- desenho ---------- */
  FX.drawAfterimages = function (g) {
    const img = Game.Assets.sheetImg;
    for (const a of FX.after) {
      const k = 1 - a.t / a.life;
      g.globalAlpha = 0.35 * k;
      if (img && a.fr) {
        g.save();
        g.translate(a.x + a.w / 2, a.y + a.h);
        g.scale(a.facing, 1);
        g.filter = 'none';
        g.drawImage(img, a.fr.x, a.fr.y, a.fr.w, a.fr.h, -a.fr.ax, -a.fr.ay, a.fr.w, a.fr.h);
        g.restore();
      } else {
        g.fillStyle = '#7fd8ff'; g.fillRect(a.x, a.y, a.w, a.h);
      }
    }
    g.globalAlpha = 1;
    // tinta azulada sobre as pós-imagens
  };

  FX.drawParticles = function (g, additive) {
    for (const p of FX.parts) {
      if (!!p.add !== additive) continue;
      const k = 1 - p.t / p.life;
      if (p.kind === 'puff') {
        // nuvem suave: sprite radial pré-gerado (mais barato e sem borda dura)
        g.globalAlpha = Math.min(1, (p.a0 || 0.4) * k * 2.2 * Math.min(1, p.t * 6));
        g.drawImage(puffSprite(), p.x - p.size * 1.6, p.y - p.size * 1.6, p.size * 3.2, p.size * 3.2);
        g.globalAlpha = 1;
      } else if (p.kind === 'drop') {
        g.fillStyle = p.col + (0.8 * k) + ')';
        g.fillRect(p.x, p.y, p.size, p.size * 2);
      } else if (p.kind === 'chunk') {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = p.col + Math.min(1, k * 2) + ')';
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        g.restore();
      } else {
        g.fillStyle = p.col + k + ')';
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
  };

  FX.drawRain = function (g, alpha) {
    g.strokeStyle = 'rgba(170,190,230,' + (0.28 * alpha) + ')';
    g.lineWidth = 1;
    g.beginPath();
    for (const d of FX.rain) {
      if (d.z < 0.7) continue;
      g.moveTo(d.x, d.y); g.lineTo(d.x + d.l * C.RAIN_ANGLE, d.y - d.l);
    }
    g.stroke();
    g.strokeStyle = 'rgba(140,160,210,' + (0.16 * alpha) + ')';
    g.beginPath();
    for (const d of FX.rain) {
      if (d.z >= 0.7) continue;
      g.moveTo(d.x, d.y); g.lineTo(d.x + d.l * 0.7 * C.RAIN_ANGLE, d.y - d.l * 0.7);
    }
    g.stroke();
  };

  /** Faixas de névoa rolando (canvas pré-gerado, desenhado em parallax). */
  function fogStrip() {
    if (FX.fog) return FX.fog;
    const { c, g } = U.canvas(1024, 160);
    const R = U.seeded(42);
    for (let i = 0; i < 70; i++) {
      const x = R() * 1024, y = 60 + R() * 70, r = 30 + R() * 70;
      for (const dx of [-1024, 0, 1024]) {
        const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        gr.addColorStop(0, 'rgba(150,165,200,0.10)'); gr.addColorStop(1, 'rgba(150,165,200,0)');
        g.fillStyle = gr; g.fillRect(x + dx - r, y - r, r * 2, r * 2);
      }
    }
    FX.fog = c;
    return c;
  }

  let fogK = null, fogScaled = null;
  FX.drawFog = function (g, camX, time, y, alpha, speed) {
    // desenhada em pixels do dispositivo a partir de uma cópia pré-escalada
    const k = Game.Screen.k;
    if (fogK !== k) {
      const f = fogStrip();
      const r = U.canvas(Math.round(1024 * k), Math.round(160 * k));
      r.g.drawImage(f, 0, 0, r.c.width, r.c.height);
      fogScaled = r.c; fogK = k;
    }
    const w = fogScaled.width;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = alpha;
    let x = -Math.round((((camX * 0.6 + time * speed) * k % w) + w) % w);
    for (; x < g.canvas.width; x += w) g.drawImage(fogScaled, x, Math.round(y * k));
    g.restore();
  };

  /** Holofotes cruzados varrendo o céu (desenhados sobre o bg_far). */
  FX.drawSearchlights = function (g, time) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const beams = [
      { x: 260, a: -0.55 + Math.sin(time * 0.35) * 0.28 },
      { x: 700, a: 0.5 + Math.sin(time * 0.29 + 2) * 0.3 },
      { x: 480, a: -0.1 + Math.sin(time * 0.21 + 4) * 0.35 }
    ];
    for (const b of beams) {
      g.save();
      g.translate(b.x, C.VIEW_H * 0.82);
      g.rotate(b.a);
      const gr = g.createLinearGradient(0, 0, 0, -C.VIEW_H * 1.1);
      gr.addColorStop(0, 'rgba(170,200,255,0.16)'); gr.addColorStop(1, 'rgba(170,200,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(-6, 0); g.lineTo(-70, -C.VIEW_H * 1.1); g.lineTo(70, -C.VIEW_H * 1.1); g.lineTo(6, 0); g.fill();
      g.restore();
    }
    g.restore();
    // raio
    if (FX.bolt) {
      const R = U.seeded(FX.bolt.seed | 0);
      g.strokeStyle = 'rgba(230,235,255,' + (1 - FX.bolt.t / 0.25) + ')';
      g.lineWidth = 2;
      g.beginPath();
      let x = FX.bolt.x, y = 0;
      g.moveTo(x, y);
      while (y < C.VIEW_H * 0.55) { x += (R() - 0.5) * 50; y += 20 + R() * 30; g.lineTo(x, y); }
      g.stroke();
    }
  };

  /** Luzes com brilho aditivo (coordenadas da sala; a câmera já está aplicada). */
  FX.drawLights = function (g, room, cam, time) {
    const lights = Game.Terrain.lightsFor(room);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const L of lights) {
      if (L.x < cam.x - 200 || L.x > cam.x + C.VIEW_W + 200 || L.y < cam.y - 200 || L.y > cam.y + C.VIEW_H + 200) continue;
      let a = L.a;
      if (L.flick === 1) a *= 0.9 + 0.1 * Math.sin(time * 9 + L.x);
      if (L.flick === 2) a *= (Math.sin(time * 3 + L.x) > -0.95 ? 1 : 0.3);
      if (L.flick === 3) a *= (Math.sin(time * 23 + L.y) > 0.97 ? 0.5 : 1);
      if (L.cone) {
        const gr = g.createLinearGradient(0, L.y, 0, L.y + L.r * 1.6);
        gr.addColorStop(0, 'rgba(230,240,255,' + (0.18 * a) + ')'); gr.addColorStop(1, 'rgba(230,240,255,0)');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(L.x - 34, L.y); g.lineTo(L.x + 34, L.y); g.lineTo(L.x + 120, L.y + L.r * 1.6); g.lineTo(L.x - 120, L.y + L.r * 1.6); g.fill();
      }
      FX.glow(g, L.x, L.y, L.r, L.col, a * 0.7);
      FX.glow(g, L.x, L.y, L.r * 0.25, 'white', a * 0.4);
    }
    g.restore();
  };
})();
