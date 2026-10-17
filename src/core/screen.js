/*
 * Canvas, escala com letterbox e loop com passo fixo (60 Hz).
 * O mundo é sempre desenhado em coordenadas lógicas 960×540; o contexto recebe
 * uma transformação de escala k para a resolução real (até MAX_RENDER_SCALE).
 */
(function () {
  'use strict';
  const C = Game.CONFIG;

  const S = Game.Screen = { canvas: null, g: null, k: 1, cssScale: 1 };

  S.init = function () {
    S.canvas = document.getElementById('game');
    S.g = S.canvas.getContext('2d', { alpha: false });
    window.addEventListener('resize', S.resize);
    window.addEventListener('orientationchange', S.resize);
    S.resize();
  };

  S.resize = function () {
    const W = window.innerWidth || C.VIEW_W, H = window.innerHeight || C.VIEW_H;
    const scale = Math.max(0.1, Math.min(W / C.VIEW_W, H / C.VIEW_H));
    S.cssScale = scale;
    const cw = Math.floor(C.VIEW_W * scale), ch = Math.floor(C.VIEW_H * scale);
    S.canvas.style.width = cw + 'px';
    S.canvas.style.height = ch + 'px';
    const dpr = window.devicePixelRatio || 1;
    S.k = Math.max(1, Math.min(C.MAX_RENDER_SCALE, scale * dpr));
    S.canvas.width = Math.round(C.VIEW_W * S.k);
    S.canvas.height = Math.round(C.VIEW_H * S.k);
  };

  /** Converte coordenadas de cliente (px da janela) para coordenadas lógicas. */
  S.toLogical = function (clientX, clientY) {
    const r = S.canvas.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width * C.VIEW_W, y: (clientY - r.top) / r.height * C.VIEW_H };
  };

  S.toggleFullscreen = function () {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    } catch (e) { /* navegador sem suporte */ }
  };

  /* ---------------- Loop ---------------- */
  const L = Game.Loop = { frozen: false, alpha: 1, fps: 60, frameMs: 16 };

  L.start = function (update, render) {
    let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0;
    const step = C.FIXED_DT;
    function frame(now) {
      requestAnimationFrame(frame); // agenda antes: um erro não congela o jogo
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;
      if (dt < 0) dt = 0;
      const t0 = performance.now();
      try {
        if (!L.frozen) {
          acc += dt;
          let n = 0;
          while (acc >= step && n < C.MAX_STEPS_PER_FRAME) { update(step); acc -= step; n++; }
          if (n >= C.MAX_STEPS_PER_FRAME) acc = 0;
          L.alpha = acc / step;
        } else L.alpha = 1;
        render(L.alpha, dt);
      } catch (e) {
        if (!L.errorShown) { console.error(e); L.errorShown = true; }
      }
      L.frameMs = L.frameMs * 0.9 + (performance.now() - t0) * 0.1;
      fpsAcc += dt; fpsN++;
      if (fpsAcc >= 0.5) { L.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    }
    requestAnimationFrame(frame);
  };
})();
