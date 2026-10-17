# Noite de Ferro — documento de design

Este é o protótipo jogável de um metroidvania 2D feito em HTML5 Canvas e JavaScript puro, sem build e sem dependências.
O jogo não tem inimigos nesta versão. A progressão vem de três habilidades que abrem caminhos, cada uma guardada numa relíquia.

## Como rodar

- **Direto do disco:** abra `index.html` no navegador (`file://`). Todos os scripts são clássicos (sem ES modules) e não há `fetch`.
- **Por HTTP:** `python3 -m http.server` na raiz do projeto, depois abra `http://localhost:8000/`.
- **Pasta de assets alternativa:** `index.html?assets=outra/pasta/`. Uma pasta inexistente força os placeholders procedurais.

## Controles

| Ação | Teclado | Gamepad | Toque |
|---|---|---|---|
| Mover | ← → / A D | D-pad / analógico | D-pad |
| Pular (segurar = mais alto) | Espaço / Z | Ⓐ | PULO |
| Chicote; no ar, perto de argola = gancho | X / J | Ⓧ / LT | CHICOTE |
| Dash | C / K / Shift | Ⓑ / RB / RT | DASH |
| Descer de passarela/grade | ↓ + Pular | ↓ + Ⓐ | ↓ + PULO |
| Interagir (salvar, tocar o sino) | ↑ perto do objeto | ↑ | ↑ |
| Poção (cura 2 corações) | Q | LB | POÇÃO |
| Foco (gasta 40 de mana, cura 1 coração) | F | Ⓨ | — |
| Mapa | M / Tab | Select | MAPA |
| Pausa (volumes, tremor, controles) | Esc / P | Start | ❚❚ |
| Debug | F1 (hitboxes, FPS); com debug ligado: `[` `]` trocam de sala, F2 dá todas as habilidades | — | — |

Gancho, enquanto pendurada: ←/→ balançam o pêndulo, Pular solta com impulso (pulo duplo e dash recarregam) e ↓ larga.
Apertar o chicote de novo, perto de outra argola, troca de argola no ar.

## Mapa do mundo

O mundo é um grid de células de 30×17 tiles (960×544 px, uma tela). Cada sala ocupa um retângulo de células.
Uma passagem na borda de uma sala leva à sala vizinha naquela célula: portas laterais e poços verticais.

```
 x:   0        1        2        3        4        5        6        7
y=0                                                     +-----------------+
                                                        |    CATEDRAL     |
                                                        |  do Sino  [Z]   |
                                                        +---------||------+
y=1                       +--------+--------------------------+ || +--------+
                          |ANDAIMES|        PONTE dos         | TORRE  |
                          |[R:DASH]=====  Holofotes  =========[G]  do  |
                          |  ...   | [G][H]  O O O  ...  O O O | Relógio|
y=2  +--------+           |   (V)  +--------------------------+ (V,O)  |
     |TELHADO |           |   [G]  |                          |        |
     |  [H]   |           +--||----+                          |        |
y=3  +---||---+--------+--------||-------+-----------------------+   |
     |   PASSARELA     |    FÁBRICA de   |      GALERIA          ==[G]   |
     |  das Gárgulas   X    Canos  [E]=======  Encharcada  O O O ==>     |
     |  [G] início     |  (V)      ||    |  [G]   ^^^  ||  ^^^^^ +--------+
y=4  +-----------------+-----------||----+-------------||--------+
                       |    PORÃO de     |      CISTERNA         |
                       | [R:PULO] X [G] [E][H]  [G]  ^^ [R:GANCHO]|
                       +-----------------+-----------------------+

 ||  poço vertical         ==  porta lateral             X  parede rachada (chicote)
 [E] grade de energia (dash)   (V) subida que exige pulo duplo   O  argolas (gancho)
 [G] estátua de save        [R] relíquia             [H] recipiente de coração   ^ espinhos
```

