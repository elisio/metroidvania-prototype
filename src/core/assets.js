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

    const jobs = [];
    if (A.manifest) {
      for (const name in A.manifest) {
        if (name === 'hero_sheet') continue;
        const ent = A.manifest[name];
        const file = typeof ent === 'string' ? ent : ent && ent.file;
        if (!file || !/\.(png|jpe?g|webp)$/i.test(file)) continue;
        jobs.push(loadImage(A.base + file).then((im) => {
          if (im && im.width > 0) { A.images[name] = im; A.loaded.push(name); } else A.missing.push(name);
        }));
      }
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
