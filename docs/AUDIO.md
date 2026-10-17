# Áudio — Noite de Ferro

Todo o áudio é **procedural**, feito com WebAudio puro: não há arquivos de áudio nem bibliotecas.
O módulo fica em `src/audio/audio.js`. É um script clássico que define `window.Game.Audio` e funciona via `file://` e via HTTP.
A bancada de testes é `tools/audio_lab.html`: tem um botão por som e por música, sliders de volume/pitch/pan, medidor de pico e um teste offline.

## Carregamento

```html
<script src="src/audio/audio.js"></script>   <!-- qualquer posição; não depende de outros scripts -->
```

O módulo se desbloqueia sozinho no primeiro `pointerdown`/`keydown`/`touchend` da janela.
O `src/core/input.js` já chama `Game.Audio.unlock()` (alias de `init()`) em cada tecla, o que é inofensivo porque `init` é idempotente.

## API

```js
Game.Audio.init()                 // cria/retoma o AudioContext; idempotente; retorna true/false
Game.Audio.play(name, opts)       // opts: {volume 0..2 (padrão 1), pitch 0.25..4 (padrão 1), pan -1..1}; retorna true se tocou
Game.Audio.music(track)           // 'title' | 'exterior' | 'interior' | 'tower' | null  (crossfade de 1,5 s)
Game.Audio.ambient(name, level)   // 'rain' | 'steam', level 0..1 (0 = silencia; a mudança é suavizada em ~0,4 s)
Game.Audio.setVolume(bus, v)      // 'master' | 'music' | 'sfx' | 'ambient', 0..1, salvo em localStorage
Game.Audio.getVolume(bus)
Game.Audio.mute(bool), Game.Audio.isMuted()   // também é salvo
Game.Audio.thunder()              // trovão próximo (chamar junto do relâmpago)
```

Extras, que não são obrigatórios: `unlock()` (alias de `init`), `isReady()`, `currentMusic()`, `stopAll()` (corta os efeitos; use em game over ou ao sair para o menu), `SOUNDS`, `TRACKS`, `getAnalyser()`, `getContext()`, `renderOffline(seg, script)` e `analyze(buffer)` (os dois últimos são para testes).

**Segurança:** toda função pública é envolvida em try/catch.
- Antes de `init()`, `play`/`thunder` não fazem nada.
- `music`/`ambient`/`setVolume` guardam o estado desejado e o aplicam quando o contexto for criado. Assim, dá para chamar `music('title')` no boot e ela começa no primeiro clique.
- Num navegador sem WebAudio, tudo vira no-op e `init()` retorna `false`.
- O contexto é suspenso quando a aba fica oculta e retomado quando ela volta.

## Barramentos e mixagem

```
sfx ─────┐                    ┌─> convolver (IR sintetizada: salão de pedra + ressonâncias de ferro, RT60 ≈ 2,7 s)
music ───┼─> bus + envio ─────┤
ambient ─┘                    └─> master ─> compressor "glue" (-14 dB, 2.5:1) ─> limitador (-3 dB, 20:1) ─> trim 0.7 ─> saída
```

- O ganho de cada barramento é `v²`, uma curva perceptual. Os padrões são master 0.85, music 0.7, sfx 0.9 e ambient 0.7.
- Níveis medidos com o volume padrão:
  - Música: RMS de longo prazo ≈ −27 dBFS.
  - Efeitos de gameplay: picos de curto prazo (janela de 50 ms) entre −21 e −28 dBFS, ficando 4 a 8 dB acima da música.
  - Eventos grandes (relic, death, break_wall): ≈ −13 a −17 dBFS.
- **Limite de vozes:** cada som tem `max` (vozes simultâneas; a mais antiga é cortada com fade de 30 ms) e `gap` (retrigger mínimo). Exemplo: `step` tem max 2 e gap 70 ms. Também há um teto global de 48 vozes de efeito.
- **Performance:**
  - Os buffers de ruído (branco, rosa, marrom, estéreo e a textura de respingos) e a IR são gerados **uma vez** no `init`.
  - A música cria cerca de 15 a 30 nós por segundo, todos de vida curta e desconectados ao terminar.
  - 100 chamadas de `step` no mesmo frame criam 14 nós (o limitador descarta o resto).
  - O scheduler usa `setInterval` de 25 ms com lookahead de 150 ms. Se a aba travar, ele pula os passos atrasados em vez de disparar uma rajada.

## Efeitos — onde chamar