| Sala | Células | Tema | Conteúdo |
|---|---|---|---|
| Passarela das Gárgulas | (0..1, 3) | exterior; composição da referência, céu aberto, parallax | início, save, livro, poção, mana alta (pulo duplo), parede rachada para a Fábrica |
| Telhado da Fábrica | (0, 2) | exterior | coração no alto de uma chaminé (pulo duplo), livro |
| Fábrica de Canos | (2..3, 3) | interior com vapor e canos | grade alta (pulo duplo) para os Andaimes; grade no chão para o Porão; barreira de energia (dash) para a Galeria |
| Porão de Tijolos | (2..3, 4) | interior com janela gradeada e luminárias | espinhos, parede rachada, **relíquia PULO DUPLO**, save, livro, poção; barreira (dash) guardando um coração |
| Andaimes e Caixa d'Água | (2, 1..2) | vertical, exterior | tábuas e grades até a **relíquia DASH**, save, poção, mana |
| Ponte dos Holofotes | (3..5, 1) | exterior | dois abismos que só se cruzam com o gancho (7 argolas); ilha central com save, coração e livro |
| Galeria Encharcada | (4..5, 3) | exterior | fosso de espinhos (pulo duplo), grade para a Cisterna, campo de espinhos com 3 argolas até a Torre |
| Cisterna Velha | (4..5, 4) | interior com água | espinhos e pilar para a **relíquia GANCHO**; argola extra com mana; porta à esquerda dá no nicho do coração do Porão (atrás da grade de energia) |
| Torre do Relógio | (6, 1..3) | vertical, interior, mostrador de relógio | 51 tiles de altura; a 4ª plataforma só se alcança com o gancho; mana, livro, save |
| Catedral do Sino | (6..7, 0) | topo | escadaria até o **sino**: tocar com ↑ (ou com o chicote) termina o jogo |

## Rota crítica e portões de habilidade

1. **Passarela:** pule o vão e quebre com o chicote a parede rachada à direita (`X`), que leva à Fábrica.
   A plataforma alta do mana e o poço para o Telhado ficam visíveis desde o início, mas exigem pulo duplo (backtracking).
2. **Fábrica:** a grade alta (4 tiles acima do chão mais 3 até o teto) **não** se alcança com pulo simples.
   A barreira de energia à direita **não** se atravessa sem dash. Resta descer pela grade do chão (↓+Pular).
3. **Porão:** espinhos, depois a parede rachada e a **relíquia PULO DUPLO**. Volta-se à Fábrica pela escada de grades do poço.
4. **Fábrica → Andaimes** (pulo duplo pela grade alta e pelo poço) → tábuas → **relíquia DASH**.
5. **Fábrica → barreira de energia** (dash) → **Galeria** → fosso de espinhos (pulo duplo) → grade → **Cisterna**.
   Lá: espinhos, pilar, bloco alto e **relíquia GANCHO**.
6. Com o gancho há dois caminhos até a Torre:
   - Galeria → 3 argolas sobre o campo de espinhos → **Torre** (base).
   - Andaimes → Ponte → argolas sobre os dois abismos → **Torre** (meio).
7. **Torre:** suba os patamares. O trecho entre a linha 36 e a linha 26 só passa com o gancho (argola em 9,24).
   O topo leva à **Catedral**: suba a escadaria e toque o sino.

O que impede softlocks:

- Todo poço vertical tem plataforma de apoio dentro do próprio poço, e a heroína recebe um impulso para cima ao entrar numa sala por baixo.
- Toda descida (grade, poço) tem caminho de volta com as habilidades já obtidas naquele ponto.
  O Porão volta pela escada de grades com pulo duplo, a Cisterna volta pela escada de grades com pulo duplo.
  Para a Galeria também há a saída pela Torre.
- Espinhos e abismos não matam de imediato. Cada um tira 1 coração e devolve a heroína ao último chão seguro.
  Só com 0 corações ela volta à última estátua (ou ao início, se não houver save).
- Paredes quebradas, habilidades e itens são salvos. Ao morrer, o estado volta ao do último save, então nada se perde de forma irreversível.

A rota inteira é verificada automaticamente por `tools/route_test.py` (veja Testes).

