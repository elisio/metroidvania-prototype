/*
 * Noite de Ferro — áudio 100% procedural (WebAudio puro, sem arquivos nem bibliotecas).
 *
 * Script clássico: define window.Game.Audio. Funciona via file:// e HTTP.
 * Todas as funções públicas são seguras antes de init() e em navegadores sem WebAudio
 * (viram no-op e nunca lançam erro).
 *
 * Grafo:
 *   [vozes sfx] ─┐                        ┌─> Convolver (IR sintetizada "catedral de ferro") ─┐
 *   [música]   ──┼─> bus.in / bus.verbIn ─┤                                                   │
 *   [ambiente] ─┘                         └──────────────> master ─> glue comp ─> limiter ─> trim ─> saída
 *
 * Volume dos barramentos: ganho = v² (curva perceptual); v é o valor 0..1 salvo/retornado.
 * Ver docs/AUDIO.md para pontos de integração.
 */
window.Game = window.Game || {};

(function () {
  'use strict';

  // ===================================================================== config
  const STORAGE_KEY = 'noiteDeFerro.audio.v1';
  const BUSES = ['master', 'music', 'sfx', 'ambient'];
  const DEFAULT_VOL = { master: 0.85, music: 0.7, sfx: 0.9, ambient: 0.7 };
  const FADE = 1.5;          // crossfade de música (s)
  const LOOKAHEAD = 0.15;    // janela do scheduler (s)
  const TICK_MS = 25;        // intervalo do scheduler (ms)
  const MAX_VOICES = 48;     // teto global de vozes de efeito
  const TRACK_NAMES = ['title', 'exterior', 'interior', 'tower'];

  const state = {
    vol: Object.assign({}, DEFAULT_VOL),
    muted: false,
    want: { music: null, rain: 0, steam: 0 }   // estado desejado (aplicado no init)
  };

  (function load() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o && o.vol) {
        for (const b of BUSES) {
          const v = o.vol[b];
          if (typeof v === 'number' && isFinite(v)) state.vol[b] = clamp(v, 0, 1);
        }
      }
      state.muted = !!(o && o.muted);
    } catch (e) { /* storage indisponível: usa padrões */ }
  })();

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ vol: state.vol, muted: state.muted }));
    } catch (e) { /* ignore */ }
  }

  // ===================================================================== utilidades
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function R(a, b) { return a + Math.random() * (b - a); }
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  /** 'C#4' -> 61 */
  function N(s) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
    if (!m) return NaN;
    return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  /** 'D3 F3 A3' -> [50, 53, 57] */
  function P(s) { return s.split(/\s+/).filter(Boolean).map(N); }
  /** 'D5:2 C5:1 r:1' -> [[beat, midi, beats], ...] */
  function seq(s) {
    let b = 0; const out = [];
    for (const tok of s.split(/\s+/)) {
      if (!tok) continue;
      const parts = tok.split(':');
      const d = parseFloat(parts[1]);
      if (parts[0] !== 'r') out.push([b, N(parts[0]), d]);
      b += d;
    }
    return out;
  }
  function seeded(seed) {
    let s = ((seed * 2654435761) >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function hashStr(str) { let h = 7; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
  function choose(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  /** próximo grau acima/abaixo dentro de um conjunto de classes de altura */
  function scaleStep(m, set, dir) {
    for (let k = 1; k <= 3; k++) { const c = m + dir * k; if (set.indexOf(((c % 12) + 12) % 12) >= 0) return c; }
    return m + dir * 2;
  }
  function holdParam(p, now) {
    try {
      if (p.cancelAndHoldAtTime) { p.cancelAndHoldAtTime(now); return; }
    } catch (e) { /* fallback abaixo */ }
    const v = p.value; p.cancelScheduledValues(now); p.setValueAtTime(v, now);
  }
  function busGain(b) { const v = state.vol[b]; return v * v; }

  let warned = 0;
  function warn(e) {
    if (warned++ < 5 && window.console) console.warn('[Game.Audio]', e && e.message ? e.message : e);
  }

  // ===================================================================== buffers gerados
  function loopable(data, n, x) {
    // data tem n + x amostras; funde a cauda no início com crossfade de potência constante
    for (let i = 0; i < x; i++) {
      const k = i / x;
      data[i] = data[i] * Math.sqrt(k) + data[n + i] * Math.sqrt(1 - k);
    }
  }
  function fillWhite(d) { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  function fillPink(d) {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  }
  function fillBrown(d) {
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  }
  function normalize(d, peak) {
    let m = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
    if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
  }
  function makeNoise(ctx, fill, seconds, channels) {
    const sr = ctx.sampleRate, n = Math.floor(sr * seconds), x = Math.floor(sr * 0.05);
    const buf = ctx.createBuffer(channels, n, sr);
    for (let c = 0; c < channels; c++) {
      const tmp = new Float32Array(n + x);
      fill(tmp);
      let mean = 0; for (let i = 0; i < tmp.length; i++) mean += tmp[i];
      mean /= tmp.length; for (let i = 0; i < tmp.length; i++) tmp[i] -= mean;
      normalize(tmp, 0.95); loopable(tmp, n, x);
      buf.getChannelData(c).set(tmp.subarray(0, n));
    }
    return buf;
  }
  /** textura de respingos de chuva (grãos curtos), estéreo e emendável */
  function makePatter(ctx) {
    const sr = ctx.sampleRate, n = Math.floor(sr * 3);
    const buf = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      const grains = 3 * 420;
      for (let g = 0; g < grains; g++) {
        const pos = Math.floor(Math.random() * n);
        const len = Math.floor(R(0.0008, 0.005) * sr);
        const amp = 0.04 + 0.7 * Math.pow(Math.random(), 3);
        let prev = 0;
        for (let k = 0; k < len; k++) {
          const w = Math.random() * 2 - 1;
          const hp = w - prev; prev = w;               // realce de agudos
          d[(pos + k) % n] += hp * amp * Math.exp(-5 * k / len);
        }
      }
      // gotas mais pesadas com pequena ressonância (metal molhado)
      for (let g = 0; g < 3 * 9; g++) {
        const pos = Math.floor(Math.random() * n);
        const f = R(1800, 5200), len = Math.floor(0.025 * sr), amp = R(0.1, 0.35);
        for (let k = 0; k < len; k++) {
          d[(pos + k) % n] += Math.sin(2 * Math.PI * f * k / sr) * amp * Math.exp(-k / (0.004 * sr));
        }
      }
      normalize(d, 0.9);
    }
    return buf;
  }
  /** resposta ao impulso sintetizada: salão de pedra + ressonâncias de ferro */
  function makeIR(ctx) {
    const sr = ctx.sampleRate, secs = 3.4, len = Math.floor(sr * secs), pre = Math.floor(0.016 * sr);
    const buf = ctx.createBuffer(2, len, sr);
    const modes = [[412, 0.6], [977, 0.45], [1530, 0.3], [2290, 0.2]];
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const env = Math.exp(-t * 6.9 / 2.7);                  // RT60 ≈ 2.7 s
        const coef = 0.82 * Math.exp(-t * 1.4) + 0.07;         // perde agudos com o tempo
        lp += ((Math.random() * 2 - 1) - lp) * coef;
        let s = lp * env * (1.2 - coef * 0.4);
        if (t < 1.2) {
          for (const md of modes) s += Math.sin(2 * Math.PI * md[0] * (1 + c * 0.003) * t) * md[1] * 0.025 * Math.exp(-t * 3.5);
        }
        d[i] = s;
      }
      // reflexões iniciais (paredes de tijolo / vigas)
      const taps = c ? [0.019, 0.031, 0.052, 0.067, 0.088, 0.109] : [0.023, 0.037, 0.046, 0.071, 0.083, 0.117];
      taps.forEach((tp, k) => {
        const i = Math.floor(tp * sr);
        if (i < len) d[i] += (k % 2 ? -1 : 1) * 0.5 * Math.pow(0.78, k);
      });
    }
    return buf;
  }
  function makeWaves(ctx) {
    // órgão de tubos: 8' + 4' + 2⅔' + 2' + 1⅗' + 1'
    const h = [0, 1, 0.62, 0.36, 0.42, 0.08, 0.16, 0.03, 0.18, 0.02, 0.05];
    const real = new Float32Array(h.length), imag = new Float32Array(h);
    // "reed" para fanfarra (metais escuros)
    const r = [0]; for (let k = 1; k < 18; k++) r.push((k < 6 ? 1.0 : 0.8) / Math.pow(k, 0.85));
    return {
      organ: ctx.createPeriodicWave(real, imag),
      reed: ctx.createPeriodicWave(new Float32Array(r.length), new Float32Array(r))
    };
  }
  function makeDrive() {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * 3.2) / Math.tanh(3.2); }
    return c;
  }

  // ===================================================================== primitivas de síntese
  function shape(p, t, a, v, h, d, lin) {
    v = Math.max(v, 1e-4); a = Math.max(a, 0.0005);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + a);
    if (h > 0) p.setValueAtTime(v, t + a + h);
    if (lin) p.linearRampToValueAtTime(0, t + a + h + d);
    else p.exponentialRampToValueAtTime(v * 1e-3, t + a + h + d);
  }
  function filt(E, src, f, t, end) {
    const list = Array.isArray(f) ? f : [f];
    let n = src;
    for (const x of list) {
      const b = E.bq(x.type || 'lowpass', x.f, x.Q);
      if (x.f2) {
        b.frequency.setValueAtTime(x.f, t);
        b.frequency.exponentialRampToValueAtTime(Math.max(20, x.f2), t + (x.glide || (end - t)));
      }
      n.connect(b); n = b;
    }
    return n;
  }
  /** oscilador com envelope. o: {f, f2, glide, type|wave, a, hold, d, v, lin, detune, vib, filter, drive} */
  function tone(E, dest, t, o) {
    const ctx = E.ctx;
    const a = o.a == null ? 0.004 : o.a, h = o.hold || 0, d = o.d == null ? 0.2 : o.d;
    const end = t + a + h + d;
    const osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(E.waves[o.wave]); else osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(5, o.f2), t + (o.glide || a + h + d));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) o.vib.connect(osc.detune);
    const env = ctx.createGain();
    shape(env.gain, t, a, o.v, h, d, o.lin);
    let n = osc;
    if (o.filter) n = filt(E, n, o.filter, t, end);
    if (o.drive) { const ws = ctx.createWaveShaper(); ws.curve = E.curve; n.connect(ws); n = ws; }
    n.connect(env); env.connect(dest);
    osc.start(t); osc.stop(end + 0.02);
    return osc;
  }
  /** ruído filtrado com envelope. o: {buf, rate, a, hold, d, v, lin, filter} */
  function noise(E, dest, t, o) {
    const ctx = E.ctx;
    const a = o.a == null ? 0.002 : o.a, h = o.hold || 0, d = o.d == null ? 0.1 : o.d;
    const end = t + a + h + d;
    const src = ctx.createBufferSource();
    src.buffer = E.buf[o.buf || 'white']; src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const env = ctx.createGain();
    shape(env.gain, t, a, o.v, h, d, o.lin);
    let n = src;
    if (o.filter) n = filt(E, n, o.filter, t, end);
    n.connect(env); env.connect(dest);
    src.start(t, Math.random() * (src.buffer.duration - 0.1));
    src.stop(end + 0.02);
    return src;
  }
  /** parciais inarmônicos (metal) */
  function metal(E, dest, t, f, ratios, d, v) {
    ratios.forEach((r, i) => tone(E, dest, t, { f: f * r, a: 0.0008, d: d / (1 + i * 0.45), v: v / (1 + i * 0.35) }));
  }
  const BELL = [[0.5, 0.32, 1.0], [1, 1, 0.75], [1.19, 0.42, 0.5], [1.5, 0.28, 0.42], [2, 0.38, 0.33], [2.52, 0.2, 0.22], [3.01, 0.14, 0.17]];
  /** sino de igreja (hum, prime, terça menor, quinta, nominal...) */
  function bell(E, dest, t, f, v, dur) {
    for (const p of BELL) tone(E, dest, t, { f: f * p[0], a: 0.002, d: dur * p[2], v: v * p[1] * 0.42, detune: R(-3, 3) });
  }
  /** nota sustentada genérica: retorna o nó de envelope */
  function susEnv(E, t, dur, a, r, v) {
    const g = E.g(0), p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + a);
    p.setValueAtTime(v, t + Math.max(a, dur));
    p.linearRampToValueAtTime(0, t + Math.max(a, dur) + r);
    return g;
  }
  function oscs(E, env, t, stopAt, f, type, detunes, vib) {
    for (const dt of detunes) {
      const o = E.ctx.createOscillator();
      if (type === 'organ' || type === 'reed') o.setPeriodicWave(E.waves[type]); else o.type = type;
      o.frequency.value = f; o.detune.value = dt;
      if (vib) vib.connect(o.detune);
      o.connect(env); o.start(t); o.stop(stopAt);
    }
  }

  // ===================================================================== instrumentos musicais
  const INS = {
    organ(E, dest, t, m, dur, v) {
      const env = susEnv(E, t, dur, 0.07, 0.35, v);
      oscs(E, env, t, t + dur + 0.4, mtof(m), 'organ', [-5, 5]);
      env.connect(dest);
    },
    sub(E, dest, t, m, dur, v) {
      const env = susEnv(E, t, dur, 0.2, 0.6, v);
      oscs(E, env, t, t + dur + 0.65, mtof(m), 'sine', [0]);
      env.connect(dest);
    },
    flute(E, T, dest, t, m, dur, v) {
      const env = susEnv(E, t, dur, 0.09, 0.3, v);
      oscs(E, env, t, t + dur + 0.35, mtof(m), 'sine', [0], T.vib);
      oscs(E, env, t, t + dur + 0.35, mtof(m) * 2, 'triangle', [3], null);
      env.connect(dest);
      noise(E, dest, t, { buf: 'pink', a: 0.02, d: 0.12, v: v * 0.25, filter: { type: 'bandpass', f: mtof(m) * 2, Q: 2 } });
    },
    choir(E, T, t, m, dur, v) {
      const env = susEnv(E, t, dur, 0.4, 0.7, v);
      oscs(E, env, t, t + dur + 0.75, mtof(m), 'sawtooth', [-9, 8], T.vib);
      env.connect(T.choirIn);
    },
    strings(E, dest, t, m, dur, v, a, r) {
      a = a == null ? 0.8 : a; r = r == null ? 1.2 : r;
      const env = susEnv(E, t, dur, a, r, v);
      oscs(E, env, t, t + dur + r + 0.05, mtof(m), 'sawtooth', [-11, 0, 10]);
      env.connect(dest);
    },
    bass(E, dest, t, m, dur, v) {
      const f = mtof(m), end = t + dur;
      const lp = E.bq('lowpass', 160, 5);
      lp.frequency.setValueAtTime(160, t);
      lp.frequency.linearRampToValueAtTime(160 + 1000 * v, t + 0.012);
      lp.frequency.exponentialRampToValueAtTime(170, end);
      const env = susEnv(E, t, dur * 0.7, 0.006, dur * 0.3, v);
      oscs(E, lp, t, end + 0.05, f, 'sawtooth', [-6, 6]);
      lp.connect(env);
      const sub = susEnv(E, t, dur * 0.7, 0.006, dur * 0.3, v * 0.7);
      oscs(E, sub, t, end + 0.05, f / 2, 'sine', [0]);
      env.connect(dest); sub.connect(dest);
    },
    lead(E, T, dest, t, m, dur, v) {
      const env = susEnv(E, t, dur, 0.035, 0.28, v);
      oscs(E, env, t, t + dur + 0.32, mtof(m), 'sawtooth', [-4], T.vib);
      oscs(E, env, t, t + dur + 0.32, mtof(m), 'triangle', [5], T.vib);
      env.connect(dest);
    },
    glass(E, dest, t, m, v) {
      const f = mtof(m);
      tone(E, dest, t, { f, a: 0.002, d: 1.8, v });
      tone(E, dest, t, { f: f * 2.76, a: 0.001, d: 0.7, v: v * 0.22 });
      tone(E, dest, t, { f: f * 5.4, a: 0.001, d: 0.25, v: v * 0.08 });
    },
    kick(E, dest, t, v) {
      tone(E, dest, t, { f: 115, f2: 40, glide: 0.14, a: 0.002, d: 0.34, v });
      noise(E, dest, t, { a: 0.0005, d: 0.012, v: v * 0.15, filter: { type: 'lowpass', f: 3000 } });
    },
    hat(E, dest, t, v) { noise(E, dest, t, { a: 0.0006, d: 0.035, v, filter: { type: 'highpass', f: 7000 } }); },
    clap(E, dest, t, v) {
      for (let k = 0; k < 3; k++) noise(E, dest, t + k * 0.011, { a: 0.0006, d: k === 2 ? 0.16 : 0.012, v, filter: { type: 'bandpass', f: 1300, Q: 0.9 } });
    },
    metalHit(E, dest, t, f, v) {
      metal(E, dest, t, f, [1, 2.37, 3.71, 5.18], 1.5, v);
      noise(E, dest, t, { a: 0.0006, d: 0.03, v: v * 0.6, filter: { type: 'bandpass', f: f * 4, Q: 3 } });
    },
    drip(E, dest, t, f, v) {
      tone(E, dest, t, { f, f2: f * 1.8, glide: 0.022, a: 0.0008, d: 0.07, v });
    },
    taiko(E, dest, t, v) {
      tone(E, dest, t, { f: 98, f2: 52, glide: 0.22, a: 0.002, d: 0.6, v });
      noise(E, dest, t, { buf: 'brown', a: 0.001, d: 0.14, v: v * 0.7, filter: { type: 'lowpass', f: 600 } });
      noise(E, dest, t, { a: 0.0005, d: 0.02, v: v * 0.15, filter: { type: 'bandpass', f: 1800, Q: 1 } });
    },
    tick(E, dest, t, f, v) {
      noise(E, dest, t, { a: 0.0004, d: 0.022, v, filter: { type: 'bandpass', f, Q: 7 } });
      tone(E, dest, t, { f: f * 0.5, a: 0.0005, d: 0.03, v: v * 0.3 });
    },
    groan(E, dest, t, f, v) {
      tone(E, dest, t, { f, f2: f * 0.86, glide: 3.2, type: 'sawtooth', a: 1.0, hold: 0.6, d: 1.6, v, lin: true, filter: { type: 'lowpass', f: 240, Q: 6 } });
    },
    swell(E, dest, t, dur, v) {
      noise(E, dest, t, { a: dur, d: 0.08, v, lin: true, filter: { type: 'highpass', f: 900, f2: 5000, glide: dur } });
    }
  };

  // ===================================================================== efeitos (SFX)
  // fn(K, opts) -> duração (s). K.tone/noise recebem 'at' relativo ao início.
  // send = quantidade de reverb; bus = barramento; max/gap = limite de vozes/retrigger.
  const SFX = {};

  SFX.jump = { gain: 7, send: 0.1, max: 2, gap: 0.05, fn(K) {
    const p = K.p;
    K.noise({ buf: 'pink', a: 0.012, d: 0.16, v: 0.5, filter: { type: 'bandpass', f: 500 * p, f2: 1900 * p, Q: 1.3 } });
    K.tone({ f: 150 * p, f2: 240 * p, a: 0.002, d: 0.07, v: 0.3 });
    K.noise({ a: 0.0008, d: 0.02, v: 0.14, filter: { type: 'highpass', f: 3500 } });
    return 0.25;
  } };

  SFX.double_jump = { gain: 2, send: 0.35, max: 2, gap: 0.05, fn(K) {
    const p = K.p;
    K.noise({ a: 0.01, d: 0.22, v: 0.32, filter: { type: 'bandpass', f: 800 * p, f2: 3200 * p, Q: 1.5 } });
    K.tone({ f: 180 * p, f2: 90 * p, a: 0.002, d: 0.11, v: 0.25 });
    [88, 95, 100].forEach((m, i) => {
      K.tone({ at: i * 0.04, f: mtof(m) * p, a: 0.003, d: 0.28, v: 0.11 });
      K.tone({ at: i * 0.04, f: mtof(m) * 2.01 * p, a: 0.003, d: 0.12, v: 0.03 });
    });
    return 0.55;
  } };

  SFX.land = { gain: 2.3, send: 0.12, max: 2, gap: 0.06, fn(K) {
    const p = K.p;
    K.tone({ f: 125 * p, f2: 45 * p, a: 0.002, d: 0.17, v: 0.65 });
    K.noise({ buf: 'brown', a: 0.002, d: 0.12, v: 0.55, filter: { type: 'lowpass', f: 700 } });
    K.metal(0.002, 210 * p * R(0.95, 1.05), [1, 2.31, 3.87, 5.12], 0.28, 0.1);
    K.noise({ a: 0.003, d: 0.11, v: 0.13, filter: { type: 'highpass', f: 2600 } });
    return 0.4;
  } };

  SFX.step = { gain: 9, send: 0.08, max: 2, gap: 0.07, fn(K) {
    // salto alto em metal molhado: clique do salto + "ping" curto do metal + respingo
    const p = K.p * R(0.94, 1.06), r1 = R(0.93, 1.07), r2 = R(0.93, 1.07), heel = Math.random() < 0.5;
    K.noise({ a: 0.0006, d: 0.022, v: heel ? 0.55 : 0.4, filter: { type: 'bandpass', f: (heel ? 3600 : 2800) * p, Q: 2.2 } });
    K.tone({ f: 2350 * p * r1, a: 0.0006, d: 0.07, v: 0.05 });
    K.tone({ f: 3720 * p * r2, a: 0.0006, d: 0.05, v: 0.035 });
    K.tone({ f: 310 * p, f2: 170 * p, a: 0.0008, d: 0.045, v: 0.2 });
    K.noise({ at: 0.004, a: 0.004, d: 0.07, v: R(0.05, 0.11), filter: { type: 'highpass', f: 3200 } });
    return 0.12;
  } };

  SFX.whip = { gain: 1.3, send: 0.3, max: 2, gap: 0.05, fn(K) {
    const p = K.p;
    // swish crescente -> estalo -> zumbido de energia luminosa
    K.noise({ buf: 'pink', a: 0.08, d: 0.05, v: 0.38, filter: { type: 'bandpass', f: 500 * p, f2: 3600 * p, glide: 0.12, Q: 1.1 } });
    K.noise({ at: 0.11, a: 0.0004, d: 0.035, v: 0.45, filter: { type: 'highpass', f: 2200 } });
    K.tone({ at: 0.11, type: 'square', f: 1900 * p, f2: 500 * p, a: 0.0004, d: 0.025, v: 0.12 });
    K.tone({ at: 0.06, type: 'sawtooth', f: 110 * p, a: 0.02, d: 0.38, v: 0.1, filter: { type: 'lowpass', f: 3200, f2: 350, Q: 4 } });
    K.tone({ at: 0.06, type: 'sawtooth', f: 165.6 * p, a: 0.02, d: 0.34, v: 0.07, filter: { type: 'lowpass', f: 3000, f2: 400, Q: 4 } });
    K.tone({ at: 0.1, f: 880 * p, f2: 1760 * p, a: 0.006, d: 0.3, v: 0.07 });
    K.tone({ at: 0.12, f: 2640 * p, a: 0.004, d: 0.45, v: 0.035 });
    return 0.65;
  } };

  SFX.whip_hit = { gain: 3.6, send: 0.2, max: 3, gap: 0.03, fn(K) {
    const p = K.p * R(0.96, 1.04);
    K.tone({ f: 165 * p, f2: 55 * p, a: 0.0008, d: 0.13, v: 0.6 });
    K.noise({ a: 0.0008, d: 0.09, v: 0.5, filter: { type: 'lowpass', f: 1900 } });
    K.metal(0.001, 380 * p, [1, 2.76, 5.4, 8.93], 0.45, 0.13);
    K.noise({ a: 0.0008, d: 0.15, v: 0.12, filter: { type: 'highpass', f: 5200 } });
    return 0.5;
  } };

  SFX.dash = { gain: 5, send: 0.15, max: 2, gap: 0.08, fn(K) {
    const p = K.p;
    K.noise({ buf: 'pink', a: 0.02, d: 0.25, v: 0.6, filter: { type: 'bandpass', f: 3200 * p, f2: 380 * p, Q: 0.9 } });
    K.tone({ type: 'sawtooth', f: 92 * p, f2: 46 * p, a: 0.01, d: 0.2, v: 0.12, filter: { type: 'lowpass', f: 650 } });
    K.tone({ f: 1250 * p, f2: 300 * p, a: 0.002, d: 0.13, v: 0.06 });
    return 0.32;
  } };

  SFX.grapple_fire = { gain: 6.5, send: 0.1, max: 2, gap: 0.08, fn(K) {
    const p = K.p;
    K.noise({ a: 0.0008, d: 0.02, v: 0.6, filter: { type: 'bandpass', f: 2000 * p, Q: 3 } });
    K.tone({ type: 'square', f: 300 * p, f2: 1400 * p, glide: 0.2, a: 0.005, d: 0.22, v: 0.06, filter: { type: 'lowpass', f: 2600 } });
    for (let i = 1; i <= 8; i++) {
      K.noise({ at: i * 0.028 + R(-0.004, 0.004), a: 0.0005, d: 0.016, v: 0.26 * (1 - i / 10), filter: { type: 'bandpass', f: R(2500, 4500) * p, Q: 4 } });
      K.tone({ at: i * 0.028, f: R(3000, 4500) * p, a: 0.0005, d: 0.03, v: 0.035 * (1 - i / 10) });
    }
    return 0.35;
  } };

  SFX.grapple_attach = { gain: 3, send: 0.2, max: 2, gap: 0.08, fn(K) {
    const p = K.p;
    K.metal(0, 520 * p, [1, 1.73, 2.94, 4.21], 0.36, 0.18);
    K.noise({ a: 0.0008, d: 0.04, v: 0.6, filter: { type: 'bandpass', f: 1600, Q: 1 } });
    K.tone({ type: 'sawtooth', f: 150 * p, f2: 138 * p, a: 0.002, d: 0.32, v: 0.13, filter: { type: 'lowpass', f: 1300, f2: 300 } });
    K.tone({ f: 210 * p, f2: 80 * p, a: 0.001, d: 0.06, v: 0.32 });
    return 0.45;
  } };

  SFX.break_wall = { send: 0.35, max: 2, gap: 0.15, fn(K) {
    const p = K.p;
    K.tone({ f: 72 * p, f2: 28 * p, a: 0.004, d: 0.7, v: 0.85 });
    K.noise({ a: 0.0008, d: 0.08, v: 0.6, filter: { type: 'lowpass', f: 4200 } });
    K.noise({ buf: 'brown', a: 0.02, d: 1.2, v: 0.75, filter: { type: 'lowpass', f: 950, f2: 180 } });
    for (let i = 0; i < 22; i++) {
      const at = 0.05 + Math.pow(i / 22, 1.4) * 1.15 + R(-0.02, 0.02);
      const v = 0.42 * (1 - i / 26) * R(0.4, 1);
      K.noise({ at, a: 0.0006, d: R(0.02, 0.07), v, filter: { type: 'bandpass', f: R(700, 3500) * p, Q: R(2, 5) } });
      if (i % 3 === 0) { const f = R(260, 620) * p; K.tone({ at, f, f2: f * 0.6, a: 0.0008, d: 0.06, v: v * 0.4 }); }
    }
    return 1.6;
  } };

  SFX.pickup = { gain: 1.7, send: 0.35, max: 4, gap: 0.03, fn(K, o, E) {
    // fragmentos coletados em sequência sobem pela pentatônica de mi menor
    const now = K.t, ch = E.chain;
    ch.n = now - ch.t < 0.7 ? Math.min(ch.n + 1, 7) : 0; ch.t = now;
    const PENT = [76, 79, 81, 83, 86, 88, 91, 93];
    const f = mtof(PENT[ch.n]) * K.p;
    K.tone({ f, a: 0.002, d: 0.32, v: 0.17 });
    K.tone({ f: f * 2, type: 'triangle', a: 0.002, d: 0.12, v: 0.04 });
    K.tone({ at: 0.06, f: f * 1.5, a: 0.002, d: 0.42, v: 0.12 });
    K.noise({ a: 0.0008, d: 0.12, v: 0.06, filter: { type: 'highpass', f: 7000 } });
    return 0.55;
  } };

  SFX.heart_up = { gain: 1.8, send: 0.4, max: 1, gap: 0.3, fn(K) {
    const p = K.p;
    ['D5', 'F#5', 'A5', 'D6'].forEach((n, i) => {
      const f = mtof(N(n)) * p;
      K.tone({ at: i * 0.075, type: 'triangle', f, a: 0.003, d: 0.6, v: 0.14 });
      K.tone({ at: i * 0.075, f: f * 2, a: 0.003, d: 0.3, v: 0.04 });
    });
    ['D4', 'A4', 'F#5'].forEach((n) => K.tone({ at: 0.28, f: mtof(N(n)) * p, a: 0.15, d: 1.0, v: 0.05, lin: true }));
    return 1.5;
  } };

  SFX.relic = { send: 0.5, max: 1, gap: 1, fn(K, o, E) {
    // fanfarra mística: Dm -> Bb -> C -> D (terça de picardia), metais escuros + órgão + sinos
    const p = K.p;
    const chords = [['D3 A3 D4 F4', 0, 0.3], ['Bb2 F3 Bb3 D4', 0.32, 0.3], ['C3 G3 C4 E4', 0.64, 0.3], ['D3 A3 D4 F#4 A4', 1.0, 1.5]];
    chords.forEach((c) => {
      const notes = P(c[0]), at = c[1], dur = c[2];
      notes.forEach((m) => {
        const t = K.t + at, f = mtof(m) * p;
        const env = susEnv(E, t, dur, 0.04, at > 0.9 ? 1.2 : 0.18, 0.05);
        const lp = E.bq('lowpass', 500, 1.5);
        lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(2600, t + 0.12);
        lp.frequency.exponentialRampToValueAtTime(900, t + dur + 0.3);
        oscs(E, lp, t, t + dur + 1.3, f, 'reed', [-6, 6]);
        lp.connect(env); env.connect(K.dest);
        const org = susEnv(E, t, dur, 0.05, at > 0.9 ? 1.4 : 0.2, 0.035);
        oscs(E, org, t, t + dur + 1.5, f * 2, 'organ', [0]);
        org.connect(K.dest);
      });
      K.bell(at, mtof(notes[notes.length - 1] + 12) * p, 0.1, 2.5);
    });
    K.tone({ f: 73.4 * p, f2: 65 * p, a: 0.003, d: 0.8, v: 0.45 });
    K.tone({ at: 1.0, f: 73.4 * p, f2: 64 * p, a: 0.003, d: 1.1, v: 0.55 });
    P('D6 F#6 A6 D7 A6 F#6 D6 F#6 A6 D7 F#7 A7').forEach((m, i) => K.tone({ at: 1.0 + i * 0.09, f: mtof(m) * p, a: 0.003, d: 0.4, v: 0.035 }));
    return 3.2;
  } };

  SFX.save = { send: 0.6, max: 1, gap: 1, fn(K, o, E) {
    const p = K.p;
    K.bell(0, 440 * p, 0.3, 3.6);
    P('A2 A3 E4 A4 C#5').forEach((m, i) => {
      const env = susEnv(E, K.t + 0.05, 1.5, 0.45, 1.3, i === 0 ? 0.05 : 0.04);
      oscs(E, env, K.t + 0.05, K.t + 3.4, mtof(m) * p, 'organ', [-4, 4]);
      env.connect(K.dest);
    });
    ['E6', 'A6'].forEach((n, i) => K.tone({ at: 0.35 + i * 0.2, f: mtof(N(n)) * p, a: 0.5, d: 1.6, v: 0.025, lin: true }));
    return 4.0;
  } };

  SFX.door = { gain: 1.5, send: 0.3, max: 1, gap: 0.2, fn(K) {
    const p = K.p;
    K.noise({ buf: 'pink', a: 0.08, d: 0.36, v: 0.3, filter: { type: 'lowpass', f: 900 * p, f2: 280 * p } });
    K.metal(0.02, 180 * p, [1, 2.4, 3.9], 0.32, 0.15);
    K.tone({ at: 0.02, f: 110 * p, f2: 58 * p, a: 0.001, d: 0.16, v: 0.4 });
    K.noise({ at: 0.02, a: 0.0008, d: 0.03, v: 0.3, filter: { type: 'bandpass', f: 1200, Q: 2 } });
    return 0.6;
  } };

  SFX.potion = { gain: 1.3, send: 0.4, max: 1, gap: 0.3, fn(K) {
    const p = K.p;
    for (let i = 0; i < 3; i++) {
      const at = i * 0.16;
      K.tone({ at, f: 250 * p * (1 - i * 0.05), f2: 520 * p, glide: 0.05, a: 0.005, d: 0.07, v: 0.28, filter: { type: 'lowpass', f: 1400 } });
      K.noise({ at, buf: 'brown', a: 0.004, d: 0.05, v: 0.2, filter: { type: 'lowpass', f: 450 } });
    }
    P('E6 G#6 B6 E7').forEach((m, i) => K.tone({ at: 0.45 + i * 0.05, f: mtof(m) * p, a: 0.003, d: 0.42, v: 0.07 }));
    K.noise({ at: 0.45, a: 0.05, d: 0.5, v: 0.05, filter: { type: 'highpass', f: 6000 } });
    return 1.2;
  } };

  SFX.book = { gain: 2.2, send: 0.3, max: 1, gap: 0.15, fn(K) {
    const p = K.p;
    K.noise({ a: 0.04, d: 0.18, v: 0.3, filter: { type: 'bandpass', f: 2500 * p, f2: 4500 * p, Q: 0.8 } });
    for (let i = 0; i < 5; i++) K.noise({ at: R(0.02, 0.2), a: 0.0004, d: 0.006, v: 0.12, filter: { type: 'highpass', f: 4000 } });
    K.tone({ at: 0.12, f: 1568 * p, a: 0.004, d: 0.5, v: 0.04 });
    K.tone({ at: 0.16, f: 2093 * p, a: 0.004, d: 0.5, v: 0.03 });
    return 0.7;
  } };

  SFX.menu_move = { gain: 14, send: 0.05, max: 2, gap: 0.025, fn(K) {
    K.tone({ type: 'triangle', f: 1320 * K.p, a: 0.001, d: 0.045, v: 0.13 });
    K.noise({ a: 0.0005, d: 0.01, v: 0.05, filter: { type: 'highpass', f: 6000 } });
    return 0.08;
  } };

  SFX.menu_select = { gain: 1.6, send: 0.2, max: 2, gap: 0.05, fn(K) {
    const p = K.p;
    K.tone({ type: 'triangle', f: 880 * p, a: 0.002, d: 0.18, v: 0.14 });
    K.tone({ at: 0.07, type: 'triangle', f: 1318.5 * p, a: 0.002, d: 0.24, v: 0.14 });
    K.tone({ at: 0.07, f: 2637 * p, a: 0.002, d: 0.3, v: 0.04 });
    return 0.45;
  } };

  SFX.menu_back = { gain: 2.2, send: 0.1, max: 2, gap: 0.05, fn(K) {
    const p = K.p;
    K.tone({ type: 'triangle', f: 784 * p, a: 0.002, d: 0.12, v: 0.11, filter: { type: 'lowpass', f: 2500 } });
    K.tone({ at: 0.06, type: 'triangle', f: 523 * p, a: 0.002, d: 0.18, v: 0.11, filter: { type: 'lowpass', f: 2000 } });
    return 0.3;
  } };

  SFX.death = { send: 0.55, max: 1, gap: 1, fn(K, o, E) {
    const p = K.p;
    K.tone({ f: 90 * p, f2: 30 * p, a: 0.002, d: 0.8, v: 0.7 });
    K.noise({ buf: 'brown', a: 0.002, d: 0.6, v: 0.5, filter: { type: 'lowpass', f: 600 } });
    // cluster dissonante de órgão afundando
    P('D3 D4 Eb4 A3').forEach((m) => {
      const t = K.t + 0.05;
      const env = susEnv(E, t, 1.3, 0.05, 1.4, 0.045);
      const o1 = E.ctx.createOscillator(); o1.setPeriodicWave(E.waves.organ);
      o1.frequency.setValueAtTime(mtof(m) * p, t); o1.frequency.exponentialRampToValueAtTime(mtof(m) * p * 0.5, t + 2.6);
      o1.connect(env); env.connect(K.dest); o1.start(t); o1.stop(t + 2.8);
    });
    K.bell(0.25, mtof(N('D3')) * p, 0.32, 4.0);
    K.noise({ buf: 'pink', a: 0.4, d: 1.5, v: 0.18, filter: { type: 'bandpass', f: 2000 * p, f2: 200 * p, Q: 1 } });
    return 3.6;
  } };

  SFX.hurt = { gain: 9, send: 0.12, max: 2, gap: 0.12, fn(K) {
    const p = K.p;
    K.noise({ a: 0.0008, d: 0.06, v: 0.55, filter: { type: 'bandpass', f: 1400 * p, Q: 0.8 } });
    K.tone({ type: 'square', f: 520 * p, f2: 160 * p, a: 0.002, d: 0.18, v: 0.13, drive: true, filter: { type: 'lowpass', f: 2000 } });
    K.tone({ f: 1900 * p, f2: 1500 * p, a: 0.001, d: 0.12, v: 0.05 });
    return 0.35;
  } };

  SFX.respawn = { gain: 1.5, send: 0.5, max: 1, gap: 0.5, fn(K) {
    const p = K.p;
    K.noise({ buf: 'pink', a: 1.0, d: 0.25, v: 0.25, lin: true, filter: { type: 'bandpass', f: 300 * p, f2: 4000 * p, glide: 1.0, Q: 1 } });
    P('D4 A4 D5 F#5 A5 D6').forEach((m, i) => {
      K.tone({ at: 0.2 + i * 0.12, f: mtof(m) * p, a: 0.004, d: 0.5, v: 0.09 });
      K.tone({ at: 0.2 + i * 0.12, type: 'triangle', f: mtof(m) * p, a: 0.004, d: 0.25, v: 0.04 });
    });
    P('D5 F#5 A5').forEach((m) => K.tone({ at: 1.0, f: mtof(m) * p, a: 0.02, d: 1.0, v: 0.055 }));
    return 2.2;
  } };

  // --- clima (barramento ambiente) ---
  SFX.thunder = { bus: 'ambient', send: 0.3, max: 2, gap: 0.4, fn(K) {
    const p = K.p;
    K.noise({ a: 0.0008, d: 0.16, v: 0.6, filter: { type: 'highpass', f: 1500 } });
    for (let i = 0; i < 5; i++) K.noise({ at: R(0.01, 0.3), a: 0.001, d: R(0.03, 0.09), v: R(0.15, 0.4), filter: { type: 'bandpass', f: R(800, 3000), Q: 1 } });
    K.tone({ f: 52 * p, f2: 30 * p, a: 0.01, d: 1.3, v: 0.55 });
    K.noise({ buf: 'brown', a: 0.04, d: 4.5, v: 0.9, filter: { type: 'lowpass', f: 320 * p, f2: 90 } });
    [0.35, 0.9, 1.7].forEach((at) => K.noise({ at: at + R(0, 0.2), buf: 'brown', a: R(0.15, 0.4), d: R(1.5, 2.5), v: R(0.4, 0.7), filter: { type: 'lowpass', f: R(150, 260) * p } }));
    return 5.5;
  } };

  SFX.thunder_far = { bus: 'ambient', send: 0.4, max: 1, gap: 3, fn(K) {
    const p = K.p;
    K.noise({ buf: 'brown', a: 0.6, d: 3.8, v: 0.5, filter: { type: 'lowpass', f: 170 * p, f2: 80 } });
    K.noise({ at: R(0.5, 1.2), buf: 'brown', a: 0.4, d: 2.2, v: 0.35, filter: { type: 'lowpass', f: 130 * p } });
    return 5.0;
  } };

  SFX.drop_plink = { bus: 'ambient', send: 0.5, max: 3, gap: 0.05, fn(K) {
    const f = R(1800, 3600) * K.p;
    K.tone({ f, f2: f * 1.4, glide: 0.02, a: 0.0006, d: 0.06, v: 0.05 });
    return 0.1;
  } };

  const SOUND_NAMES = ['jump', 'double_jump', 'land', 'step', 'whip', 'whip_hit', 'dash', 'grapple_fire',
    'grapple_attach', 'break_wall', 'pickup', 'heart_up', 'relic', 'save', 'door', 'potion', 'book',
    'menu_move', 'menu_select', 'menu_back', 'death', 'hurt', 'respawn'];

  // ===================================================================== ambientes
  const AMBIENTS = {
    rain: {
      create(E) {
        const ctx = E.ctx, b = E.bus.ambient;
        const out = E.g(0), send = E.g(0.12);
        out.connect(b.in); out.connect(send); send.connect(b.verbIn);
        const srcs = [];
        const loop = (buf, rate) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate || 1; srcs.push(s); return s; };
        // lavagem (chuva caindo)
        const wash = loop(E.buf.pinkSt), whp = E.bq('highpass', 450, 0.6), wlp = E.bq('lowpass', 6000, 0.5), wg = E.g(0.32);
        wash.connect(whp); whp.connect(wlp); wlp.connect(wg); wg.connect(out);
        // corpo grave distante (telhados, cidade)
        const body = loop(E.buf.brownSt), blp = E.bq('lowpass', 650, 0.5), bhp = E.bq('highpass', 35, 0.7), bg = E.g(0.5);
        body.connect(bhp); bhp.connect(blp); blp.connect(bg); bg.connect(out);
        // respingos (textura de grãos)
        const pat = loop(E.buf.patter, 0.97), php = E.bq('highpass', 1300, 0.5), pg = E.g(0.42);
        pat.connect(php); php.connect(pg); pg.connect(out);
        const t0 = ctx.currentTime;
        srcs.forEach((s) => s.start(t0, Math.random() * 2));
        const L = {
          level: 0, nextPlink: t0 + 0.5, nextThunder: t0 + R(20, 50),
          set(v) {
            const now = ctx.currentTime;
            L.level = v;
            out.gain.setTargetAtTime(v * 0.55, now, 0.4);
            wlp.frequency.setTargetAtTime(2500 + v * 5000, now, 0.4);
            pg.gain.setTargetAtTime(0.18 + v * 0.3, now, 0.4);
          },
          pump(until) {
            if (L.level <= 0.01) { L.nextPlink = Math.max(L.nextPlink, until); return; }
            while (L.nextPlink < until) {
              if (L.nextPlink > ctx.currentTime - 0.05) {
                E.playAt('drop_plink', { volume: L.level * R(0.4, 1), pan: R(-0.8, 0.8) }, Math.max(L.nextPlink, ctx.currentTime));
              }
              L.nextPlink += R(0.25, 1.2) / (0.4 + L.level);
            }
            if (until > L.nextThunder) {
              if (L.level > 0.25) E.play('thunder_far', { volume: L.level * R(0.6, 1), pan: R(-0.6, 0.6), pitch: R(0.85, 1.15) });
              L.nextThunder = until + R(25, 70);
            }
          },
          dispose() { srcs.forEach((s) => { try { s.stop(); } catch (e) { /* */ } }); out.disconnect(); }
        };
        return L;
      }
    },
    steam: {
      create(E) {
        const ctx = E.ctx, b = E.bus.ambient;
        const out = E.g(0), send = E.g(0.1);
        out.connect(b.in); out.connect(send); send.connect(b.verbIn);
        const hiss = ctx.createBufferSource(); hiss.buffer = E.buf.pinkSt; hiss.loop = true;
        const bp = E.bq('bandpass', 3800, 0.5), hp = E.bq('highpass', 1200, 0.7), hg = E.g(1.3), am = E.g(0.7);
        hiss.connect(bp); bp.connect(hp); hp.connect(hg); hg.connect(am); am.connect(out);
        // "baforadas": duas LFOs lentas modulando a amplitude
        const l1 = ctx.createOscillator(), l2 = ctx.createOscillator(), d1 = E.g(0.2), d2 = E.g(0.12);
        l1.frequency.value = 0.23; l2.frequency.value = 0.37;
        l1.connect(d1); l2.connect(d2); d1.connect(am.gain); d2.connect(am.gain);
        const rum = ctx.createBufferSource(); rum.buffer = E.buf.brownSt; rum.loop = true;
        const rlp = E.bq('lowpass', 180, 0.7), rg = E.g(0.45);
        rum.connect(rlp); rlp.connect(rg); rg.connect(out);
        const t0 = ctx.currentTime;
        [hiss, rum].forEach((s) => s.start(t0, Math.random() * 2)); l1.start(t0); l2.start(t0);
        const L = {
          level: 0,
          set(v) { L.level = v; out.gain.setTargetAtTime(v * 0.4, ctx.currentTime, 0.3); },
          pump() {},
          dispose() { [hiss, rum, l1, l2].forEach((s) => { try { s.stop(); } catch (e) { /* */ } }); out.disconnect(); }
        };
        return L;
      }
    }
  };

  // ===================================================================== música
  function channel(E, T, o) {
    const g = E.g(o.level == null ? 1 : o.level);
    g.connect(T.mix);
    if (o.send) { const s = E.g(o.send); g.connect(s); s.connect(T.wetMix); }
    let inp = g;
    if (o.lp) { const f = E.bq('lowpass', o.lp, o.Q == null ? 0.6 : o.Q); f.connect(inp); inp = f; }
    if (o.hp) { const f = E.bq('highpass', o.hp, 0.6); f.connect(inp); inp = f; }
    if (o.delay) {
      const d = E.ctx.createDelay(2), fb = E.g(o.delay.fb), dlp = E.bq('lowpass', o.delay.lp || 2400, 0.5), wet = E.g(o.delay.wet || 0.35);
      d.delayTime.value = o.delay.time;
      const head = E.g(1);
      head.connect(inp); head.connect(d); d.connect(dlp); dlp.connect(fb); fb.connect(d); dlp.connect(wet); wet.connect(inp);
      T.disposables.push(fb, d);
      inp = head;
    }
    return inp;
  }
  function lfo(E, T, freq, depth, type) {
    const o = E.ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const d = E.g(depth); o.connect(d); o.start(E.ctx.currentTime);
    T.lfos.push(o);
    return d;
  }
  const VOWELS = { ah: [700, 1150, 2700, 3400], oh: [450, 800, 2830, 3500], oo: [330, 720, 2550, 3450], eh: [530, 1700, 2500, 3500] };
  function makeChoir(E, T, o) {
    const out = channel(E, T, o);
    const inp = E.g(1);
    const F = [[6, 1.0], [8, 0.6], [10, 0.28], [12, 0.12]];
    T.formants = F.map((x, i) => {
      const bp = E.bq('bandpass', VOWELS.ah[i], x[0]), g = E.g(x[1] * 2.2);
      inp.connect(bp); bp.connect(g); g.connect(out);
      return bp;
    });
    const lp = E.bq('lowpass', 450, 0.7), lg = E.g(0.18);
    inp.connect(lp); lp.connect(lg); lg.connect(out);
    T.choirIn = inp;
    return inp;
  }
  function vowel(T, t, name, tc) {
    if (!T.formants) return;
    const v = VOWELS[name];
    T.formants.forEach((bp, i) => bp.frequency.setTargetAtTime(v[i], t, tc || 0.4));
  }
  function notesAt(list, s) {
    const out = [];
    for (const n of list) if (Math.round(n[0] * 4) === s) out.push(n);
    return out;
  }
  /** variação: com prob. divide notas longas em nota + bordadura superior */
  function ornament(rng, list, set, prob) {
    const out = [];
    for (const n of list) {
      if (n[2] >= 2 && rng() < prob) {
        out.push([n[0], n[1], n[2] - 0.5]);
        out.push([n[0] + n[2] - 0.5, scaleStep(n[1], set, rng() < 0.6 ? 1 : -1), 0.5]);
      } else out.push(n);
    }
    return out;
  }

  // --------------------------------------------------------------- TITLE (Ré menor, 64 bpm)
  const TITLE_CH = [
    ['D2', 'A3 D4 F4'], ['Bb1', 'Bb3 D4 F4'], ['G1', 'Bb3 D4 G4'], ['A1', 'A3 C#4 E4'],
    ['D2', 'A3 D4 F4'], ['F2', 'A3 C4 F4'], ['G2', 'G3 Bb3 D4'], ['A1', 'G3 C#4 E4'],
    ['Bb1', 'Bb3 D4 F4'], ['F2', 'A3 C4 F4'], ['C2', 'G3 C4 E4'], ['D2', 'A3 D4 F4'],
    ['G1', 'G3 Bb3 D4'], ['A1', 'A3 D4 F4'], ['E2', 'G3 Bb3 E4'], ['A1', 'A3 C#4 E4'],
    ['D2', 'A3 D4 F4'], ['Bb1', 'Bb3 D4 F4'], ['G1', 'Bb3 D4 G4'], ['A1', 'A3 C#4 E4'],
    ['D2', 'A3 D4 F4'], ['F2', 'A3 C4 F4'], ['G2', 'G3 Bb3 D4'], ['A1', 'G3 C#4 E4'],
    ['G1', 'G3 Bb3 D4'], ['D2', 'A3 D4 F4'], ['Bb1', 'Bb3 D4 F4'], ['F2', 'A3 C4 F4'],
    ['G1', 'G3 Bb3 D4'], ['A1', 'A3 C#4 E4'], ['D2', 'A3 D4 F4'], ['D2', 'A3 D4 F4']
  ].map((c) => [N(c[0]), P(c[1])]);
  const TMEL_A = ['D5:2 C5:1 A4:1', 'Bb4:3 A4:1', 'G4:2 Bb4:1 D5:1', 'C#5:4', 'F5:2 E5:1 D5:1', 'C5:2 A4:2', 'Bb4:1 A4:1 G4:1 Bb4:1', 'A4:4'];
  const TMEL_B = ['D5:3 F5:1', 'F5:2 C5:2', 'E5:3 D5:1', 'D5:2 A4:2', 'Bb4:2 D5:1 G5:1', 'F5:3 E5:1', 'E5:2 Bb4:2', 'C#5:4'];
  const TMEL_C = ['G5:2 F5:1 D5:1', 'F5:3 E5:1', 'D5:2 F5:2', 'C5:4', 'Bb4:2 D5:2', 'E5:2 C#5:2', 'D5:4', 'r:4'];
  const TITLE_MEL = [TMEL_A, TMEL_B, TMEL_A, TMEL_C].map((sec) => sec.map(seq));
  const D_HARM = [2, 4, 5, 7, 9, 10, 1];

  const TRACKS = {};
  TRACKS.title = {
    bpm: 64, bars: 32, level: 1,
    setup(E, T) {
      T.vib = lfo(E, T, 5.1, 9);
      T.ch = {
        organ: channel(E, T, { level: 1, send: 0.55, lp: 2800 }),
        pedal: channel(E, T, { level: 1, send: 0.2 }),
        flute: channel(E, T, { level: 1, send: 0.6 }),
        bell: channel(E, T, { level: 1, send: 0.8 })
      };
      makeChoir(E, T, { level: 1, send: 0.75 });
    },
    step(E, T, i, t, sd) {
      const s = i % 16, ba = Math.floor(i / 16), bar = ba % 32, pass = Math.floor(ba / 32), sec = bar >> 3, B = sd * 4;
      if (T.pass !== pass) {
        T.pass = pass;
        T.rng = seeded(1009 + pass * 7919);
        T.arp = [false, T.rng() < 0.5, true, T.rng() < 0.4];
        T.mel = TITLE_MEL.map((secm, k) => secm.map((m) => (pass > 0 && k !== 0 ? ornament(T.rng, m, D_HARM, 0.3) : m)));
      }
      const ch = TITLE_CH[bar], barDur = 16 * sd;
      if (s === 0) {
        const ov = [0.034, 0.04, 0.04, 0.05][sec] * (bar === 31 ? 0.6 : 1);
        ch[1].forEach((m) => INS.organ(E, T.ch.organ, t, m, barDur - 0.06, ov));
        INS.organ(E, T.ch.pedal, t, ch[0] + 12, barDur - 0.06, ov * 0.9);
        INS.sub(E, T.ch.pedal, t, ch[0], barDur - 0.1, 0.13);
        if (bar % 8 === 0) bell(E, T.ch.bell, t, mtof(N('D3')), pass === 0 && bar === 0 ? 0.24 : 0.18, 6);
        if (sec >= 2) {
          vowel(T, t, sec === 2 ? 'oo' : 'oh');
          ch[1].forEach((m) => INS.choir(E, T, t + 0.02, m, barDur - 0.1, 0.012));
        } else vowel(T, t, sec === 1 ? 'ah' : 'oo');
        if (sec === 2 && bar % 2 === 0) bell(E, T.ch.bell, t + B * 2, mtof(ch[1][2] + 24), 0.05, 2.5);
      }
      // melodia
      const mel = notesAt(T.mel[sec][bar & 7], s);
      for (const n of mel) {
        const dur = n[2] * B * 0.97;
        if (sec === 0) {
          if (pass % 2 === 0) INS.flute(E, T, T.ch.flute, t, n[1], dur, 0.06);
          else INS.choir(E, T, t, n[1], dur, 0.03);
        } else {
          INS.choir(E, T, t, n[1], dur, sec === 3 ? 0.034 : 0.03);
          if (sec === 2) INS.flute(E, T, T.ch.flute, t, n[1] + 12, dur, 0.022);
          if (sec === 3) INS.organ(E, T.ch.organ, t, n[1], dur, 0.022);
        }
      }
      // arpejo de flauta (procedural)
      if (T.arp[sec] && s % 2 === 0 && bar !== 31) {
        const k = (s / 2) % 4, idx = [0, 1, 2, 1][k];
        INS.flute(E, T, T.ch.flute, t, ch[1][idx] + 12, sd * 1.8, 0.016);
      }
    }
  };

  // --------------------------------------------------------------- EXTERIOR (Dó menor, 88 bpm)
  const EXT_CHORDS = {
    Cm: ['C2', 'C4 Eb4 G4'], Ab: ['Ab1', 'C4 Eb4 Ab4'], Fm: ['F1', 'C4 F4 Ab4'], G: ['G1', 'B3 D4 G4'],
    Bb: ['Bb1', 'Bb3 D4 F4'], Eb: ['Eb2', 'Bb3 Eb4 G4']
  };
  Object.keys(EXT_CHORDS).forEach((k) => { const c = EXT_CHORDS[k]; EXT_CHORDS[k] = [N(c[0]), P(c[1])]; });
  const EXT_MAIN = ['Cm', 'Cm', 'Ab', 'Ab', 'Fm', 'Fm', 'G', 'G'];
  const EXT_BRIDGE = ['Ab', 'Bb', 'Eb', 'Cm', 'Fm', 'Ab', 'G', 'G'];
  const EXT_SEQ = EXT_MAIN.concat(EXT_MAIN, EXT_BRIDGE, EXT_MAIN);
  const EXT_THEME = ['G4:1.5 Ab4:0.5 G4:1 Eb4:1', 'F4:1 Eb4:1 D4:1 C4:1', 'C5:2 Bb4:1 Ab4:1', 'G4:3 r:1',
    'Ab4:1.5 G4:0.5 F4:1 C5:1', 'Ab4:2 F4:2', 'G4:1 B4:1 D5:1 F5:1', 'Eb5:1 D5:3'].map(seq);
  const C_MIN = [0, 2, 3, 5, 7, 8, 10, 11];
  const BASS_PATTERNS = [
    [0, 0, 12, 0, 7, 0, 12, 7],
    [0, 12, 0, 7, 0, 12, 7, 0],
    [0, 0, 7, 12, 0, 0, 7, 10]
  ];
  TRACKS.exterior = {
    bpm: 88, bars: 32, level: 1,
    setup(E, T) {
      T.vib = lfo(E, T, 5.4, 7);
      const beat = 60 / 88;
      T.ch = {
        pad: channel(E, T, { level: 1, send: 0.5, lp: 1500 }),
        bass: channel(E, T, { level: 1, send: 0.06 }),
        kick: channel(E, T, { level: 1, send: 0.12 }),
        hat: channel(E, T, { level: 1, send: 0.3 }),
        clap: channel(E, T, { level: 1, send: 0.9 }),
        lead: channel(E, T, { level: 1, send: 0.45, lp: 2200, delay: { time: beat * 0.75, fb: 0.32, wet: 0.4, lp: 2200 } }),
        bell: channel(E, T, { level: 1, send: 0.8 })
      };
    },
    step(E, T, i, t, sd) {
      const s = i % 16, ba = Math.floor(i / 16), bar = ba % 32, pass = Math.floor(ba / 32), sec = bar >> 3, B = sd * 4;
      if (T.pass !== pass) {
        T.pass = pass;
        T.rng = seeded(2003 + pass * 7919);
        T.bp = [0, 1, 2, 3].map(() => Math.floor(T.rng() * BASS_PATTERNS.length));
        T.theme = EXT_THEME.map((m) => (pass > 0 ? ornament(T.rng, m, C_MIN, 0.3) : m));
        T.lift = pass % 2 === 1;   // passes ímpares: tema da seção 4 uma oitava abaixo e mais cheio
      }
      const name = EXT_SEQ[bar], ch = EXT_CHORDS[name];
      if (s === 0 && (bar === 0 || EXT_SEQ[bar - 1] !== name)) {
        let len = 1; while (bar + len < 32 && EXT_SEQ[bar + len] === name) len++;
        const inv = T.rng() < 0.3 ? 12 : 0;
        ch[1].forEach((m, k) => INS.strings(E, T.ch.pad, t, m + (k === 0 ? inv : 0), len * 16 * sd - 0.1, 0.022));
        if (sec >= 2) INS.strings(E, T.ch.pad, t, ch[0] + 24, len * 16 * sd - 0.1, 0.016);
      }
      // baixo ostinato (colcheias)
      if ((bar >= 4 || pass > 0) && s % 2 === 0) {
        const pat = BASS_PATTERNS[T.bp[sec]], k = s / 2;
        INS.bass(E, T.ch.bass, t, ch[0] + 12 + pat[k], sd * 1.8, k === 0 ? 0.11 : 0.075);
      }
      // pulso: batida de coração
      const hb = { 0: 0.32, 3: 0.18, 8: 0.27, 11: 0.15 };
      if (hb[s] != null && !(bar === 0 && pass === 0 && s < 8)) INS.kick(E, T.ch.kick, t, hb[s] * (sec === 3 ? 1.1 : 1));
      if (sec === 3 && s === 14) INS.kick(E, T.ch.kick, t, 0.16);
      if (sec >= 1 && s % 4 === 2) INS.hat(E, T.ch.hat, t, 0.05 * (0.7 + T.rng() * 0.6));
      if (sec === 3 && s % 2 === 1) INS.hat(E, T.ch.hat, t, 0.018);
      if (sec === 3 && (s === 4 || s === 12)) INS.clap(E, T.ch.clap, t, 0.1);
      // tema
      if (sec === 1 || sec === 3) {
        const oct = sec === 3 && !T.lift ? 12 : 0;
        for (const n of notesAt(T.theme[bar & 7], s)) {
          INS.lead(E, T, T.ch.lead, t, n[1] + oct, n[2] * B * 0.92, sec === 3 ? 0.045 : 0.05);
          if (sec === 3) bell(E, T.ch.bell, t, mtof(n[1] + oct + 12), 0.025, 1.4);
        }
      }
      // contracanto de sinos na ponte
      if (sec === 2 && (s === 0 || s === 8) && T.rng() < 0.8) {
        bell(E, T.ch.bell, t, mtof(choose(T.rng, ch[1]) + 24), 0.045, 2.2);
      }
    }
  };

  // --------------------------------------------------------------- INTERIOR (Lá menor, 72 bpm)
  const INT_CHORDS = {
    Am: ['A1', 'A3 C4 E4'], F: ['F1', 'A3 C4 F4'], Dm: ['D2', 'A3 D4 F4'], E: ['E1', 'G#3 B3 E4'],
    C: ['C2', 'G3 C4 E4'], G: ['G1', 'G3 B3 D4']
  };
  Object.keys(INT_CHORDS).forEach((k) => { const c = INT_CHORDS[k]; INT_CHORDS[k] = [N(c[0]), P(c[1])]; });
  const INT_SEQ = ['Am', 'F', 'Dm', 'E', 'Am', 'C', 'Dm', 'E', 'F', 'C', 'Dm', 'Am', 'F', 'G', 'E', 'E'];
  const A_PENT = P('A4 C5 D5 E5 G5 A5 C6 D6 E6');
  TRACKS.interior = {
    bpm: 72, bars: 32, level: 1,
    setup(E, T) {
      T.ch = {
        drone: channel(E, T, { level: 1, send: 0.3, lp: 380 }),
        pad: channel(E, T, { level: 1, send: 0.7, lp: 750 }),
        metal: channel(E, T, { level: 1, send: 1.4, lp: 2400 }),
        drip: channel(E, T, { level: 1, send: 1.0 }),
        glass: channel(E, T, { level: 1, send: 0.9 }),
        low: channel(E, T, { level: 1, send: 0.5 })
      };
      T.gi = 3;
    },
    step(E, T, i, t, sd) {
      const s = i % 16, ba = Math.floor(i / 16), bar = ba % 32, pass = Math.floor(ba / 32), sec = bar >> 3;
      if (T.pass !== pass) { T.pass = pass; T.rng = seeded(3001 + pass * 7919); }
      const rng = T.rng, ch = INT_CHORDS[INT_SEQ[bar >> 1]], barDur = 16 * sd;
      if (s === 0 && bar % 2 === 0) {
        INS.strings(E, T.ch.drone, t, ch[0] + 12, barDur * 2 - 0.2, 0.05, 1.2, 1.6);
        INS.sub(E, T.ch.drone, t, ch[0] + 12, barDur * 2 - 0.2, 0.09);
        if (sec >= 1 || pass > 0) ch[1].forEach((m) => INS.strings(E, T.ch.pad, t, m, barDur * 2 - 0.3, 0.017, 1.5, 2));
      }
      // percussão metálica distante
      const mp = { 0: 0.45, 5: 0.18, 10: 0.32, 13: 0.14 };
      if (mp[s] != null && rng() < mp[s] * (sec === 3 ? 1.3 : 1)) {
        INS.metalHit(E, T.ch.metal, t + R(-0.01, 0.01), choose(rng, [196, 233, 277, 330, 415]), R(0.035, 0.07));
      }
      // gotejamento
      if (rng() < (sec % 2 ? 0.075 : 0.05)) INS.drip(E, T.ch.drip, t + rng() * sd, R(1100, 2600), R(0.04, 0.09));
      // motivo de vidro / caixinha de música (passeio aleatório na pentatônica)
      const gp = [0.07, 0.14, 0.1, 0.18][sec];
      if (s % 2 === 0 && rng() < gp) {
        T.gi = clamp(T.gi + (rng() < 0.5 ? -1 : 1) * (rng() < 0.3 ? 2 : 1), 0, A_PENT.length - 1);
        INS.glass(E, T.ch.glass, t, A_PENT[T.gi], 0.05);
      }
      // gemido de cano
      if (s === 0 && bar % 8 === 4 && rng() < 0.6) INS.groan(E, T.ch.low, t, choose(rng, [55, 49, 61.7]), 0.1);
      // pulsação surda nas seções finais
      if ((sec >= 2) && s === 0 && bar % 2 === 0) tone(E, T.ch.low, t, { f: 72, f2: 44, glide: 0.2, a: 0.003, d: 0.45, v: 0.16 });
    }
  };

  // --------------------------------------------------------------- TOWER (Mi frígio, 100 bpm, tensão crescente)
  const TW_CHORDS = {
    Em: ['E2', 'E3 B3 E4 G4'], F: ['F2', 'F3 C4 F4 A4'], G: ['G2', 'G3 D4 G4 B4'], 'F#dim': ['F#2', 'F#3 C4 F#4 A4'],
    'G#dim': ['G#2', 'G#3 D4 F4 B4'], Am: ['A2', 'A3 E4 A4 C5'], Bb: ['Bb2', 'Bb3 F4 Bb4 D5'], B: ['B1', 'B3 F#4 B4 D#5'],
    C: ['C2', 'C4 G4 C5 E5'], B7: ['B1', 'B3 F#4 A4 D#5']
  };
  Object.keys(TW_CHORDS).forEach((k) => { const c = TW_CHORDS[k]; TW_CHORDS[k] = [N(c[0]), P(c[1])]; });
  const TW_SEQ = ['Em', 'F', 'Em', 'F', 'Em', 'F', 'G', 'F', 'Em', 'F', 'Em', 'F', 'Em', 'F', 'G', 'F',
    'Em', 'F', 'F#dim', 'G', 'G#dim', 'Am', 'Bb', 'B', 'B', 'C', 'B', 'C', 'B', 'C', 'B7', 'B7'];
  const TW_BELL = [['E5', 'B4'], ['F5', 'C5'], ['G5', 'E5'], ['A5', 'F5'], ['B5', 'G5'], ['C6', 'A5'], ['D6', 'B5'], ['C6', 'A5']].map((x) => x.map(N));
  const E_PHRYG = [4, 5, 7, 9, 11, 0, 2];
  TRACKS.tower = {
    bpm: 100, bars: 32, level: 1,
    setup(E, T) {
      T.vib = lfo(E, T, 4.8, 10);
      const trem = E.g(0.6), tl = lfo(E, T, 100 / 60 * 4, 0.4);   // trêmolo em semicolcheias
      tl.connect(trem.gain);
      const tremOut = channel(E, T, { level: 1, send: 0.5, lp: 2600 });
      trem.connect(tremOut);
      T.ch = {
        bell: channel(E, T, { level: 1, send: 0.85 }),
        tick: channel(E, T, { level: 1, send: 0.5 }),
        drone: channel(E, T, { level: 1, send: 0.2, lp: 300 }),
        pulse: channel(E, T, { level: 1, send: 0.15, lp: 950 }),
        taiko: channel(E, T, { level: 1, send: 0.4 }),
        swell: channel(E, T, { level: 1, send: 0.6 }),
        trem
      };
      makeChoir(E, T, { level: 1, send: 0.7 });
    },
    step(E, T, i, t, sd) {
      const s = i % 16, ba = Math.floor(i / 16), bar = ba % 32, pass = Math.floor(ba / 32), sec = bar >> 3, barDur = 16 * sd;
      if (T.pass !== pass) {
        T.pass = pass;
        T.rng = seeded(4001 + pass * 7919);
        T.bells = TW_BELL.map((pair) => pair.map((m) => (pass > 0 && T.rng() < 0.25 ? scaleStep(m, E_PHRYG, T.rng() < 0.5 ? 1 : -1) : m)));
      }
      const rng = T.rng, ch = TW_CHORDS[TW_SEQ[bar]], inten = [0.7, 0.85, 1.0, 1.15][sec];
      if (s === 0) {
        // sino grave a cada compasso
        bell(E, T.ch.bell, t, mtof(ch[0] + 24), 0.11 * inten * (bar === 0 ? 1.4 : 1), 4.5);
        INS.sub(E, T.ch.drone, t, sec < 3 ? N('E1') + 12 : N('B1'), barDur - 0.05, 0.1);
        if (bar >= 4) {
          vowel(T, t, sec < 2 ? 'oo' : 'ah', 0.8);
          ch[1].slice(0, 3).forEach((m) => INS.choir(E, T, t + 0.02, m, barDur - 0.1, 0.009 * inten));
        }
        if (sec >= 1) ch[1].forEach((m) => INS.strings(E, T.ch.trem, t, m + (sec === 3 ? 12 : 0), barDur - 0.05, 0.016 * inten, 0.1, 0.25));
        if (sec === 3 && bar === 31) INS.swell(E, T.ch.swell, t, barDur, 0.12);
      }
      // relógio
      if (s % 4 === 0) INS.tick(E, T.ch.tick, t, (s / 4) % 2 ? 2400 : 3200, sec < 2 ? 0.08 : 0.05);
      // pulso de cordas graves
      if (sec >= 1) {
        const every = sec === 3 ? 1 : 2;
        if (s % every === 0) {
          const m = ch[0] + 12 + ((s / every) % 4 === 2 ? 7 : 0);
          INS.strings(E, T.ch.pulse, t, m, sd * every * 0.6, (s % 4 === 0 ? 0.05 : 0.032) * inten, 0.005, 0.06);
        }
      }
      // melodia de sinos
      if (sec === 1 && (s === 0 || s === 8)) bell(E, T.ch.bell, t, mtof(T.bells[bar & 7][s ? 1 : 0]), 0.07, 2.4);
      if (sec === 2 && (s === 0 || s === 8)) bell(E, T.ch.bell, t, mtof(ch[1][3] + (s ? 0 : 12)), 0.06, 2.2);
      if (sec === 3 && s % 4 === 0) {
        const top = TW_SEQ[bar] === 'C' ? [N('C6'), N('E6')] : [N('B5'), N('D#6')];
        bell(E, T.ch.bell, t, mtof(top[(s / 4) % 2]), bar >= 30 ? 0.06 : 0.045, 1.8);
      }
      // taikos
      if (sec === 2) {
        const hits = bar < 20 ? [0, 8] : [0, 4, 8, 12];
        if (hits.indexOf(s) >= 0) INS.taiko(E, T.ch.taiko, t, 0.4);
        if (bar === 23 && s % 2 === 0) INS.taiko(E, T.ch.taiko, t, 0.18 + s * 0.02);
      }
      if (sec === 3) {
        if ([0, 6, 8, 12, 14].indexOf(s) >= 0) INS.taiko(E, T.ch.taiko, t, s === 0 ? 0.5 : 0.32);
        else if (rng() < 0.12) INS.taiko(E, T.ch.taiko, t, 0.12);
        if (bar === 31 && s >= 8) INS.taiko(E, T.ch.taiko, t, 0.15 + (s - 8) * 0.04);
      }
    }
  };

  // ===================================================================== engine
  function createEngine(ctx, offline) {
    const E = { ctx, offline: !!offline, voices: {}, all: [], tracks: [], curName: null, amb: {}, chain: { n: 0, t: -9 } };
    E.g = function (v) { const n = ctx.createGain(); n.gain.value = v == null ? 1 : v; return n; };
    E.bq = function (type, f, Q) {
      const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f;
      if (Q != null) n.Q.value = Q;
      return n;
    };
    E.buf = {
      white: makeNoise(ctx, fillWhite, 2, 1),
      pink: makeNoise(ctx, fillPink, 2, 1),
      brown: makeNoise(ctx, fillBrown, 2, 1),
      pinkSt: makeNoise(ctx, fillPink, 4, 2),
      brownSt: makeNoise(ctx, fillBrown, 4, 2),
      patter: makePatter(ctx)
    };
    E.waves = makeWaves(ctx);
    E.curve = makeDrive();

    // master: glue -> limiter -> trim
    E.master = E.g(state.muted ? 0 : busGain('master'));
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -14; glue.knee.value = 10; glue.ratio.value = 2.5; glue.attack.value = 0.01; glue.release.value = 0.2;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    E.trim = E.g(0.7);
    E.analyser = ctx.createAnalyser(); E.analyser.fftSize = 2048;
    E.master.connect(glue); glue.connect(lim); lim.connect(E.trim); E.trim.connect(ctx.destination); E.trim.connect(E.analyser);

    // reverb por convolução
    E.verb = ctx.createConvolver(); E.verb.buffer = makeIR(ctx);
    const vhp = E.bq('highpass', 170, 0.7), vret = E.g(0.8);
    vhp.connect(E.verb); E.verb.connect(vret); vret.connect(E.master);

    E.bus = {};
    ['music', 'sfx', 'ambient'].forEach((b) => {
      const inp = E.g(busGain(b)), vin = E.g(busGain(b));
      inp.connect(E.master); vin.connect(vhp);
      E.bus[b] = { in: inp, verbIn: vin };
    });

    E.setBus = function (b, v) {
      const now = ctx.currentTime, g = v * v;
      if (b === 'master') { E.master.gain.setTargetAtTime(state.muted ? 0 : g, now, 0.03); return; }
      const bus = E.bus[b]; if (!bus) return;
      bus.in.gain.setTargetAtTime(g, now, 0.03); bus.verbIn.gain.setTargetAtTime(g, now, 0.03);
    };

    // ---------------- vozes
    function kill(v, now) {
      if (v.dead) return; v.dead = true;
      try {
        holdParam(v.out.gain, now);
        v.out.gain.linearRampToValueAtTime(0, now + 0.03);
      } catch (e) { /* */ }
      v.end = now + 0.04;
      if (!E.offline) setTimeout(() => disposeVoice(v), 120);
    }
    function disposeVoice(v) { v.nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* */ } }); }

    E.playAt = function (name, opts, when) {
      const def = SFX[name];
      if (!def) return false;
      opts = opts || {};
      const now = ctx.currentTime;
      let list = E.voices[name] || [];
      list = E.voices[name] = list.filter((v) => v.end > now);
      const gap = def.gap == null ? 0.02 : def.gap;
      const tReq = Math.max(when || 0, now);
      if (list.length && Math.abs(tReq - list[list.length - 1].start) < gap) return false;
      while (list.length >= (def.max || 3)) kill(list.shift(), now);
      E.all = E.all.filter((v) => v.end > now && !v.dead);
      if (E.all.length >= MAX_VOICES) kill(E.all.shift(), now);

      const vol = clamp(opts.volume == null ? 1 : +opts.volume || 0, 0, 2);
      if (vol <= 0.001) return false;
      const pitch = clamp(opts.pitch == null ? 1 : +opts.pitch || 1, 0.25, 4);
      const bus = E.bus[def.bus || 'sfx'];
      const out = E.g(vol * (def.gain || 1)), nodes = [out];
      let tail = out;
      if (opts.pan && ctx.createStereoPanner) {
        const pn = ctx.createStereoPanner(); pn.pan.value = clamp(+opts.pan || 0, -1, 1);
        out.connect(pn); tail = pn; nodes.push(pn);
      }
      tail.connect(bus.in);
      if (def.send) { const sg = E.g(def.send); tail.connect(sg); sg.connect(bus.verbIn); nodes.push(sg); }
      const t = Math.max(when || 0, now + (E.offline ? 0.001 : 0.008));
      const K = {
        t, p: pitch, dest: out,
        tone(o) { return tone(E, o.dest || out, t + (o.at || 0), o); },
        noise(o) { return noise(E, o.dest || out, t + (o.at || 0), o); },
        metal(at, f, ratios, d, v) { metal(E, out, t + at, f, ratios, d, v); },
        bell(at, f, v, d) { bell(E, out, t + at, f, v, d); }
      };
      const dur = def.fn(K, opts, E) || 1;
      const voice = { name, start: tReq, end: t + dur + 0.05, out, nodes, dead: false };
      list.push(voice); E.all.push(voice);
      if (!E.offline) setTimeout(() => disposeVoice(voice), (t - now + dur + 0.5) * 1000);
      return true;
    };
    E.play = function (name, opts) { return E.playAt(name, opts, 0); };
    E.thunder = function () { return E.play('thunder', { pan: R(-0.3, 0.3), pitch: R(0.9, 1.1) }); };

    // ---------------- música
    function startTrack(name) {
      const def = TRACKS[name];
      const now = ctx.currentTime;
      const T = { name, def, step: 0, nextTime: now + 0.08, stopAt: Infinity, dead: false, rng: seeded(hashStr(name)), lfos: [], disposables: [], errs: 0 };
      T.mix = E.g(1); T.wetMix = E.g(1); T.out = E.g(0); T.wetOut = E.g(0);
      T.mix.connect(T.out); T.wetMix.connect(T.wetOut);
      T.out.connect(E.bus.music.in); T.wetOut.connect(E.bus.music.verbIn);
      const L = def.level || 1;
      [T.out, T.wetOut].forEach((n) => { n.gain.setValueAtTime(0, now); n.gain.linearRampToValueAtTime(L, now + FADE); });
      def.setup(E, T);
      E.tracks.push(T);
      return T;
    }
    function stopTrack(T) {
      if (T.stopAt !== Infinity) return;
      const now = ctx.currentTime;
      T.stopAt = now + FADE;
      [T.out, T.wetOut].forEach((n) => { holdParam(n.gain, now); n.gain.linearRampToValueAtTime(0, now + FADE); });
    }
    function disposeTrack(T) {
      T.dead = true;
      T.lfos.forEach((o) => { try { o.stop(); } catch (e) { /* */ } });
      [T.out, T.wetOut, T.mix, T.wetMix].concat(T.disposables).forEach((n) => { try { n.disconnect(); } catch (e) { /* */ } });
    }
    E.music = function (name) {
      if (name && !TRACKS[name]) name = null;
      if (name === E.curName) return;
      E.tracks.forEach(stopTrack);
      E.curName = name || null;
      if (name) startTrack(name);
      E.pump(ctx.currentTime + LOOKAHEAD);
    };

    // ---------------- ambiente
    E.ambient = function (name, level) {
      const A = AMBIENTS[name]; if (!A) return;
      let L = E.amb[name];
      if (!L) { if (level <= 0) return; L = E.amb[name] = A.create(E); }
      L.set(level);
    };

    // ---------------- scheduler (lookahead)
    E.pump = function (until) {
      const now = ctx.currentTime;
      for (const T of E.tracks) {
        if (T.dead) continue;
        const sd = 60 / T.def.bpm / 4;
        if (T.nextTime < now - 0.03) {          // aba congelada / atraso: pula sem rajada
          const miss = Math.ceil((now - T.nextTime) / sd);
          T.step += miss; T.nextTime += miss * sd;
        }
        while (T.nextTime < until && T.nextTime < T.stopAt) {
          try { T.def.step(E, T, T.step, T.nextTime, sd); } catch (e) { if (T.errs++ < 3) warn(e); }
          T.step++; T.nextTime += sd;
        }
        if (T.stopAt !== Infinity && now > T.stopAt + 9) disposeTrack(T);
      }
      E.tracks = E.tracks.filter((T) => !T.dead);
      for (const k in E.amb) { try { E.amb[k].pump(until); } catch (e) { warn(e); } }
    };

    E.stopAll = function () {
      const now = ctx.currentTime;
      E.all.forEach((v) => kill(v, now)); E.all = []; E.voices = {};
    };
    return E;
  }

  // ===================================================================== API pública
  const AC = window.AudioContext || window.webkitAudioContext;
  let live = null, ticker = null, hooked = false;

  function applyWant() {
    live.music(state.want.music);
    if (state.want.rain > 0) live.ambient('rain', state.want.rain);
    if (state.want.steam > 0) live.ambient('steam', state.want.steam);
  }
  function hook() {
    if (hooked) return; hooked = true;
    try {
      document.addEventListener('visibilitychange', () => {
        if (!live) return;
        try {
          if (document.hidden) { const p = live.ctx.suspend(); if (p && p.catch) p.catch(() => {}); }
          else { const p = live.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
        } catch (e) { /* */ }
      });
    } catch (e) { /* */ }
  }

  const Audio = {
    SOUNDS: SOUND_NAMES.slice(),
    TRACKS: TRACK_NAMES.slice(),

    init() {
      try {
        if (!AC) return false;
        if (!live) {
          let ctx;
          try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
          live = createEngine(ctx, false);
          applyWant();
          ticker = setInterval(() => { try { live.pump(live.ctx.currentTime + LOOKAHEAD); } catch (e) { warn(e); } }, TICK_MS);
          hook();
        }
        if (live.ctx.state === 'suspended' && !(document && document.hidden)) {
          const p = live.ctx.resume(); if (p && p.catch) p.catch(() => {});
        }
        return true;
      } catch (e) { warn(e); return false; }
    },
    /** alias usado por src/core/input.js */
    unlock() { return Audio.init(); },
    isReady() { return !!(live && live.ctx.state === 'running'); },

    play(name, opts) {
      try { if (live) return live.play(name, opts); } catch (e) { warn(e); }
      return false;
    },
    music(track) {
      try {
        const name = track && TRACKS[track] ? track : null;
        state.want.music = name;
        if (live) live.music(name);
      } catch (e) { warn(e); }
    },
    currentMusic() { return state.want.music; },
    ambient(name, level) {
      try {
        if (!AMBIENTS[name]) return;
        const v = clamp(+level || 0, 0, 1);
        state.want[name] = v;
        if (live) live.ambient(name, v);
      } catch (e) { warn(e); }
    },
    thunder() { try { if (live) live.thunder(); } catch (e) { warn(e); } },

    setVolume(bus, v) {
      try {
        if (BUSES.indexOf(bus) < 0) return;
        v = clamp(+v || 0, 0, 1);
        state.vol[bus] = v; save();
        if (live) live.setBus(bus, v);
      } catch (e) { warn(e); }
    },
    getVolume(bus) { return BUSES.indexOf(bus) >= 0 ? state.vol[bus] : 0; },
    mute(b) {
      try {
        state.muted = !!b; save();
        if (live) live.master.gain.setTargetAtTime(state.muted ? 0 : busGain('master'), live.ctx.currentTime, 0.03);
      } catch (e) { warn(e); }
    },
    isMuted() { return state.muted; },
    stopAll() { try { if (live) live.stopAll(); } catch (e) { warn(e); } },

    // ---------- ferramentas (lab / testes) ----------
    getAnalyser() { return live ? live.analyser : null; },
    getContext() { return live ? live.ctx : null; },
    /**
     * Renderiza offline: script(E, at) recebe um engine offline (E.play/music/ambient/thunder) e
     * at(segundos, fn) para agendar ações. Retorna Promise<AudioBuffer>.
     */
    renderOffline(seconds, script, opts) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return Promise.reject(new Error('OfflineAudioContext indisponível'));
      opts = opts || {};
      const sr = opts.sampleRate || 44100;
      const ctx = new OAC(2, Math.ceil(seconds * sr), sr);
      const E = createEngine(ctx, true);
      const events = [];
      const at = (time, fn) => events.push({ time, fn });
      if (script) script(E, at);
      events.sort((a, b) => a.time - b.time);
      const runDue = (now) => { while (events.length && events[0].time <= now + 1e-6) { const ev = events.shift(); ev.fn(E); } };
      runDue(0);
      E.pump(LOOKAHEAD + 0.25);
      const CH = 0.25;
      for (let s = CH; s < seconds; s += CH) {
        const mark = s;
        ctx.suspend(mark).then(() => {
          try { runDue(mark); E.pump(mark + CH + LOOKAHEAD); } catch (e) { warn(e); }
          ctx.resume();
        }).catch(() => {});
      }
      return ctx.startRendering();
    },
    /** estatísticas de um AudioBuffer (ou trecho) */
    analyze(buf, from, to) {
      const sr = buf.sampleRate;
      const a = Math.max(0, Math.floor((from || 0) * sr)), b = Math.min(buf.length, to ? Math.floor(to * sr) : buf.length);
      let peak = 0, sum = 0, n = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = a; i < b; i++) { const x = d[i]; const ax = x < 0 ? -x : x; if (ax > peak) peak = ax; sum += x * x; n++; }
      }
      const rms = Math.sqrt(sum / Math.max(1, n));
      // loudness de curto prazo: maior RMS numa janela de 50 ms (canais somados)
      const W = Math.max(1, Math.floor(0.05 * sr));
      let win = 0;
      for (let i = a; i + W <= b; i += W >> 1) {
        let acc = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let k = i; k < i + W; k++) acc += d[k] * d[k]; }
        const r = Math.sqrt(acc / (W * buf.numberOfChannels)); if (r > win) win = r;
      }
      const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
      return { peak, rms, win, peakDb: db(peak), rmsDb: db(rms), winDb: db(win), clipped: peak >= 1, silent: peak < 1e-3 };
    }
  };

  Game.Audio = Audio;

  // desbloqueio automático no primeiro gesto (o motor também pode chamar init())
  try {
    const once = () => {
      Audio.init();
      if (Audio.isReady()) ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.removeEventListener(ev, once, true));
    };
    ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, once, true));
  } catch (e) { /* */ }
})();
