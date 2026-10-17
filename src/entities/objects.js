/*
 * Objetos interativos das salas: estátuas de save, livros, relíquias,
 * recipientes de coração, fragmentos de mana, poções, argolas do gancho e o sino.
 * Cada objeto tem posição em px da sala (x,y = centro-base para estátuas,
 * centro para itens).
 */
(function () {
  'use strict';
  const C = Game.CONFIG, U = Game.U, TS = C.TILE;

  const O = Game.Objects = {};

  /** Instancia os objetos de uma sala considerando o progresso salvo. */
  O.spawn = function (room, state) {
    const list = [], rings = [];
    for (const e of room.entities) {
      const cx = e.tx * TS + TS / 2, cy = e.ty * TS + TS / 2;
      const base = { kind: e.kind, id: e.id, tx: e.tx, ty: e.ty, x: cx, y: cy, t: Math.random() * 10 };
      switch (e.kind) {
        case 'save': list.push(Object.assign(base, { y: (e.ty + 1) * TS, lit: !!state.saves[e.id], glow: state.saves[e.id] ? 1 : 0 })); break;
        case 'ring': { const r = Object.assign(base, { y: cy }); list.push(r); rings.push(r); break; }
        case 'bell': list.push(Object.assign(base, { y: (e.ty + 1) * TS, rung: !!state.finished, swing: 0 })); break;
        case 'relic':
          if (!state.abilities[room.def.relic]) list.push(Object.assign(base, { ability: room.def.relic }));
          break;
        default:
          if (!state.collected[e.id]) list.push(base);
      }
    }
    return { list, rings };
  };

  /** Área de interação/coleta de um objeto. */
  O.box = function (o) {
    switch (o.kind) {
      case 'save': return { x: o.x - 40, y: o.y - 110, w: 80, h: 110 };
      case 'bell': return { x: o.x - 60, y: o.y - 150, w: 120, h: 150 };
      case 'book': return { x: o.x - 22, y: o.y - 26, w: 44, h: 52 };
      case 'relic': return { x: o.x - 26, y: o.y - 34, w: 52, h: 60 };
      default: return { x: o.x - 20, y: o.y - 22, w: 40, h: 44 };
    }
  };

  O.update = function (objs, dt) {
    for (const o of objs) {
      o.t += dt;
      if (o.kind === 'save') o.glow = U.approach(o.glow, o.lit ? 1 : 0, dt * 2);
      if (o.kind === 'bell') o.swing *= Math.pow(0.6, dt);
      if (o.pop) { o.pop -= dt; }
    }
  };

  /* ---------------- desenho ---------------- */
  O.draw = function (g, o, time, hookAvail, nearRing) {
    switch (o.kind) {
      case 'save': drawSave(g, o, time); break;
      case 'ring': drawRing(g, o, time, hookAvail, nearRing === o); break;
      case 'bell': drawBell(g, o, time); break;
      case 'relic': drawRelic(g, o, time); break;
      case 'heart': drawFloat(g, o, time, 'heart'); break;
      case 'mana': drawFloat(g, o, time, 'mana'); break;
      case 'potion': drawFloat(g, o, time, 'potion'); break;
      case 'book': drawFloat(g, o, time, 'book'); break;
    }
  };

  /** Brilhos aditivos dos objetos (chamado com 'lighter'). */
  O.drawGlow = function (g, o, time) {
    const FX = Game.FX;
    const bob = Math.sin(o.t * 2.4) * 4;
    switch (o.kind) {
      case 'save': if (o.glow > 0) { FX.glow(g, o.x, o.y - 70, 110, 'blue', 0.55 * o.glow); FX.glow(g, o.x, o.y - 84, 28, 'cyan', 0.9 * o.glow); } else FX.glow(g, o.x, o.y - 84, 18, 'blue', 0.2 + 0.1 * Math.sin(time * 3)); break;
      case 'relic': FX.glow(g, o.x, o.y + bob, 80 + Math.sin(time * 4) * 8, 'gold', 0.8); break;
      case 'heart': FX.glow(g, o.x, o.y + bob, 46, 'red', 0.6); break;
      case 'mana': FX.glow(g, o.x, o.y + bob, 44, 'purple', 0.7); break;
      case 'potion': FX.glow(g, o.x, o.y + bob, 36, 'red', 0.45); break;
      case 'book': FX.glow(g, o.x, o.y + bob, 36, 'lamp', 0.5); break;
      case 'bell': FX.glow(g, o.x, o.y - 70, 90, 'gold', o.rung ? 0.6 : 0.25); break;
    }
  };

  function drawSave(g, o, time) {
    // pedestal + gárgula (prop_gargoyle) com olhos que acendem
    const x = o.x, y = o.y;
    g.fillStyle = '#26242c'; g.fillRect(x - 34, y - 18, 68, 18);
    g.fillStyle = '#3e3c48'; g.fillRect(x - 34, y - 18, 68, 3);
    g.fillStyle = '#1b1a20'; g.fillRect(x - 28, y - 30, 56, 12);
    const im = Game.Tex.get('prop_gargoyle');
    const s = 0.82;
    g.drawImage(im, x - im.width * s / 2, y - 30 - im.height * s, im.width * s, im.height * s);
    // runa no pedestal
    g.fillStyle = o.glow > 0.05 ? 'rgba(120,220,255,' + (0.4 + 0.6 * o.glow) + ')' : 'rgba(80,100,140,0.6)';
    g.fillRect(x - 6, y - 14, 12, 3); g.fillRect(x - 1.5, y - 17, 3, 10);
    // olhos
    const eyeY = y - 30 - im.height * s * 0.7;
    g.fillStyle = o.glow > 0.05 ? 'rgba(170,240,255,' + o.glow + ')' : 'rgba(40,50,70,1)';
    g.fillRect(x - 9, eyeY, 5, 3); g.fillRect(x + 4, eyeY, 5, 3);
  }

  function drawRing(g, o, time, avail, near) {
    const x = o.x, y = o.y;
    // suporte
    g.strokeStyle = '#2b2a33'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(x, y - 16); g.lineTo(x, y - 60); g.stroke();
    g.fillStyle = '#3a3844'; g.fillRect(x - 10, y - 64, 20, 6);
    // argola
    g.strokeStyle = '#6d6a7a'; g.lineWidth = 5;
    g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#a7a3b8'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, 12, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
    // marca dourada (indica "use o gancho")
    g.fillStyle = avail ? '#ffcf6a' : '#8a7340';
    g.beginPath(); g.moveTo(x, y + 18); g.lineTo(x - 5, y + 25); g.lineTo(x + 5, y + 25); g.fill();
    if (near) {
      g.strokeStyle = 'rgba(255,220,140,' + (0.5 + 0.5 * Math.sin(time * 10)) + ')';
      g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.stroke();
    }
  }

  function drawBell(g, o, time) {
    const x = o.x, y = o.y;
    g.fillStyle = '#2a2730'; g.fillRect(x - 60, y - 160, 120, 10); g.fillRect(x - 56, y - 160, 8, 160); g.fillRect(x + 48, y - 160, 8, 160);
    g.save();
    g.translate(x, y - 150);
    g.rotate(Math.sin(time * 6) * o.swing);
    const gr = g.createLinearGradient(-40, 0, 40, 0);
    gr.addColorStop(0, '#5a3d17'); gr.addColorStop(0.45, '#c79a45'); gr.addColorStop(1, '#4a3212');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-14, 12); g.quadraticCurveTo(-18, 70, -42, 100); g.lineTo(42, 100); g.quadraticCurveTo(18, 70, 14, 12);
    g.quadraticCurveTo(0, 2, -14, 12); g.fill();
    g.fillStyle = '#3b2a10'; g.fillRect(-44, 96, 88, 8);
    g.fillStyle = '#2a1d0a'; g.beginPath(); g.arc(0, 104, 9, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawRelic(g, o, time) {
    const bob = Math.sin(o.t * 2.4) * 4;
    const x = o.x, y = o.y + bob;
    // pedestal
    g.fillStyle = '#25232b'; g.fillRect(x - 22, o.y + 16, 44, 16);
    g.fillStyle = '#45424f'; g.fillRect(x - 22, o.y + 16, 44, 3);
    g.save();
    g.translate(x, y);
    g.rotate(Math.sin(time * 1.5) * 0.15);
    const cols = { double: '#ffd27a', dash: '#7ff3ff', hook: '#ffb36a' };
    g.fillStyle = '#1a1820';
    g.beginPath(); g.moveTo(0, -24); g.lineTo(18, 0); g.lineTo(0, 24); g.lineTo(-18, 0); g.closePath(); g.fill();
    g.strokeStyle = cols[o.ability] || '#fff'; g.lineWidth = 3; g.stroke();
    g.fillStyle = cols[o.ability] || '#fff';
    if (o.ability === 'double') { g.beginPath(); g.moveTo(-8, 6); g.lineTo(0, -8); g.lineTo(8, 6); g.lineTo(0, 0); g.fill(); }
    else if (o.ability === 'dash') { g.fillRect(-10, -3, 14, 6); g.beginPath(); g.moveTo(4, -8); g.lineTo(12, 0); g.lineTo(4, 8); g.fill(); }
    else { g.beginPath(); g.arc(0, -2, 6, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = g.fillStyle; g.stroke(); g.fillRect(-1, 4, 2, 8); }
    g.restore();
  }

  function drawFloat(g, o, time, type) {
    const bob = Math.sin(o.t * 2.4) * 4;
    const x = o.x, y = o.y + bob;
    if (type === 'heart') {
      const s = 1 + Math.sin(time * 6) * 0.06;
      g.save(); g.translate(x, y); g.scale(s, s);
      // recipiente: coração dentro de um relicário
      g.fillStyle = '#2a2530'; g.beginPath(); g.arc(0, 0, 18, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#8a7a60'; g.lineWidth = 2; g.stroke();
      const im = Game.Tex.get('hud_heart_full');
      g.drawImage(im, -im.width / 2, -im.height / 2);
      g.fillStyle = '#ffe1a0'; g.font = 'bold 12px Georgia, serif'; g.textAlign = 'center'; g.fillText('+', 13, -9);
      g.restore();
    } else if (type === 'mana') {
      g.save(); g.translate(x, y); g.rotate(time * 1.2);
      g.fillStyle = '#5a2a9a';
      g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 0); g.lineTo(0, 14); g.lineTo(-9, 0); g.closePath(); g.fill();
      g.fillStyle = '#4fc8f0';
      g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 0); g.lineTo(0, 8); g.lineTo(-5, 0); g.closePath(); g.fill();
      g.restore();
    } else if (type === 'potion') {
      const im = Game.Tex.get('icon_potion');
      const s = 1.2;
      g.drawImage(im, x - im.width * s / 2, y - im.height * s / 2, im.width * s, im.height * s);
    } else if (type === 'book') {
      const im = Game.Tex.get('icon_book');
      const s = 1.2;
      g.drawImage(im, x - im.width * s / 2, y - im.height * s / 2, im.width * s, im.height * s);
    }
  }
})();
