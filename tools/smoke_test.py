#!/usr/bin/env python3
"""
Smoke test de Noite de Ferro (Playwright + Chromium headless).

Carrega o jogo servido por HTTP e também via file://, verifica que não há erros
de console, joga com o TECLADO em tempo real (andar, pular, chicote, dash,
mudar de sala), abre mapa/pausa, salva numa estátua e recarrega com "Continuar".
Screenshots em tools/screens/smoke_*.png.

Uso:  python3 tools/smoke_test.py
Saída != 0 em caso de falha.
"""
import os, sys, time, socket, subprocess
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', 'screens')
os.makedirs(OUT, exist_ok=True)

fails, oks = [], []


def check(name, cond, extra=''):
    (oks if cond else fails).append(name)
    print(('  ok    ' if cond else '  FALHA ') + name + ('' if cond else '  ' + str(extra)))


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def info(pg):
    return pg.evaluate('() => Game.Test.info()')


def press(pg, key, ms=90):
    pg.keyboard.down(key); pg.wait_for_timeout(ms); pg.keyboard.up(key)


def shot(pg, name):
    pg.screenshot(path=os.path.join(OUT, 'smoke_' + name + '.png'))


def play_session(pg, errors):
    pg.wait_for_function('() => window.__game && window.__game.scene === "title"', timeout=20000)
    pg.wait_for_timeout(600)
    shot(pg, '01_title')
    loaded = pg.evaluate('() => Game.Assets.loaded.length')
    print('    assets carregados:', loaded)

    # Novo jogo (sem save: primeira opção visível é "Novo jogo")
    pg.evaluate('() => Game.Save.wipe()')
    pg.evaluate('() => Game.Title.enter()')
    press(pg, 'Enter')
    pg.wait_for_timeout(900)
    i = info(pg)
    check('novo jogo inicia na Passarela', i['scene'] == 'play' and i['room'] == 'passarela', i)
    shot(pg, '02_start')

    # andar para a direita
    x0 = i['x']
    pg.keyboard.down('ArrowRight'); pg.wait_for_timeout(500)
    i = info(pg)
    check('anda para a direita', i['x'] > x0 + 60, i)
    # pulo variável: toque curto vs. segurar
    pg.keyboard.up('ArrowRight'); pg.wait_for_timeout(300)
    y0 = info(pg)['y']
    pg.keyboard.down('Space'); pg.wait_for_timeout(60); pg.keyboard.up('Space')
    best_short = y0
    for _ in range(14):
        pg.wait_for_timeout(30); best_short = min(best_short, info(pg)['y'])
    pg.wait_for_timeout(500)
    y0 = info(pg)['y']
    pg.keyboard.down('Space')
    best_long = y0
    for _ in range(20):
        pg.wait_for_timeout(30); best_long = min(best_long, info(pg)['y'])
    pg.keyboard.up('Space')
    check('pulo variável (segurar sobe mais)', (y0 - best_long) > (y0 - best_short) + 25, (y0 - best_short, y0 - best_long))
    pg.wait_for_timeout(700)
    check('pousa de volta no chão', info(pg)['grounded'])

    # chicote
    pg.keyboard.down('KeyX')
    atk = pg.evaluate('() => new Promise(r => { let seen = false; const t0 = performance.now(); (function f() { if (Game.G.player.attackT > 0) seen = true; if (seen || performance.now() - t0 > 600) r(seen); else requestAnimationFrame(f); })(); })')
    pg.keyboard.up('KeyX')
    check('chicote dispara o ataque (tecla X)', atk, atk)
    # quadro congelado no meio do golpe para o screenshot
    pg.evaluate('() => { Game.Test.freeze(true); Game.Test.tap("attack"); Game.Test.step(9); Game.Test.render(); }')
    shot(pg, '03_whip')
    pg.evaluate('() => { Game.Test.step(20); Game.Test.freeze(false); }')
    pg.wait_for_timeout(200)

    # acender a estátua com ↑ (ela está perto do início)
    pg.evaluate('() => Game.Test.place("passarela", 8, 10)')
    pg.wait_for_timeout(100)
    press(pg, 'ArrowUp', 120)
    pg.wait_for_timeout(300)
    saved = pg.evaluate('() => !!localStorage.getItem(Game.CONFIG.SAVE_KEY)')
    check('estátua salva no localStorage', saved)
    shot(pg, '04_save')

    # mapa e pausa
    press(pg, 'KeyM'); pg.wait_for_timeout(300)
    check('mapa abre (M)', info(pg)['overlay'] == 'map')
    shot(pg, '05_map')
    press(pg, 'KeyM'); pg.wait_for_timeout(200)
    check('mapa fecha', info(pg)['overlay'] is None)
    press(pg, 'Escape'); pg.wait_for_timeout(300)
    check('pausa abre (Esc)', info(pg)['overlay'] == 'pause')
    shot(pg, '06_pause')
    press(pg, 'Escape'); pg.wait_for_timeout(200)
    check('pausa fecha', info(pg)['overlay'] is None)

    # dash (dá a habilidade via debug F2) e atravessar a sala até a Fábrica
    pg.evaluate('() => Game.Test.place("passarela", 47, 10, {double:true, dash:true, hook:true})')
    pg.evaluate('() => { Game.World.applyBroken("passarela:52,7"); Game.G.state.broken["passarela:52,7"] = true; }')
    pg.wait_for_timeout(100)
    x0 = info(pg)['x']
    pg.keyboard.down('ArrowRight'); press(pg, 'KeyC', 60); pg.wait_for_timeout(160)
    i = info(pg)
    shot(pg, '07_dash')
    check('dash acelera (mais rápido que correr)', i['x'] - x0 > 110, i['x'] - x0)
    pg.wait_for_timeout(1500)
    pg.keyboard.up('ArrowRight')
    pg.wait_for_timeout(400)
    i = info(pg)
    check('transição de sala Passarela -> Fábrica', i['room'] == 'fabrica', i)
    shot(pg, '08_fabrica')

    # gancho na ponte (tempo real)
    pg.evaluate('() => Game.Test.place("ponte", 20, 12, {double:true, dash:true, hook:true})')
    pg.wait_for_timeout(150)
    pg.keyboard.down('ArrowRight'); pg.wait_for_timeout(80)
    pg.keyboard.down('Space'); pg.wait_for_timeout(140)
    press(pg, 'KeyX', 60)
    pg.wait_for_timeout(200)
    i = info(pg)
    shot(pg, '09_hook')
    pg.keyboard.up('Space'); pg.keyboard.up('ArrowRight')
    check('gancho prende na argola', i['hooked'], i)
    pg.wait_for_timeout(300)

    # salas visuais extras
    for rid, tx, ty, nm in [('porao', 30, 14, '10_porao'), ('andaimes', 22, 30, '11_andaimes'), ('torre', 6, 47, '12_torre'),
                            ('galeria', 26, 13, '13_galeria'), ('cisterna', 25, 14, '14_cisterna'), ('catedral', 30, 13, '15_catedral'),
                            ('telhado', 6, 12, '16_telhado')]:
        pg.evaluate('([r,x,y]) => { Game.Test.place(r,x,y,{double:true,dash:true,hook:true}); Game.G.banner = null; }', [rid, tx, ty])
        pg.wait_for_timeout(450)
        shot(pg, nm)
        check('sala %s carregada' % rid, info(pg)['room'] == rid)

    # desempenho
    pg.evaluate('() => Game.Test.place("passarela", 30, 10)')
    pg.wait_for_timeout(2000)
    fps = pg.evaluate('() => Game.Loop.fps')
    ms = pg.evaluate('() => Game.Loop.frameMs')
    print('    FPS headless: %.0f   tempo de quadro: %.2f ms' % (fps, ms))
    # benchmark: 120 quadros de update+render com flush (getImageData força a rasterização)
    bench = pg.evaluate('''() => { Game.Test.freeze(true); Game.Test.hold('right');
        const g = Game.Screen.g; const t0 = performance.now();
        for (let i = 0; i < 120; i++) { Game.Test.step(1); Game.Test.render(); g.getImageData(0, 0, 1, 1); }
        const dt = (performance.now() - t0) / 120; Game.Test.release(); Game.Test.freeze(false); return dt; }''')
    print('    benchmark: %.2f ms/quadro (update+render, Chromium headless por software)' % bench)
    check('quadro médio < 40 ms mesmo com render por software (sem GPU, 1280x720)', bench < 40, bench)

    # debug F1
    press(pg, 'F1'); pg.wait_for_timeout(250)
    shot(pg, '17_debug')
    check('debug liga (F1)', pg.evaluate('() => Game.G.debug'))
    press(pg, 'F1')

    # recarregar e continuar
    pg.reload()
    pg.wait_for_function('() => window.__game && window.__game.scene === "title"', timeout=20000)
    pg.wait_for_timeout(300)
    press(pg, 'Enter')  # "Continuar" é a primeira opção quando há save
    pg.wait_for_timeout(900)
    i = info(pg)
    check('Continuar restaura o save (Passarela)', i['scene'] == 'play' and i['room'] == 'passarela', i)

    # morte por queda volta ao chão seguro / save
    pg.evaluate('() => Game.Test.place("passarela", 20, 10)')
    pg.keyboard.down('ArrowRight'); pg.wait_for_timeout(900); pg.keyboard.up('ArrowRight')
    pg.wait_for_timeout(2000)
    i = info(pg)
    check('cair no vão tira coração e reposiciona', i['hearts'] < i['maxHearts'] and i['room'] == 'passarela' and i['grounded'], i)


