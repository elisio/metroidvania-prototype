# assets/game — arte do jogo

Tudo aqui é **gerado** a partir de `assets/src/reference.jpg` por `python3 tools/build_assets.py`
(adicione `--clean` para refazer o cache do inpainting em `tools/.cache/`). A escala é 0.5 da referência,
reduzida com LANCZOS em alfa pré-multiplicado. Nada foi desenhado do zero: a arte é recortada,
emendada e recombinada.

## Fundos
| arquivo | como foi feito |
|---|---|
| `bg_far.png` 451×620 | Personagem, chicote, brilho e grade quebrada removidos por inpainting de exemplares (Criminisi, em passadas por região: fachadas copiadas na vertical, parapeito da ponte na horizontal, névoa em janela local). Recorte x 407–858 / y 250–1490 espelhado no eixo do prédio art-déco, o que dá emenda horizontal perfeita (o período é a largura da imagem). Sem robôs, HUD ou passarela. |
| `bg_mid.png` 900×488 (alfa) | Canos e vapor da esquerda e andaime + parede de tijolo quebrada da direita. Máscara feita com polígono e classificador de tom quente/escuro contra o céu azul. Fundo transparente; o vão entre os grupos deixa a imagem emendável em X. |
| `bg_interior.png` 260×259 | Tijolo escuro quilted (Efros-Freeman, linhas de tijolo alinhadas), com a janela gradeada e o cano original compostos por cima. Emendável em X e em Y. |

## Terreno (emendável)
`tile_deck` 128×56 (o topo é a superfície; período da treliça de 85 px da referência, 3 módulos, junção por corte de erro mínimo, chuva removida) ·
`tile_brick` / `tile_brick_dark` 128×128 (quilting + nivelamento de luz em LAB, linhas alinhadas, emenda em X e Y) ·
`tile_girder_v` 34×120 (coluna treliçada da parte de baixo, 2 períodos) ·
`tile_girder_x` 62×61 (extra: torre em X com vãos transparentes) ·
`tile_stairs` 120×100 (recorte simples da escada da direita, opaco, **não** emendável).

## Props (alfa)
`prop_gargoyle` (polígono + GrabCut em faixa) · `prop_lamp` (arandela com halo de alfa radial) ·
`prop_pipes` (cano em L da parede) · `prop_fence` (grade reparada por periodicidade e módulo de 2 postes repetido 3×; emenda em X) ·
`prop_water_tower` (caixa d'água cortada pela borda da imagem e completada por espelhamento) ·
`prop_neon_cyan` / `prop_neon_purple` (letreiros + halo) · `prop_window_bars` (vidros com 60% de opacidade) ·
`prop_fluorescent` (tubo espelhado para ganhar as duas pontas, com halo).

## Personagem
`hero_sheet.png` 1008×480 = grade 8 colunas × 3 linhas de células 126×160. `hero_sheet.js` define `window.HERO_SHEET`.
Âncora dos pés (ax,ay) = (60,156) em todos os frames; a mão do chicote (hx,hy) vem por frame.
A pose é **rig de recortes** da única pose da referência, que já olha para a direita (sem espelhar):
torso+cabeça+braço de guarda, braço do chicote (pivô no ombro), coxa/canela/pé de cada perna
(IK de 2 ossos, joelhos arredondados em cápsula, buracos preenchidos por difusão de cor).
Prévias: `tools/preview_hero.png` e `tools/preview_{run,attack,idle}.gif`.
`hero_portrait.png` = disco do rosto do retrato do HUD.

## HUD
`hud_portrait_frame` (anel com interior vazio, trechos cobertos pelos badges reconstruídos por espelhamento/rotação) ·
`hud_bar_frame` (molduras de vida e mana; interiores transparentes, em px da imagem: vida x 14–226 / y 9–20, mana x 14–189 / y 33–43) ·
`hud_heart_full`, `hud_heart_empty` · `hud_slot` (vazio) · `icon_book`, `icon_potion` ·
`hud_minimap_frame` (interior vazio) · `hud_level_badge` (com o "1") · `hud_lives_badge` (coração + "2" embutido).

`manifest.js` → `window.ASSET_MANIFEST = { nome: {file, w, h} }`. A visão geral está em `tools/contact_sheet.png`.
