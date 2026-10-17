/*
 * HUD com o mesmo layout da referência:
 *   [retrato circular] [barra vermelha de vida]                [livro]  [minimapa
 *   [badge nível "1"]  [barra roxa→azul de mana]               [poção]   ornamentado]
 *   [coração + contador]  [corações ♥♥♡♡]
 * Usa os PNGs do HUD quando existem; senão desenha molduras equivalentes.
 */
(function () {
  'use strict';
  const C = Game.CONFIG, U = Game.U, Tex = Game.Tex;

  const H = Game.HUD = { hpShown: 1, manaShown: 1, hpLag: 1, msg: null };

  function serif(sz, bold) { return (bold ? 'bold ' : '') + sz + 'px Georgia, "Times New Roman", serif'; }

  /** Moldura de barra (fallback para hud_bar_frame). */
  function barFrameFallback(g, x, y, w, h) {
    g.fillStyle = '#15151d';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w - 12, y); g.lineTo(x + w, y + h / 2); g.lineTo(x + w - 12, y + h); g.lineTo(x, y + h); g.closePath(); g.fill();
    g.strokeStyle = '#7d7a8c'; g.lineWidth = 2; g.stroke();
  }

  function drawBar(g, x, y, w, h, frac, lag, colA, colB) {
    g.fillStyle = '#0b0b12'; g.fillRect(x, y, w, h);
    if (lag > frac) { g.fillStyle = 'rgba(255,240,220,0.55)'; g.fillRect(x, y, w * lag, h); }
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, colA); gr.addColorStop(1, colB);
    g.fillStyle = gr; g.fillRect(x, y, w * frac, h);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, y, w * frac, Math.max(1, h * 0.3));
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + h * 0.7, w * frac, h * 0.3);
  }

  H.draw = function (g, game, time, dt) {
    const st = game.state;
    const hpFrac = st.hearts / st.maxHearts;
    const manaFrac = st.mana / st.maxMana;
    H.hpShown = U.damp(H.hpShown, hpFrac, 10, dt);
    H.hpLag = hpFrac < H.hpLag ? U.approach(H.hpLag, hpFrac, dt * 0.5) : hpFrac;
    H.manaShown = U.damp(H.manaShown, manaFrac, 10, dt);

    g.save();
    // leve fundo escuro atrás do HUD para legibilidade
    const grd = g.createLinearGradient(0, 0, 0, 110);
    grd.addColorStop(0, 'rgba(5,6,12,0.55)'); grd.addColorStop(1, 'rgba(5,6,12,0)');
    g.fillStyle = grd; g.fillRect(0, 0, C.VIEW_W, 110);

    /* ---- barras (desenhadas antes do retrato, que fica por cima) ---- */
    const bf = Game.Assets.img('hud_bar_frame');
    const BX = 92, BY = 14;
    // Na arte (242×52): barra de vida interna x 14..228, y 9..20; mana x 14..190, y 33..44
    if (bf) {
      const s = 1.25;
      drawBar(g, BX + 14 * s, BY + 9 * s, 214 * s, 12 * s, H.hpShown, H.hpLag, '#a01818', '#e5443a');
      drawBar(g, BX + 14 * s, BY + 33 * s, 176 * s, 12 * s, H.manaShown, H.manaShown, '#9b46d8', '#2fb7e8');
      g.drawImage(bf, BX, BY, bf.width * s, bf.height * s);
    } else {
      barFrameFallback(g, BX, BY + 6, 280, 20);
      drawBar(g, BX + 6, BY + 10, 262, 12, H.hpShown, H.hpLag, '#a01818', '#e5443a');
      barFrameFallback(g, BX, BY + 34, 230, 20);
      drawBar(g, BX + 6, BY + 38, 212, 12, H.manaShown, H.manaShown, '#9b46d8', '#2fb7e8');
    }

    /* ---- retrato ---- */
    const PX = 10, PY = 6;
    const pf = Game.Assets.img('hud_portrait_frame');
    const portrait = Tex.get('hero_portrait');
    g.save();
    g.beginPath(); g.arc(PX + 53, PY + 52, 39, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#141a2c'; g.fillRect(PX, PY, 107, 105);
    g.drawImage(portrait, PX + 53 - 40, PY + 52 - 40, 80, 80);
    if (game.player && game.player.invuln > 0.6) { g.fillStyle = 'rgba(255,40,40,0.35)'; g.fillRect(PX, PY, 107, 105); }
    g.restore();
    if (pf) g.drawImage(pf, PX, PY);
    else {
      g.strokeStyle = '#5e5b6c'; g.lineWidth = 6; g.beginPath(); g.arc(PX + 53, PY + 52, 42, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#2a2833'; g.lineWidth = 2; g.beginPath(); g.arc(PX + 53, PY + 52, 46, 0, Math.PI * 2); g.stroke();
    }

    /* ---- badge de nível "1" ---- */
    const lb = Game.Assets.img('hud_level_badge');
    const LX = 98, LY = 82;
    if (lb) g.drawImage(lb, LX, LY);
    else { g.fillStyle = '#151824'; g.beginPath(); g.arc(LX + 21, LY + 21, 19, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#6a6878'; g.lineWidth = 3; g.stroke(); }
    g.fillStyle = '#0b0c14'; g.beginPath(); g.arc(LX + 21, LY + 21, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2f0ea'; g.font = serif(20, true); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('1', LX + 21, LY + 22);

    /* ---- badge de vidas/coração com contador (corações cheios) ---- */
    const vb = Game.Assets.img('hud_lives_badge');
    const VX = 10, VY = 104;
    if (vb) g.drawImage(vb, VX, VY);
    else {
      g.fillStyle = '#151824'; U.roundRect(g, VX + 30, VY + 8, 44, 24, 5); g.fill();
      g.beginPath(); g.arc(VX + 20, VY + 20, 18, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#6a6878'; g.lineWidth = 2; g.stroke();
      const hh = Tex.get('hud_heart_full'); g.drawImage(hh, VX + 7, VY + 8);
    }
    // cobre o número embutido (se houver) e escreve o contador atual
    g.fillStyle = '#121522'; U.roundRect(g, VX + 42, VY + 11, 26, 18, 3); g.fill();
    g.fillStyle = '#f2f0ea'; g.font = serif(17, true);
    g.fillText(String(st.hearts), VX + 55, VY + 21);

    /* ---- corações ---- */
    const hf = Tex.get('hud_heart_full'), he = Tex.get('hud_heart_empty');
    for (let i = 0; i < st.maxHearts; i++) {
      const x = 152 + i * 31, y = 86;
      const full = i < st.hearts;
      let s = 1;
      if (full && i === st.hearts - 1 && st.hearts <= 1) s = 1 + Math.max(0, Math.sin(time * 8)) * 0.12; // pulsando com vida baixa
      const im = full ? hf : he;
      const w = im.width * 1.08 * s, h = im.height * 1.08 * s;
      g.drawImage(im, x + 13 - w / 2, y + 12 - h / 2, w, h);
    }

    /* ---- slots: livro e poção ---- */
    const slot = Game.Assets.img('hud_slot');
    const SX = 690, SY1 = 10, SY2 = 62;
    for (const [sy, icon, count] of [[SY1, 'icon_book', st.books], [SY2, 'icon_potion', st.potions]]) {
      if (slot) g.drawImage(slot, SX, sy);
      else { g.fillStyle = '#10121c'; U.roundRect(g, SX, sy, 46, 46, 6); g.fill(); g.strokeStyle = '#6a6878'; g.lineWidth = 2; g.stroke(); }
      const im = Tex.get(icon);
      g.globalAlpha = count > 0 ? 1 : 0.3;
      g.drawImage(im, SX + 23 - im.width / 2, sy + 23 - im.height / 2);
      g.globalAlpha = 1;
      if (count > 0) {
        g.font = serif(12, true); g.textAlign = 'right';
        g.fillStyle = '#000'; g.fillText('×' + count, SX + 44, sy + 41);
        g.fillStyle = '#f2e6c8'; g.fillText('×' + count, SX + 43, sy + 40);
        g.textAlign = 'center';
      }
    }
    // dica da poção
    if (st.potions > 0 && st.hearts < st.maxHearts) {
      g.font = serif(10); g.fillStyle = 'rgba(240,230,200,0.75)';
      g.fillText(Game.Input.label('potion'), SX - 9, SY2 + 23);
    }

    /* ---- minimapa ---- */
    const mf = Game.Assets.img('hud_minimap_frame');
    const MX = 750, MY = 6, MW = 196, MH = 114;
    // área interna da moldura: x 11..181, y 14..99
    const pc = Game.Map.playerCell(game.room, game.player);
    Game.Map.draw(g, game, MX + 12, MY + 14, 170, 86, 26, pc.x, pc.y, false, time);
    if (mf) g.drawImage(mf, MX, MY);
    else {
      g.strokeStyle = '#6e6a7c'; g.lineWidth = 5; g.strokeRect(MX + 8, MY + 10, MW - 16, MH - 20);
      g.strokeStyle = '#2a2833'; g.lineWidth = 2; g.strokeRect(MX + 3, MY + 5, MW - 6, MH - 10);
      for (const [cx, cy] of [[MX + 8, MY + 10], [MX + MW - 8, MY + 10], [MX + 8, MY + MH - 10], [MX + MW - 8, MY + MH - 10]]) {
        g.fillStyle = '#8a8698'; g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.fill();
      }
    }
    // nome da sala sob o minimapa
    g.font = serif(12); g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(game.room.name, MX + MW - 9, MY + MH + 13);
    g.fillStyle = 'rgba(215,220,240,0.9)'; g.fillText(game.room.name, MX + MW - 10, MY + MH + 12);
    g.restore();
  };
})();