def main():
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            print('[HTTP]')
            ctx = b.new_context(viewport={'width': 1280, 'height': 720})
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
            pg.on('console', lambda m: errors.append('console.error: ' + m.text) if m.type == 'error' else None)
            pg.goto('http://127.0.0.1:%d/index.html' % port)
            play_session(pg, errors)
            ctx.close()

            print('[file://]')
            ctx = b.new_context(viewport={'width': 960, 'height': 540})
            pg = ctx.new_page()
            ferr = []
            pg.on('pageerror', lambda e: ferr.append('pageerror: ' + str(e)))
            pg.on('console', lambda m: ferr.append('console.error: ' + m.text) if m.type == 'error' else None)
            pg.goto('file://' + os.path.join(ROOT, 'index.html'))
            pg.wait_for_function('() => window.__game && window.__game.scene === "title"', timeout=20000)
            n = pg.evaluate('() => Game.Assets.loaded.length')
            press(pg, 'Enter'); pg.wait_for_timeout(800)
            check('file:// inicia o jogo', info(pg)['scene'] == 'play')
            check('file:// carrega assets (%d)' % n, n > 0)
            shot(pg, '18_file')
            errors += ferr
            ctx.close()

            print('[sem assets / placeholders]')
            ctx = b.new_context(viewport={'width': 960, 'height': 540})
            pg = ctx.new_page()
            perr = []
            pg.on('pageerror', lambda e: perr.append('pageerror: ' + str(e)))
            pg.goto('http://127.0.0.1:%d/index.html?assets=nao/existe/' % port)
            pg.wait_for_function('() => window.__game && window.__game.scene === "title"', timeout=20000)
            press(pg, 'Enter'); pg.wait_for_timeout(800)
            pg.keyboard.down('ArrowRight'); pg.wait_for_timeout(400); press(pg, 'KeyX'); pg.wait_for_timeout(60)
            shot(pg, '19_placeholders')
            pg.keyboard.up('ArrowRight')
            check('roda só com placeholders', info(pg)['scene'] == 'play' and not perr, perr)
            errors += perr
            ctx.close()

            print('[toque]')
            ctx = b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)
            pg = ctx.new_page()
            terr = []
            pg.on('pageerror', lambda e: terr.append('pageerror: ' + str(e)))
            pg.goto('http://127.0.0.1:%d/index.html' % port)
            pg.wait_for_function('() => window.__game && window.__game.scene === "title"', timeout=20000)
            pg.evaluate('() => { Game.Save.wipe(); Game.Title.enter(); Game.G.newGame(); }')
            pg.wait_for_timeout(800)
            check('controles de toque habilitados', pg.evaluate('() => Game.Touch.enabled'))
            shot(pg, '20_touch')
            errors += terr
            ctx.close()
            b.close()
    finally:
        srv.terminate()
    print('\nResultado: %d ok, %d falhas, %d erros de console' % (len(oks), len(fails), len(errors)))
    for e in errors:
        print('  ', e)
    sys.exit(1 if (fails or errors) else 0)


if __name__ == '__main__':
    main()
