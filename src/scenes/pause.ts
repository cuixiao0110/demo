import type Phaser from 'phaser';
import type { BaseScene } from '../engine/scenes';
import { workshopAudio, type VolumeChannel } from './audio';

export function createPausePanel(scene: BaseScene, resume: () => void) {
  const audio = workshopAudio(scene);
  const { width, height } = scene.ctx.config.view;
  const ink = '#493024';
  const green = '#285546';
  const shade = scene.add.rectangle(width / 2, height / 2, width, height, 0x201911, 0.68).setInteractive();
  const frame = scene.add.graphics();
  frame.fillStyle(0xfff1d4).fillRoundedRect(340, 141, 600, 438, 23);
  frame.lineStyle(3, 0xad7d51).strokeRoundedRect(340, 141, 600, 438, 23);
  const heading = scene.label(640, 198, '工坊暂停', { size: 33, weight: 700, align: 'center', color: green });
  const status = scene.label(640, 244, '订单倒计时和工位加工已暂停', { size: 17, align: 'center', color: ink });
  const panel = scene.add.container(0, 0, [shade, frame, heading, status]).setDepth(1000).setVisible(false);

  function volumeRow(channel: VolumeChannel, label: string, y: number) {
    const left = 543;
    const trackWidth = 205;
    const name = scene.label(400, y, label, { size: 20, weight: 700, color: ink });
    const track = scene.add.rectangle(left + trackWidth / 2, y, trackWidth, 22, 0xd8bb8e)
      .setInteractive({ useHandCursor: true });
    const fill = scene.add.rectangle(left, y, trackWidth, 13, 0x588262).setOrigin(0, 0.5);
    const value = scene.label(880, y, '', { size: 18, weight: 700, align: 'right', color: green });
    const refresh = () => {
      const level = audio.getVolume(channel);
      fill.setVisible(level > 0).setDisplaySize(trackWidth * level, 13);
      value.setText(`${Math.round(level * 100)}%`);
    };
    const adjust = (level: number) => {
      audio.setVolume(channel, level);
      if (channel === 'effects') scene.sfx('sfx_work_ready', { volume: 0.65 });
      refresh();
    };
    track.on('pointerdown', (pointer: Phaser.Input.Pointer) => adjust((pointer.x - left) / trackWidth));
    const minus = scene.button({
      x: 504, y, w: 49, h: 38, size: 19, label: '−', style: 'secondary',
      onClick: () => adjust(audio.getVolume(channel) - 0.1),
    });
    const plus = scene.button({
      x: 786, y, w: 49, h: 38, size: 19, label: '+', style: 'secondary',
      onClick: () => adjust(audio.getVolume(channel) + 0.1),
    });
    panel.add([name, track, fill, value, minus, plus]);
    refresh();
  }

  volumeRow('music', '音乐', 323);
  volumeRow('effects', '音效', 392);
  panel.add(scene.button({
    x: 640, y: 494, w: 335, h: 58, size: 23, label: '继续（Esc）', onClick: resume,
  }));
  return panel;
}
