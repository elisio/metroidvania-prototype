/*
 * Controles de toque (aparecem automaticamente em dispositivos touch) e
 * clique do mouse nos menus. D-pad à esquerda, botões de ação à direita.
 */
(function () {
  'use strict';
  const C = Game.CONFIG, I = Game.Input, U = Game.U;

  const T = Game.Touch = { enabled: false, pointers: {}, tap: null, visible: false };

  // Layout em coordenadas lógicas (960×540)
  const DPAD = { x: 120, y: 430, r: 92 };
  const BTN = [
    { a: 'jump', x: 870, y: 452, r: 44, label: 'PULO' },
    { a: 'attack', x: 776, y: 470, r: 38, label: 'CHICOTE' },
    { a: 'dash', x: 860, y: 352, r: 34, label: 'DASH' },
    { a: 'potion', x: 690, y: 488, r: 26, label: 'POÇÃO' },
    { a: 'map', x: 650, y: 30, r: 22, label: 'MAPA', top: true },
    { a: 'pause', x: 600, y: 30, r: 22, label: '❚❚', top: true }
  ];

  T.init = function () {
    const cv = Game.Screen.canvas;
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    T.enabled = isTouch;
    cv.addEventListener('pointerdown', onDown, { passive: false });
    cv.addEventListener('pointermove', onMove, { passive: false });
    cv.addEventListener('pointerup', onUp, { passive: false });
    cv.addEventListener('pointercancel', onUp, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  function actionsAt(x, y) {
    const acts = [];
    const dx = x - DPAD.x, dy = y - DPAD.y;
    if (Math.hypot(dx, dy) < DPAD.r * 1.35 && x < 330) {
      const dead = 16;
      if (dx < -dead) acts.push('left');
      if (dx > dead) acts.push('right');
      if (dy < -dead * 1.8) acts.push('up');
      if (dy > dead * 1.8) acts.push('down');
      return acts;
    }
    for (const b of BTN) if (Math.hypot(x - b.x, y - b.y) < b.r * 1.3) { acts.push(b.a); return acts; }
    return acts;
  }

  function recompute() {
    const t = {};
    for (const id in T.pointers) for (const a of T.pointers[id].acts) t[a] = true;
    // o botão de pulo também confirma; o de pausa também volta
    if (t.jump) t.confirm = true;
    I.touch = t;
  }

  function onDown(e) {
    try { if (Game.Audio && Game.Audio.init) Game.Audio.init(); } catch (err) { /* opcional */ }
    const p = Game.Screen.toLogical(e.clientX, e.clientY);
    if (e.pointerType === 'touch') { T.enabled = true; I.device = 'touch'; }
    e.preventDefault();
    const inPlay = Game.G && Game.G.scene === 'play' && !Game.G.overlay;
    if (e.pointerType !== 'touch' || !inPlay) {
      // menus: clique/toque seleciona
      T.tap = p;
    }
    if (e.pointerType === 'touch' && inPlay) {
      const acts = actionsAt(p.x, p.y);
      T.pointers[e.pointerId] = { acts };
      for (const a of acts) I.latch[a] = true;
      recompute();
    }
  }
  function onMove(e) {
    const ptr = T.pointers[e.pointerId];
    if (!ptr) return;
    e.preventDefault();
    const p = Game.Screen.toLogical(e.clientX, e.clientY);
    const acts = actionsAt(p.x, p.y);
    // só o D-pad desliza entre direções
    if (ptr.acts.some((a) => a === 'left' || a === 'right' || a === 'up' || a === 'down') || acts.length === 0) {
      ptr.acts = acts.filter((a) => a === 'left' || a === 'right' || a === 'up' || a === 'down');
      recompute();
    }
  }
  function onUp(e) {
    if (T.pointers[e.pointerId]) { delete T.pointers[e.pointerId]; recompute(); }
  }

  /** Consome o último toque/clique de menu. */
  T.takeTap = function () { const t = T.tap; T.tap = null; return t; };

  T.draw = function (g) {
    if (!T.enabled) return;
    const held = I.touch || {};
    g.save();
    g.globalAlpha = 0.55;
    // D-pad
    g.fillStyle = 'rgba(10,12,22,0.55)';
    g.beginPath(); g.arc(DPAD.x, DPAD.y, DPAD.r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(200,190,160,0.5)'; g.lineWidth = 2; g.stroke();
    const arrows = [['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]];
    for (const [a, ax, ay] of arrows) {
      const cx = DPAD.x + ax * DPAD.r * 0.6, cy = DPAD.y + ay * DPAD.r * 0.6;
      g.fillStyle = held[a] ? '#ffcf6a' : 'rgba(230,225,210,0.8)';
      g.beginPath();
      g.moveTo(cx + ax * 14, cy + ay * 14);
      g.lineTo(cx - ay * 12 - ax * 6, cy - ax * 12 - ay * 6);
      g.lineTo(cx + ay * 12 - ax * 6, cy + ax * 12 - ay * 6);
      g.fill();
    }
    // botões
    for (const b of BTN) {
      g.fillStyle = held[b.a] ? 'rgba(255,200,110,0.6)' : 'rgba(10,12,22,0.6)';
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(220,200,150,0.7)'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#f2ead6'; g.font = 'bold ' + (b.r > 30 ? 12 : 10) + 'px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(b.label, b.x, b.y);
    }
    g.restore();
    g.textBaseline = 'alphabetic';
  };
  void C; void U;
})();
