#!/usr/bin/env python3
"""
Teste de rota de Noite de Ferro: prova que o mundo é completável na ordem
prevista e que cada portão de habilidade realmente bloqueia sem a habilidade.

A simulação roda congelada (Game.Test.freeze) e avança em passos fixos de 1/60 s
com entradas virtuais, então o resultado é determinístico.

Uso:  python3 tools/route_test.py            (servidor http embutido)
      python3 tools/route_test.py --shots    (salva screenshots em tools/screens/route_*.png)
"""
import os, sys, json, time, socket, subprocess, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = '--shots' in sys.argv
OUT = os.path.join(ROOT, 'tools', 'screens')


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


class Runner:
    def __init__(self, page):
        self.pg = page
        self.fails = []
        self.passes = 0

    def js(self, expr, *args):
        return self.pg.evaluate(expr, *args)

    def place(self, room, tx, ty, abil=None):
        return self.js('([r,x,y,a]) => Game.Test.place(r,x,y,a)', [room, tx, ty, abil or {}])

    def run(self, seq):
        return self.js('(s) => Game.Test.run(s)', seq)

    def check(self, name, cond, info=None):
        if cond:
            self.passes += 1
            print('  ok   ', name)
        else:
            self.fails.append(name)
            print('  FALHA', name, '->', json.dumps(info, ensure_ascii=False) if info else '')

    def shot(self, name):
        if SHOTS:
            self.js('() => Game.Test.render()')
            self.pg.screenshot(path=os.path.join(OUT, 'route_' + name + '.png'))


