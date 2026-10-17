/*
 * Noite de Ferro — orquestração: cenas (título / jogo / final), sobreposições
 * (pausa, mapa, diálogo), transições entre salas, coleta, save points,
 * morte/respawn, render em camadas e modo debug (F1).
 */
(function () {
  'use strict';
  const C = Game.CONFIG, U = Game.U, I = Game.Input, TS = C.TILE, T = Game.T;
  const VW = C.VIEW_W, VH = C.VIEW_H;
  const sfx = (n, o) => Game.sfx(n, o);
  const au = (fn, ...a) => { try { if (Game.Audio && Game.Audio[fn]) Game.Audio[fn](...a); } catch (e) { /* áudio opcional */ } };

  const G = Game.G = {
    scene: 'boot', overlay: null, time: 0,
    state: null, room: null, player: null, objs: [], rings: [],
    trans: null, fade: 0, debug: false, dbgRoomIdx: 0,
    safe: null, deathT: 0, banner: null, nearRing: null, prompt: null
  };

  /* ================= ciclo de vida ================= */
  G.boot = async function () {
    Game.Screen.init();
    Game.Touch.init();
    Game.Settings.load();
    await Game.Assets.load();
    Game.World.build({});
    Game.FX.resetRain();
    // estado "fantasma" para o título poder desenhar minimapas etc. sem erro
    G.state = Game.Save.fresh();
    G.toTitle();
    Game.Loop.start(G.update, G.render);
    // ganchos para testes automatizados
    window.__game = G;
  };

  function firstGesture() {
    try { if (Game.Audio && Game.Audio.init) Game.Audio.init(); } catch (e) { /* opcional */ }
    try { if (Game.Audio && Game.Audio.unlock) Game.Audio.unlock(); } catch (e) { /* opcional */ }
  }
  window.addEventListener('keydown', firstGesture);
  window.addEventListener('pointerdown', firstGesture);

  G.toTitle = function () {
    G.scene = 'title'; G.overlay = null; G.trans = null; G.fade = 0;
    I.clearAll();
    Game.Title.enter();
  };

  G.newGame = function () {
    G.startFrom(Game.Save.fresh(), true);
    G.banner = { text: 'Passarela das Gárgulas', sub: 'A noite de ferro começou', t: 0 };
  };

  G.continueGame = function () {
    const s = Game.Save.load();
    if (!s) return G.newGame();
    G.startFrom(s, false);
  };

  /** Inicia o jogo a partir de um estado (save ou novo). */
  G.startFrom = function (state, fresh) {
    G.state = U.clone(state);
    // ao continuar, volta com vida cheia na estátua
    if (!fresh) { G.state.hearts = G.state.maxHearts; G.state.mana = G.state.maxMana; }
    Game.World.build(G.state.broken);
    G.player = Game.Player.create();
    const sp = G.spawnPoint();
    G.enterRoom(sp.room, sp.x, sp.y, 1);
    G.scene = 'play'; G.overlay = null;
    G.fade = 1;
    G.trans = { phase: 'in', t: 0, dur: 0.5 };
    I.clearAll();
  };

  /** Ponto de nascimento: estátua salva ou início. */
  G.spawnPoint = function () {
    const st = G.state;
    const room = Game.World.room(st.room) || Game.World.room('passarela');
    let tx = st.spawn ? st.spawn.tx : 7, ty = st.spawn ? st.spawn.ty : 10;
    if (st.saveId) {
      const e = room.entities.find((e) => e.id === st.saveId);
      if (e) { tx = e.tx; ty = e.ty; }
    }
    return { room, x: tx * TS + TS / 2 + 40, y: (ty + 1) * TS };
  };

  /* ================= salas ================= */
  /** Coloca o jogador na sala (x = centro, y = pés). */
  G.enterRoom = function (room, x, feetY, facing) {
    const p = G.player;
    G.room = room;
    p.x = x - p.w / 2; p.y = feetY - p.h;
    p.px = p.x; p.py = p.y;
    if (facing) p.facing = facing;
    const sp = Game.Objects.spawn(room, G.state);
    G.objs = sp.list; G.rings = sp.rings;
    p.hook = null;
    const first = !G.state.visited[room.id];
    G.state.visited[room.id] = true;
    if (first && G.scene === 'play') G.banner = { text: room.name, sub: room.area, t: 0 };
    Game.FX.clear();
    Game.Camera.snap(room, p);
    G.safe = null;
    G.updateMusic();
  };

  G.updateMusic = function () {
    const th = G.room.theme;
    const ext = Game.Terrain.isExterior(G.room);
    au('music', th === 'tower' || th === 'cathedral' ? 'tower' : ext ? 'exterior' : 'interior');
    au('ambient', 'rain', ext ? 0.7 : 0.18);
    au('ambient', 'steam', th === 'factory' ? 0.5 : 0);
  };

  /** Verifica se o jogador saiu da sala e inicia a transição. */
  function checkExit() {
    const p = G.player, r = G.room;
    let dir = null;
    if (p.cx() < 0) dir = 'L';
    else if (p.cx() > r.pw) dir = 'R';
    else if (p.y + p.h * 0.5 < 0 && p.vy <= 0) dir = 'U';
    else if (p.y > r.ph) dir = 'D';
    if (!dir) return;
    const wx = r.ox + p.cx(), wy = r.oy + p.y + p.h; // pés em coordenadas globais
    const probeX = r.ox + (dir === 'L' ? -4 : dir === 'R' ? r.pw + 4 : p.cx());
    const probeY = r.oy + (dir === 'U' ? -4 : dir === 'D' ? r.ph + 4 : p.cy());
    const cx = Math.floor(probeX / (C.CELL_W * TS)), cy = Math.floor(probeY / (C.CELL_H * TS));
    const next = Game.World.roomAtCell(cx, cy);
    if (!next) {
      if (dir === 'D') { G.hazard('fall'); return; }
      // sem sala vizinha: segura na borda
      if (dir === 'L') p.x = -p.w / 2; else if (dir === 'R') p.x = r.pw - p.w / 2; else if (dir === 'U') { p.y = -p.h * 0.5; p.vy = 0; }
      return;
    }
    G.trans = {
      phase: 'out', t: 0, dur: C.TRANSITION_OUT, dir, next,
      x: wx - next.ox, feet: wy - next.oy, vx: p.vx, vy: p.vy, facing: p.facing
    };
    sfx('door', { volume: 0.4 });
  }

  function finishTransition() {
    const tr = G.trans;
    const p = G.player;
    G.enterRoom(tr.next, tr.x, tr.feet, tr.facing);
    p.vx = tr.vx; p.vy = tr.vy;
    // empurrões para garantir que a heroína fique dentro da nova sala
    if (tr.dir === 'L') p.x = Math.min(p.x, tr.next.pw - p.w - 2);
    if (tr.dir === 'R') p.x = Math.max(p.x, 2);
    if (tr.dir === 'U') {
      p.vy = Math.min(p.vy, -C.ROOM_ENTER_UP_BOOST);  // impulso para alcançar a borda do poço
      p.doubleUsed = false; p.airDashUsed = false;      // poços verticais são tolerantes
      p.y = Math.min(p.y, tr.next.ph - p.h - 2);
    }
    if (tr.dir === 'D') { p.y = Math.max(p.y, -p.h * 0.4); }
    p.px = p.x; p.py = p.y;
    Game.Camera.snap(tr.next, p);
    G.trans = { phase: 'in', t: 0, dur: C.TRANSITION_IN, dir: tr.dir };
  }

  /* ================= update ================= */
  G.update = function (dt) {
    I.update();
    G.time += dt;
    if (I.pressed.debug) { G.debug = !G.debug; Game.Toast.add('Debug ' + (G.debug ? 'ligado' : 'desligado'), '#8fe6ff'); }
    Game.Toast.update(dt);
    if (G.scene === 'title') { Game.FX.update(dt, null, { x: 0, y: 0 }, true); updateRainOnly(dt); Game.Title.update(dt); return; }
    if (G.scene === 'ending') { updateRainOnly(dt); Game.Ending.update(dt); return; }
    if (G.scene !== 'play') return;

    if (G.overlay) {
      if (G.overlay === 'pause') Game.Pause.update(dt);
      else if (G.overlay === 'map') Game.MapScreen.update(dt);
      else if (G.overlay === 'dialog') { if (Game.Dialog.update(dt) && !Game.Dialog.cur) G.overlay = null; }
      return;
    }

    if (I.pressed.pause) { G.overlay = 'pause'; Game.Pause.open(); au('play', 'menu_select'); return; }
    if (I.pressed.map) { G.openMap(); return; }

    // transições
    if (G.trans) {
      G.trans.t += dt;
      const k = G.trans.t / G.trans.dur;
      G.fade = G.trans.phase === 'out' ? U.clamp(k, 0, 1) : U.clamp(1 - k, 0, 1);
      if (k >= 1) {
        if (G.trans.phase === 'out') finishTransition();
        else if (G.trans.phase === 'respawn') doRespawn();
        else { G.trans = null; G.fade = 0; }
      }
      if (G.trans && (G.trans.phase === 'out' || G.trans.phase === 'respawn')) return;
    }

    if (G.deathT > 0) {
      G.deathT -= dt;
      Game.FX.update(dt, G.room, Game.Camera, Game.Terrain.isExterior(G.room));
      if (G.deathT <= 0) G.trans = { phase: 'respawn', t: 0, dur: 0.45 };
      return;
    }

    const st = G.state;
    st.playTime += dt;
    if (G.debug) debugKeys();

    const p = G.player;
    const res = Game.Player.update(p, dt, G.room, st.abilities, G);
    if (res === 'hazard') G.hazard('spike');

    // chicote: paredes rachadas e estátuas
    whipHits();
    // posição segura (para voltar após cair em espinhos / abismo)
    if (p.grounded && !p.onOneWayOnly && p.invuln <= 0 && !Game.Player.overlapsTile(p, G.room, T.SPIKE)) {
      const solidUnder = isSafeGround(p);
      if (solidUnder) G.safe = { x: p.cx(), feet: p.y + p.h };
    } else if (p.grounded && p.onOneWayOnly && isSafeGround(p)) {
      G.safe = { x: p.cx(), feet: p.y + p.h };
    }

    // coleta e interação
    G.prompt = null;
    for (const o of G.objs) {
      const b = Game.Objects.box(o);
      const hit = U.overlap(p, b);
      if (!hit) continue;
      if (o.kind === 'save') {
        G.prompt = { o, label: o.lit && st.saveId === o.id ? 'Salvar' : 'Acender e salvar' };
        if (I.pressed.up) activateSave(o);
      } else if (o.kind === 'bell') {
        G.prompt = { o, label: 'Tocar o sino' };
        if (I.pressed.up) ringBell(o);
      } else if (o.kind !== 'ring') collect(o);
    }
    G.nearRing = st.abilities.hook && !p.grounded ? Game.Player.findRing(p, G, p.hook ? p.hook.ring : null) : null;

    // poção / foco
    if (I.pressed.potion) usePotion();
    if (I.pressed.focus) useFocus();
    st.mana = Math.min(st.maxMana, st.mana + C.MANA_REGEN * dt);

    Game.Objects.update(G.objs, dt);
    Game.Camera.update(dt, p);
    Game.FX.update(dt, G.room, Game.Camera, Game.Terrain.isExterior(G.room));
    if (G.banner) { G.banner.t += dt; if (G.banner.t > 3.2) G.banner = null; }
    checkExit();
  };

  function updateRainOnly(dt) {
    Game.FX.update(dt, null, { x: 0, y: 0 }, true);
    for (const d of Game.FX.rain) {
      d.y += d.v * dt * d.z; d.x -= d.v * C.RAIN_ANGLE * dt * d.z;
      if (d.y > VH || d.x < -40) { d.y = U.rand(-80, -10); d.x = U.rand(0, VW + 200); }
    }
    if (Game.FX.flash > 0) Game.FX.flash = Math.max(0, Game.FX.flash - dt * 2.6);
    Game.FX.nextBolt -= dt;
    if (Game.FX.nextBolt <= 0) { Game.FX.nextBolt = U.rand(C.LIGHTNING_MIN, C.LIGHTNING_MAX); Game.FX.flash = 1; Game.FX.bolt = { x: U.rand(100, VW - 100), t: 0, seed: Math.random() * 1000 }; }
    if (Game.FX.bolt) { Game.FX.bolt.t += dt; if (Game.FX.bolt.t > 0.25) Game.FX.bolt = null; }
  }

  function isSafeGround(p) {
    // as duas quinas da hitbox precisam estar apoiadas
    const ty = Math.floor((p.y + p.h + 2) / TS);
    const l = Game.World.tileAt(G.room, Math.floor((p.x + 2) / TS), ty);
    const r = Game.World.tileAt(G.room, Math.floor((p.x + p.w - 2) / TS), ty);
    const ok = (t) => Game.TILE_SOLID[t] || Game.TILE_ONEWAY[t];
    return ok(l) && ok(r);
  }

  /* ================= chicote ================= */
  function whipHits() {
    const p = G.player;
    const wb = Game.Player.whipBox(p);
    if (!wb || p.attackHit) return;
    // paredes rachadas
    for (const grp of G.room.cracks) {
      if (grp.broken) continue;
      const box = { x: grp.x * TS, y: grp.y * TS, w: grp.w * TS, h: grp.h * TS };
      if (U.overlap(wb, box)) {
        p.attackHit = true;
        breakWall(grp);
        return;
      }
    }
    // estátuas acendem com o chicote
    for (const o of G.objs) {
      if (o.kind === 'save' && !o.lit && U.overlap(wb, Game.Objects.box(o))) {
        p.attackHit = true;
        activateSave(o);
        return;
      }
      if (o.kind === 'bell' && U.overlap(wb, Game.Objects.box(o))) { p.attackHit = true; ringBell(o); return; }
    }
  }

  function breakWall(grp) {
    Game.World.applyBroken(grp.key);
    G.state.broken[grp.key] = true;
    for (const j of grp.cells) {
      const x = (j % G.room.tw) * TS + TS / 2, y = ((j / G.room.tw) | 0) * TS + TS / 2;
      Game.FX.burst(x, y, 'rubble', 4, 0);
      Game.FX.burst(x, y, 'dust', 2, 0);
    }
    Game.Camera.shake(6, 0.35);
    sfx('whip_hit');
    sfx('break_wall');
    Game.Toast.add('A parede rachada cedeu!', '#e8c890');
  }

  /* ================= interação ================= */
  function activateSave(o) {
    const st = G.state;
    const wasLit = o.lit;
    o.lit = true;
    st.saves[o.id] = true;
    st.saveId = o.id;
    st.room = G.room.id;
    st.spawn = { tx: o.tx, ty: o.ty };
    st.hearts = st.maxHearts;
    st.mana = st.maxMana;
    const ok = Game.Save.store(st);
    Game.FX.burst(o.x, o.y - 60, 'save', 26, 0);
    sfx('save');
    Game.Camera.shake(2, 0.15);
    Game.Toast.add(wasLit ? 'Jogo salvo.' : 'A gárgula desperta — jogo salvo.', '#8fe6ff');
    if (!ok) Game.Toast.add('(armazenamento indisponível: save só nesta sessão)', '#a09cb4');
  }

  function collect(o) {
    const st = G.state;
    const idx = G.objs.indexOf(o);
    if (idx < 0) return;
    G.objs.splice(idx, 1);
    switch (o.kind) {
      case 'relic':
        st.abilities[o.ability] = true;
        st.hearts = st.maxHearts;
        Game.FX.burst(o.x, o.y, 'pickup', 40, 'rgba(255,220,140,');
        Game.Camera.shake(4, 0.4);
        sfx('relic');
        G.overlay = 'dialog';
        Game.Dialog.open({ kind: 'ability', ability: o.ability });
        I.clearAll();
        break;
      case 'heart':
        st.collected[o.id] = true;
        st.maxHearts = Math.min(C.MAX_HEARTS_CAP, st.maxHearts + 1);
        st.hearts = st.maxHearts;
        Game.FX.burst(o.x, o.y, 'pickup', 24, 'rgba(255,120,110,');
        sfx('heart_up');
        Game.Toast.add('Recipiente de coração! Vida máxima +1', '#ff9c8c');
        break;
      case 'mana':
        st.collected[o.id] = true;
        st.maxMana += C.MANA_PER_FRAGMENT;
        st.mana = st.maxMana;
        Game.FX.burst(o.x, o.y, 'pickup', 20, 'rgba(180,120,255,');
        sfx('pickup', { pitch: 1.2 });
        Game.Toast.add('Fragmento de mana: mana máxima +' + C.MANA_PER_FRAGMENT, '#c69cff');
        break;
      case 'potion':
        st.collected[o.id] = true;
        st.potions = Math.min(C.MAX_POTIONS, st.potions + 1);
        Game.FX.burst(o.x, o.y, 'pickup', 14, 'rgba(255,120,130,');
        sfx('pickup');
        Game.Toast.add('Poção obtida (' + Game.Input.label('potion') + ' para beber)', '#ffb0b8');
        break;
      case 'book': {
        st.collected[o.id] = true;
        st.books += 1;
        const b = Game.TEXT.books[G.room.id] || ['Página solta', '…'];
        st.booksRead.push(G.room.id);
        sfx('book');
        G.overlay = 'dialog';
        Game.Dialog.open({ kind: 'book', title: b[0], body: b[1] });
        I.clearAll();
        break;
      }
    }
  }

  function usePotion() {
    const st = G.state;
    if (st.potions <= 0) { Game.Toast.add('Sem poções.', '#a09cb4'); return; }
    if (st.hearts >= st.maxHearts) { Game.Toast.add('Vida já está cheia.', '#a09cb4'); return; }
    st.potions--;
    st.hearts = Math.min(st.maxHearts, st.hearts + C.POTION_HEAL);
    Game.FX.burst(G.player.cx(), G.player.cy(), 'pickup', 18, 'rgba(255,110,110,');
    sfx('potion');
  }

  function useFocus() {
    const st = G.state;
    if (st.hearts >= st.maxHearts) return;
    if (st.mana < C.FOCUS_COST) { Game.Toast.add('Mana insuficiente para o foco.', '#a09cb4'); return; }
    st.mana -= C.FOCUS_COST;
    st.hearts += 1;
    Game.FX.burst(G.player.cx(), G.player.cy(), 'pickup', 18, 'rgba(160,120,255,');
    sfx('potion', { pitch: 1.3 });
  }

  function ringBell(o) {
    if (o.rung && G.state.finished) { o.swing = 0.5; sfx('relic', { pitch: 0.5 }); return; }
    o.rung = true; o.swing = 0.6;
    G.state.finished = true;
    Game.Save.store(G.state);
    Game.Camera.shake(8, 1.2);
    sfx('relic', { pitch: 0.5 });
    Game.FX.burst(o.x, o.y - 80, 'pickup', 50, 'rgba(255,220,140,');
    setTimeout(() => { if (G.scene === 'play') { G.scene = 'ending'; G.overlay = null; Game.Ending.enter(); } }, 2200);
  }

  G.openMap = function () { G.overlay = 'map'; au('play', 'menu_select'); };
  G.closeOverlay = function () { G.overlay = null; I.clearAll(); };

  /** % de itens coletados (relíquias + corações + mana + poções + livros). */
  G.completion = function () {
    let tot = 0, got = 0;
    for (const id in Game.World.rooms) {
      const r = Game.World.rooms[id];
      for (const e of r.entities) {
        if (e.kind === 'relic') { tot++; if (G.state.abilities[r.def.relic]) got++; }
        else if (['heart', 'mana', 'potion', 'book'].includes(e.kind)) { tot++; if (G.state.collected[e.id]) got++; }
      }
    }
    return tot ? Math.round(got / tot * 100) : 0;
  };

  /* ================= perigos, morte e respawn ================= */
  G.hazard = function (kind) {
    const st = G.state, p = G.player;
    if (G.deathT > 0 || (G.trans && G.trans.phase === 'respawn')) return;
    st.hearts -= C.HAZARD_DAMAGE;
    sfx('hurt');
    Game.Camera.shake(6, 0.3);
    Game.FX.burst(p.cx(), p.cy(), 'pickup', 16, 'rgba(255,80,70,');
    p.hook = null;
    if (st.hearts <= 0 || C.HAZARD_MODE === 'save') {
      st.deaths++;
      sfx('death');
      G.deathT = 0.9;
      G.respawnMode = 'save';
      p.vx = 0; p.vy = 0;
    } else {
      G.deathT = 0.3;
      G.respawnMode = 'safe';
    }
  };

  function doRespawn() {
    const st = G.state, p = G.player;
    if (G.respawnMode === 'safe' && G.safe) {
      p.x = G.safe.x - p.w / 2; p.y = G.safe.feet - p.h;
      p.vx = 0; p.vy = 0; p.px = p.x; p.py = p.y;
      p.invuln = C.INVULN_TIME;
      Game.Camera.snap(G.room, p);
    } else if (G.respawnMode === 'safe') {
      // sem chão seguro registrado nesta sala: entrada da sala = spawn do save
      G.respawnMode = 'save';
      return doRespawn();
    } else {
      // volta ao último save com o estado salvo (itens coletados depois são mantidos? não: recarrega o save)
      const saved = Game.Save.load();
      const keepDeaths = st.deaths, keepTime = st.playTime;
      if (saved) {
        G.state = U.clone(saved);
        G.state.deaths = keepDeaths; G.state.playTime = keepTime;
        Game.World.build(G.state.broken);
      } else {
        // sem save: recomeça do início mantendo o progresso de habilidades
        G.state.room = 'passarela'; G.state.saveId = null; G.state.spawn = { tx: 7, ty: 10 };
      }
      G.state.hearts = G.state.maxHearts;
      G.state.mana = G.state.maxMana;
      const sp = G.spawnPoint();
      G.enterRoom(sp.room, sp.x, sp.y, 1);
      p.vx = 0; p.vy = 0; p.invuln = C.INVULN_TIME;
      sfx('respawn');
    }
    G.trans = { phase: 'in', t: 0, dur: 0.4 };
  }

  /* ================= debug ================= */
  function debugKeys() {
    const ids = Game.World.order;
    if (I.pressed.dbgNext || I.pressed.dbgPrev) {
      G.dbgRoomIdx = (ids.indexOf(G.room.id) + (I.pressed.dbgNext ? 1 : ids.length - 1)) % ids.length;
      G.teleport(ids[G.dbgRoomIdx]);
    }
    if (I.pressed.dbgGive) {
      G.state.abilities = { double: true, dash: true, hook: true };
      Game.Toast.add('[debug] todas as habilidades', '#8fe6ff');
    }
  }

  /** Teleporta para uma sala (debug/testes): usa um save, ou o primeiro chão livre. */
  G.teleport = function (id, tx, ty) {
    const r = Game.World.room(id);
    if (!r) return false;
    let x, feet;
    if (tx !== undefined) { x = tx * TS + TS / 2; feet = (ty + 1) * TS; }
    else {
      const s = r.entities.find((e) => e.kind === 'save');
      if (s) { x = s.tx * TS + TS / 2 + 50; feet = (s.ty + 1) * TS; }
      else { x = r.pw / 2; feet = r.ph / 2; }
    }
    G.enterRoom(r, x, feet, 1);
    G.player.vx = 0; G.player.vy = 0;
    return true;
  };

  /* ================= render ================= */
  G.render = function (alpha, frameDt) {
    const g = Game.Screen.g;
    const k = Game.Screen.k;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const time = G.time;

    if (G.scene === 'title' || G.scene === 'boot') {
      if (G.scene === 'boot') { g.fillStyle = '#05060b'; g.fillRect(0, 0, VW, VH); return; }
      Game.Title.draw(g, time);
      Game.Toast.draw(g);
      return;
    }
    if (G.scene === 'ending') { Game.Ending.draw(g, time, G); return; }

    renderWorld(g, alpha, time);
    // HUD
    Game.HUD.draw(g, G, time, frameDt || 1 / 60);
    drawBanner(g, time);
    Game.Toast.draw(g);
    if (G.debug) drawDebug(g);
    Game.Touch.draw(g);
    // overlays
    if (G.overlay === 'pause') Game.Pause.draw(g, time, G);
    else if (G.overlay === 'map') Game.MapScreen.draw(g, time, G);
    else if (G.overlay === 'dialog') Game.Dialog.draw(g, time);
  };

  function renderWorld(g, alpha, time) {
    const room = G.room;
    const cam = Game.Camera.view(alpha);
    const ext = Game.Terrain.isExterior(room);
    // fundo
    if (ext) Game.Terrain.drawExteriorBg(g, cam, room, time, Game.FX.flash);
    else Game.Terrain.drawInteriorBg(g, cam, room, time);
    if (ext) Game.FX.drawFog(g, cam.x * 0.5, time, VH * 0.55 - (cam.y * 0.1) % 60, 0.55, 8);

    g.save();
    g.translate(-cam.x, -cam.y);
    // terreno (cache)
    const cache = Game.Terrain.getCache(room);
    const sx = Math.max(0, cam.x), sy = Math.max(0, cam.y);
    const sw = Math.min(VW, room.pw - sx), sh = Math.min(VH, room.ph - sy);
    if (sw > 0 && sh > 0) g.drawImage(cache, sx, sy, sw, sh, sx, sy, sw, sh);
    Game.Terrain.drawDynamic(g, room, cam, time, G.player.dashT > 0);
    // objetos
    for (const o of G.objs) Game.Objects.draw(g, o, time, G.state.abilities.hook, G.nearRing);
    // jogadora
    Game.FX.drawAfterimages(g);
    if (!(G.deathT > 0 && G.respawnMode === 'save' && G.deathT < 0.6)) Game.Player.draw(g, G.player, alpha, time);
    Game.FX.drawParticles(g, false);
    // brilhos aditivos
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const o of G.objs) Game.Objects.drawGlow(g, o, time);
    Game.FX.drawParticles(g, true);
    g.restore();
    Game.FX.drawLights(g, room, cam, time);
    // prompt de interação
    if (G.prompt) {
      const o = G.prompt.o;
      Game.drawPrompt(g, o.x, o.y - (o.kind === 'bell' ? 190 : 140), Game.Input.label('up'), G.prompt.label, time);
    }
    if (G.debug) drawDebugWorld(g);
    g.restore();

    // névoa de primeiro plano e chuva
    if (ext) {
      Game.FX.drawFog(g, cam.x * 1.2, time * 1.5, VH - 150 + U.clamp((room.ph - cam.y - VH) * 0.3, 0, 200), 0.65, 18);
      Game.FX.drawRain(g, 1);
    } else if (room.theme === 'factory') {
      Game.FX.drawFog(g, cam.x, time, VH - 160, 0.35, 10);
    }
    // relâmpago ilumina tudo um pouco
    if (ext && Game.FX.flash > 0.3) { g.fillStyle = 'rgba(190,205,255,' + (Game.FX.flash * 0.12) + ')'; g.fillRect(0, 0, VW, VH); }
    Game.Terrain.drawVignette(g, ext ? 0.55 : 0.8);
    // dano / morte
    if (G.deathT > 0 && G.respawnMode === 'save') { g.fillStyle = 'rgba(80,0,0,' + (0.5 * (1 - G.deathT / 0.9)) + ')'; g.fillRect(0, 0, VW, VH); }
    // fade da transição
    if (G.fade > 0) {
      g.fillStyle = 'rgba(3,3,8,' + U.easeInOut(G.fade) + ')';
      g.fillRect(0, 0, VW, VH);
    }
  }

  function drawBanner(g, time) {
    const b = G.banner;
    if (!b) return;
    const a = Math.min(1, b.t * 2, (3.2 - b.t) * 1.5);
    if (a <= 0) return;
    g.save();
    g.globalAlpha = a;
    g.font = Game.serif(30, true);
    Game.drawText(g, b.text, VW / 2, 190, '#f2e2bc');
    g.font = Game.serif(15, false, true);
    Game.drawText(g, b.sub, VW / 2, 216, '#a8a5bd');
    g.strokeStyle = 'rgba(232,184,102,0.6)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(VW / 2 - 160, 228); g.lineTo(VW / 2 + 160, 228); g.stroke();
    g.restore();
  }

  function drawDebugWorld(g) {
    const p = G.player;
    g.strokeStyle = '#0f0'; g.lineWidth = 1;
    g.strokeRect(p.x, p.y, p.w, p.h);
    const wb = Game.Player.whipBox(p);
    if (wb) { g.strokeStyle = '#ff0'; g.strokeRect(wb.x, wb.y, wb.w, wb.h); }
    g.strokeStyle = '#0ff';
    for (const o of G.objs) { const b = Game.Objects.box(o); g.strokeRect(b.x, b.y, b.w, b.h); }
    for (const r of G.rings) { g.strokeStyle = 'rgba(255,200,0,0.3)'; g.beginPath(); g.arc(r.x, r.y, C.HOOK_RANGE, 0, Math.PI * 2); g.stroke(); }
    if (G.safe) { g.fillStyle = '#0f0'; g.fillRect(G.safe.x - 3, G.safe.feet - 3, 6, 6); }
  }

  function drawDebug(g) {
    const p = G.player;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(8, VH - 112, 380, 104);
    g.font = '12px monospace'; g.fillStyle = '#9f9'; g.textAlign = 'left';
    const lines = [
      'FPS ' + Game.Loop.fps.toFixed(0) + '  frame ' + Game.Loop.frameMs.toFixed(1) + 'ms  partículas ' + Game.FX.parts.length,
      'sala ' + G.room.id + '  pos ' + (p.x | 0) + ',' + (p.y | 0) + '  tile ' + Math.floor(p.cx() / TS) + ',' + Math.floor((p.y + p.h - 1) / TS),
      'v ' + (p.vx | 0) + ',' + (p.vy | 0) + '  chão ' + p.grounded + '  coyote ' + Math.max(0, p.coyote).toFixed(2) + '  anim ' + p.anim,
      'hab ' + JSON.stringify(G.state.abilities),
      'assets: ' + Game.Assets.loaded.length + ' carregados, ' + (Game.Assets.manifest ? 'com' : 'sem') + ' manifest',
      '[ / ] troca sala   F2 dá habilidades   F1 fecha'
    ];
    lines.forEach((l, i) => g.fillText(l, 16, VH - 92 + i * 15));
  }

  /*
   * API de teste (usada por tools/smoke_test.py e tools/route_test.py):
   * congela o loop e avança a simulação de forma determinística.
   */
  Game.Test = {
    freeze(on) { Game.Loop.frozen = on !== false; },
    hold(action, on) { I.virt[action] = on !== false; },
    release() { I.virt = {}; },
    tap(action) { I.latch[action] = true; },
    step(n) { for (let i = 0; i < (n || 1); i++) G.update(C.FIXED_DT); },
    render() { G.render(1, C.FIXED_DT); },
    /** Posiciona a heroína no tile (tx = coluna central, ty = linha dos pés). */
    place(roomId, tx, ty, abilities) {
      if (G.scene !== 'play') { G.startFrom(Game.Save.fresh(), true); }
      G.trans = null; G.fade = 0; G.overlay = null; G.deathT = 0; G.banner = null;
      if (abilities) Object.assign(G.state.abilities, abilities);
      G.teleport(roomId, tx, ty);
      const p = G.player;
      p.dashT = 0; p.attackT = 0; p.hook = null; p.invuln = 0;
      for (let i = 0; i < 3; i++) G.update(C.FIXED_DT); // assenta no chão
      return Game.Test.info();
    },
    /**
     * Executa uma sequência de comandos determinística:
     *   ['walk', tx]                 anda até a coluna tx
     *   ['hold', [ações], quadros]   segura ações por N quadros
     *   ['tap', ação]                aperta e solta (1 quadro)
     *   ['wait', quadros]            espera
     *   ['until', 'grounded'|'room:<id>'|'hooked', maxQuadros, [ações]]
     * Retorna info() ao final (ou no primeiro erro).
     */
    run(seq) {
      const step = () => G.update(C.FIXED_DT);
      const log = [];
      for (const cmd of seq) {
        const op = cmd[0];
        if (op === 'walk') {
          const target = cmd[1] * TS + TS / 2;
          for (let i = 0; i < 900; i++) {
            const d = target - G.player.cx();
            if (Math.abs(d) < 5 && G.player.grounded) break;
            I.virt = { left: d < -4, right: d > 4 };
            step();
          }
          I.virt = {};
          for (let i = 0; i < 8; i++) step();
        } else if (op === 'hold') {
          I.virt = {};
          for (const a of cmd[1]) { I.virt[a] = true; I.latch[a] = true; }
          for (let i = 0; i < cmd[2]; i++) step();
          I.virt = {};
        } else if (op === 'tap') {
          I.latch[cmd[1]] = true; step();
        } else if (op === 'wait') {
          I.virt = {};
          for (let i = 0; i < cmd[1]; i++) step();
        } else if (op === 'until') {
          I.virt = {};
          for (const a of cmd[3] || []) I.virt[a] = true;
          const cond = cmd[1];
          let ok = false;
          for (let i = 0; i < cmd[2]; i++) {
            step();
            if (cond === 'grounded' && G.player.grounded && !G.trans) { ok = true; break; }
            if (cond === 'hooked' && G.player.hook) { ok = true; break; }
            if (cond.startsWith('room:') && G.room.id === cond.slice(5) && !G.trans) { ok = true; break; }
          }
          I.virt = {};
          if (!ok) log.push('timeout ' + cond);
        }
        if (G.overlay === 'dialog') { Game.Dialog.cur = null; G.overlay = null; log.push('dialog closed'); }
      }
      const out = Game.Test.info();
      out.log = log;
      return out;
    },
    info() {
      const p = G.player;
      return {
        scene: G.scene, overlay: G.overlay, room: G.room && G.room.id,
        x: p ? p.x : 0, y: p ? p.y : 0, cx: p ? p.cx() : 0, feet: p ? p.y + p.h : 0,
        tx: p ? Math.floor(p.cx() / TS) : 0, ty: p ? Math.floor((p.y + p.h - 1) / TS) : 0,
        vx: p ? p.vx : 0, vy: p ? p.vy : 0, grounded: p ? p.grounded : false, hooked: !!(p && p.hook),
        hearts: G.state && G.state.hearts, maxHearts: G.state && G.state.maxHearts,
        abilities: G.state && Object.assign({}, G.state.abilities), trans: !!G.trans, dead: G.deathT > 0
      };
    }
  };

  window.addEventListener('load', () => { G.boot(); });
})();
