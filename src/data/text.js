/* Textos do jogo: habilidades, livros de lore, créditos. */
window.Game = window.Game || {};

Game.TEXT = {
  title: 'Noite de Ferro',
  subtitle: 'um protótipo metroidvania',
  credits: [
    'Noite de Ferro — protótipo',
    'Motor e design: HTML5 Canvas + JavaScript puro',
    'Arte derivada da ilustração de referência do projeto',
    'Som sintetizado via WebAudio',
    'Obrigado por jogar!'
  ],

  abilities: {
    double: {
      name: 'Asas de Fuligem',
      what: 'PULO DUPLO',
      desc: 'Pule novamente no ar para alcançar grades e plataformas altas.',
      how: (L) => 'Aperte ' + L('jump') + ' de novo no ar.'
    },
    dash: {
      name: 'Passo Relâmpago',
      what: 'DASH',
      desc: 'Um avanço veloz que cruza vãos largos e atravessa grades de energia.',
      how: (L) => 'Aperte ' + L('dash') + ' (funciona também no ar, uma vez por salto).'
    },
    hook: {
      name: 'Laço de Luz',
      what: 'GANCHO DO CHICOTE',
      desc: 'Prenda o chicote nas argolas de ferro e balance sobre abismos.',
      how: (L) => 'No ar, aperte ' + L('attack') + ' perto de uma argola. ' + L('left') + '/' + L('right') + ' balança, ' + L('jump') + ' solta com impulso, ' + L('down') + ' larga.'
    }
  },

  // Livros: um por id de sala (ordem de leitura livre)
  books: {
    passarela: ['Diário da caçadora — pág. 1',
      'A chuva não para há onze noites. As gárgulas da passarela guardam a luz dos que caíram: toque-as com o chicote e elas lembrarão de você.'],
    telhado: ['Bilhete preso numa chaminé',
      '"Quem sobe pelas grades da fábrica chega ao telhado. Quem desce pelos canos chega ao porão. Quem tem asas, chega a ambos."'],
    fabrica: ['Manual do capataz',
      'As barreiras elétricas só deixam passar o que é mais rápido que a corrente. Nenhum operário jamais conseguiu.'],
    porao: ['Inscrição na parede',
      'Sob a fábrica dorme uma relíquia de fuligem. Paredes rachadas cedem ao golpe de quem tem paciência.'],
    ponte: ['Placa da Ponte dos Holofotes',
      'Cuidado: o vão central desabou. Os vigias atravessam pelas argolas dos holofotes — ou não atravessam.'],
    galeria: ['Carta molhada',
      'Desci pela grade da galeria até a cisterna velha. Lá embaixo, uma argola sobre os espinhos… e um brilho dourado depois dela.'],
    cisterna: ['Registro da cisterna',
      'O nível da água subiu de novo. O Laço de Luz foi escondido aqui, longe da torre, para que ninguém tocasse o sino.'],
    torre: ['Gravação no relógio',
      'Cada argola da torre foi forjada para quem domina o laço. Suba, e a cidade inteira ouvirá o sino.'],
    catedral: ['Último registro',
      'Quando o sino tocar, a noite de ferro termina. Pelo menos esta noite.']
  },

  ending: [
    'O sino de bronze ecoa sobre a cidade encharcada.',
    'Os holofotes se apagam, um a um. A chuva, por fim, enfraquece.',
    'A noite de ferro terminou — por enquanto.'
  ]
};
