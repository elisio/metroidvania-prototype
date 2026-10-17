/*
 * Mapa do mundo: cada sala é um retângulo de células; salas visitadas são
 * reveladas. Desenha o minimapa (HUD) e a tela de mapa completo.
 */
(function () {
  'use strict';
  const C = Game.CONFIG, U = Game.U;

  const M = Game.Map = {};

  const AREA_COL = {
    'Cidade': [64, 86, 140], 'Fábrica': [120, 84, 56], 'Subsolo': [70, 70, 96],
    'Andaimes': [86, 96, 120], 'Torre': [96, 70, 130]
  };

  /** Célula (global) em que o jogador está. */
  M.playerCell = function (room, p) {
    const lx = U.clamp(p.cx(), 0, room.pw - 1), ly = U.clamp(p.cy(), 0, room.ph - 1);
    return {
      x: room.cx + lx / (C.CELL_W * C.TILE),
      y: room.cy + ly / (C.CELL_H * C.TILE)
    };
  };

  /**
   * Desenha o mapa numa área (x,y,w,h) centrado em (focusX, focusY) células.
   * cs = tamanho da célula em px. full = tela de mapa (com ícones e rótulos).
   */
  M.draw = function (g, game, x, y, w, h, cs, focusX, focusY, full, time) {
    const st = game.state;
    const csH = cs * 0.62;            // células são mais largas que altas (30×17)
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = full ? 'rgba(6,8,16,0.0)' : '#070912';
    g.fillRect(x, y, w, h);
    const ox = x + w / 2 - focusX * cs, oy = y + h / 2 - focusY * csH;
    const W = Game.World;
    const pad = Math.max(1, cs * 0.06);
    // salas
    for (const id of W.order) {
      const r = W.rooms[id];
      const visited = !!st.visited[id];
      const debugReveal = game.debug && full;
      if (!visited && !debugReveal) continue;
      const rx = ox + r.cx * cs, ry = oy + r.cy * csH, rw = r.cw * cs, rh = r.ch * csH;
      const col = AREA_COL[r.area] || [70, 80, 120];
      const cur = game.room === r;
      g.fillStyle = U.rgba(col, cur ? 0.95 : visited ? 0.75 : 0.25);
      g.fillRect(rx + pad, ry + pad, rw - pad * 2, rh - pad * 2);
      g.strokeStyle = cur ? 'rgba(220,230,255,0.95)' : 'rgba(150,170,220,0.6)';
      g.lineWidth = Math.max(1, cs * 0.06);
      g.strokeRect(rx + pad, ry + pad, rw - pad * 2, rh - pad * 2);
      // divisões de célula
      g.strokeStyle = 'rgba(10,12,24,0.35)'; g.lineWidth = 1;
      for (let i = 1; i < r.cw; i++) { g.beginPath(); g.moveTo(rx + i * cs, ry + pad); g.lineTo(rx + i * cs, ry + rh - pad); g.stroke(); }
      for (let j = 1; j < r.ch; j++) { g.beginPath(); g.moveTo(rx + pad, ry + j * csH); g.lineTo(rx + rw - pad, ry + j * csH); g.stroke(); }
      // portas (aberturas nas bordas)
      g.fillStyle = cur ? 'rgba(220,230,255,0.95)' : 'rgba(160,180,230,0.8)';
      const dw = Math.max(2, cs * 0.12);
      for (let cy = 0; cy < r.ch; cy++) {
        if (W.edgeOpen(r, 'L', 0, cy) && W.roomAtCell(r.cx - 1, r.cy + cy)) g.fillRect(rx - dw / 2, ry + cy * csH + csH * 0.35, dw, csH * 0.3);
        if (W.edgeOpen(r, 'R', 0, cy) && W.roomAtCell(r.cx + r.cw, r.cy + cy)) g.fillRect(rx + rw - dw / 2, ry + cy * csH + csH * 0.35, dw, csH * 0.3);
      }
      for (let cx = 0; cx < r.cw; cx++) {
        if (W.edgeOpen(r, 'U', cx, 0) && W.roomAtCell(r.cx + cx, r.cy - 1)) g.fillRect(rx + cx * cs + cs * 0.35, ry - dw / 2, cs * 0.3, dw);
        if (W.edgeOpen(r, 'D', cx, 0) && W.roomAtCell(r.cx + cx, r.cy + r.ch)) g.fillRect(rx + cx * cs + cs * 0.35, ry + rh - dw / 2, cs * 0.3, dw);
      }
      // ícones
      if (full || cs >= 14) drawIcons(g, game, r, rx, ry, cs, csH, full, time);
      if (full && cs >= 30) {
        g.fillStyle = 'rgba(230,235,255,0.85)';
        g.font = '11px Georgia, serif'; g.textAlign = 'center';
        g.fillText(r.name, rx + rw / 2, ry + rh - 6);
      }
    }
    // jogador
    const pc = M.playerCell(game.room, game.player);
    const blink = Math.sin(time * 8) > -0.2;
    if (blink) {
      const px = ox + pc.x * cs, py = oy + pc.y * csH;
      const s = U.clamp(cs * 0.18, 3, 9);
      g.fillStyle = '#ffcf5a';
      g.beginPath(); g.moveTo(px, py - s * 1.3); g.lineTo(px + s, py); g.lineTo(px + s * 0.6, py + s); g.lineTo(px - s * 0.6, py + s); g.lineTo(px - s, py); g.closePath(); g.fill();
      g.strokeStyle = '#5a3a10'; g.lineWidth = 1; g.stroke();
    }
    g.restore();
  };

  function cellPos(r, tx, ty, rx, ry, cs, csH) {
    return { x: rx + (tx + 0.5) / C.CELL_W * cs, y: ry + (ty + 0.5) / C.CELL_H * csH };
  }

  function drawIcons(g, game, r, rx, ry, cs, csH, full, time) {
    const st = game.state;
    const sz = Math.max(3, cs * (full ? 0.16 : 0.2));
    for (const e of r.entities) {
      const p = cellPos(r, e.tx, e.ty, rx, ry, cs, csH);
      if (e.kind === 'save') {
        g.fillStyle = st.saves[e.id] ? '#7fe0ff' : '#4a6a8a';
        g.fillRect(p.x - sz / 2, p.y - sz, sz, sz * 1.4);
      } else if (full) {
        const collected = e.kind === 'relic' ? st.abilities[r.def.relic] : st.collected[e.id];
        if (collected || e.kind === 'ring') continue;
        const col = { relic: '#ffcf5a', heart: '#e0403a', mana: '#a060ff', potion: '#ff6070', book: '#d9b070', bell: '#ffcf5a' }[e.kind];
        if (!col) continue;
        g.fillStyle = col;
        g.beginPath(); g.arc(p.x, p.y, sz * 0.45, 0, Math.PI * 2); g.fill();
      }
    }
  }
})();
