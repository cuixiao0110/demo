import type Phaser from 'phaser';
import {
  forgeProgress, interact, nextStep, startBusiness, strike, tick,
  type GameState, type Interaction, type Order, type Piece, type StationId,
} from '../core/game';
import { BaseScene } from '../engine/scenes';
import { workshopAudio } from './audio';
import { createPausePanel } from './pause';
import { drawWorkshopRoom, WORKSHOP_GUIDE, WORKSHOP_PALETTE } from './workshop-room';
import { lightWorkshopFurnace, playWorkshopEffect, rippleWorkshopWater, WorkshopBench, type WorkshopStation } from './workshop-stations';

const { ink: INK, cream: PAPER, green: GREEN, gold: GOLD } = WORKSHOP_PALETTE;
const AMBER = '#783c25';

const STATIONS = [
  { id: 'rack', x: 145, y: 237, label: '料架' },
  { id: 'shape', x: 291, y: 237, label: '整坯台' },
  { id: 'heat', x: 437, y: 237, label: '炉台' },
  { id: 'forge', x: 583, y: 237, label: '铁砧' },
  { id: 'cool', x: 729, y: 237, label: '冷却槽' },
  { id: 'bufferA', x: 319, y: 504, label: '暂存一' },
  { id: 'bufferB', x: 470, y: 504, label: '暂存二' },
  { id: 'delivery', x: 615, y: 504, label: '交付台' },
  { id: 'finish', x: 773, y: 504, label: '修整台' },
] as const satisfies readonly WorkshopStation[];

type Station = (typeof STATIONS)[number];
type Direction = 'left' | 'right' | 'up' | 'down';
type Text = Phaser.GameObjects.Text;

const CUSTOMER = {
  small: 'char_merchant_neutral',
  kitchen: 'char_auntie_neutral',
  firewood: 'char_guard_neutral',
} as const;

interface OrderView {
  panel: Phaser.GameObjects.Rectangle;
  portraitFrame: Phaser.GameObjects.Arc;
  knife: Phaser.GameObjects.Image;
  customer: Phaser.GameObjects.Image;
  name: Text;
  status: Text;
  time: Text;
}

const seconds = (ms: number) => String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, '0');
const guideWords = new Intl.Segmenter('zh-Hans', { granularity: 'word' });

function wrapGuide(text: string, label: Text) {
  const maxWidth = label.style.wordWrapWidth ?? Infinity;
  const words: string[] = [];
  for (const { segment } of guideWords.segment(text)) {
    if (/^[，。！？：、；）]/u.test(segment) && words.length) words[words.length - 1] += segment;
    else words.push(segment);
  }
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line + word;
    if (line && label.context.measureText(candidate.trimEnd()).width > maxWidth) {
      lines.push(line.trimEnd());
      line = word.trimStart();
    } else {
      line = candidate;
    }
  }
  return [...lines, line.trimEnd()].join('\n');
}

export class PlayScene extends BaseScene {
  private stationViews = new Map<StationId, WorkshopBench>();
  private orderViews: OrderView[] = [];
  private movement: Partial<Record<Direction, Phaser.Input.Keyboard.Key[]>> = {};
  private selectedId: number | null = null;
  private near: Station | null = null;
  private paused = false;
  private noticeExpires = 0;
  private walkCycle = 0;
  private player!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Ellipse;
  private carried!: Phaser.GameObjects.Image;
  private coach!: Phaser.GameObjects.Image;
  private clock!: Text;
  private score!: Text;
  private dayLabel!: Text;
  private notice!: Text;
  private instructions!: Text;
  private handLabel!: Text;
  private forgeMeter!: Phaser.GameObjects.Graphics;
  private startButton!: Phaser.GameObjects.Container;
  private pauseButton!: Phaser.GameObjects.Container;
  private pausePanel!: Phaser.GameObjects.Container;
  private audio!: ReturnType<typeof workshopAudio>;

  constructor() {
    super('play');
  }

