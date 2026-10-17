# Como contribuir

## Branches

- `main` é sempre jogável: cada push nela publica o jogo no GitHub Pages.
- Trabalhe em uma branch a partir da `main`, com prefixo pelo tipo:
  `feat/inimigos-robo`, `fix/colisao-escada`, `arte/tile-telhado`, `som/chuva`, `docs/readme`, `ci/pages`.
- Abra um pull request para a `main`. O CI precisa passar antes do merge.
- Mantenha a branch atualizada com `git pull --rebase origin main`.

## Commits (em português)

Formato: `<área>: <o que mudou, no imperativo>` — linha curta (até ~72 caracteres), corpo opcional explicando o porquê.

Áreas usuais: `motor`, `jogo`, `mundo`, `ui`, `som`, `arte`, `assets`, `ferramentas`, `ci`, `docs`.

```
motor: corrige pulo duplo ao sair de plataforma
arte: refaz emenda horizontal do tile_deck
ci: publica apenas src/ e assets/ no Pages
```

- Um assunto por commit.
- Arquivos em `assets/game/` são gerados: altere os scripts em `tools/` e regenere com
  `python3 tools/build_assets.py --clean`, comitando o script e o resultado juntos.

## Testes e CI localmente

Requisitos: Node 18+ e Python 3.10+.

```bash
bash tools/ci/check_syntax.sh          # sintaxe de todos os .js
node tools/ci/check_manifest.js        # arquivos do manifesto existem

# smoke test no navegador
pip install playwright && python3 -m playwright install chromium
python3 -m http.server 8000 &          # em outro terminal, se preferir
python3 tools/smoke_test.py
```

Para conferir o site como ele vai para o Pages, rode o passo "Montar _site" de
`.github/workflows/pages.yml` e sirva a pasta: `python3 -m http.server -d _site 8000`.
