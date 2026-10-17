/*
 * A heroína: movimento com "game feel" (aceleração, coyote time, jump buffer,
 * pulo variável, gravidade de queda), chicote, dash, pulo duplo e gancho.
 * Posição em px locais da sala atual; (x, y) = canto superior esquerdo da hitbox.
 */
(function () {
  'use strict';
  const C = Game.CONFIG, U = Game.U, T = Game.T, TS = C.TILE;
  const I = Game.Input;
  const sfx = (n, o) => { try { if (Game.Audio && Game.Audio.play) Game.Audio.play(n, o); } catch (e) { /* som opcional */ } };
  Game.sfx = sfx;

  const P = Game.Player = {};

  P.create = function () {
    const p = {
      x: 0, y: 0, w: C.HITBOX_W, h: C.HITBOX_H,
      px: 0, py: 0,             // posição anterior (interpolação)
      vx: 0, vy: 0, facing: 1,
      grounded: false, wasGrounded: false, onOneWayOnly: false,
      coyote: 0, jumpBuf: 0, jumping: false, doubleUsed: false,
      dashT: 0, dashCd: 0, dashDir: 1, airDashUsed: false,
      attackT: 0, attackHit: false, whipTrail: [],
      hook: null, hookCd: 0,
      dropT: 0, invuln: 0, crouch: false,
      anim: 'idle', animT: 0, frame: null,
      inWater: false, stepT: 0, landT: 0, squash: 0,
      cx() { return this.x + this.w / 2; },
      cy() { return this.y + this.h / 2; },
      bottom() { return this.y + this.h; }
    };
    return p;
  };

  /* ---------------- Colisão com tiles ---------------- */
  function tileAt(room, tx, ty) { return Game.World.tileAt(room, tx, ty); }

  function blocks(p, room, tx, ty) {
    const t = tileAt(room, tx, ty);
    if (Game.TILE_SOLID[t]) return true;
    if (t === T.ENERGY) return p.dashT <= 0;
    return false;
  }

  /** Há sólido dentro do retângulo? */
  function boxSolid(p, room, x, y, w, h) {
    const x0 = Math.floor(x / TS), x1 = Math.floor((x + w - 0.01) / TS);
    const y0 = Math.floor(y / TS), y1 = Math.floor((y + h - 0.01) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (blocks(p, room, tx, ty)) return true;
    return false;
  }
  P.boxSolid = boxSolid;

  function moveX(p, room, dx) {
    if (dx === 0) return false;
    const nx = p.x + dx;
    const y0 = Math.floor(p.y / TS), y1 = Math.floor((p.y + p.h - 0.01) / TS);
    const tx = dx > 0 ? Math.floor((nx + p.w - 0.01) / TS) : Math.floor(nx / TS);
    let hit = false, highest = 1e9;
    for (let ty = y0; ty <= y1; ty++) {
      if (blocks(p, room, tx, ty)) { hit = true; highest = Math.min(highest, ty); }
    }
    if (!hit) { p.x = nx; return false; }
    // Degrau / borda: sobe automaticamente se o obstáculo é baixo
    const feet = p.y + p.h;
    const rise = feet - highest * TS;
    const canStep = (p.grounded && rise <= C.STEP_HEIGHT) || (!p.grounded && p.vy > -60 && rise <= C.LEDGE_ASSIST);
    if (canStep && rise > 0 && !boxSolid(p, room, nx, p.y - rise - 0.5, p.w, p.h)) {
      p.y -= rise + 0.01;
      p.x = nx;
      return false;
    }
    p.x = dx > 0 ? tx * TS - p.w : (tx + 1) * TS;
    return true;
  }

  function moveY(p, room, dy) {
    if (dy === 0) return 0;
    const ny = p.y + dy;
    const x0 = Math.floor(p.x / TS), x1 = Math.floor((p.x + p.w - 0.01) / TS);
    if (dy > 0) {
      const prevBottom = p.y + p.h;
      const ty = Math.floor((ny + p.h - 0.01) / TS);
      let hit = false;
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileAt(room, tx, ty);
        if (blocks(p, room, tx, ty)) { hit = true; break; }
        if (Game.TILE_ONEWAY[t] && p.dropT <= 0 && prevBottom <= ty * TS + 1) { hit = true; break; }
      }
      if (hit) { p.y = ty * TS - p.h; return 1; }
      p.y = ny;
      return 0;
    }
    const ty = Math.floor(ny / TS);
    const solidCols = [];
    for (let tx = x0; tx <= x1; tx++) if (blocks(p, room, tx, ty)) solidCols.push(tx);
    if (!solidCols.length) { p.y = ny; return 0; }
    // Correção de quina: se só a beirada bateu, desliza para o lado
    const K = C.CORNER_CORRECTION;
    for (const dir of [-1, 1]) {
      for (let s = 1; s <= K; s++) {
        const tx2 = p.x + dir * s;
        if (!boxSolid(p, room, tx2, ny, p.w, p.h)) { p.x = tx2; p.y = ny; return 0; }
      }
    }
    p.y = (ty + 1) * TS;
    return -1;
  }

  function checkGround(p, room) {
    const by = p.y + p.h + 1;
    const ty = Math.floor(by / TS);
    if (Math.abs(p.y + p.h - ty * TS) > 1.5) { p.onOneWayOnly = false; return false; }
    const x0 = Math.floor(p.x / TS), x1 = Math.floor((p.x + p.w - 0.01) / TS);
    let solid = false, oneway = false;
    for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(room, tx, ty);
      if (blocks(p, room, tx, ty)) solid = true;
      else if (Game.TILE_ONEWAY[t] && p.dropT <= 0) oneway = true;
    }
    p.onOneWayOnly = oneway && !solid;
    return solid || oneway;
  }

  function overlapsTile(p, room, type, inset) {
    inset = inset || 0;
    const x0 = Math.floor((p.x + inset) / TS), x1 = Math.floor((p.x + p.w - inset - 0.01) / TS);
    const y0 = Math.floor((p.y + inset) / TS), y1 = Math.floor((p.y + p.h - 0.01) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (tileAt(room, tx, ty) === type) return { tx, ty };
    return null;
  }
  P.overlapsTile = overlapsTile;

  /** Espinhos: hitbox só na parte de baixo do tile. */
  function touchingSpikes(p, room) {
    const x0 = Math.floor((p.x + 4) / TS), x1 = Math.floor((p.x + p.w - 4.01) / TS);
    const y0 = Math.floor(p.y / TS), y1 = Math.floor((p.y + p.h - 0.01) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(room, tx, ty) === T.SPIKE && p.y + p.h > ty * TS + 12) return true;
    }
    return false;
  }

  /* ---------------- Atualização ---------------- */
  P.update = function (p, dt, room, ab, game) {
    p.px = p.x; p.py = p.y;
    const left = I.held.left, right = I.held.right;
    const dirIn = (right ? 1 : 0) - (left ? 1 : 0);

    // timers
    p.coyote -= dt; p.jumpBuf -= dt; p.dashCd -= dt; p.dropT -= dt; p.invuln -= dt; p.hookCd -= dt;
    p.landT -= dt;
    p.squash = U.damp(p.squash, 0, 14, dt);
    if (I.pressed.jump) p.jumpBuf = C.JUMP_BUFFER;

    // ---- Dash ----
    if (I.pressed.dash && ab.dash && p.dashCd <= 0 && p.dashT <= 0 && !p.hook && (p.grounded || !p.airDashUsed)) {
      p.dashT = C.DASH_TIME;
      p.dashDir = dirIn || p.facing;
      p.facing = p.dashDir;
      p.dashCd = C.DASH_COOLDOWN + C.DASH_TIME;
      if (!p.grounded) p.airDashUsed = true;
      p.attackT = 0;
      sfx('dash');
      Game.FX.burst(p.cx() - p.dashDir * 10, p.y + p.h - 30, 'dash', 10, p.dashDir);
      Game.Camera.shake(2, 0.1);
    }

    // ---- Ataque / gancho ----
    if (I.pressed.attack && p.dashT <= 0) {
      if (p.hook) {
        // novo alvo enquanto pendurada = troca de argola; senão solta
        const ring = ab.hook ? findRing(p, game, p.hook.ring) : null;
        if (ring) startHook(p, ring); else releaseHook(p, false);
      } else {
        const ring = ab.hook && p.hookCd <= 0 && (!p.grounded || I.held.up) ? findRing(p, game, null) : null;
        if (ring) startHook(p, ring);
        else if (p.attackT <= 0) {
          p.attackT = C.ATTACK_TIME; p.attackHit = false; p.whipTrail.length = 0;
          sfx('whip', { pitch: U.rand(0.95, 1.08) });
        }
      }
    }

    if (p.hook) {
      updateHook(p, dt, room, dirIn);
    } else if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashDir * C.DASH_SPEED;
      p.vy = 0;
      // não termina o dash dentro de uma grade de energia
      if (p.dashT <= 0 && overlapsTile(p, room, T.ENERGY)) p.dashT = dt;
      if (p.dashT <= 0) p.vx = p.dashDir * C.RUN_SPEED;
      if (Math.random() < 0.7) Game.FX.afterimage(p);
    } else {
      // ---- Movimento horizontal ----
      p.crouch = p.grounded && I.held.down && !dirIn;
      let max = C.RUN_SPEED * (p.inWater ? 0.78 : 1);
      if (p.attackT > 0 && p.grounded) max *= C.ATTACK_GROUND_SPEED;
      if (p.crouch) max = 0;
      const target = dirIn * max;
      let accel;
      if (p.grounded) accel = dirIn ? C.GROUND_ACCEL : C.GROUND_DECEL;
      else accel = dirIn ? C.AIR_ACCEL : C.AIR_DECEL;
      if (dirIn && U.sign(p.vx) === -dirIn) accel *= C.TURN_BOOST;
      if (!p.grounded && Math.abs(p.vx) > max && U.sign(p.vx) === dirIn) accel = C.OVERSPEED_DECEL; // conserva impulso do balanço
      p.vx = U.approach(p.vx, target, accel * dt);
      if (dirIn && p.attackT <= 0) p.facing = dirIn;

      // ---- Pulo ----
      if (p.jumpBuf > 0) {
        if (p.grounded && I.held.down && p.onOneWayOnly) {
          p.dropT = C.DROP_THROUGH_TIME; p.y += 2; p.grounded = false; p.jumpBuf = 0; p.coyote = 0;
        } else if (p.grounded || p.coyote > 0) {
          p.vy = -C.JUMP_VELOCITY; p.grounded = false; p.coyote = 0; p.jumpBuf = 0; p.jumping = true;
          p.squash = -0.12;
          sfx('jump');
          Game.FX.burst(p.cx(), p.y + p.h, 'dust', 6, 0);
        } else if (ab.double && !p.doubleUsed) {
          p.vy = -C.DOUBLE_JUMP_VELOCITY; p.doubleUsed = true; p.jumpBuf = 0; p.jumping = true;
          sfx('double_jump');
          Game.FX.burst(p.cx(), p.y + p.h - 6, 'double', 14, 0);
        }
      }
      if (p.jumping && !I.held.jump && p.vy < 0) { p.vy *= C.JUMP_CUT; p.jumping = false; }
      if (p.vy >= 0) p.jumping = false;

      // ---- Gravidade ----
      let g = C.GRAVITY;
      if (p.vy > 0) g *= C.FALL_GRAVITY_MULT;
      else if (Math.abs(p.vy) < C.APEX_THRESHOLD && I.held.jump) g *= C.APEX_GRAVITY_MULT;
      p.vy = Math.min(p.vy + g * dt, C.MAX_FALL);
    }

    // ---- Integração com colisão ----
    if (!p.hook || !p.hook.moved) {
      const hitX = moveX(p, room, p.vx * dt);
      if (hitX) {
        if (p.dashT > 0 && Math.abs(p.vx) > 400) { Game.Camera.shake(2, 0.08); }
        p.vx = 0;
      }
      const hy = moveY(p, room, p.vy * dt);
      if (hy !== 0) {
        if (hy > 0 && p.vy > 300) p.squash = Math.min(0.22, p.vy / 3600);
        p.vy = 0;
      }
    }

    // ---- Chão ----
    p.wasGrounded = p.grounded;
    p.grounded = p.vy >= 0 && checkGround(p, room);
    if (p.grounded) {
      p.coyote = C.COYOTE_TIME;
      p.doubleUsed = false;
      p.airDashUsed = false;
      if (!p.wasGrounded) {
        p.landT = 0.12;
        sfx('land', { volume: 0.6 });
        Game.FX.burst(p.cx(), p.y + p.h, 'dust', 8, 0);
      }
      if (p.hook) releaseHook(p, false);
    }

    // ---- Água / passos ----
    p.inWater = !!overlapsTile(p, room, T.WATER);
    if (p.grounded && Math.abs(p.vx) > 60 && p.dashT <= 0) {
      p.stepT -= dt * Math.abs(p.vx) / C.RUN_SPEED;
      if (p.stepT <= 0) {
        p.stepT = 0.29;
        sfx('step', { volume: 0.35, pitch: U.rand(0.9, 1.1) });
        if (p.inWater) Game.FX.burst(p.cx(), p.y + p.h - 6, 'splash', 6, 0);
        else if (Game.Terrain.isExterior(room)) Game.FX.burst(p.cx(), p.y + p.h, 'splash', 2, 0);
      }
    }

    // ---- Ataque ----
    if (p.attackT > 0) p.attackT -= dt;

    // ---- Perigos ----
    if (p.invuln <= 0 && touchingSpikes(p, room)) return 'hazard';

    updateAnim(p, dt);
    return null;
  };

  /* ---------------- Gancho ---------------- */
  function attachPoint(p) { return { x: p.cx(), y: p.y + 34 }; }

  function findRing(p, game, exclude) {
    const a = attachPoint(p);
    let best = null, bestScore = 1e9;
    for (const r of game.rings) {
      if (r === exclude) continue;
      const dx = r.x - a.x, dy = r.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > C.HOOK_RANGE || d < 20) continue;
      if (dy > 40) continue;                 // a argola precisa estar acima
      let score = d;
      if (U.sign(dx) === p.facing || Math.abs(dx) < 48) score -= 90;
      if (exclude && U.sign(dx) !== U.sign(p.vx) && Math.abs(p.vx) > 100) score += 120;
      if (score < bestScore) { bestScore = score; best = r; }
    }
    return best;
  }
  P.findRing = findRing;

  function startHook(p, ring) {
    const a = attachPoint(p);
    p.hook = { ring, len: Math.hypot(ring.x - a.x, ring.y - a.y), fireT: 0.07, moved: false };
    p.attackT = 0;
    p.dashT = 0;
    p.facing = ring.x >= a.x ? 1 : -1;
    p.doubleUsed = false;
    p.airDashUsed = false;
    sfx('grapple_fire');
  }

  function releaseHook(p, jump) {
    if (!p.hook) return;
    if (jump) {
      p.vy = Math.min(p.vy * 0.5, -C.JUMP_VELOCITY * C.HOOK_RELEASE_JUMP);
      // impulso horizontal mínimo na direção pedida (ou do balanço): soltar é sempre útil
      const dirIn = (I.held.right ? 1 : 0) - (I.held.left ? 1 : 0);
      const dir = dirIn || U.sign(p.vx) || p.facing;
      p.vx = dir * Math.max(Math.abs(p.vx) * (U.sign(p.vx) === dir ? 1 : 0.3), C.HOOK_RELEASE_VX);
      p.facing = dir;
      p.jumping = true;
      sfx('jump');
    }
    p.hook = null;
    p.hookCd = 0.12;
  }
  P.releaseHook = releaseHook;

  function updateHook(p, dt, room, dirIn) {
    const h = p.hook;
    h.moved = false;
    if (h.fireT > 0) {
      // chicote ainda viajando até a argola: queda leve
      h.fireT -= dt;
      p.vy = Math.min(p.vy + C.GRAVITY * 0.5 * dt, C.MAX_FALL);
      if (h.fireT <= 0) {
        sfx('grapple_attach');
        Game.FX.burst(h.ring.x, h.ring.y, 'spark', 12, 0);
        Game.Camera.shake(1.5, 0.08);
      }
      return;
    }
    if (p.jumpBuf > 0) { p.jumpBuf = 0; releaseHook(p, true); return; }
    if (I.pressed.down) { releaseHook(p, false); return; }

    const a = attachPoint(p);
    const R = h.ring;
    // gravidade + impulso tangencial (balançar com ←/→)
    const dx0 = a.x - R.x, dy0 = a.y - R.y;
    const d0 = Math.hypot(dx0, dy0) || 1;
    let tx = -dy0 / d0, ty = dx0 / d0;       // tangente unitária
    if (dirIn) {
      if (U.sign(tx) !== dirIn) { tx = -tx; ty = -ty; } // tangente apontando para o lado pedido
      const k = C.HOOK_PUMP * (dy0 > 0 ? 1 : 0.35) * dt;
      p.vx += tx * k; p.vy += ty * k;
    }
    p.vy += C.GRAVITY * dt;

    if (h.len > C.HOOK_HANG) h.len = Math.max(C.HOOK_HANG, h.len - C.HOOK_PULL_SPEED * dt);

    let nx = a.x + p.vx * dt, ny = a.y + p.vy * dt;
    const dx = nx - R.x, dy = ny - R.y;
    const d = Math.hypot(dx, dy) || 1;
    let taut = false;
    if (d > h.len) { nx = R.x + dx / d * h.len; ny = R.y + dy / d * h.len; taut = true; }
    const mvx = nx - a.x, mvy = ny - a.y;
    let vx = mvx / dt, vy = mvy / dt;
    if (taut) {
      const ux = dx / d, uy = dy / d;
      const vr = vx * ux + vy * uy;
      if (vr < 0) { vx -= ux * vr; vy -= uy * vr; } // remove a componente radial para dentro
    }
    const sp = Math.hypot(vx, vy);
    if (sp > C.HOOK_MAX_SPEED) { vx *= C.HOOK_MAX_SPEED / sp; vy *= C.HOOK_MAX_SPEED / sp; }
    p.vx = vx; p.vy = vy;
    if (Math.abs(vx) > 30) p.facing = U.sign(vx);
    // movimento com colisão
    if (moveX(p, room, mvx)) p.vx = 0;
    if (moveY(p, room, mvy) !== 0) p.vy = 0;
    h.moved = true;
  }

  /* ---------------- Animação ---------------- */
  function setAnim(p, name) {
    if (p.anim !== name) { p.anim = name; p.animT = 0; }
  }
  function updateAnim(p, dt) {
    if (p.dashT > 0) setAnim(p, 'dash');
    else if (p.attackT > 0) setAnim(p, 'attack');
    else if (p.hook) setAnim(p, p.vy < 0 ? 'jump' : 'fall');
    else if (!p.grounded) setAnim(p, p.vy < 0 ? 'jump' : 'fall');
    else if (p.crouch) setAnim(p, 'crouch');
    else if (Math.abs(p.vx) > 25) setAnim(p, 'run');
    else setAnim(p, 'idle');
    let rate = 1;
    if (p.anim === 'run') rate = U.clamp(Math.abs(p.vx) / C.RUN_SPEED, 0.5, 1.3);
    p.animT += dt * rate;
  }

  /** Frame atual do sheet (ou null sem sheet). */
  P.currentFrame = function (p) {
    const S = Game.Assets.sheet;
    if (!S) return null;
    let anim = S.anims[p.anim] || S.anims.idle;
    if (!anim) return null;
    let idx;
    if (p.anim === 'attack') {
      const prog = 1 - Math.max(0, p.attackT) / C.ATTACK_TIME;
      idx = Math.min(anim.frames.length - 1, Math.floor(prog * anim.frames.length * 1.15));
    } else {
      idx = Math.floor(p.animT * (anim.fps || 8));
      idx = anim.loop ? idx % anim.frames.length : Math.min(idx, anim.frames.length - 1);
    }
    return S.frames[anim.frames[idx]] || null;
  };

  /** Ponto da mão (px da sala) para o chicote. */
  P.handPoint = function (p, fr, x, y) {
    x = x === undefined ? p.x : x; y = y === undefined ? p.y : y;
    const cx = x + p.w / 2, feet = y + p.h;
    const s = C.SPRITE_SCALE;
    if (!fr) return { x: cx + p.facing * 16, y: feet - 82 };
    const lx = (fr.hx - fr.ax) * s;
    return { x: cx + lx * p.facing, y: feet + (fr.hy - fr.ay) * s };
  };

  /** Hitbox do chicote quando está na fase ativa (px da sala) ou null. */
  P.whipBox = function (p) {
    if (p.attackT <= 0) return null;
    const t = C.ATTACK_TIME - p.attackT;
    if (t < C.ATTACK_ACTIVE_START || t > C.ATTACK_ACTIVE_END) return null;
    const hy = p.y + p.h - 92;
    const x0 = p.facing > 0 ? p.cx() : p.cx() - C.WHIP_LENGTH - 12;
    return { x: x0, y: hy - C.WHIP_HIT_H / 2, w: C.WHIP_LENGTH + 12, h: C.WHIP_HIT_H };
  };

  /* ---------------- Desenho ---------------- */
  P.draw = function (g, p, alpha, time) {
    const x = U.lerp(p.px, p.x, alpha), y = U.lerp(p.py, p.y, alpha);
    if (p.invuln > 0 && Math.floor(time * 20) % 2 === 0) return;
    const fr = P.currentFrame(p);
    const cx = x + p.w / 2, feet = y + p.h;
    // sombra
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(cx, feet - 1, 22, 4, 0, 0, Math.PI * 2); g.fill();
    // corda do gancho (atrás do corpo)
    if (p.hook) drawHookRope(g, p, fr, x, y, time);

    const sx = 1 + p.squash * 0.6, sy = 1 - p.squash;
    g.save();
    g.translate(cx, feet);
    g.scale(p.facing * sx, sy);
    if (fr && Game.Assets.sheetImg) {
      const s = C.SPRITE_SCALE;
      g.drawImage(Game.Assets.sheetImg, fr.x, fr.y, fr.w, fr.h, -fr.ax * s, -fr.ay * s, fr.w * s, fr.h * s);
    } else {
      drawPlaceholderHero(g, p, time);
    }
    g.restore();
    if (p.attackT > 0) drawWhip(g, p, fr, x, y, time);
  };

  /** Silhueta procedural nas cores da heroína (sem hero_sheet). */
  function drawPlaceholderHero(g, p, time) {
    const run = p.anim === 'run' ? Math.sin(p.animT * 14) : 0;
    const crouch = p.anim === 'crouch' ? 26 : 0;
    g.translate(0, crouch);
    // pernas (meias escuras)
    g.fillStyle = '#231a22';
    g.save(); g.translate(-6, -62); g.rotate(run * 0.5); g.fillRect(-6, 0, 11, 62); g.restore();
    g.save(); g.translate(6, -62); g.rotate(-run * 0.5); g.fillRect(-5, 0, 11, 62); g.restore();
    g.fillStyle = '#0d0b10'; g.fillRect(-14, -6, 14, 6); g.fillRect(2, -6, 14, 6);
    // short e jaqueta
    g.fillStyle = '#16141c'; g.fillRect(-15, -76, 30, 18);
    g.fillStyle = '#1d1b24'; U.roundRect(g, -16, -118, 32, 46, 8); g.fill();
    g.fillStyle = '#c9a24a'; g.fillRect(-2, -116, 3, 40); g.fillRect(-12, -100, 24, 2);
    // braços
    g.fillStyle = '#1d1b24';
    g.save(); g.translate(10, -112); g.rotate(p.anim === 'attack' ? -1.3 : 0.4 - run * 0.4); g.fillRect(-4, 0, 9, 38); g.restore();
    // cabeça + cabelo ruivo
    g.fillStyle = '#e8bc9c'; g.beginPath(); g.ellipse(2, -128, 10, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#b8401e';
    g.beginPath(); g.ellipse(-1, -134, 14, 11, 0, Math.PI * 0.95, Math.PI * 2.1); g.fill();
    g.fillRect(-14, -136, 8, 20);
    g.translate(0, -crouch);
  }

  /* Trajetória da ponta do chicote em função do progresso do golpe (virado à direita). */
  function whipPose(prog) {
    const L = C.WHIP_LENGTH;
    let ang, len, lag;
    if (prog < 0.25) { const k = prog / 0.25; ang = U.lerp(-2.6, -1.9, k); len = U.lerp(0.25, 0.45, k) * L; lag = 0.6; }
    else if (prog < 0.55) { const k = U.easeOutCubic((prog - 0.25) / 0.3); ang = U.lerp(-1.9, 0.02, k); len = U.lerp(0.45, 1.0, k) * L; lag = U.lerp(0.9, 0.25, k); }
    else if (prog < 0.75) { const k = (prog - 0.55) / 0.2; ang = U.lerp(0.02, 0.1, k); len = L * (1 + Math.sin(k * Math.PI) * 0.04); lag = -0.12 * Math.sin(k * Math.PI * 2); }
    else { const k = (prog - 0.75) / 0.25; ang = U.lerp(0.1, 1.0, k); len = U.lerp(1.0, 0.3, k) * L; lag = -0.4 * k; }
    return { ang, len, lag };
  }

  function whipPoints(h, facing, prog, time) {
    const { ang, len, lag } = whipPose(prog);
    const tipX = h.x + Math.cos(ang) * len * facing, tipY = h.y + Math.sin(ang) * len;
    // ponto de controle "atrasado" em relação à ponta: dá a curvatura do chicote
    const ca = ang + lag * 1.4;
    const cX = h.x + Math.cos(ca) * len * 0.55 * facing, cY = h.y + Math.sin(ca) * len * 0.55 + 10;
    const pts = [];
    const N = 18;
    for (let i = 0; i <= N; i++) {
      const t = i / N, it = 1 - t;
      let x = it * it * h.x + 2 * it * t * cX + t * t * tipX;
      let y = it * it * h.y + 2 * it * t * cY + t * t * tipY;
      y += Math.sin(t * 9 - time * 30) * 2.2 * t;
      pts.push(x, y);
    }
    return pts;
  }

  function strokePts(g, pts, w, col) {
    g.lineWidth = w; g.strokeStyle = col;
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  }

  function drawWhip(g, p, fr, x, y, time) {
    const prog = U.clamp(1 - p.attackT / C.ATTACK_TIME, 0, 1);
    const h = P.handPoint(p, fr, x, y);
    const pts = whipPoints(h, p.facing, prog, time);
    // rastro: guarda as últimas poses
    p.whipTrail.unshift(pts);
    if (p.whipTrail.length > 5) p.whipTrail.length = 5;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = p.whipTrail.length - 1; i >= 1; i--) {
      strokePts(g, p.whipTrail[i], 6, 'rgba(255,200,110,' + (0.16 - i * 0.025) + ')');
    }
    strokePts(g, pts, 10, 'rgba(255,170,70,0.22)');
    strokePts(g, pts, 5, 'rgba(255,220,150,0.55)');
    strokePts(g, pts, 1.8, 'rgba(255,252,235,1)');
    const tx = pts[pts.length - 2], ty = pts[pts.length - 1];
    Game.FX.glow(g, tx, ty, prog > 0.4 && prog < 0.75 ? 34 : 18, 'whip', 0.9);
    g.restore();
    if (prog > 0.45 && prog < 0.7 && Math.random() < 0.6) Game.FX.burst(tx, ty, 'spark', 1, p.facing);
  }

  function drawHookRope(g, p, fr, x, y, time) {
    const h = P.handPoint(p, fr, x, y);
    const R = p.hook.ring;
    let ex = R.x, ey = R.y;
    if (p.hook.fireT > 0) { const k = 1 - p.hook.fireT / 0.07; ex = U.lerp(h.x, R.x, k); ey = U.lerp(h.y, R.y, k); }
    const pts = [];
    const N = 12;
    const slack = p.hook.fireT > 0 ? 14 : 3;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push(U.lerp(h.x, ex, t) + Math.sin(t * Math.PI * 3 + time * 25) * slack * (1 - t) * t,
        U.lerp(h.y, ey, t) + Math.sin(t * Math.PI) * slack);
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    strokePts(g, pts, 8, 'rgba(255,170,70,0.2)');
    strokePts(g, pts, 3.5, 'rgba(255,220,150,0.55)');
    strokePts(g, pts, 1.5, 'rgba(255,252,235,1)');
    Game.FX.glow(g, ex, ey, 22, 'whip', 0.8);
    g.restore();
  }
})();
