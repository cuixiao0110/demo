// 标题 / 欢迎页：小镇街景、标题字、两侧站着街坊。点街坊会换成开心表情跳一下。
// 这页只是门面，换成你们自己的标题画面时整个文件都可以改。
import { newGame } from '../core/game';
import { BaseScene } from '../engine/scenes';
import { COLOR, hex } from '../engine/ui';
import { workshopAudio } from './audio';

// 左右两组街坊：[角色 ID 前缀, x, 是否在后排]。后排小一点、靠上一点。
const FOLKS: [string, number, boolean][] = [
  ['char_grandma', 92, true],
  ['char_auntie', 300, true],
  ['char_laozhou', 172, false],
  ['char_apprentice', 382, false],
  ['char_scholar', 980, true],
  ['char_kid', 1196, true],
  ['char_merchant', 898, false],
  ['char_heroine', 1104, false],
];

export class TitleScene extends BaseScene {
  constructor() {
    super('title');
  }

  create() {
    workshopAudio(this).setTrack('title');
    this.background('bg_title');
    // 上方压一层很淡的奶油色，让标题更跳。
    const veil = this.add.graphics();
    veil.fillGradientStyle(hex(COLOR.cream), hex(COLOR.cream), hex(COLOR.cream), hex(COLOR.cream), 0.55, 0.55, 0, 0);
    veil.fillRect(0, 0, 1280, 300);

    for (const [prefix, x, back] of FOLKS) this.addFolk(prefix, x, back);

    const logo = this.art('logo_title', 640, 138, 720);
    this.tweens.add({ targets: logo, y: 146, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    let y = 340;
    this.button({
      x: 640, y, label: '开工（空格）', key: 'Space',
      onClick: () => {
        this.ctx.game = newGame(this.ctx.config, true);
        this.ctx.go('play');
      },
    });
    const run = this.ctx.save.run;
    if (run) {
      y += 96;
      this.button({
        x: 640, y, label: '继续（C）', key: 'KeyC',
        onClick: () => {
          this.ctx.game = run;
          this.ctx.go('play');
        },
      });
    }

    this.label(640, 694, '点一点街坊打个招呼', { size: 18, align: 'center', color: COLOR.ink }).setAlpha(0.7);
  }

  private addFolk(prefix: string, x: number, back: boolean) {
    const h = back ? 236 : 276;
    const baseY = back ? 676 : 732;
    const folk = this.art(`${prefix}_neutral`, x, baseY, h * 0.75).setOrigin(0.5, 1);
    // 朝向画面中间
    folk.setFlipX(x > 640);
    folk.setDepth(back ? 0 : 1);
    const scaleY = folk.scaleY;
    // 轻轻呼吸，每个人节奏错开
    this.tweens.add({
      targets: folk, scaleY: scaleY * 1.025, duration: 1100 + Math.random() * 500,
      yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: Math.random() * 800,
    });

    let busy = false;
    folk.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 10 });
    folk.on('pointerdown', () => {
      if (busy) return;
      busy = true;
      folk.setTexture(`${prefix}_happy`);
      this.sfx('sfx_coin', { volume: 0.6 });
      this.tweens.add({ targets: folk, y: baseY - 36, duration: 160, yoyo: true, ease: 'Quad.out' });
      const heart = this.art('fx_heart', x + (x > 640 ? -40 : 40), baseY - h + 10, 56).setDepth(5);
      this.tweens.add({ targets: heart, y: heart.y - 70, alpha: 0, duration: 1100, ease: 'Sine.out', onComplete: () => heart.destroy() });
      this.time.delayedCall(1400, () => {
        folk.setTexture(`${prefix}_neutral`);
        busy = false;
      });
    });
  }
}
