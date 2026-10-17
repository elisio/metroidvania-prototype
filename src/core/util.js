/* Utilitários matemáticos e de canvas compartilhados por todo o jogo. */
(function () {
  'use strict';
  const U = Game.U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  /** Move v em direção a t no máximo d unidades. */
  U.approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  /** Suavização exponencial independente de framerate. */
  U.damp = (a, b, lambda, dt) => U.lerp(a, b, 1 - Math.exp(-lambda * dt));
  U.sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  U.rand = (a, b) => a + Math.random() * (b - a);
  U.randi = (a, b) => Math.floor(U.rand(a, b + 1));
  U.choose = (arr) => arr[Math.floor(Math.random() * arr.length)];
  U.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  U.overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  U.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  U.easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  U.easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  /** Gerador pseudoaleatório determinístico (xorshift32) para texturas procedurais. */
  U.seeded = function (seed) {
    let s = ((seed * 2654435761) >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };

  U.canvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    const g = c.getContext('2d');
    return { c, g };
  };

  U.rgb = (a) => 'rgb(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ')';
  U.rgba = (a, al) => 'rgba(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ',' + al + ')';
  U.mix = (a, b, t) => [U.lerp(a[0], b[0], t), U.lerp(a[1], b[1], t), U.lerp(a[2], b[2], t)];

  U.roundRect = function (g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };

  /** Desenha um coração (usado no HUD e no mapa como fallback). */
  U.heartPath = function (g, cx, cy, s) {
    g.beginPath();
    g.moveTo(cx, cy + s * 0.35);
    g.bezierCurveTo(cx - s * 0.05, cy + s * 0.28, cx - s * 0.5, cy + s * 0.02, cx - s * 0.5, cy - s * 0.18);
    g.bezierCurveTo(cx - s * 0.5, cy - s * 0.42, cx - s * 0.18, cy - s * 0.5, cx, cy - s * 0.26);
    g.bezierCurveTo(cx + s * 0.18, cy - s * 0.5, cx + s * 0.5, cy - s * 0.42, cx + s * 0.5, cy - s * 0.18);
    g.bezierCurveTo(cx + s * 0.5, cy + s * 0.02, cx + s * 0.05, cy + s * 0.28, cx, cy + s * 0.35);
    g.closePath();
  };

  U.fmtTime = function (s) {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => (n < 10 ? '0' : '') + n;
    return (h ? h + ':' : '') + p(m) + ':' + p(ss);
  };

  /** Quebra texto em linhas que caibam em maxW (usa a fonte atual do contexto). */
  U.wrap = function (g, text, maxW) {
    const out = [];
    String(text).split('\n').forEach((para) => {
      const words = para.split(' ');
      let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (g.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
      }
      out.push(line);
    });
    return out;
  };

  U.clone = (o) => JSON.parse(JSON.stringify(o));
})();
