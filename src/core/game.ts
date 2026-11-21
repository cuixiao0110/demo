// 纯规则。关卡、订单和工位共用以毫秒表示的营业时钟。
import type { Config } from '../config';

export type Step = keyof Config['steps'];
export type Blade = keyof Config['blades'];
export type BenchId = Step | 'bufferA' | 'bufferB';
export type StationId = BenchId | 'rack' | 'delivery';

export interface Order {
  id: number;
  slot: number;
  blade: Blade;
  deadline: number | null;
  claimed: boolean;
}

export interface Piece {
  orderId: number;
  blade: Blade;
  step: number;
  quality: 'ordinary' | 'precise';
  struck: boolean;
}

interface Bench {
  piece: Piece;
  completesAt: number | null;
}

export interface DayReport {
  day: number;
  score: number;
  target: number;
  delivered: number;
  precise: number;
  expired: number;
  passed: boolean;
}

export interface GameState {
  phase: 'tutorial' | 'open' | 'report' | 'final';
  day: number;
  elapsed: number;
  nextArrival: number;
  scheduleIndex: number;
  nextOrderId: number;
  orders: Order[];
  held: Piece | null;
  benches: Partial<Record<BenchId, Bench>>;
  score: number;
  delivered: number;
  precise: number;
  expired: number;
  history: DayReport[];
  report: DayReport | null;
}

export type Interaction =
  | { kind: 'blocked' | 'taken' | 'placed' | 'precise' | 'ordinary'; message: string }
  | { kind: 'delivered'; message: string; points: number };

function issueOrder(game: GameState, blade: Blade, deadline: number | null, capacity: number) {
  const slot = Array.from({ length: capacity }, (_, index) => index + 1)
    .find((number) => game.orders.every((order) => order.slot !== number));
  if (slot === undefined) return;
  game.orders.push({ id: game.nextOrderId++, slot, blade, deadline, claimed: false });
}

function issueScheduledOrder(game: GameState, config: Config, time: number) {
  const day = config.days[game.day - 1];
  if (game.orders.length >= day.capacity) return;
  const blade = day.sequence[game.scheduleIndex % day.sequence.length];
  issueOrder(game, blade, Math.min(day.duration, time + config.blades[blade].limit), day.capacity);
  game.scheduleIndex += 1;
}

function openDay(config: Config, day: number, history: DayReport[], nextOrderId: number, tutorial = false): GameState {
  const game: GameState = {
    phase: tutorial ? 'tutorial' : 'open',
    day,
    elapsed: 0,
    nextArrival: config.days[day - 1].interval,
    scheduleIndex: 0,
    nextOrderId,
    orders: [],
    held: null,
    benches: {},
    score: config.game.startScore,
    delivered: 0,
    precise: 0,
    expired: 0,
    history,
    report: null,
  };
  if (tutorial) issueOrder(game, 'small', null, 1);
  else issueScheduledOrder(game, config, 0);
  return game;
}

export function newGame(config: Config, tutorial = false): GameState {
  return openDay(config, 1, [], 1, tutorial);
}

export function startBusiness(game: GameState, config: Config) {
  if (game.phase === 'tutorial') Object.assign(game, newGame(config));
}

export function addScore(state: GameState, points: number) {
  state.score = Math.max(0, state.score + points);
}

function expireOrders(game: GameState, time: number) {
  const expired = new Set(game.orders
    .filter((order) => order.deadline !== null && order.deadline <= time)
    .map((order) => order.id));
  if (!expired.size) return;

  game.expired += expired.size;
  game.orders = game.orders.filter((order) => !expired.has(order.id));
  if (game.held && expired.has(game.held.orderId)) game.held = null;
  for (const id of Object.keys(game.benches) as BenchId[]) {
    if (expired.has(game.benches[id]!.piece.orderId)) delete game.benches[id];
  }
}

export function tick(game: GameState, config: Config, delta: number) {
  const events = { expired: 0, completed: false, cooled: false };
  if (game.phase !== 'open' && game.phase !== 'tutorial') return events;

  const day = config.days[game.day - 1];
  const previousExpired = game.expired;
  const elapsed = game.elapsed + Math.max(0, delta);
  game.elapsed = game.phase === 'open' ? Math.min(day.duration, elapsed) : elapsed;
  if (game.phase === 'open') {
    while (game.nextArrival <= game.elapsed && game.nextArrival < day.duration - config.game.stopOrdersBeforeClosing) {
      // 同一时刻先释放到期单的卡位，再发新单。
      expireOrders(game, game.nextArrival);
      issueScheduledOrder(game, config, game.nextArrival);
      game.nextArrival += day.interval;
    }
    expireOrders(game, game.elapsed);
    events.expired = game.expired - previousExpired;
  }

  for (const [id, bench] of Object.entries(game.benches)) {
    if (bench.completesAt !== null && bench.completesAt <= game.elapsed) {
      bench.completesAt = null;
      bench.piece.step += 1;
      events.completed = true;
      if (id === 'cool') events.cooled = true;
    }
  }

  if (game.phase === 'open' && game.elapsed >= day.duration) {
    game.report = {
      day: game.day, score: game.score, target: day.target, delivered: game.delivered,
      precise: game.precise, expired: game.expired, passed: game.score >= day.target,
    };
    game.phase = 'report';
  }
  return events;
}