  create() {
    this.selectedId = null;
    this.near = null;
    this.paused = false;
    this.noticeExpires = 0;
    this.walkCycle = 0;
    this.stationViews.clear();
    this.audio = workshopAudio(this);
    this.audio.setTrack(this.ctx.game.phase === 'open' ? 'workshop' : 'title');
    this.drawWorkshop();
    for (const station of STATIONS) this.stationViews.set(station.id, new WorkshopBench(this, station));
    lightWorkshopFurnace(this, STATIONS[2]);
    rippleWorkshopWater(this, STATIONS[4]);
    this.createHud();

    this.shadow = this.add.ellipse(145, 315, 38, 12, 0x35271e, 0.37).setDepth(-48);
    this.player = this.art(this.texture('char_apprentice_topdown', 'char_apprentice_neutral'), 145, 313, 61)
      .setOrigin(0.5, 1);
    this.carried = this.art('iron_dark', 0, 0, 37);
    this.handLabel = this.label(0, 0, '', { size: 15, weight: 700, align: 'center', color: PAPER, stroke: INK }).setDepth(660);
    this.forgeMeter = this.add.graphics().setDepth(650);
    this.pausePanel = createPausePanel(this, () => this.togglePause());

    const keyboard = this.input.keyboard;
    const keys = (...names: string[]) => keyboard ? names.map((name) => keyboard.addKey(name)) : [];
    this.movement = { left: keys('A', 'LEFT'), right: keys('D', 'RIGHT'), up: keys('W', 'UP'), down: keys('S', 'DOWN') };
    this.onKey((event) => this.handleKey(event.code));
    this.ctx.debug = () => ({ player: { x: this.player.x, y: this.player.y }, near: this.near?.id ?? null, paused: this.paused });
    this.events.once('shutdown', () => {
      this.ctx.debug = undefined;
      this.audio.setDucked(false);
    });
    this.refresh();
  }

  update(_time: number, delta: number) {
    if (this.paused) return;
    const game = this.ctx.game;
    const events = tick(game, this.ctx.config, delta);
    if (game.phase === 'report') {
      this.ctx.go('summary');
      return;
    }
    if (events.expired) this.showNotice(`${events.expired} 张订单超时，刀坯已回收`);
    if (events.cooled) {
      this.sfx('sfx_hiss', { volume: 0.55 });
      playWorkshopEffect(this, 'fx_splash', STATIONS[4], 49, 500);
      playWorkshopEffect(this, 'fx_steam', STATIONS[4], 42, 760);
    }
    if (events.completed) this.sfx('sfx_work_ready');
    const { x, y } = this.player;
    this.move(delta);
    this.updateWalk(delta, this.player.x !== x || this.player.y !== y);
    this.refresh();
  }

  private togglePause() {
    this.paused = !this.paused;
    this.pausePanel.setVisible(this.paused);
    this.pauseButton.setVisible(!this.paused);
    this.startButton.setVisible(!this.paused && this.ctx.game.phase === 'tutorial');
    this.audio.setDucked(this.paused);
  }

  private drawWorkshop() {
    drawWorkshopRoom(this);
    this.art('hammer_small', 62, 51, 17).setRotation(-0.48);
    this.label(85, 51, '老周的铁匠铺', { size: 30, color: PAPER, weight: 700 });
    this.label(56, 87, 'WASD 移动   ·   1–3 选单   ·   空格 操作   ·   F 落锤', { size: 16, color: '#d9e5cf' });
    this.label(587, 159, '加工区', { size: 13, color: PAPER, weight: 700, align: 'center' });
    this.label(57, 591, '暂存与交付', { size: 15, color: PAPER, weight: 700, stroke: '#785438' });
    this.label(939, 163, '订单', { size: 20, color: PAPER, weight: 700 });
  }

