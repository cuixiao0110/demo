import { endRun, nextDay, retryDay } from '../core/game';
import { BaseScene } from '../engine/scenes';
import { workshopAudio } from './audio';

const INK = '#422e25';
const GREEN = '#294b3d';

export class SummaryScene extends BaseScene {
  constructor() {
    super('summary');
  }

  create() {
    const game = this.ctx.game;
    const report = game.report;
    if (!report) {
      this.ctx.go('title');
      return;
    }
    const final = game.phase === 'final';
    const passed = final ? game.history.length === this.ctx.config.days.length : report.passed;
    workshopAudio(this).setTrack(final && passed ? 'graduation' : passed ? 'closingPassed' : 'closingRetry');
    this.background('bg_result');
    this.add.rectangle(640, 360, 1280, 720, 0x392522, 0.55);
    const plate = this.add.graphics();
    plate.fillStyle(0xfff0d2).fillRoundedRect(270, 95, 740, 530, 24);
    plate.lineStyle(3, 0xb57d54).strokeRoundedRect(270, 95, 740, 530, 24);
    this.art(passed ? 'char_laozhou_happy' : 'char_laozhou_neutral', 409, 372, 152);

    if (final) {
      const total = game.history.reduce((sum, day) => sum + day.score, 0);
      this.label(620, 162, passed ? '学徒出师' : '今日收工', { size: 36, weight: 700, color: GREEN });
      this.label(620, 218, passed ? `三天总分 ${total}` : `通过 ${game.history.length} / ${this.ctx.config.days.length} 天`, {
        size: 24, weight: 700, color: INK,
      });
      const days = passed ? game.history : [...game.history, report];
      days.forEach((day, index) => {
        this.label(620, 278 + index * 43, `第 ${day.day} 天　${day.score} / ${day.target} 分`, { size: 22, color: INK });
      });
      this.label(620, 434, passed ? '老周：这手艺，可以传给你了。' : '老周：再练练，铺子等你回来。', { size: 18, color: GREEN });
      this.button({ x: 641, y: 549, label: '回到封面（空格）', key: 'Space', onClick: () => this.ctx.go('title') });
      return;
    }

    this.label(620, 162, `第 ${report.day} 天收工`, { size: 35, weight: 700, color: GREEN });
    this.label(620, 223, `${report.score} / ${report.target} 分`, { size: 31, weight: 700, color: INK });
    this.label(620, 292, `交付 ${report.delivered} 单`, { size: 22, color: INK });
    this.label(620, 337, `精准 ${report.precise} 单`, { size: 22, color: INK });
    this.label(620, 382, `超时 ${report.expired} 单`, { size: 22, color: INK });
    this.label(620, 432, passed ? '达标，可以继续。' : `离目标还有 ${report.target - report.score} 分。`, { size: 20, color: GREEN });

    if (passed) {
      const last = game.day === this.ctx.config.days.length;
      this.button({
        x: 641, y: 549, label: last ? '查看最终成绩（空格）' : '下一天（空格）', key: 'Space',
        onClick: () => {
          nextDay(game, this.ctx.config);
          this.ctx.go(last ? 'summary' : 'play');
        },
      });
    } else {
      this.button({
        x: 516, y: 549, w: 240, label: '重试（空格）', key: 'Space',
        onClick: () => {
          retryDay(game, this.ctx.config);
          this.ctx.go('play');
        },
      });
      this.button({
        x: 785, y: 549, w: 240, label: '结束（Esc）', key: 'Escape', style: 'secondary',
        onClick: () => {
          endRun(game);
          this.ctx.go('summary');
        },
      });
    }
  }
}
