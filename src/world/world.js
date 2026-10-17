/*
 * Mundo: constrói as salas a partir de Game.ROOMS, indexa as células do mapa
 * global e responde consultas de tile — inclusive além da borda de uma sala,
 * consultando a sala vizinha (assim as portas/poços são contínuos).
 */
(function () {
  'use strict';
  const C = Game.CONFIG;

  // Tipos de tile
  const T = Game.T = {
    EMPTY: 0, BRICK: 1, BRICKB: 2, DECK: 3, IRON: 4, PIPE: 5, STAIR: 6,
    GRATE: 7, PLANK: 8, CRACK: 9, ENERGY: 10, SPIKE: 11, WATER: 12
  };
  const CHAR = {
    '.': T.EMPTY, '#': T.BRICK, 'b': T.BRICKB, 'T': T.DECK, 'I': T.IRON, 'C': T.PIPE,
    'S': T.STAIR, '=': T.GRATE, '-': T.PLANK, 'X': T.CRACK, 'E': T.ENERGY,
    '^': T.SPIKE, '~': T.WATER
  };
  const ENTITY_CHARS = { G: 'save', K: 'book', R: 'relic', H: 'heart', M: 'mana', P: 'potion', O: 'ring', Z: 'bell' };

  // Sólidos "de verdade" (energia é tratada à parte: sólida exceto durante o dash)
  const SOLID = new Uint8Array(16);
  [T.BRICK, T.BRICKB, T.DECK, T.IRON, T.PIPE, T.STAIR, T.CRACK].forEach((t) => { SOLID[t] = 1; });
  const ONEWAY = new Uint8Array(16);
  [T.GRATE, T.PLANK].forEach((t) => { ONEWAY[t] = 1; });
  Game.TILE_SOLID = SOLID;
  Game.TILE_ONEWAY = ONEWAY;

  const W = Game.World = { rooms: {}, order: [], cells: {}, gridW: 0, gridH: 0 };

  /** (Re)constrói todas as salas. `broken` = paredes rachadas já quebradas. */
  W.build = function (broken) {
    W.rooms = {}; W.order = []; W.cells = {};
    W.gridW = 0; W.gridH = 0;
    for (const id in Game.ROOMS) {
      const def = Game.ROOMS[id];
      const th = def.map.length, tw = def.map[0].length;
      const r = {
        id, def, name: def.name, area: def.area, theme: def.theme,
        cx: def.cell[0], cy: def.cell[1],
        cw: Math.round(tw / C.CELL_W), ch: Math.round(th / C.CELL_H),
        tw, th, pw: tw * C.TILE, ph: th * C.TILE,
        tiles: new Uint8Array(tw * th),
        entities: [], deco: (def.deco || []).slice(), cracks: [], cache: null, cacheDirty: true
      };
      r.ox = r.cx * C.CELL_W * C.TILE;
      r.oy = r.cy * C.CELL_H * C.TILE;
      for (let y = 0; y < th; y++) {
        const row = def.map[y];
        for (let x = 0; x < tw; x++) {
          const ch = row[x];
          if (ENTITY_CHARS[ch]) {
            r.entities.push({ kind: ENTITY_CHARS[ch], tx: x, ty: y, id: id + ':' + x + ',' + y });
            r.tiles[y * tw + x] = T.EMPTY;
          } else {
            r.tiles[y * tw + x] = CHAR[ch] !== undefined ? CHAR[ch] : T.EMPTY;
          }
        }
      }
      for (let cy = 0; cy < r.ch; cy++) {
        for (let cx = 0; cx < r.cw; cx++) W.cells[(r.cx + cx) + ',' + (r.cy + cy)] = id;
      }
      W.gridW = Math.max(W.gridW, r.cx + r.cw);
      W.gridH = Math.max(W.gridH, r.cy + r.ch);
      findCrackGroups(r);
      W.rooms[id] = r;
      W.order.push(id);
    }
    if (broken) {
      for (const key in broken) if (broken[key]) W.applyBroken(key);
    }
  };

  /** Agrupa tiles rachados conectados: um golpe quebra o grupo inteiro. */
  function findCrackGroups(r) {
    const seen = new Uint8Array(r.tw * r.th);
    for (let i = 0; i < r.tiles.length; i++) {
      if (r.tiles[i] !== T.CRACK || seen[i]) continue;
      const stack = [i], cells = [];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        cells.push(j);
        const x = j % r.tw, y = (j / r.tw) | 0;
        const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= r.tw || ny >= r.th) continue;
          const k = ny * r.tw + nx;
          if (!seen[k] && r.tiles[k] === T.CRACK) { seen[k] = 1; stack.push(k); }
        }
      }
      let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
      for (const j of cells) {
        const x = j % r.tw, y = (j / r.tw) | 0;
        minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
      }
      r.cracks.push({ key: r.id + ':' + minx + ',' + miny, cells, x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, broken: false });
    }
  }

  W.applyBroken = function (key) {
    const rid = key.split(':')[0];
    const r = W.rooms[rid];
    if (!r) return null;
    for (const g of r.cracks) {
      if (g.key === key && !g.broken) {
        g.broken = true;
        for (const j of g.cells) r.tiles[j] = T.EMPTY;
        r.cacheDirty = true;
        return g;
      }
    }
    return null;
  };

  W.room = (id) => W.rooms[id];
  W.roomAtCell = (cx, cy) => W.rooms[W.cells[cx + ',' + cy]] || null;

  /** Tile em coordenadas locais de `r`, consultando vizinhas fora da borda. */
  W.tileAt = function (r, tx, ty) {
    if (tx >= 0 && ty >= 0 && tx < r.tw && ty < r.th) return r.tiles[ty * r.tw + tx];
    const wtx = r.cx * C.CELL_W + tx, wty = r.cy * C.CELL_H + ty;
    const cx = Math.floor(wtx / C.CELL_W), cy = Math.floor(wty / C.CELL_H);
    const o = W.roomAtCell(cx, cy);
    if (o) {
      const lx = wtx - o.cx * C.CELL_W, ly = wty - o.cy * C.CELL_H;
      return o.tiles[ly * o.tw + lx];
    }
    // sem vizinha: laterais são paredes, acima é céu aberto, abaixo é abismo
    if (tx < 0 || tx >= r.tw) return T.BRICK;
    return T.EMPTY;
  };

  /** Sala que contém o ponto (px de mundo local a `r`) — ou null. */
  W.roomAtLocal = function (r, x, y) {
    const wx = r.ox + x, wy = r.oy + y;
    const cx = Math.floor(wx / (C.CELL_W * C.TILE)), cy = Math.floor(wy / (C.CELL_H * C.TILE));
    return W.roomAtCell(cx, cy);
  };

  W.isSolid = (t) => SOLID[t] === 1;
  W.isOneWay = (t) => ONEWAY[t] === 1;

  /** Sala que é vizinha de `r` naquela borda e se há passagem (para o mapa). */
  W.edgeOpen = function (r, side, cellX, cellY) {
    // cellX/cellY: célula local da sala. Retorna true se há tiles livres na borda.
    const CW = C.CELL_W, CH = C.CELL_H;
    let open = 0;
    if (side === 'L' || side === 'R') {
      const x = side === 'L' ? 0 : r.tw - 1;
      for (let y = cellY * CH; y < (cellY + 1) * CH; y++) {
        const t = r.tiles[y * r.tw + x];
        if (!SOLID[t] && t !== T.CRACK) open++;
      }
    } else {
      const y = side === 'U' ? 0 : r.th - 1;
      for (let x = cellX * CW; x < (cellX + 1) * CW; x++) {
        const t = r.tiles[y * r.tw + x];
        if (!SOLID[t]) open++;
      }
    }
    return open >= 2;
  };
})();