  private createHud() {
    this.pauseButton = this.button({
      x: 1172, y: 690, w: 137, h: 32, size: 15, label: '暂停（Esc）', style: 'secondary',
      onClick: () => this.togglePause(),
    }).setDepth(700);
    this.dayLabel = this.label(677, 64, '', { size: 23, color: PAPER, weight: 700, align: 'center' });
    this.art('icon_clock', 795, 64, 23);
    this.clock = this.label(875, 64, '', { size: 23, color: PAPER, weight: 700, align: 'center' });
    this.art('icon_star', 1045, 64, 23);
    this.score = this.label(1213, 64, '', { size: 23, color: GOLD, weight: 700, align: 'right' });
    this.notice = this.label(45, 690, '', { size: 17, weight: 700, color: GREEN });
    this.orderViews = Array.from({ length: 3 }, (_, index) => {
      const y = 222 + index * 102;
      const panel = this.add.rectangle(1081, y + 1, 300, 77, 0xfff3d6).setStrokeStyle(2, 0xba905e);
      const portraitFrame = this.add.circle(954, y + 3, 23, 0xe6ca9a).setStrokeStyle(1, 0xc29d67);
      const customer = this.art('char_auntie_neutral', 954, y + 3, 37);
      const knife = this.art('item_knife', 993, y + 2, 42);
      const name = this.label(1022, y - 18, '', { size: 19, weight: 700 });
      const status = this.label(1022, y + 15, '', { size: 15, color: GREEN });
      const time = this.label(1221, y + 15, '', { size: 16, align: 'right', weight: 700 });
      return { panel, portraitFrame, customer, knife, name, status, time };
    });
    const guide = WORKSHOP_GUIDE;
    const centerY = guide.y + guide.height / 2;
    this.coach = this.art('char_laozhou_neutral', guide.x + guide.padding + guide.portrait / 2, centerY, guide.portrait);
    this.instructions = this.label(guide.x + guide.padding, centerY, '', { size: 16, color: INK, wrap: guide.width - 2 * guide.padding })
      .setOrigin(0, 0.5).setLineSpacing(4).setWordWrapCallback(wrapGuide);
    this.startButton = this.button({
      x: 1081, y: 619, w: 295, h: 51, size: 19, label: '进入第一天（Enter）', key: 'Enter',
      onClick: () => {
        if (this.paused || this.ctx.game.phase !== 'tutorial') return;
        startBusiness(this.ctx.game, this.ctx.config);
        this.selectedId = null;
        this.player.setPosition(145, 313);
        this.audio.setTrack('workshop');
        this.showNotice('开门营业，先选一张订单');
        this.refresh();
      },
    });
  }

  private handleKey(code: string) {
    const game = this.ctx.game;
    if (game.phase !== 'tutorial' && game.phase !== 'open') return;
    if (code === 'Escape') {
      this.togglePause();
      return;
    }
    if (this.paused) return;
    if (/^Digit[1-3]$/.test(code)) {
      const slot = Number(code.at(-1));
      const order = game.orders.find((candidate) => candidate.slot === slot);
      if (order) this.selectedId = order.id;
      else this.showNotice(`当前没有 #${slot} 订单`);
      this.refresh();
      return;
    }
    if (code === 'Space') {
      if (this.near) {
        const slot = game.orders.find(({ id }) => id === this.selectedId)?.slot;
        this.feedback(interact(game, this.ctx.config, this.near.id, slot));
      } else this.showNotice('走到工位旁，等它亮起再按空格');
      this.refresh();
    }
    if (code === 'KeyF') {
      if (this.near?.id === 'forge') this.feedback(strike(game, this.ctx.config));
      else this.showNotice('走到铁砧旁才可以落锤');
      this.refresh();
    }
  }

  private move(delta: number) {
    const pressed = (direction: Direction) => Number(this.movement[direction]?.some((key) => key.isDown) ?? false);
    const dx = pressed('right') - pressed('left');
    const dy = pressed('down') - pressed('up');
    if (!dx && !dy) return;

    const step = Math.min(50, delta) * this.ctx.config.game.speed / (1000 * Math.hypot(dx, dy));
    const x = Math.min(852, Math.max(60, this.player.x + dx * step));
    const y = Math.min(612, Math.max(194, this.player.y + dy * step));
    const blocked = (x: number, y: number) => STATIONS.some((station) =>
      Math.abs(station.x - x) < 59 && Math.abs(station.y + 10 - y) < 35);
    if (!blocked(x, this.player.y)) this.player.x = x;
    if (!blocked(this.player.x, y)) this.player.y = y;
    if (dx) this.player.setFlipX(dx < 0);
  }

  private updateWalk(delta: number, moving: boolean) {
    this.walkCycle = moving ? this.walkCycle + delta * 0.021 : 0;
    const lift = moving ? Math.abs(Math.sin(this.walkCycle)) : 0;
    this.player.setOrigin(0.5, 1 + lift * 3 / this.player.displayHeight);
    this.shadow.setScale(1 - lift * 0.12, 1 - lift * 0.09);
  }

