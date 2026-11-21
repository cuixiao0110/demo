import { describe, expect, test } from 'vitest';
import { CONFIG } from '../src/config';
import * as workshop from '../src/core/game';
import type { GameState, StationId } from '../src/core/game';

const { newGame, interact, tick, strike, nextDay, retryDay, endRun, startBusiness } = workshop;

function finishStep(game: GameState, station: StationId, milliseconds: number) {
  expect(interact(game, CONFIG, station).kind).toBe('placed');
  tick(game, CONFIG, milliseconds);
  expect(interact(game, CONFIG, station).kind).toBe('taken');
}

describe('铁匠铺订单和工位', () => {
  test('开场有一张限时小刀单，第 16 秒发菜刀单', () => {
    const game = newGame(CONFIG);
    expect(game.orders?.map(({ blade, deadline }) => [blade, deadline])).toEqual([['small', 32000]]);
    tick(game, CONFIG, 16000);
    expect(game.orders.map(({ slot, blade }) => [slot, blade])).toEqual([[1, 'small'], [2, 'kitchen']]);
  });

  test('加工完成后须取走刀坯，暂存后仍从下一道工序继续', () => {
    expect(interact).toBeTypeOf('function');
    const game = newGame(CONFIG);
    expect(interact(game, CONFIG, 'rack', 1).kind).toBe('taken');
    expect(interact(game, CONFIG, 'forge').kind).toBe('blocked');
    expect(interact(game, CONFIG, 'heat').kind).toBe('placed');
    expect(interact(game, CONFIG, 'heat').kind).toBe('blocked');
    expect(tick(game, CONFIG, 4999).completed).toBe(false);
    expect(tick(game, CONFIG, 1).completed).toBe(true);
    expect(tick(game, CONFIG, 1).completed).toBe(false);
    expect(game.benches.heat?.piece.step).toBe(1);
    expect(interact(game, CONFIG, 'heat').kind).toBe('taken');
    expect(interact(game, CONFIG, 'bufferA').kind).toBe('placed');
    expect(game.held).toBeNull();
    expect(interact(game, CONFIG, 'bufferA').kind).toBe('taken');
    expect(game.held?.step).toBe(1);
    expect(interact(game, CONFIG, 'rack', 1).kind).toBe('blocked');
  });

  test('第一锤精准加分，成品只交付和计分一次', () => {
    expect(strike).toBeTypeOf('function');
    const game = newGame(CONFIG);
    interact(game, CONFIG, 'rack', 1);
    finishStep(game, 'heat', 5000);
    interact(game, CONFIG, 'forge');
    tick(game, CONFIG, 2000);
    expect(strike(game, CONFIG).kind).toBe('precise');
    expect(strike(game, CONFIG).kind).toBe('blocked');
    tick(game, CONFIG, 2000);
    interact(game, CONFIG, 'forge');
    finishStep(game, 'cool', 3000);
    expect(interact(game, CONFIG, 'delivery')).toMatchObject({ kind: 'delivered', points: 25 });
    expect(interact(game, CONFIG, 'delivery').kind).toBe('blocked');
    expect(game.score).toBe(25);
    expect(game.orders).toHaveLength(0);
  });

  test('空敲之后的第二次命中不能把普通改成精准', () => {
    expect(strike).toBeTypeOf('function');
    const game = newGame(CONFIG);
    interact(game, CONFIG, 'rack', 1);
    finishStep(game, 'heat', 5000);
    interact(game, CONFIG, 'forge');
    expect(strike(game, CONFIG).kind).toBe('ordinary');
    tick(game, CONFIG, 2000);
    expect(strike(game, CONFIG).kind).toBe('blocked');
    expect(game.benches.forge?.piece.quality).toBe('ordinary');
  });

  test('超时只清理关联刀坯，满额跳单不跳过刀型', () => {
    expect(tick).toBeTypeOf('function');
    const game = newGame(CONFIG);
    interact(game, CONFIG, 'rack', 1);
    interact(game, CONFIG, 'bufferA');
    tick(game, CONFIG, 16000);
    interact(game, CONFIG, 'rack', 2);
    tick(game, CONFIG, 16000);
    expect(game.benches.bufferA).toBeUndefined();
    expect(game.held?.blade).toBe('kitchen');
    const smallId = game.orders.find(({ blade }) => blade === 'small')?.id;
    tick(game, CONFIG, 16000);
    expect(game.orders.find(({ blade }) => blade === 'small')?.id).toBe(smallId);
    expect(game.expired).toBe(1);
    tick(game, CONFIG, 16000);
    expect(game.orders.map(({ blade }) => blade)).toEqual(['kitchen']);
    expect(game.held).toBeNull();
  });
});