## Mecânicas e game feel (constantes em `src/config.js`)

- **Corrida:** aceleração de 2800 px/s² no chão, desaceleração de 3400 px/s², aceleração 1,6× maior ao inverter a direção e controle aéreo reduzido.
- **Pulo:** velocidade inicial de 720 px/s, cerca de 3,8 tiles de altura.
  - Pulo variável: soltar o botão multiplica a velocidade vertical por 0,45.
  - Gravidade 1,45× maior na queda, "flutuação" no ápice com o botão segurado e queda máxima de 920 px/s.
  - Coyote time de 0,10 s e jump buffer de 0,13 s.
- **Colisão:** a correção de quina desliza até 12 px ao bater a cabeça e a assistência de borda sobe até 10 px.
  Degraus de escada (`S`) são subidos andando, tratados como rampa em degraus.
- **Pulo duplo:** 640 px/s, total de cerca de 6,9 tiles.
- **Dash:** 760 px/s durante 0,17 s, sem gravidade, uma vez por salto no ar, recarga de 0,3 s.
  Atravessa grades de energia (`E`) e não termina dentro delas.
- **Chicote:** dura 0,30 s, com janela ativa de 0,09 a 0,22 s, alcance de 132 px, e pode ser usado no ar.
  - É desenhado de forma procedural: uma curva de Bézier com ondulação, em três passadas aditivas (halo âmbar, corpo dourado, núcleo branco), com rastro das poses anteriores, brilho na ponta e faíscas.
  - Sai da mão (`hx,hy` do frame do sheet), espelhado conforme a direção.
  - Quebra paredes rachadas (o grupo conectado inteiro), acende estátuas e toca o sino.
- **Gancho:** com o chicote no ar, ele procura a argola mais próxima à frente e acima, até 256 px.
  - O chicote "voa" por 0,07 s até a argola. Depois a corda encolhe até 44 px (o puxão) e vira um pêndulo com restrição de distância.
  - ←/→ dão impulso tangencial. Pular solta com um impulso de pelo menos 400 px/s na direção desejada.
- **Plataformas atravessáveis** (`=` grade, `-` tábua): sobe-se por baixo, desce-se com ↓+Pular.
- **Câmera:** zona morta, lookahead na direção do movimento, olhar para baixo em quedas rápidas, limites da sala e tremor (pode ser desligado no menu).
- **Transições:** fade de 0,16 s de saída e 0,24 s de entrada, preservando posição e velocidade entre salas.

## Coletáveis

| Item | Efeito | Quantidade |
|---|---|---|
| Relíquias | pulo duplo, dash, gancho; tela "Nova habilidade" com explicação | 3 |
| Recipiente de coração | +1 coração máximo (HUD com corações, como na referência) | 3 (Telhado, Ponte, Porão/Cisterna) |
| Fragmento de mana | +20 de mana máxima | 5 |
| Poção | Q cura 2 corações | 4 no mapa, mais 1 inicial |
| Livro | texto curto de lore | 1 por sala, 9 no total |

## Save

- As estátuas-gárgula acendem com ↑ ou com o chicote. Elas salvam em `localStorage` (`noiteDeFerro.save.v1`, sempre com try/catch) e restauram vida e mana.
- Sem storage disponível, o save fica em memória durante a sessão.
- A tela de título tem **Continuar** (só aparece quando há save) e **Novo jogo** (pede confirmação para apagar).

## Arquitetura