| som | quando chamar (sugestão) | opts úteis |
|---|---|---|
| `step` | animação `run` (8 frames, 12 fps): ao **entrar** nos frames **2 e 6** (os pés tocam o chão). Só no chão. | `{pan}` pela posição na tela. Cada passo já varia sozinho em pitch, timbre e respingo. Se quiser, use `volume: 0.6` quando ela andar devagar. |
| `jump` | quando o pulo do chão (ou coyote) é aceito | — |
| `double_jump` | quando o pulo duplo é aceito | — |
| `land` | no 1º frame em que ela toca o chão vinda do ar, **se `vy > 250`** | `volume: clamp((vy - 250) / (MAX_FALL - 250), 0.25, 1)` e `pitch: 1.1 - 0.2 * volume`. Abaixo de 250, não toque nada, ou toque `step` para não ficar mudo. |
| `whip` | no início do ataque (frame 0 de `attack`). O estalo cai ~110 ms depois, perto do frame 2 a 16 fps. | — |
| `whip_hit` | quando a hitbox do chicote acerta inimigo, parede ou objeto (uma vez por alvo) | `{pitch: 0.9..1.1}` varia o material; use pitch < 1 para pedra |
| `dash` | no início do dash | — |
| `grapple_fire` | ao lançar o gancho | — |
| `grapple_attach` | quando o gancho prende no ponto | — |
| `break_wall` | quando uma parede quebrável é destruída | `{pan}` |
| `pickup` | ao coletar um fragmento de mana. Coletas seguidas (< 0,7 s) **sobem automaticamente** pela pentatônica. | — |
| `heart_up` | ao pegar um coração ou aumentar a vida máxima | — |
| `relic` | ao obter uma habilidade nova ou relíquia (~3 s; recomendo baixar a música, ver abaixo) | — |
| `save` | ao salvar no ponto de save | — |
| `door` | no início da transição de sala (fade) | — |
| `potion` | ao beber uma poção | — |
| `book` | ao abrir o livro, ler uma página ou abrir o mapa | — |
| `menu_move` | a cada mudança de item do cursor | — |
| `menu_select` | ao confirmar | — |
| `menu_back` | ao voltar ou cancelar | — |
| `hurt` | ao tomar dano (no início do i-frame) | — |
| `death` | quando a vida chega a 0 (~3,5 s). Combine com `music(null)`. | — |
| `respawn` | quando ela reaparece no checkpoint | — |

### Música e ambiente

| situação | chamada |
|---|---|
| tela de título | `music('title')` |
| salas externas (céu aberto) | `music('exterior'); ambient('rain', 1); ambient('steam', 0)` |
| salas internas | `music('interior'); ambient('rain', 0.3)` (chuva abafada lá fora) |
| sala com canos de vapor | `ambient('steam', 0.5..1)` (pode variar com a distância até o cano) |
| torre / boss / área final | `music('tower')` |
| morte | `music(null)` e depois `play('death')`; no respawn, `music(<faixa da sala>)` |
| relâmpago visual | `Game.Audio.thunder()` no mesmo frame do flash |

`music(track)` não faz nada se a faixa pedida já estiver tocando, então pode ser chamada a cada troca de sala sem reiniciar o loop.
A chuva já inclui gotas metálicas aleatórias e um trovão **distante** raro, a cada 25 a 70 s, quando `level > 0.25`.

Para destacar o `relic`, abaixe a música e restaure depois:
```js
const v = Game.Audio.getVolume('music');
Game.Audio.setVolume('music', v * 0.4); Game.Audio.play('relic');
setTimeout(() => Game.Audio.setVolume('music', v), 3000);
```
Atenção: `setVolume` também grava no localStorage. Se o jogo for fechado no meio desses 3 s, o volume reduzido fica salvo.

## Músicas

Cada faixa tem **32 compassos** escritos. A cada nova passada, um gerador com semente por passada muda ornamentos, padrões e escolhas, então a repetição nunca é idêntica.

| faixa | tom / bpm | conteúdo |
|---|---|---|
| `title` | Ré menor, 64 | Órgão de tubos (onda periódica com registros 8'/4'/2⅔'/2'), pedal, sino de igreja a cada 8 compassos. Melodia de flauta na seção A; coral sintetizado (serra → formantes "oo/ah/oh") nas seções B a D. Arpejos opcionais. |
| `exterior` | Dó menor, 88 | Pulso de "batimento cardíaco", baixo ostinato em colcheias (3 padrões sorteados por seção), pad de cordas sintéticas. Tema curto de 8 compassos com delay; na repetição vem dobrado por sinos. Ponte com contracanto de sinos. |
| `interior` | Lá menor, 72 | Drone grave, pad abafado, percussão metálica distante (parciais inarmônicos com muito reverb), gotejamento, "caixinha de música" de vidro em passeio aleatório pela pentatônica, gemido de cano. |
| `tower` | Mi frígio, 100 | Sino grave em cada compasso, relógio, coro. Trêmolo de cordas a partir da 2ª seção e pulso de cordas que acelera. Progressão cromática ascendente na 3ª seção, com taikos. Clímax em B/C com sinos agudos e crescendo de ruído. |

## Como ajustar

- **Volume de um som:** em `audio.js`, cada entrada `SFX.nome = { gain, send, max, gap, fn }`:
  - `gain` multiplica o volume do som;
  - `send` é a quantidade de reverb;
  - `max` é o limite de vozes simultâneas;
  - `gap` é o intervalo mínimo entre disparos.
