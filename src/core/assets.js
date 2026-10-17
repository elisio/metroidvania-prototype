/*
 * Carregador de assets com fallback.
 *  - Lê assets/game/manifest.js (window.ASSET_MANIFEST) e assets/game/hero_sheet.js
 *    (window.HERO_SHEET) via <script> (funciona em file://, sem fetch).
 *  - Carrega os PNGs listados no manifesto. Tudo que faltar vira placeholder
 *    procedural (ver src/world/textures.js).
 *  - ?assets=outra/pasta/ troca a pasta base (útil para testar recortes provisórios).
 */
(function () {
  'use strict';
  const A = Game.Assets = {
    base: 'assets/game/',
    images: {}, manifest: null, sheet: null, sheetImg: null,
    loaded: [], missing: [], ready: false
  };

  try {
    const q = new URLSearchParams(location.search).get('assets');
    if (q) A.base = q.endsWith('/') ? q : q + '/';
  } catch (e) { /* ignore */ }

  /** Nomes do contrato (docs/ASSET_CONTRACT.md) que o motor usa. */
  A.CONTRACT = [
    'bg_far', 'bg_mid', 'bg_interior',
    'tile_deck', 'tile_brick', 'tile_brick_dark', 'tile_girder_v', 'tile_girder_x', 'tile_stairs',
    'prop_gargoyle', 'prop_lamp', 'prop_pipes', 'prop_fence', 'prop_water_tower', 'prop_neon_cyan',
    'prop_neon_purple', 'prop_window_bars', 'prop_fluorescent',
    'hero_portrait', 'hud_portrait_frame', 'hud_bar_frame', 'hud_heart_full', 'hud_heart_empty',
    'hud_slot', 'hud_minimap_frame', 'icon_book', 'icon_potion', 'hud_level_badge', 'hud_lives_badge'
  ];

  function loadScript(src) {
    return new Promise((res) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => res(true);
      s.onerror = () => { s.remove(); res(false); };
      document.head.appendChild(s);
    });
  }
  function loadImage(src) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  }

  A.load = async function () {
    const [okM, okH] = await Promise.all([
      loadScript(A.base + 'manifest.js'),
      loadScript(A.base + 'hero_sheet.js')
    ]);
    A.manifest = okM && window.ASSET_MANIFEST ? window.ASSET_MANIFEST : null;
    A.sheet = okH && window.HERO_SHEET && window.HERO_SHEET.frames ? window.HERO_SHEET : null;

    // Lista de nomes: o manifesto (se existir) + os nomes fixos do contrato.
    const files = {};
    for (const n of A.CONTRACT) files[n] = n + '.png';
    if (A.manifest) {
      for (const name in A.manifest) {
        if (name === 'hero_sheet') continue;
        const ent = A.manifest[name];
        const file = typeof ent === 'string' ? ent : ent && ent.file;
        if (file && /\.(png|jpe?g|webp)$/i.test(file)) files[name] = file;
      }
    }
    const jobs = [];
    for (const name in files) {
      jobs.push(loadImage(A.base + files[name]).then((im) => {
        if (im && im.width > 0) { A.images[name] = im; A.loaded.push(name); } else A.missing.push(name);
      }));
    }
    if (A.sheet) {
      jobs.push(loadImage(A.base + (A.sheet.image || 'hero_sheet.png')).then((im) => {
        if (im && im.width > 0) { A.sheetImg = im; A.loaded.push('hero_sheet'); } else { A.sheet = null; A.missing.push('hero_sheet'); }
      }));
    }
    await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 12000))]);
    A.ready = true;
    if (window.console && console.info) {
      console.info('[Noite de Ferro] assets carregados:', A.loaded.join(', ') || '(nenhum — usando placeholders)');
    }
  };

  /** Imagem do contrato se existir, senão null. */
  A.img = (name) => A.images[name] || null;
})();
