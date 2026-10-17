/*
 * Câmera com deadzone, lookahead na direção do movimento, olhar para baixo em
 * quedas longas, limites da sala e tremor (screen shake).
 */
(function () {
  'use strict';
  const C = Game.CONFIG, U = Game.U;

  const Cam = Game.Camera = {
    x: 0, y: 0,           // canto superior esquerdo (px de mundo da sala)
    px: 0, py: 0,         // posição anterior (interpolação)
    fx: 0, fy: 0,         // ponto focal suavizado
    look: 0,
    shakeMag: 0, shakeT: 0, ox: 0, oy: 0,
    room: null
  };

  function clampToRoom() {
    const r = Cam.room;
    if (!r) return;
    const W = C.VIEW_W, H = C.VIEW_H;
    Cam.x = r.pw <= W ? (r.pw - W) / 2 : U.clamp(Cam.x, 0, r.pw - W);
    Cam.y = r.ph <= H ? (r.ph - H) / 2 : U.clamp(Cam.y, 0, r.ph - H);
  }

  /** Posiciona a câmera imediatamente sobre o alvo (entrada de sala, respawn). */
  Cam.snap = function (room, p) {
    Cam.room = room;
    Cam.look = p.facing * C.CAMERA.LOOKAHEAD_X;
    Cam.fx = p.cx() + Cam.look;
    Cam.fy = p.cy() - C.CAMERA.LOOK_UP;
    Cam.x = Cam.fx - C.VIEW_W / 2;
    Cam.y = Cam.fy - C.VIEW_H / 2;
    clampToRoom();
    Cam.px = Cam.x; Cam.py = Cam.y;
  };

  Cam.update = function (dt, p) {
    const K = C.CAMERA;
    Cam.px = Cam.x; Cam.py = Cam.y;
    // lookahead acompanha a direção do olhar/movimento
    const wantLook = (Math.abs(p.vx) > 40 ? U.sign(p.vx) : p.facing) * K.LOOKAHEAD_X;
    Cam.look = U.damp(Cam.look, wantLook, 2.2, dt);
    const tx = p.cx() + Cam.look;
    let ty = p.cy() - K.LOOK_UP;
    if (p.vy > 650 && !p.grounded) ty += K.FALL_LOOKDOWN;
    // deadzone: o ponto focal só anda quando o alvo sai da zona
    let gx = Cam.fx, gy = Cam.fy;
    if (tx > gx + K.DEADZONE_X) gx = tx - K.DEADZONE_X;
    else if (tx < gx - K.DEADZONE_X) gx = tx + K.DEADZONE_X;
    if (ty > gy + K.DEADZONE_Y) gy = ty - K.DEADZONE_Y;
    else if (ty < gy - K.DEADZONE_Y) gy = ty + K.DEADZONE_Y;
    Cam.fx = U.damp(Cam.fx, gx, K.SMOOTH_X, dt);
    Cam.fy = U.damp(Cam.fy, gy, p.grounded ? K.SMOOTH_Y : K.SMOOTH_Y * 1.4, dt);
    Cam.x = Cam.fx - C.VIEW_W / 2;
    Cam.y = Cam.fy - C.VIEW_H / 2;
    clampToRoom();
    // tremor
    if (Cam.shakeT > 0) {
      Cam.shakeT -= dt;
      const m = Cam.shakeMag * Math.max(0, Cam.shakeT) * 4;
      Cam.ox = U.rand(-m, m); Cam.oy = U.rand(-m, m);
    } else { Cam.ox = Cam.oy = 0; }
  };

  Cam.shake = function (mag, time) {
    if (Game.Settings && Game.Settings.data.shake === false) return;
    Cam.shakeMag = Math.max(Cam.shakeMag * (Cam.shakeT > 0 ? 1 : 0), mag);
    Cam.shakeT = Math.max(Cam.shakeT, time || 0.25);
  };

  /** Posição interpolada para o render. */
  Cam.view = function (alpha) {
    return {
      x: Math.round((U.lerp(Cam.px, Cam.x, alpha) + Cam.ox) * 2) / 2,
      y: Math.round((U.lerp(Cam.py, Cam.y, alpha) + Cam.oy) * 2) / 2
    };
  };
})();
