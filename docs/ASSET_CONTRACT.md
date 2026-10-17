# Contrato de assets — Protótipo Metroidvania "Noite de Ferro"

Fonte única da arte: `assets/src/reference.jpg` (1311×2576). Toda arte do jogo é recortada/derivada
dessa imagem — nada de arte nova desenhada do zero, exceto efeitos (chuva, brilho do chicote, partículas).

## Escala
- **Escala do jogo = 0.5 da referência.** Um pixel do mundo = 2 px da referência.
- Canvas lógico: **960×540**. `TILE = 32` px de mundo.
- A personagem tem ~140 px de altura no jogo (≈ 280 px na referência).
- Arte não é "pixel grid" exato (é imagem gerada), então reduzir com LANCZOS e desenhar com smoothing ligado.

## Pasta de saída: `assets/game/`
Todos PNG RGBA. Nomes exatos (o motor carrega estes nomes; se faltar, usa um placeholder):

### Fundo (parallax)
| arquivo | conteúdo | requisito |
|---|---|---|
| `bg_far.png` | céu nublado + holofotes + arranha-céus góticos/art-déco + ponte ao fundo | sem personagem, sem robôs, sem HUD, sem a passarela da frente; **emendável na horizontal** (repetir lado a lado sem costura); altura ~610 |
| `bg_mid.png` | camada intermediária com transparência (canos/vapor à esquerda, andaimes/caixa d'água à direita) | fundo transparente onde houver céu; emendável na horizontal; opcional |
| `bg_interior.png` | parede interna de tijolo escuro com canos e janela gradeada (parte de baixo da imagem) | fundo para salas internas; emendável na horizontal e vertical se possível |

### Terreno (texturas emendáveis)
| arquivo | conteúdo | requisito |
|---|---|---|
| `tile_deck.png` | passarela de ferro: faixa superior + treliça em X logo abaixo | emendável na horizontal; altura 48–64; o topo da imagem = superfície onde se pisa |
| `tile_brick.png` | tijolo sólido (parede/chão maciço) | 128×128, emendável em X e Y |
| `tile_brick_dark.png` | tijolo mais escuro para paredes de fundo | 128×128, emendável |
| `tile_girder_v.png` | coluna vertical de ferro com treliça | largura 32–48, emendável na vertical |
| `tile_stairs.png` | degrau/escada de ferro | opcional |

### Props (decoração, recortados com alpha)
`prop_gargoyle.png`, `prop_lamp.png` (arandela acesa), `prop_pipes.png`, `prop_fence.png`,
`prop_water_tower.png`, `prop_neon_cyan.png`, `prop_neon_purple.png`, `prop_window_bars.png`,
`prop_fluorescent.png` (luz tubular).

### Personagem
- `hero_sheet.png` + `hero_sheet.js` (JS, não JSON, para abrir via file://):
```js
window.HERO_SHEET = {
  image: "hero_sheet.png",
  // cada frame: retângulo no sheet + âncora dos pés (centro-base) + ponto da mão que segura o chicote
  frames: { "idle_0": {x,y,w,h, ax, ay, hx, hy}, ... },   // ax,ay e hx,hy relativos ao canto do frame
  anims: {
    idle:   { frames: ["idle_0","idle_1",...], fps: 6,  loop: true },
    run:    { frames: [...8], fps: 12, loop: true },
    jump:   { frames: [...], fps: 10, loop: false },
    fall:   { frames: [...], fps: 8,  loop: true },
    attack: { frames: [...4], fps: 16, loop: false },
    dash:   { frames: [...], fps: 12, loop: false },
    crouch: { frames: [...], fps: 1,  loop: false }
  },
  facing: "right"   // sprites desenhados virados para a direita
};
```
- O chicote **não** fica no sprite: o motor desenha o chicote (brilho branco-dourado) saindo de (hx,hy).
- `hero_portrait.png`: rosto para o HUD (recortado do retrato no canto superior esquerdo).

### HUD (recortes do topo da imagem)
`hud_portrait_frame.png`, `hud_bar_frame.png` (moldura das barras vida/mana), `hud_heart_full.png`,
`hud_heart_empty.png`, `hud_slot.png` (moldura de item), `hud_minimap_frame.png`,
`icon_book.png`, `icon_potion.png`, `hud_level_badge.png`, `hud_lives_badge.png`.

### Manifesto
`assets/game/manifest.js`:
```js
window.ASSET_MANIFEST = { "bg_far": {file:"bg_far.png", w, h}, ... };
```
