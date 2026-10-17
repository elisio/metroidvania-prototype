/*
 * Telas e sobreposições: título, pausa, mapa completo, diálogos (nova
 * habilidade, livro), confirmação, final e créditos. Também os "prompts"
 * contextuais e os avisos rápidos (toasts).
 */
(function () {
  'use strict';
  const C = Game.CONFIG, U = Game.U, I = Game.Input, TXT = Game.TEXT;
  const VW = C.VIEW_W, VH = C.VIEW_H;
  const au = (fn, ...a) => { try { if (Game.Audio && Game.Audio[fn]) Game.Audio[fn](...a); } catch (e) { /* áudio opcional */ } };

  function serif(sz, bold, italic) { return (italic ? 'italic ' : '') + (bold ? 'bold ' : '') + sz + 'px Georgia, "Times New Roman", serif'; }
  Game.serif = serif;

  /** Texto com sombra. */
  function text(g, s, x, y, col, align, shadow) {
    g.textAlign = align || 'center';
    g.fillStyle = shadow || 'rgba(0,0,0,0.75)';
    g.fillText(s, x + 1.5, y + 2);
    g.fillStyle = col || '#eee';
    g.fillText(s, x, y);
  }
  Game.drawText = text;

  /** Painel ornamentado (moldura de ferro). */
  function panel(g, x, y, w, h, alpha) {
    g.save();
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, 'rgba(18,20,34,0.94)'); gr.addColorStop(1, 'rgba(8,9,16,0.96)');
    g.fillStyle = gr; U.roundRect(g, x, y, w, h, 6); g.fill();
    g.strokeStyle = '#6e6a7c'; g.lineWidth = 3; U.roundRect(g, x + 4, y + 4, w - 8, h - 8, 4); g.stroke();
    g.strokeStyle = '#26242e'; g.lineWidth = 2; U.roundRect(g, x, y, w, h, 6); g.stroke();
    for (const [cx, cy] of [[x + 6, y + 6], [x + w - 6, y + 6], [x + 6, y + h - 6], [x + w - 6, y + h - 6]]) {
      g.fillStyle = '#8f8a9e'; g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx + 7, cy); g.lineTo(cx, cy + 7); g.lineTo(cx - 7, cy); g.fill();
      g.fillStyle = '#2b2933'; g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
  Game.panel = panel;

  /* ================= Menu genérico ================= */
  function Menu(items, opts) {
    this.items = items; this.idx = 0; this.rects = []; this.opts = opts || {};
    this.skip();
  }
  Menu.prototype.skip = function () {
    let n = 0;
    while (this.items[this.idx] && this.items[this.idx].hidden && n++ < 20) this.idx = (this.idx + 1) % this.items.length;
  };
  Menu.prototype.move = function (d) {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      this.idx = (this.idx + d + n) % n;
      if (!this.items[this.idx].hidden) break;
    }
    au('play', 'menu_move');
  };
  Menu.prototype.update = function () {
    if (I.pressed.up) this.move(-1);
    if (I.pressed.down) this.move(1);
    const it = this.items[this.idx];
    if (it && it.adjust) {
      if (I.pressed.left) { it.adjust(-1); au('play', 'menu_move'); }
      if (I.pressed.right) { it.adjust(1); au('play', 'menu_move'); }
    }
    // clique / toque
    const tap = Game.Touch && Game.Touch.takeTap();
    if (tap) {
      for (let i = 0; i < this.rects.length; i++) {
        const r = this.rects[i];
        if (r && tap.x >= r.x && tap.x <= r.x + r.w && tap.y >= r.y && tap.y <= r.y + r.h) {
          this.idx = i;
          return this.activate(tap.x > r.x + r.w * 0.7 ? 1 : tap.x < r.x + r.w * 0.3 ? -1 : 0);
        }
      }
    }
    if (I.pressed.confirm || (I.pressed.attack && !this.opts.noAttackConfirm)) return this.activate(0);
    return null;
  };
  Menu.prototype.activate = function (side) {
    const it = this.items[this.idx];
    if (!it) return null;
    if (it.adjust && !it.action) { it.adjust(side || 1); au('play', 'menu_move'); return null; }
    au('play', 'menu_select');
    if (it.action) it.action();
    return it;
  };
  Menu.prototype.draw = function (g, x, y, lineH, time, align) {
    this.rects = [];
    g.font = serif(this.opts.size || 22);
    g.textBaseline = 'middle';
    let yy = y;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.hidden) { this.rects.push(null); continue; }
      const sel = i === this.idx;
      const label = typeof it.label === 'function' ? it.label() : it.label;
      const w = Math.max(200, g.measureText(label).width + 60);
      const rx = align === 'left' ? x - 20 : x - w / 2;
      this.rects.push({ x: rx, y: yy - lineH / 2, w, h: lineH });
      if (sel) {
        const gr = g.createLinearGradient(rx, 0, rx + w, 0);
        gr.addColorStop(0, 'rgba(255,200,120,0)'); gr.addColorStop(0.5, 'rgba(255,200,120,0.16)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
        g.fillStyle = gr; g.fillRect(rx, yy - lineH / 2 + 3, w, lineH - 6);
        const ax = align === 'left' ? x - 14 : x - g.measureText(label).width / 2 - 22;
        const bob = Math.sin(time * 6) * 2;
        g.fillStyle = '#ffcf6a';
        g.beginPath(); g.moveTo(ax + bob, yy - 6); g.lineTo(ax + 8 + bob, yy); g.lineTo(ax + bob, yy + 6); g.fill();
      }
      text(g, label, align === 'left' ? x : x, yy, it.disabled ? '#6a6878' : sel ? '#fff3d6' : '#b9b6c8', align === 'left' ? 'left' : 'center');
      yy += lineH;
    }
    g.textBaseline = 'alphabetic';
  };
  Game.Menu = Menu;

  /* ================= Título ================= */
  const Title = Game.Title = { t: 0, menu: null, confirm: null, credits: false };

  Title.enter = function () {
    Title.t = 0; Title.credits = false; Title.confirm = null;
    const has = Game.Save.exists();
    Title.menu = new Menu([
      { label: 'Continuar', hidden: !has, action: () => Game.G.continueGame() },
      { label: 'Novo jogo', action: () => {
        if (Game.Save.exists()) {
          Title.confirm = new Menu([
            { label: 'Não', action: () => { Title.confirm = null; } },
            { label: 'Sim, apagar e começar', action: () => { Title.confirm = null; Game.Save.wipe(); Game.G.newGame(); } }
          ]);
        } else Game.G.newGame();
      } },
      { label: 'Créditos', action: () => { Title.credits = true; } },
      { label: () => 'Tela cheia', action: () => Game.Screen.toggleFullscreen() }
    ]);
    au('music', 'title');
    au('ambient', 'rain', 0.6);
  };

  Title.update = function (dt) {
    Title.t += dt;
    if (Title.credits) {
      if (I.pressed.confirm || I.pressed.back || I.pressed.attack || (Game.Touch && Game.Touch.takeTap())) { Title.credits = false; au('play', 'menu_back'); }
      return;
    }
    if (Title.confirm) {
      if (I.pressed.back) { Title.confirm = null; au('play', 'menu_back'); return; }
      Title.confirm.update();
      return;
    }
    Title.menu.update();
  };

  Title.draw = function (g, time) {
    // cidade em parallax lento
    const cam = { x: time * 14, y: 0 };
    const fakeRoom = { ox: 0, oy: 3 * C.CELL_H * C.TILE };
    Game.Terrain.drawExteriorBg(g, cam, fakeRoom, time, Game.FX.flash);
    Game.FX.drawFog(g, time * 20, time, VH - 170, 0.9, 12);
    Game.FX.drawRain(g, 1);
    // passarela silhueta no rodapé
    const deck = Game.Tex.get('tile_deck');
    for (let x = -((time * 30) % deck.width); x < VW; x += deck.width) g.drawImage(deck, x, VH - 56);
    g.fillStyle = 'rgba(5,6,12,0.55)'; g.fillRect(0, VH - 56 + deck.height, VW, 60);
    Game.Terrain.drawVignette(g, 0.9);

    // título
    const a = U.clamp(Title.t / 1.2, 0, 1);
    g.save();
    g.globalAlpha = a;
    g.font = serif(76, true);
    g.textBaseline = 'middle';
    g.save();
    g.globalCompositeOperation = 'lighter';
    Game.FX.glow(g, VW / 2, 128, 260, 'whip', 0.18 + 0.04 * Math.sin(time * 2));
    g.restore();
    const gr = g.createLinearGradient(0, 90, 0, 168);
    gr.addColorStop(0, '#fff2d2'); gr.addColorStop(0.55, '#e8b866'); gr.addColorStop(1, '#8a5a24');
    g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillText(TXT.title, VW / 2 + 3, 132 + 4);
    g.fillStyle = gr; g.fillText(TXT.title, VW / 2, 130);
    g.strokeStyle = 'rgba(40,20,8,0.7)'; g.lineWidth = 1.5; g.strokeText(TXT.title, VW / 2, 130);
    g.font = serif(17, false, true);
    text(g, TXT.subtitle, VW / 2, 182, '#b8bdd6');
    // chicote decorativo sob o título
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,220,150,0.7)'; g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, x = VW / 2 - 190 + t * 380, y = 206 + Math.sin(t * Math.PI * 3 + time * 3) * 4 * Math.sin(t * Math.PI);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.restore();

    if (Title.credits) {
      panel(g, VW / 2 - 260, 230, 520, 240);
      g.font = serif(18);
      TXT.credits.forEach((l, i) => text(g, l, VW / 2, 272 + i * 34, i === 0 ? '#ffd890' : '#d6d3e2'));
      g.font = serif(13, false, true);
      text(g, 'Pressione ' + I.label('confirm') + ' para voltar', VW / 2, 452, '#8f8ca2');
      return;
    }
    Title.menu.draw(g, VW / 2, 290, 44, time);
    if (Title.confirm) {
      panel(g, VW / 2 - 220, 250, 440, 170);
      g.font = serif(19);
      text(g, 'Apagar o progresso salvo?', VW / 2, 286, '#ffd890');
      Title.confirm.draw(g, VW / 2, 338, 40, time);
    }
    g.font = serif(13);
    const hint = I.device === 'touch' ? 'Toque numa opção' : 'Setas/WASD: navegar  ·  Enter/Espaço: confirmar';
    text(g, hint, VW / 2, VH - 20, '#7d7a90');
  };

  /* ================= Pausa ================= */
  const Pause = Game.Pause = { menu: null };
  Pause.open = function () {
    const S = Game.Settings;
    const pct = (v) => Math.round(v * 100) + '%';
    Pause.menu = new Menu([
      { label: 'Continuar', action: () => Game.G.closeOverlay() },
      { label: 'Mapa', action: () => Game.G.openMap() },
      { label: () => 'Música   ◂ ' + pct(S.vol('music')) + ' ▸', adjust: (d) => S.setVol('music', U.clamp(Math.round((S.vol('music') + d * 0.1) * 10) / 10, 0, 1)) },
      { label: () => 'Efeitos  ◂ ' + pct(S.vol('sfx')) + ' ▸', adjust: (d) => { S.setVol('sfx', U.clamp(Math.round((S.vol('sfx') + d * 0.1) * 10) / 10, 0, 1)); au('play', 'pickup'); } },
      { label: () => 'Ambiente ◂ ' + pct(S.vol('ambient')) + ' ▸', adjust: (d) => S.setVol('ambient', U.clamp(Math.round((S.vol('ambient') + d * 0.1) * 10) / 10, 0, 1)) },
      { label: () => 'Tremor de tela: ' + (S.data.shake ? 'sim' : 'não'), adjust: () => { S.data.shake = !S.data.shake; S.store(); } },
      { label: 'Tela cheia', action: () => Game.Screen.toggleFullscreen() },
      { label: 'Controles', action: () => { Pause.controls = true; } },
      { label: 'Sair para o título', action: () => Game.G.toTitle() }
    ], { noAttackConfirm: true });
    Pause.controls = false;
  };
  Pause.update = function () {
    if (Pause.controls) {
      if (I.pressed.back || I.pressed.confirm || I.pressed.pause || (Game.Touch && Game.Touch.takeTap())) Pause.controls = false;
      return;
    }
    if (I.pressed.pause || I.pressed.back) { au('play', 'menu_back'); Game.G.closeOverlay(); return; }
    Pause.menu.update();
  };
  Pause.draw = function (g, time, game) {
    g.fillStyle = 'rgba(4,5,10,0.6)'; g.fillRect(0, 0, VW, VH);
    if (Pause.controls) return drawControls(g);
    panel(g, VW / 2 - 230, 56, 460, 448);
    g.font = serif(30, true);
    text(g, 'Pausa', VW / 2, 102, '#ffd890');
    const st = game.state;
    g.font = serif(13);
    text(g, 'Tempo ' + U.fmtTime(st.playTime) + '   ·   Itens ' + Game.G.completion() + '%   ·   Quedas ' + st.deaths, VW / 2, 130, '#9a97ae');
    Pause.menu.draw(g, VW / 2, 170, 36, time);
  };

  function drawControls(g) {
    panel(g, VW / 2 - 300, 60, 600, 420);
    g.font = serif(26, true);
    text(g, 'Controles', VW / 2, 104, '#ffd890');
    const rows = [
      ['Mover', '← → / A D  ·  analógico'],
      ['Pular (segure = mais alto)', 'Espaço / Z  ·  Ⓐ'],
      ['Chicote / gancho (no ar)', 'X / J  ·  Ⓧ'],
      ['Dash', 'C / K / Shift  ·  Ⓑ RB'],
      ['Descer de passarela', '↓ + Pular'],
      ['Interagir (salvar, ler, sino)', '↑ perto do objeto'],
      ['Poção  ·  Foco (gasta mana)', 'Q  ·  F'],
      ['Mapa  ·  Pausa', 'M / Tab  ·  Esc'],
      ['Debug', 'F1 (hitboxes, FPS, [ ] troca de sala)']
    ];
    g.font = serif(15);
    rows.forEach((r, i) => {
      text(g, r[0], VW / 2 - 270, 150 + i * 34, '#d9d5e6', 'left');
      text(g, r[1], VW / 2 + 270, 150 + i * 34, '#ffcf8a', 'right');
    });
  }

  /* ================= Mapa completo ================= */
  const MapScreen = Game.MapScreen = { zoom: 1 };
  MapScreen.update = function () {
    if (I.pressed.map || I.pressed.back || I.pressed.pause || I.pressed.confirm || (Game.Touch && Game.Touch.takeTap())) { au('play', 'menu_back'); Game.G.closeOverlay(); }
  };
  MapScreen.draw = function (g, time, game) {
    g.fillStyle = 'rgba(3,4,9,0.86)'; g.fillRect(0, 0, VW, VH);
    panel(g, 40, 30, VW - 80, VH - 60);
    g.font = serif(26, true);
    text(g, 'Mapa da Cidade', VW / 2, 70, '#ffd890');
    const W = Game.World;
    const cs = 96;
    const cx = W.gridW / 2, cy = W.gridH / 2;
    Game.Map.draw(g, game, 70, 92, VW - 140, VH - 190, cs, cx, cy, true, time);
    // legenda
    g.font = serif(13);
    const lg = [['#7fe0ff', 'Estátua (save)'], ['#ffcf5a', 'Relíquia'], ['#e0403a', 'Coração'], ['#a060ff', 'Mana'], ['#ff6070', 'Poção'], ['#d9b070', 'Livro']];
    let lx = 80;
    for (const [col, name] of lg) {
      g.fillStyle = col; g.beginPath(); g.arc(lx, VH - 74, 5, 0, Math.PI * 2); g.fill();
      text(g, name, lx + 10, VH - 70, '#c9c6d8', 'left');
      lx += g.measureText(name).width + 38;
    }
    const st = game.state;
    const ab = st.abilities;
    const abil = ['double', 'dash', 'hook'].map((k) => (ab[k] ? '◆ ' : '◇ ') + TXT.abilities[k].what.toLowerCase()).join('    ');
    text(g, abil, VW / 2, VH - 48, '#e8d9b0');
    text(g, 'Itens: ' + Game.G.completion() + '%', VW - 80, 70, '#9a97ae', 'right');
  };

  /* ================= Diálogos ================= */
  const Dialog = Game.Dialog = { cur: null };
  /** kind: 'ability' | 'book' | 'info'. */
  Dialog.open = function (d) { Dialog.cur = Object.assign({ t: 0 }, d); };
  Dialog.update = function (dt) {
    const d = Dialog.cur;
    if (!d) return true;
    d.t += dt;
    const tap = Game.Touch && Game.Touch.takeTap();
    if (d.t > 0.6 && (I.pressed.confirm || I.pressed.attack || I.pressed.back || I.pressed.up || tap)) {
      au('play', 'menu_select');
      Dialog.cur = null;
      if (d.onClose) d.onClose();
      return true;
    }
    return false;
  };
  Dialog.draw = function (g, time) {
    const d = Dialog.cur;
    if (!d) return;
    const k = U.easeOutCubic(U.clamp(d.t / 0.35, 0, 1));
    g.fillStyle = 'rgba(3,4,10,' + (0.65 * k) + ')'; g.fillRect(0, 0, VW, VH);
    g.save();
    g.globalAlpha = k;
    if (d.kind === 'ability') {
      const ab = TXT.abilities[d.ability];
      g.save(); g.globalCompositeOperation = 'lighter';
      Game.FX.glow(g, VW / 2, 200, 220 + Math.sin(time * 3) * 10, 'gold', 0.35);
      g.restore();
      panel(g, VW / 2 - 300, 120 + (1 - k) * 30, 600, 300);
      g.font = serif(15, true);
      text(g, 'NOVA HABILIDADE', VW / 2, 165, '#e8b866');
      g.font = serif(36, true);
      text(g, ab.what, VW / 2, 212, '#fff3d6');
      g.font = serif(17, false, true);
      text(g, '— ' + ab.name + ' —', VW / 2, 244, '#c9b48a');
      g.font = serif(18);
      U.wrap(g, ab.desc, 500).forEach((l, i) => text(g, l, VW / 2, 290 + i * 26, '#d9d6e6'));
      g.font = serif(18, true);
      text(g, ab.how(I.label), VW / 2, 360, '#8fe6ff');
    } else {
      const w = 560;
      g.font = serif(17);
      const lines = U.wrap(g, d.body, w - 80);
      const h = 120 + lines.length * 26;
      const y = VH / 2 - h / 2;
      // pergaminho escuro
      panel(g, VW / 2 - w / 2, y, w, h);
      if (d.kind === 'book') {
        const im = Game.Tex.get('icon_book');
        g.drawImage(im, VW / 2 - w / 2 + 24, y + 22);
      }
      g.font = serif(20, true);
      text(g, d.title, VW / 2, y + 44, '#ffd890');
      g.font = serif(17);
      lines.forEach((l, i) => text(g, l, VW / 2, y + 84 + i * 26, '#e2dfee'));
    }
    if (d.t > 0.6) {
      g.font = serif(13, false, true);
      text(g, (I.device === 'touch' ? 'Toque' : I.label('confirm')) + ' para continuar', VW / 2, d.kind === 'ability' ? 404 : VH / 2 + 160, 'rgba(200,196,220,' + (0.6 + 0.4 * Math.sin(time * 4)) + ')');
    }
    g.restore();
  };

  /* ================= Toasts e prompts ================= */
  const Toast = Game.Toast = { list: [] };
  Toast.add = function (msg, col) {
    Toast.list.push({ msg, col: col || '#f2e6c8', t: 0, life: 2.6 });
    if (Toast.list.length > 4) Toast.list.shift();
  };
  Toast.update = function (dt) {
    for (let i = Toast.list.length - 1; i >= 0; i--) { Toast.list[i].t += dt; if (Toast.list[i].t > Toast.list[i].life) Toast.list.splice(i, 1); }
  };
  Toast.draw = function (g) {
    g.font = serif(16);
    Toast.list.forEach((t, i) => {
      const a = Math.min(1, t.t * 5, (t.life - t.t) * 2);
      const y = VH - 70 - (Toast.list.length - 1 - i) * 30;
      g.globalAlpha = a;
      const w = g.measureText(t.msg).width + 40;
      g.fillStyle = 'rgba(8,9,16,0.75)'; U.roundRect(g, VW / 2 - w / 2, y - 18, w, 28, 6); g.fill();
      g.strokeStyle = 'rgba(160,150,120,0.5)'; g.lineWidth = 1; g.stroke();
      text(g, t.msg, VW / 2, y + 1, t.col);
      g.globalAlpha = 1;
    });
  };

  /** Prompt acima de um ponto do mundo (coordenadas de tela). */
  Game.drawPrompt = function (g, x, y, key, label, time) {
    g.font = serif(14, true);
    const kw = Math.max(22, g.measureText(key).width + 12);
    g.font = serif(14);
    const lw = g.measureText(label).width;
    const w = kw + lw + 18;
    const yy = y + Math.sin(time * 4) * 2;
    g.fillStyle = 'rgba(8,9,16,0.8)'; U.roundRect(g, x - w / 2, yy - 14, w, 26, 6); g.fill();
    g.strokeStyle = 'rgba(255,207,106,0.6)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#ffcf6a'; U.roundRect(g, x - w / 2 + 4, yy - 10, kw, 18, 4); g.fill();
    g.font = serif(14, true); g.fillStyle = '#1a1208'; g.textAlign = 'center'; g.fillText(key, x - w / 2 + 4 + kw / 2, yy + 4);
    g.font = serif(14); g.fillStyle = '#efe8d8'; g.textAlign = 'left'; g.fillText(label, x - w / 2 + kw + 12, yy + 4);
  };

  /* ================= Final ================= */
  const Ending = Game.Ending = { t: 0 };
  Ending.enter = function () { Ending.t = 0; au('music', 'title'); };
  Ending.update = function (dt) {
    Ending.t += dt;
    if (Ending.t > 4 && (I.pressed.confirm || I.pressed.attack || (Game.Touch && Game.Touch.takeTap()))) Game.G.toTitle();
  };
  Ending.draw = function (g, time, game) {
    const cam = { x: time * 8, y: -200 };
    Game.Terrain.drawExteriorBg(g, cam, { ox: 0, oy: 0 }, time, 0);
    g.fillStyle = 'rgba(4,5,12,0.55)'; g.fillRect(0, 0, VW, VH);
    Game.FX.drawRain(g, Math.max(0, 1 - Ending.t / 8));
    g.font = serif(40, true);
    g.globalAlpha = U.clamp(Ending.t / 1.5, 0, 1);
    text(g, 'Fim', VW / 2, 110, '#ffd890');
    g.font = serif(19, false, true);
    TXT.ending.forEach((l, i) => {
      g.globalAlpha = U.clamp((Ending.t - 1 - i * 1.2) / 1.2, 0, 1);
      text(g, l, VW / 2, 180 + i * 36, '#e2dfee');
    });
    g.globalAlpha = U.clamp((Ending.t - 4.6) / 1, 0, 1);
    const st = game.state;
    g.font = serif(17);
    text(g, 'Tempo: ' + U.fmtTime(st.playTime) + '     Itens: ' + Game.G.completion() + '%     Quedas: ' + st.deaths, VW / 2, 330, '#c9c6d8');
    g.font = serif(14);
    TXT.credits.forEach((l, i) => text(g, l, VW / 2, 380 + i * 24, '#8f8ca2'));
    g.globalAlpha = 1;
    if (Ending.t > 4) { g.font = serif(13, false, true); text(g, 'Pressione ' + I.label('confirm') + ' para voltar ao título', VW / 2, VH - 18, '#7d7a90'); }
  };
})();