def legs(R):
    NONE = {'double': False, 'dash': False, 'hook': False}
    D = {'double': True, 'dash': False, 'hook': False}
    DD = {'double': True, 'dash': True, 'hook': False}
    ALL = {'double': True, 'dash': True, 'hook': True}

    print('\n[1] Passarela: chicote quebra a parede rachada e abre a Fábrica')
    R.js('() => { Game.Save.wipe(); Game.G.newGame(); Game.Test.freeze(true); Game.Test.step(40); }')
    i = R.run([['walk', 49], ['tap', 'attack'], ['wait', 30]])
    R.check('ainda na passarela antes de quebrar', i['room'] == 'passarela', i)
    i = R.run([['walk', 51], ['tap', 'attack'], ['wait', 30]])
    broken = R.js('() => Object.keys(Game.G.state.broken).length')
    R.check('parede rachada quebrou com o chicote', broken == 1, i)
    R.shot('01_parede')
    i = R.run([['until', 'room:fabrica', 400, ['right']], ['wait', 20]])
    R.check('entrou na Fábrica de Canos', i['room'] == 'fabrica', i)

    print('\n[2] Fábrica: sem pulo duplo não sobe a grade; desce ao Porão pela grade do chão')
    R.place('fabrica', 15, 13, NONE)
    i = R.run([['hold', ['jump'], 40], ['wait', 40]])
    R.check('sem pulo duplo continua no chão da fábrica', i['ty'] == 13 and i['room'] == 'fabrica', i)
    R.place('fabrica', 41, 15, NONE)
    i = R.run([['hold', ['down', 'jump'], 2], ['until', 'room:porao', 200], ['until', 'grounded', 400]])
    R.check('caiu no Porão pela grade', i['room'] == 'porao', i)

    print('\n[3] Porão: parede rachada -> relíquia do PULO DUPLO')
    R.place('porao', 14, 14, NONE)
    i = R.run([['walk', 12], ['hold', ['left'], 2], ['tap', 'attack'], ['wait', 30], ['walk', 5], ['wait', 10]])
    R.check('obteve pulo duplo', i['abilities']['double'], i)
    R.shot('02_porao')
    print('    subindo as grades de volta à fábrica')
    i = R.run([['walk', 38], ['hold', ['jump'], 22], ['wait', 50],
               ['walk', 46], ['hold', ['jump'], 22], ['wait', 50],
               ['walk', 40], ['hold', ['jump'], 22], ['wait', 50],
               ['walk', 41], ['hold', ['jump'], 12], ['hold', ['jump'], 22], ['until', 'room:fabrica', 200], ['until', 'grounded', 300]])
    R.check('voltou do porão para a fábrica com pulo duplo', i['room'] == 'fabrica', i)

    print('\n[4] Fábrica -> Andaimes (pulo duplo) -> relíquia do DASH')
    R.place('fabrica', 12, 13, D)
    i = R.run([['walk', 12], ['hold', ['jump'], 12], ['wait', 4], ['hold', ['jump', 'right'], 30], ['until', 'grounded', 200]])
    R.check('subiu na grade alta com pulo duplo', i['ty'] == 8, i)
    i = R.run([['walk', 16], ['hold', ['jump'], 22], ['until', 'grounded', 120],
               ['hold', ['jump'], 22], ['until', 'grounded', 120],
               ['hold', ['jump'], 22], ['until', 'room:andaimes', 200], ['until', 'grounded', 300]])
    R.check('chegou aos Andaimes pelo poço', i['room'] == 'andaimes', i)
    i = R.run([['walk', 19], ['hold', ['jump'], 12], ['wait', 3], ['hold', ['jump', 'right'], 28], ['until', 'grounded', 200],
               ['walk', 20], ['hold', ['jump'], 12], ['wait', 3], ['hold', ['jump', 'left'], 30], ['until', 'grounded', 200],
               ['walk', 15], ['hold', ['jump'], 12], ['wait', 3], ['hold', ['jump', 'right'], 30], ['until', 'grounded', 200],
               ['walk', 22], ['hold', ['jump'], 22], ['hold', ['jump', 'right'], 10], ['until', 'grounded', 200]])
    R.check('subiu os andaimes até a grade da porta (linha 13)', i['ty'] == 12 and i['room'] == 'andaimes', i)
    i = R.run([['walk', 20], ['hold', ['jump', 'left'], 24], ['until', 'grounded', 200],
               ['walk', 12], ['hold', ['jump', 'left'], 24], ['until', 'grounded', 200], ['walk', 3], ['wait', 10]])
    R.check('obteve DASH', i['abilities']['dash'], i)
    R.shot('03_andaimes')

    print('\n[5] Ponte: sem gancho o vão é intransponível (mesmo com dash + pulo duplo)')
    R.place('ponte', 19, 12, DD)
    i = R.run([['walk', 19], ['hold', ['right'], 4], ['hold', ['right', 'jump'], 14], ['hold', ['right', 'jump'], 18], ['tap', 'dash'], ['hold', ['right'], 90]])
    R.check('caiu no vão sem gancho (perde coração)', i['hearts'] < i['maxHearts'] or i['dead'], i)

    print('\n[6] Fábrica: barreira de energia exige DASH -> Galeria')
    R.place('fabrica', 50, 13, D)
    i = R.run([['walk', 53], ['hold', ['right'], 60]])
    R.check('sem dash a barreira bloqueia', i['room'] == 'fabrica' and i['tx'] <= 53, i)
    R.place('fabrica', 52, 13, DD)
    i = R.run([['walk', 53], ['hold', ['right'], 4], ['hold', ['right', 'dash'], 1], ['hold', ['right'], 12], ['until', 'room:galeria', 200, ['right']]])
    R.check('dash atravessou a grade de energia até a Galeria', i['room'] == 'galeria', i)

    print('\n[7] Galeria -> Cisterna -> relíquia do GANCHO')
    R.place('galeria', 12, 13, DD)
    i = R.run([['walk', 13], ['hold', ['right', 'jump'], 14], ['hold', ['right', 'jump'], 20], ['until', 'grounded', 200, ['right']]])
    R.check('atravessou o fosso de espinhos (pulo duplo)', i['tx'] >= 21 and i['hearts'] == i['maxHearts'], i)
    i = R.run([['walk', 29], ['hold', ['right'], 18], ['until', 'grounded', 60], ['hold', ['down', 'jump'], 2], ['until', 'room:cisterna', 200], ['until', 'grounded', 400]])
    R.check('desceu à Cisterna', i['room'] == 'cisterna', i)
    i = R.run([['walk', 39], ['hold', ['right', 'jump'], 12], ['hold', ['right', 'jump'], 26], ['hold', ['right'], 30], ['until', 'grounded', 200]])
    R.check('pulou os espinhos e subiu no bloco alto', i['ty'] == 9, i)
    i = R.run([['walk', 54], ['wait', 10]])
    R.check('obteve GANCHO', i['abilities']['hook'], i)
    R.shot('04_cisterna')
    print('    voltando pela cisterna até a galeria')
    i = R.run([['walk', 50], ['hold', ['left'], 30], ['until', 'grounded', 200], ['walk', 32],
               ['hold', ['jump'], 22], ['until', 'grounded', 120],
               ['walk', 35], ['hold', ['jump'], 22], ['until', 'grounded', 120],
               ['walk', 32], ['hold', ['jump'], 22], ['until', 'grounded', 120],
               ['walk', 31], ['hold', ['jump'], 12], ['hold', ['jump'], 24], ['until', 'room:galeria', 200], ['until', 'grounded', 300]])
    R.check('subiu da cisterna para a galeria', i['room'] == 'galeria', i)

    print('\n[8] Ponte com GANCHO: argolas sobre o abismo até a Torre')
    R.place('ponte', 19, 12, ALL)
    seq = [['walk', 20], ['hold', ['jump', 'right'], 10], ['tap', 'attack'], ['until', 'hooked', 10]]
    i = R.run(seq)
    R.check('prendeu o chicote na primeira argola', i['hooked'], i)
    for k in range(3):
        i = R.run([['hold', ['right'], 26], ['tap', 'attack'], ['wait', 4]])
    i = R.run([['hold', ['right'], 20], ['hold', ['jump', 'right'], 16], ['until', 'grounded', 200, ['right']]])
    R.check('chegou à ilha central da ponte', i['tx'] >= 45 and i['tx'] <= 55 and i['room'] == 'ponte', i)
    R.shot('05_ponte')
    i = R.run([['walk', 55], ['hold', ['jump', 'right'], 10], ['tap', 'attack'], ['wait', 4]])
    for k in range(2):
        i = R.run([['hold', ['right'], 26], ['tap', 'attack'], ['wait', 4]])
    i = R.run([['hold', ['right'], 20], ['hold', ['jump', 'right'], 16], ['until', 'grounded', 200, ['right']]])
    R.check('atravessou o segundo vão', i['tx'] >= 76, i)
    i = R.run([['until', 'room:torre', 300, ['right']], ['until', 'grounded', 100]])
    R.check('entrou na Torre do Relógio', i['room'] == 'torre', i)

    print('\n[9] Galeria -> Torre pelas argolas sobre os espinhos')
    R.place('galeria', 35, 13, ALL)
    i = R.run([['walk', 36], ['hold', ['jump', 'right'], 10], ['tap', 'attack'], ['wait', 4]])
    for k in range(2):
        i = R.run([['hold', ['right'], 26], ['tap', 'attack'], ['wait', 4]])
    i = R.run([['hold', ['right'], 20], ['hold', ['jump', 'right'], 16], ['until', 'room:torre', 300, ['right']], ['until', 'grounded', 200]])
    R.check('galeria -> torre (base)', i['room'] == 'torre' and i['hearts'] == i['maxHearts'], i)

    print('\n[10] Torre: sem gancho não passa do 4º patamar; com gancho chega à Catedral')
    R.place('torre', 16, 35, D)
    i = R.run([['hold', ['jump'], 12], ['wait', 3], ['hold', ['jump', 'left'], 30], ['until', 'grounded', 200]])
    R.check('sem gancho não alcança o patamar da linha 28', i['ty'] > 27, i)
    R.place('torre', 13, 35, ALL)
    i = R.run([['hold', ['jump'], 14], ['tap', 'attack'], ['until', 'hooked', 6], ['hold', ['left'], 30], ['hold', ['jump', 'left'], 14], ['until', 'grounded', 200, ['left']]])
    R.check('com gancho chegou ao patamar da linha 28', i['ty'] == 27, i)
    i = R.run([['walk', 8], ['hold', ['jump'], 12], ['wait', 2], ['hold', ['jump', 'right'], 30], ['until', 'grounded', 200],
               ['walk', 17], ['hold', ['jump'], 12], ['wait', 2], ['hold', ['jump', 'right'], 30], ['until', 'grounded', 200],
               ['walk', 19], ['hold', ['jump'], 12], ['wait', 2], ['hold', ['jump', 'left'], 30], ['until', 'grounded', 200],
               ['walk', 16], ['hold', ['jump'], 12], ['wait', 2], ['hold', ['jump', 'right'], 30], ['until', 'grounded', 200],
               ['walk', 17], ['hold', ['jump'], 12], ['wait', 2], ['hold', ['jump', 'left'], 24], ['until', 'grounded', 200],
               ['walk', 14], ['hold', ['jump'], 14], ['until', 'room:catedral', 200], ['until', 'grounded', 300]])
    R.check('subiu a torre até a Catedral do Sino', i['room'] == 'catedral', i)
    R.shot('06_torre')

    print('\n[11] Catedral: tocar o sino termina o jogo')
    i = R.run([['walk', 47], ['hold', ['up'], 2], ['wait', 20]])
    fin = R.js('() => Game.G.state.finished')
    R.check('sino tocado (state.finished)', fin, i)
    R.shot('07_sino')


def main():
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 960, 'height': 540})
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.goto('http://127.0.0.1:%d/index.html' % port)
            pg.wait_for_function('() => window.__game && window.__game.scene === "title"', timeout=20000)
            R = Runner(pg)
            legs(R)
            b.close()
    finally:
        srv.terminate()
    print('\nResultado: %d ok, %d falhas, %d erros de console' % (R.passes, len(R.fails), len(errors)))
    for e in errors:
        print('  console:', e)
    sys.exit(1 if (R.fails or errors) else 0)


if __name__ == '__main__':
    main()