```
index.html              canvas + <script> clássicos na ordem de dependência
src/config.js           TODAS as constantes de game feel / câmera / progresso
src/core/util.js        matemática, PRNG, helpers de canvas
src/core/input.js       teclado + gamepad + toque + entrada virtual (testes) -> ações
src/core/screen.js      canvas 960×540 escalado com letterbox, loop de passo fixo (60 Hz)
src/core/assets.js      carrega manifest.js, hero_sheet.js e os PNGs do contrato, com fallback
src/core/camera.js      câmera
src/audio/audio.js      (do designer de som) Game.Audio: WebAudio procedural
src/data/rooms.js       salas em ASCII (editáveis à mão) + decoração
src/data/text.js        textos: habilidades, livros, créditos, final
src/world/world.js      construção das salas, grid global, consulta de tiles entre salas
src/world/textures.js   imagem do contrato ou placeholder procedural nas cores da referência
src/world/terrain.js    cache do terreno por sala (na resolução real), fundos, tiles animados
src/systems/fx.js       partículas, chuva + respingos, névoa, holofotes, vapor, relâmpago, luzes
src/systems/save.js     save/load e preferências
src/systems/map.js      minimapa e mapa completo
src/entities/player.js  física, chicote, dash, gancho, animação, desenho
src/entities/objects.js estátuas, itens, relíquias, argolas, sino
src/ui/hud.js           HUD no layout da referência
src/ui/screens.js       título, pausa, mapa, diálogos, toasts, final
src/ui/touch.js         controles de toque
src/game.js             cenas, transições, coleta, morte/respawn, render, debug, API de teste
```

Notas de desempenho:

- O terreno de cada sala é pré-renderizado num canvas na resolução real (k = escala × devicePixelRatio, até 2×) e desenhado 1:1.
- Os fundos de parallax, a névoa e a vinheta são pré-escalados e desenhados em pixels do dispositivo, então não há reamostragem de imagens grandes a cada quadro.
- Brilhos usam sprites radiais pré-gerados com composição `lighter`.

## Assets usados pelo motor

Todos ficam em `assets/game/`. Se algum faltar, o motor usa um placeholder procedural.

- Fundos: `bg_far`, `bg_mid`, `bg_interior`.
- Terreno: `tile_deck` (corridas de passarela `T`), `tile_brick` (sólidos), `tile_brick_dark` (sob passarelas `b`), `tile_girder_x` (estrutura `I`), `tile_girder_v` (colunas decorativas). `tile_stairs` é carregado, mas os degraus são desenhados de forma procedural.
- Props: `prop_gargoyle` (decoração e estátuas de save), `prop_lamp`, `prop_fence`, `prop_neon_cyan`, `prop_neon_purple`, `prop_window_bars`, `prop_fluorescent`, `prop_pipes`, `prop_water_tower`.
- Personagem: `hero_sheet.png` + `hero_sheet.js` (âncora `ax,ay` e mão `hx,hy` por frame; animações idle, run, jump, fall, attack, dash, crouch) e `hero_portrait`.
- HUD: `hud_portrait_frame`, `hud_bar_frame`, `hud_heart_full`, `hud_heart_empty`, `hud_slot`, `hud_minimap_frame`, `hud_level_badge`, `hud_lives_badge`, `icon_book`, `icon_potion`.
  O "1" do badge de nível e o contador de corações são desenhados por cima, então os badges podem vir sem números.
- `manifest.js` é opcional. Se existir, as entradas dele somam-se aos nomes fixos do contrato (o manifesto pode apontar outros arquivos).

## Testes

- `python3 tools/smoke_test.py`: é o teste de fumaça com teclado em tempo real. Cobre:
  - título, novo jogo, andar, pulo variável, chicote, save na estátua e `localStorage`;
  - mapa, pausa, dash, transição de sala, gancho e as 10 salas;
  - benchmark, debug, recarregar e Continuar, e queda no vão;
  - a mesma sessão via `file://`, uma execução só com placeholders e uma sessão com toque.

  Não pode haver erros de console. Os screenshots vão para `tools/screens/smoke_*.png`.
- `python3 tools/route_test.py [--shots]`: prova a completabilidade com simulação determinística congelada. Ele:
  - verifica que cada portão bloqueia sem a habilidade (Fábrica sem pulo duplo, energia sem dash, ponte sem gancho, torre sem gancho);
  - percorre a rota inteira, da parede rachada até o sino, incluindo as subidas de volta dos poços.

  Screenshots em `tools/screens/route_*.png`.
- A API de teste fica em `Game.Test`: `freeze`, `step`, `place(sala, tx, ty, habilidades)`, `run([...comandos])` e `info()`.