export function nextStep(piece: Piece, config: Config): Step | undefined {
  const recipe: readonly Step[] = config.blades[piece.blade].recipe;
  return recipe[piece.step];
}

const blocked = (message: string): Interaction => ({ kind: 'blocked', message });

function takeFromRack(game: GameState, selectedSlot: number): Interaction {
  if (game.held) return blocked('手里还有一把刀');
  const order = game.orders.find(({ slot }) => slot === selectedSlot);
  if (!order) return blocked('先按数字键选一张订单');
  if (order.claimed) return blocked('这一单已经领过刀坯');
  order.claimed = true;
  game.held = { orderId: order.id, blade: order.blade, step: 0, quality: 'ordinary', struck: false };
  return { kind: 'taken', message: `领取 #${order.slot} 刀坯` };
}

function deliver(game: GameState, config: Config): Interaction {
  const piece = game.held;
  if (!piece) return blocked('带着成品来交付');
  const step = nextStep(piece, config);
  if (step) return blocked(`还要${config.steps[step].label}`);
  const order = game.orders.find(({ id }) => id === piece.orderId);
  if (!order || order.blade !== piece.blade) return blocked('没有对应的有效订单');

  const blade = config.blades[piece.blade];
  const precise = piece.quality === 'precise';
  const points = blade.points + (precise ? blade.bonus : 0);
  game.orders = game.orders.filter(({ id }) => id !== order.id);
  game.held = null;
  game.delivered += 1;
  if (precise) game.precise += 1;
  addScore(game, points);
  const detail = precise ? ` · 精准 +${blade.bonus}` : '';
  return { kind: 'delivered', points, message: `交付 ${blade.name} +${points} 分${detail}` };
}

export function interact(game: GameState, config: Config, station: StationId, selectedSlot = 0): Interaction {
  if (game.phase !== 'open' && game.phase !== 'tutorial') return blocked('今天已经收工');
  if (station === 'rack') return takeFromRack(game, selectedSlot);
  if (station === 'delivery') return deliver(game, config);

  const bench = game.benches[station];
  if (bench) {
    if (game.held) return blocked('工位已占用');
    if (bench.completesAt !== null) return blocked('加工还没完成');
    game.held = bench.piece;
    delete game.benches[station];
    return { kind: 'taken', message: '取回刀坯' };
  }
  if (!game.held) return blocked('工位是空的');

  const piece = game.held;
  const buffering = station === 'bufferA' || station === 'bufferB';
  if (!buffering) {
    const step = nextStep(piece, config);
    if (step !== station) return blocked(step ? `下一道工序是${config.steps[step].label}` : '已经完工，可以交付');
  }
  game.benches[station] = { piece, completesAt: buffering ? null : game.elapsed + config.steps[station].duration };
  game.held = null;
  return { kind: 'placed', message: buffering ? '已暂存' : '开始加工' };
}

export function forgeProgress(game: GameState, config: Config): number | null {
  const forging = game.benches.forge;
  if (!forging || forging.completesAt === null) return null;
  return 1 - (forging.completesAt - game.elapsed) / config.steps.forge.duration;
}

export function strike(game: GameState, config: Config): Interaction {
  const forging = game.benches.forge;
  const progress = forgeProgress(game, config);
  if (game.held || !forging || progress === null) return blocked('空手靠近正在加工的铁砧再落锤');
  if (forging.piece.struck) return blocked('这把刀已经落过锤');

  const precise = progress >= config.game.strikeFrom && progress <= config.game.strikeTo;
  forging.piece.struck = true;
  forging.piece.quality = precise ? 'precise' : 'ordinary';
  return { kind: forging.piece.quality, message: precise ? '精准！交付加分' : '普通落锤' };
}

export function nextDay(game: GameState, config: Config) {
  if (game.phase !== 'report' || !game.report?.passed) return;

  const history = [...game.history, game.report];
  if (game.day === config.days.length) {
    game.history = history;
    game.phase = 'final';
    return;
  }
  Object.assign(game, openDay(config, game.day + 1, history, game.nextOrderId));
}

export function retryDay(game: GameState, config: Config) {
  if (game.phase === 'report' && game.report && !game.report.passed) {
    Object.assign(game, openDay(config, game.day, game.history, game.nextOrderId));
  }
}

export function endRun(game: GameState) {
  if (game.phase === 'report' && game.report && !game.report.passed) game.phase = 'final';
}
