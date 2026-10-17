/*
 * Entrada unificada: teclado + gamepad + toque + entrada virtual (testes).
 * Tudo é convertido em "ações". A cada passo fixo de simulação, Input.update()
 * calcula held/pressed/released. Toques rápidos entre dois passos não se perdem
 * graças ao "latch".
 */
(function () {
  'use strict';

  const KEYMAP = {
    ArrowLeft: ['left'], KeyA: ['left'],
    ArrowRight: ['right'], KeyD: ['right'],
    ArrowUp: ['up'], KeyW: ['up'],
    ArrowDown: ['down'], KeyS: ['down'],
    Space: ['jump', 'confirm'], KeyZ: ['jump', 'confirm'],
    Enter: ['confirm'], NumpadEnter: ['confirm'],
    KeyX: ['attack', 'back'], KeyJ: ['attack'],
    KeyC: ['dash'], KeyK: ['dash'], ShiftLeft: ['dash'], ShiftRight: ['dash'],
    KeyQ: ['potion'], KeyF: ['focus'],
    KeyM: ['map'], Tab: ['map'],
    Escape: ['pause', 'back'], KeyP: ['pause'], Backspace: ['back'],
    F1: ['debug'], F2: ['dbgGive'], BracketRight: ['dbgNext'], BracketLeft: ['dbgPrev']
  };

  const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'dash', 'potion', 'focus',
    'map', 'pause', 'confirm', 'back', 'debug', 'dbgGive', 'dbgNext', 'dbgPrev'];

  const I = Game.Input = {
    ACTIONS,
    held: {}, pressed: {}, released: {},
    kb: {}, gp: {}, touch: {}, virt: {}, latch: {}, prev: {},
    device: 'keyboard',
    gamepadConnected: false
  };
  ACTIONS.forEach((a) => { I.held[a] = I.pressed[a] = I.released[a] = I.prev[a] = false; });

  window.addEventListener('keydown', (e) => {
    try { if (Game.Audio && Game.Audio.init) Game.Audio.init(); } catch (err) { /* áudio opcional */ }
    const acts = KEYMAP[e.code];
    if (!acts) return;
    e.preventDefault();
    I.device = 'keyboard';
    if (e.repeat) return;
    for (const a of acts) { I.kb[a] = true; I.latch[a] = true; }
  }, { passive: false });

  window.addEventListener('keyup', (e) => {
    const acts = KEYMAP[e.code];
    if (!acts) return;
    e.preventDefault();
    for (const a of acts) I.kb[a] = false;
  }, { passive: false });

  window.addEventListener('blur', () => { I.kb = {}; I.touch = {}; });
  window.addEventListener('gamepadconnected', () => { I.gamepadConnected = true; });

  function pollGamepad() {
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { pads = []; }
    const gp = {};
    let any = false;
    for (const p of pads || []) {
      if (!p || !p.connected) continue;
      const b = (i) => p.buttons[i] && p.buttons[i].pressed;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (b(14) || ax < -0.4) gp.left = true;
      if (b(15) || ax > 0.4) gp.right = true;
      if (b(12) || ay < -0.55) gp.up = true;
      if (b(13) || ay > 0.55) gp.down = true;
      if (b(0)) { gp.jump = true; gp.confirm = true; }
      if (b(1)) { gp.dash = true; gp.back = true; }
      if (b(2)) gp.attack = true;
      if (b(3)) gp.focus = true;
      if (b(4)) gp.potion = true;
      if (b(5) || b(7)) gp.dash = true;
      if (b(6)) gp.attack = true;
      if (b(8)) gp.map = true;
      if (b(9)) gp.pause = true;
    }
    for (const k in gp) { if (gp[k]) { any = true; break; } }
    if (any) I.device = 'gamepad';
    I.gp = gp;
  }

  /** Chamado uma vez por passo fixo de simulação. */
  I.update = function () {
    pollGamepad();
    for (const a of ACTIONS) {
      const cur = !!(I.kb[a] || I.gp[a] || I.touch[a] || I.virt[a]);
      I.pressed[a] = (cur && !I.prev[a]) || !!I.latch[a];
      I.released[a] = !cur && I.prev[a];
      I.held[a] = cur;
      I.prev[a] = cur;
      I.latch[a] = false;
    }
  };

  /** Consome um "pressed" para que não seja usado duas vezes no mesmo passo. */
  I.consume = function (a) { I.pressed[a] = false; };
  I.tap = function (a) { I.latch[a] = true; };
  I.clearAll = function () {
    I.kb = {}; I.touch = {}; I.virt = {}; I.latch = {};
    ACTIONS.forEach((a) => { I.held[a] = I.pressed[a] = I.released[a] = false; });
  };

  /** Rótulo da tecla/botão para prompts, conforme o último dispositivo usado. */
  const LABELS = {
    keyboard: { jump: 'Espaço', attack: 'X', dash: 'C', up: '↑', down: '↓', potion: 'Q', focus: 'F', map: 'M', pause: 'Esc', confirm: 'Enter', back: 'Esc', left: '←', right: '→' },
    gamepad: { jump: 'Ⓐ', attack: 'Ⓧ', dash: 'Ⓑ', up: '↑', down: '↓', potion: 'LB', focus: 'Ⓨ', map: 'Select', pause: 'Start', confirm: 'Ⓐ', back: 'Ⓑ', left: '←', right: '→' },
    touch: { jump: 'PULO', attack: 'CHICOTE', dash: 'DASH', up: '↑', down: '↓', potion: 'POÇÃO', focus: 'FOCO', map: 'MAPA', pause: '❚❚', confirm: 'toque', back: 'voltar', left: '←', right: '→' }
  };
  I.label = function (a) {
    const set = LABELS[I.device] || LABELS.keyboard;
    return set[a] || a;
  };
})();
