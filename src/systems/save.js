/*
 * Salvamento em localStorage (com try/catch — funciona mesmo sem storage) e
 * preferências do jogador (volume, tremor de tela).
 */
(function () {
  'use strict';
  const C = Game.CONFIG;

  function read(key) {
    try { const s = window.localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function write(key, val) {
    try { window.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  const Save = Game.Save = { memory: null };

  /** Estado inicial de um novo jogo. */
  Save.fresh = function () {
    return {
      version: 1,
      room: 'passarela', saveId: null, spawn: { tx: 7, ty: 10 },
      maxHearts: C.START_HEARTS, hearts: C.START_HEARTS,
      maxMana: C.START_MANA, mana: C.START_MANA,
      potions: C.START_POTIONS, books: 0,
      abilities: { double: false, dash: false, hook: false },
      collected: {}, broken: {}, visited: {}, saves: {}, booksRead: [],
      playTime: 0, deaths: 0, finished: false
    };
  };

  Save.load = function () {
    const d = read(C.SAVE_KEY) || Save.memory;
    if (!d || d.version !== 1 || !Game.ROOMS[d.room]) return null;
    return d;
  };
  Save.exists = () => !!Save.load();
  Save.store = function (state) {
    Save.memory = JSON.parse(JSON.stringify(state));
    return write(C.SAVE_KEY, state);
  };
  Save.wipe = function () {
    Save.memory = null;
    try { window.localStorage.removeItem(C.SAVE_KEY); } catch (e) { /* sem storage */ }
  };

  /*
   * Preferências: volumes vivem no próprio Game.Audio (que já os salva);
   * aqui só guardamos o que é do motor (tremor de tela).
   */
  Game.Settings = {
    data: { shake: true },
    load() { const d = read(C.SETTINGS_KEY); if (d && typeof d.shake === 'boolean') this.data.shake = d.shake; },
    store() { write(C.SETTINGS_KEY, { shake: this.data.shake }); },
    vol(bus) {
      try { if (Game.Audio && Game.Audio.getVolume) return Game.Audio.getVolume(bus); } catch (e) { /* opcional */ }
      return 0;
    },
    setVol(bus, v) {
      try { if (Game.Audio && Game.Audio.setVolume) Game.Audio.setVolume(bus, v); } catch (e) { /* opcional */ }
    }
  };
})();
