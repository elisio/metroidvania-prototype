/*
 * Noite de Ferro — constantes globais e de "game feel".
 * Todas as unidades de distância estão em pixels de mundo (1 tile = 32 px),
 * velocidades em px/s e acelerações em px/s².
 * Ajuste aqui para mudar a sensação do jogo sem mexer no código.
 */
window.Game = window.Game || {};

Game.CONFIG = {
  // --- Tela / mundo ---
  VIEW_W: 960,
  VIEW_H: 540,
  TILE: 32,
  CELL_W: 30,             // largura (em tiles) de uma "célula" do mapa
  CELL_H: 17,             // altura (em tiles) de uma célula do mapa
  MAX_RENDER_SCALE: 2,    // resolução interna máxima (x960×540) para textos nítidos
  FIXED_DT: 1 / 60,       // passo fixo da simulação
  MAX_STEPS_PER_FRAME: 5,

  // --- Personagem ---
  HITBOX_W: 36,
  HITBOX_H: 120,
  SPRITE_SCALE: 1.0,      // o sheet já vem na escala do jogo (0.5 da referência)

  RUN_SPEED: 270,
  GROUND_ACCEL: 2800,
  GROUND_DECEL: 3400,
  AIR_ACCEL: 2000,
  AIR_DECEL: 900,
  OVERSPEED_DECEL: 320,   // desaceleração quando acima da velocidade de corrida (pós-balanço)
  TURN_BOOST: 1.6,        // multiplica a aceleração ao inverter a direção
  ATTACK_GROUND_SPEED: 0.3, // fração da velocidade ao atacar no chão

  GRAVITY: 2100,
  FALL_GRAVITY_MULT: 1.45,  // queda mais pesada que a subida
  APEX_GRAVITY_MULT: 0.6,   // "flutuação" no topo do pulo com o botão segurado
  APEX_THRESHOLD: 90,
  MAX_FALL: 920,

  JUMP_VELOCITY: 720,       // ~3,8 tiles de altura
  DOUBLE_JUMP_VELOCITY: 640,// total com pulo duplo ~6,9 tiles
  JUMP_CUT: 0.45,           // soltar o botão multiplica vy por isso (pulo variável)
  COYOTE_TIME: 0.10,
  JUMP_BUFFER: 0.13,
  DROP_THROUGH_TIME: 0.22,

  CORNER_CORRECTION: 12,    // px: desliza na quina ao bater a cabeça
  LEDGE_ASSIST: 10,         // px: sobe a borda se os pés ficaram um pouco abaixo
  STEP_HEIGHT: 33,          // degraus de escada (tile 'S')

  DASH_SPEED: 760,
  DASH_TIME: 0.17,
  DASH_COOLDOWN: 0.30,

  ATTACK_TIME: 0.30,
  ATTACK_ACTIVE_START: 0.09,
  ATTACK_ACTIVE_END: 0.22,
  WHIP_LENGTH: 132,
  WHIP_HIT_H: 30,

  HOOK_RANGE: 256,
  HOOK_PULL_SPEED: 520,
  HOOK_HANG: 44,            // distância argola→centro do corpo quando totalmente puxada
  HOOK_PUMP: 700,           // aceleração tangencial ao balançar com ←/→
  HOOK_MAX_SPEED: 900,
  HOOK_RELEASE_JUMP: 0.92,  // fração do pulo ao soltar com PULAR

  ROOM_ENTER_UP_BOOST: 780, // impulso ao entrar numa sala por baixo (poço vertical)
  INVULN_TIME: 1.0,

  // --- Câmera ---
  CAMERA: {
    LOOKAHEAD_X: 70,
    LOOK_UP: 30,
    DEADZONE_X: 30,
    DEADZONE_Y: 48,
    SMOOTH_X: 7,
    SMOOTH_Y: 6,
    FALL_LOOKDOWN: 110
  },

  // --- Transições ---
  TRANSITION_OUT: 0.16,
  TRANSITION_IN: 0.24,

  // --- Progresso ---
  START_HEARTS: 3,
  MAX_HEARTS_CAP: 6,
  START_MANA: 60,
  MANA_PER_FRAGMENT: 20,
  MANA_REGEN: 3,            // por segundo
  FOCUS_COST: 40,           // mana gasta para curar 1 coração sem poção
  POTION_HEAL: 2,
  START_POTIONS: 1,
  MAX_POTIONS: 5,
  HAZARD_DAMAGE: 1,         // espinhos / queda: perde 1 coração e volta ao chão seguro;
                            // com 0 corações -> morte -> último save
  HAZARD_MODE: 'checkpoint',// 'checkpoint' (padrão) ou 'save' (qualquer perigo volta ao save)

  // --- Ambiente ---
  RAIN_DROPS: 240,
  RAIN_ANGLE: 0.22,         // inclinação da chuva (vx = -angle * vy)
  SPLASHES_PER_SEC: 26,
  LIGHTNING_MIN: 7,
  LIGHTNING_MAX: 18,
  MAX_PARTICLES: 700,

  SAVE_KEY: 'noiteDeFerro.save.v1',
  SETTINGS_KEY: 'noiteDeFerro.settings.v1'
};