- **Timbre:** dentro de `fn(K)`:
  - `K.tone({f, f2, type|wave, a, hold, d, v, filter})` cria um oscilador com envelope;
  - `K.noise({buf, a, d, v, filter})` cria ruído filtrado;
  - `K.metal(at, f, razões, d, v)` cria parciais inarmônicos;
  - `K.bell(at, f, v, d)` cria um sino.
  O campo `at` é o atraso relativo ao início.
- **Reverb:** `makeIR()` controla RT60, as frequências dos modos de "ferro" e as reflexões iniciais. O retorno global é `vret` (0.8).
- **Música:** cada faixa em `TRACKS.<nome>` tem `bpm` e uma função `step(E, T, i, t, sd)`, chamada a cada semicolcheia. As progressões (`TITLE_CH`, `EXT_SEQ`, `INT_SEQ`, `TW_SEQ`) e as melodias (`seq('D5:2 C5:1 ...')`, com duração em tempos) são texto simples. Os níveis ficam nos argumentos `v` dos instrumentos `INS.*`.
- **Mix geral:** os padrões ficam em `DEFAULT_VOL`. O nível final é o `trim` (0.7) depois do limitador.
- **Chave de localStorage:** `noiteDeFerro.audio.v1` (`{vol:{master,music,sfx,ambient}, muted}`).

## Testes (resultados)

Ambiente: Chromium headless via Python Playwright, página `tools/audio_lab.html`, servida por `python3 -m http.server` **e** aberta via `file://`.

1. **Chamadas antes do `init()`:** `play`, `music`, `ambient`, `thunder`, `setVolume` e `mute` não deram erro. O estado desejado ficou guardado (a música 'title' começou ao clicar).
2. **Ao vivo:**
   - os 23 botões de efeito foram clicados;
   - as 4 músicas tocaram ~2,5 s cada (pico medido no analyser entre 0,05 e 0,16);
   - chuva, vapor e trovão foram ligados e a música parada.
   - Resultado: **0 erros de página e 0 avisos ou erros de console**, tanto em HTTP quanto em `file://`.
3. **Sem WebAudio:** com `AudioContext` removido, `init()` retornou `false`, as demais chamadas não fizeram nada, `setVolume`/`getVolume`/`mute` continuaram funcionando e não houve exceções.
4. **OfflineAudioContext** (44,1 kHz, estéreo, volumes padrão). Nenhum trecho ficou em silêncio e nenhum clipou:

| trecho | pico (linear) | pico dBFS | RMS 50 ms máx. dBFS |
|---|---|---|---|
| jump / double_jump / land | 0.14 / 0.20 / 0.16 | −16.8 / −13.9 / −15.8 | −26.6 / −23.5 / −23.0 |
| step | 0.14 | −16.8 | −31.5 |
| whip / whip_hit | 0.45 / 0.27 | −6.9 / −11.4 | −23.8 / −21.3 |
| dash / grapple_fire / grapple_attach | 0.18 / 0.18 / 0.18 | −14.8 / −15.1 / −14.7 | −25.4 / −27.9 / −23.4 |
| break_wall | 0.32 | −9.8 | −17.3 |
| pickup / heart_up / relic | 0.13 / 0.30 / 0.57 | −17.5 / −10.6 / −4.9 | −24.2 / −20.9 / −13.0 |
| save / door / potion / book | 0.23 / 0.17 / 0.29 / 0.22 | −12.7 / −15.6 / −10.6 / −13.2 | −22.3 / −23.8 / −22.1 / −28.9 |
| menu_move / select / back | 0.09 / 0.15 / 0.11 | −20.9 / −16.7 / −18.9 | −34.8 / −26.6 / −27.9 |
| death / hurt / respawn | 0.26 / 0.18 / 0.22 | −11.7 / −15.1 / −13.0 | −17.3 / −21.8 / −22.8 |
| música title (130 s) | 0.21 | −13.4 | RMS −25.4 |
| música exterior (130 s) | 0.28 | −11.1 | RMS −27.6 |
| música interior (130 s) | 0.18 | −15.0 | RMS −27.5 |
| música tower (130 s) | 0.42 | −7.5 | RMS −27.3 |
| chuva 1.0 + trovão | 0.35 | −9.2 | RMS −29.1 |
| vapor 1.0 | 0.11 | −19.4 | RMS −33.2 |
| estresse: 40× step em 1,2 s + 8× whip e whip_hit | 0.75 | −2.5 | — |
| mix: exterior + chuva + passos + chicote + parede + trovão + relic | 0.73 | −2.7 | — |
| crossfade title → tower → null | 0.18 | −15.1 | — |

5. **Carga:** a música cria de 15 a 29 nós de áudio por segundo, conforme a faixa. Os espectrogramas renderizados não mostraram DC nem cliques.

Para repetir: abra `tools/audio_lab.html` e clique em **"Renderizar e medir todos"**. Ou, num navegador automatizado, chame `await runAudioTests({musicSecs: 130})`.