  private refresh() {
    const game = this.ctx.game;
    const config = this.ctx.config;
    const tutorial = game.phase === 'tutorial';
    const day = config.days[game.day - 1];
    this.near = this.nearestStation();
    this.player.setDepth(this.player.y + 2);
    this.shadow.setPosition(this.player.x, this.player.y - 1);
    this.dayLabel.setText(tutorial ? '练习单' : `${game.day} / ${config.days.length}`);
    this.clock.setText(tutorial ? '不限时' : `收工 ${seconds(day.duration - game.elapsed)} 秒`);
    this.score.setText(tutorial ? `${game.score} 分` : `${game.score} / ${day.target} 分`);
    this.notice.setText(game.elapsed < this.noticeExpires ? this.notice.text : '');
    this.startButton.setVisible(tutorial);
    this.refreshGuide(tutorial, tutorial ? this.tutorialHint(game) :
      '领取订单后，按提示搬运刀坯。工位完成加工即可取回，赶不及的半成品可先暂存。');
    this.refreshStations(game);
    this.refreshOrders(game);

    const held = game.held;
    this.carried.setVisible(Boolean(held)).setDepth(this.player.depth + 1)
      .setPosition(this.player.x + (this.player.flipX ? -28 : 28), this.player.y - 27);
    this.handLabel.setVisible(Boolean(held)).setPosition(this.player.x + 3, this.player.y + 15);
    if (held) {
      this.carried.setTexture(this.pieceArt(held)).setDisplaySize(42, 42);
      const next = nextStep(held, config);
      this.handLabel.setText(`#${game.orders.find(({ id }) => id === held.orderId)?.slot} · ${next ? config.steps[next].label : '交付'}`);
    }

    this.drawForgeMeter(game);
  }

  private refreshGuide(tutorial: boolean, hint: string) {
    const guide = WORKSHOP_GUIDE;
    const inset = tutorial ? guide.portrait + guide.gap : 0;
    const x = guide.x + guide.padding + inset;
    this.coach.setVisible(tutorial);
    if (this.instructions.x !== x) {
      this.instructions.setX(x).setWordWrapWidth(guide.width - 2 * guide.padding - inset);
    }
    this.instructions.setText(hint);
  }

  private nearestStation() {
    let closest: Station | null = null;
    let distance: number = this.ctx.config.game.reach;
    for (const station of STATIONS) {
      const candidate = Math.hypot(station.x - this.player.x, station.y + 10 - this.player.y);
      if (candidate < distance) {
        closest = station;
        distance = candidate;
      }
    }
    return closest;
  }

  private refreshStations(game: GameState) {
    const tutorialTarget = game.phase === 'tutorial' && !game.delivered
      ? game.held ? nextStep(game.held, this.ctx.config) ?? 'delivery' : Object.keys(game.benches)[0] ?? 'rack'
      : null;
    for (const [id, view] of this.stationViews) {
      const bench = id === 'rack' || id === 'delivery' ? null : game.benches[id];
      const nearbyPlayer = this.near?.id === id ? this.player.x : null;
      view.piece.setVisible(Boolean(bench));
      if (!bench) {
        view.update('idle', nearbyPlayer !== null ? '空格' : '', nearbyPlayer, tutorialTarget === id, 0);
        continue;
      }
      view.piece.setTexture(this.pieceArt(bench.piece)).setDisplaySize(35, 35);
      const slot = game.orders.find(({ id }) => id === bench.piece.orderId)?.slot;
      const remaining = bench.completesAt === null ? null : bench.completesAt - game.elapsed;
      const stored = id === 'bufferA' || id === 'bufferB';
      const status = remaining !== null ? seconds(remaining) + ' 秒' : stored ? '暂存' : '可取';
      const state = remaining !== null ? 'working' : stored ? 'stored' : 'ready';
      const { steps } = this.ctx.config;
      const duration = id === 'rack' || id === 'delivery' || stored ? 0 : steps[id].duration;
      const progress = remaining !== null && duration > 0 ? 1 - remaining / duration : 0;
      view.update(state, `#${slot} · ${status}`, nearbyPlayer, tutorialTarget === id, progress);
    }
  }