describe('教学和三天结算', () => {
  test('练习不限时，开始营业时重置练习成绩', () => {
    const game = newGame(CONFIG, true);
    expect(game.phase).toBe('tutorial');
    tick(game, CONFIG, 120000);
    expect(game.orders[0]?.deadline).toBeNull();
    game.score = 25;
    startBusiness(game, CONFIG);
    expect(game.phase).toBe('open');
    expect(game.elapsed).toBe(0);
    expect(game.score).toBe(0);
  });

  test('三天达标后结算总分，后两天引入柴刀且加快来单', () => {
    expect(nextDay).toBeTypeOf('function');
    const game = newGame(CONFIG);
    const days = [[100000, 100], [110000, 170], [120000, 260]];
    for (const [duration, score] of days) {
      game.score = score;
      tick(game, CONFIG, duration);
      expect(game.report).toMatchObject({ score, passed: true });
      nextDay(game, CONFIG);
    }
    expect(game.phase).toBe('final');
    expect(game.history.map(({ score }) => score)).toEqual([100, 170, 260]);
  });

  test('当天失败可重试，保留前一天成绩和新关卡的来单节奏', () => {
    expect(retryDay).toBeTypeOf('function');
    const game = newGame(CONFIG);
    game.score = 100;
    tick(game, CONFIG, 100000);
    nextDay(game, CONFIG);
    expect(game.orders[0]?.blade).toBe('kitchen');
    tick(game, CONFIG, 28000);
    expect(game.orders.map(({ blade }) => blade)).toEqual(['kitchen', 'small', 'firewood']);
    tick(game, CONFIG, 82000);
    expect(game.report).toMatchObject({ passed: false, day: 2 });
    retryDay(game, CONFIG);
    expect(game.history).toHaveLength(1);
    expect(game).toMatchObject({ phase: 'open', day: 2, score: 0, elapsed: 0 });
    tick(game, CONFIG, 110000);
    endRun(game);
    expect(game.phase).toBe('final');
    expect(game.history).toHaveLength(1);
  });

  test('营业剩余恰好 20 秒时停发新单，收工清空所有未交付的刀', () => {
    expect(tick).toBeTypeOf('function');
    const game = newGame(CONFIG);
    tick(game, CONFIG, 64000);
    const lastIssued = game.nextOrderId;
    tick(game, CONFIG, 16000);
    expect(game.nextOrderId).toBe(lastIssued);
    const [first] = game.orders;
    interact(game, CONFIG, 'rack', first.slot);
    tick(game, CONFIG, 20000);
    expect(game).toMatchObject({ phase: 'report', held: null, orders: [] });
    expect(game.report?.expired).toBeGreaterThan(0);
  });

  test('按实际工序与搬运时长交单，首版配置可以打通三天', () => {
    const game = newGame(CONFIG);
    const handling = 600;

    while (game.phase === 'open') {
      while (game.phase === 'open') {
        const order = [...game.orders]
          .sort((a, b) => a.deadline! - b.deadline!)
          .find(({ blade, deadline }) => {
            const recipe = CONFIG.blades[blade].recipe;
            const work = recipe.reduce((sum, step) => sum + CONFIG.steps[step].duration, 0);
            return deadline! - game.elapsed > work + handling * (2 + recipe.length * 2);
          });
        if (!order) {
          tick(game, CONFIG, 250);
          continue;
        }

        tick(game, CONFIG, handling);
        expect(interact(game, CONFIG, 'rack', order.slot).kind).toBe('taken');
        for (const step of CONFIG.blades[order.blade].recipe) {
          tick(game, CONFIG, handling);
          expect(interact(game, CONFIG, step).kind).toBe('placed');
          const duration = CONFIG.steps[step].duration;
          tick(game, CONFIG, duration / 2);
          if (step === 'forge') expect(strike(game, CONFIG).kind).toBe('precise');
          tick(game, CONFIG, duration / 2 + handling);
          expect(interact(game, CONFIG, step).kind).toBe('taken');
        }
        tick(game, CONFIG, handling);
        expect(interact(game, CONFIG, 'delivery').kind).toBe('delivered');
      }
      expect(game.report?.passed).toBe(true);
      nextDay(game, CONFIG);
    }
    expect(game.history).toHaveLength(3);
    expect(game.phase).toBe('final');
  });
});