  private refreshOrders(game: GameState) {
    if (!game.orders.some(({ id }) => id === this.selectedId)) this.selectedId = null;
    this.orderViews.forEach((view, index) => {
      const order = game.orders.find(({ slot }) => slot === index + 1);
      for (const element of Object.values(view)) element.setVisible(Boolean(order));
      if (!order) return;
      const blade = this.ctx.config.blades[order.blade];
      const remaining = order.deadline === null ? null : order.deadline - game.elapsed;
      const urgent = remaining !== null && remaining <= 8000;
      const selected = order.id === this.selectedId;
      view.panel.setFillStyle(urgent ? 0xf8d3a6 : selected ? 0xf4e9b9 : 0xfff3d6)
        .setStrokeStyle(selected ? 3 : 2, selected ? 0x477253 : urgent ? 0xb65231 : 0xba905e);
      view.customer.setTexture(CUSTOMER[order.blade]).setDisplaySize(37, 49);
      view.knife.setTexture(this.knifeArt(order.blade)).setDisplaySize(42, 42);
      view.name.setText(`${order.slot}  ${blade.name}`);
      view.status.setText(`${blade.points} 分 · ${this.orderStatus(game, order)}`);
      view.time.setColor(urgent ? '#a83623' : GREEN).setText(remaining === null ? '练习' : seconds(remaining) + ' 秒');
    });
  }

  private orderStatus(game: GameState, order: Order) {
    if (!order.claimed) return '待领料';
    if (game.held?.orderId === order.id) return '搬运中';
    const bench = Object.values(game.benches).find(({ piece }) => piece.orderId === order.id);
    if (bench && bench.completesAt !== null) return '加工中';
    const next = bench && nextStep(bench.piece, this.ctx.config);
    return next ? `待${this.ctx.config.steps[next].label}` : '可交付';
  }

  private drawForgeMeter(game: GameState) {
    const progress = forgeProgress(game, this.ctx.config);
    const bar = this.forgeMeter.clear();
    if (progress === null) return;
    const { strikeFrom, strikeTo } = this.ctx.config.game;
    const x = 508;
    const y = 177;
    const width = 150;
    bar.fillStyle(0x3e2b23).fillRoundedRect(x - 4, y - 3, width + 8, 22, 5);
    bar.lineStyle(1, 0xe4bd74).strokeRoundedRect(x - 4, y - 3, width + 8, 22, 5);
    bar.fillStyle(0x6c4937).fillRoundedRect(x, y + 1, width, 14, 4);
    bar.fillStyle(0xa1d78b).fillRect(x + strikeFrom * width, y + 2, (strikeTo - strikeFrom) * width, 12);
    bar.fillStyle(0xffedb6).fillRoundedRect(x + progress * width - 2, y - 2, 4, 20, 2);
  }

  private tutorialHint(game: GameState) {
    if (game.delivered) return '老周：这单成了。按 Enter 进入第一天。';
    if (game.benches.forge?.completesAt != null) return '老周：指针进入绿区时按 F。落锤后等加工结束，再按空格取回。';
    if (!game.orders[0]?.claimed) return '老周：按 1 选小刀单，在亮起的料架旁按空格领一块刀坯。';
    return '老周：跟着高亮工位走。按空格放下刀坯，等加工结束再按空格取回。';
  }

  private feedback(result: Interaction) {
    this.showNotice(result.message);
    if (result.kind === 'delivered') {
      this.sfx('sfx_deliver');
      if (this.near) playWorkshopEffect(this, 'fx_star', this.near, 59, 740);
    }
    if (result.kind === 'precise' || result.kind === 'ordinary') {
      this.sfx(result.kind === 'precise' ? 'sfx_hammer_heavy' : 'sfx_hammer_light');
      if (this.near) playWorkshopEffect(this, 'fx_spark', this.near, result.kind === 'precise' ? 72 : 42);
    }
  }

  private showNotice(message: string) {
    this.notice.setText(message).setColor(AMBER);
    this.noticeExpires = this.ctx.game.elapsed + 2400;
  }

  private pieceArt(piece: Piece) {
    const step = nextStep(piece, this.ctx.config);
    if (!step) return this.knifeArt(piece.blade);
    if (step === 'forge' || step === 'cool') return 'iron_orange';
    return step === 'finish' ? 'item_blank_blade' : 'iron_dark';
  }

  private knifeArt(blade: Order['blade']) {
    if (blade === 'small') return 'item_dagger';
    if (blade === 'firewood') return this.texture('item_firewood_knife', 'item_sickle');
    return 'item_knife';
  }

  private texture(id: string, fallback: string) {
    return this.textures.exists(id) ? id : fallback;
  }
}
