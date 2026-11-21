import type Phaser from 'phaser';
import manifest from '../../assets/manifest.json';
import { urlOf } from '../engine/assets';
import type { BaseScene } from '../engine/scenes';

export type VolumeChannel = 'music' | 'effects';
type MusicTrack = keyof typeof manifest.music;

const DEFAULT_VOLUME = { music: 0.6, effects: 0.8 };
const controllers = new WeakMap<Phaser.Game, WorkshopAudio>();

/** 音乐独立播放，Phaser 的全局音量控制按钮声和工坊音效。 */
class WorkshopAudio {
  private readonly player = document.createElement('audio');
  private readonly volume: Record<VolumeChannel, number>;
  private ducked = false;

  constructor(private readonly game: Phaser.Game, private readonly storageKey: string) {
    this.volume = this.readVolume();
    this.player.hidden = true;
    this.player.preload = 'auto';
    this.player.dataset.workshopMusic = '';
    document.body.append(this.player);
    this.updateVolume();

    // 初次打开网页时，浏览器可能要等用户按键或点击才允许播放。
    window.addEventListener('keydown', this.resumeMusic, true);
    window.addEventListener('pointerdown', this.resumeMusic, true);
    game.events.once('destroy', () => {
      window.removeEventListener('keydown', this.resumeMusic, true);
      window.removeEventListener('pointerdown', this.resumeMusic, true);
      this.player.pause();
      this.player.remove();
    });
  }

  getVolume(channel: VolumeChannel) {
    return this.volume[channel];
  }

  setVolume(channel: VolumeChannel, value: number) {
    this.volume[channel] = Math.max(0, Math.min(1, Math.round(value * 10) / 10));
    this.updateVolume();
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.volume));
    } catch {
      // 浏览器禁用本地存储时仍可调节本次会话的音量。
    }
  }

  setDucked(ducked: boolean) {
    this.ducked = ducked;
    this.updateVolume();
  }

  setTrack(track: MusicTrack) {
    if (this.player.dataset.track !== track) {
      const url = urlOf(manifest.music[track]);
      this.player.pause();
      if (!url) {
        delete this.player.dataset.track;
        this.player.removeAttribute('src');
        this.player.load();
        return;
      }
      this.player.dataset.track = track;
      this.player.loop = track === 'title' || track === 'workshop';
      this.player.src = url;
    }
    this.resumeMusic();
  }

  private readonly resumeMusic = () => {
    if (this.player.dataset.track && this.player.paused && !this.player.ended) {
      void this.player.play().catch(() => {
        // 若暂时被自动播放策略拦截，下次交互会再次尝试。
      });
    }
  };

  private updateVolume() {
    this.player.volume = this.volume.music * (this.ducked ? 0.28 : 1);
    this.game.sound.setVolume(this.volume.effects);
  }

  private readVolume() {
    const volume = { ...DEFAULT_VOLUME };
    try {
      const saved: Partial<Record<VolumeChannel, number>> | null = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null');
      for (const key of ['music', 'effects'] as const) {
        const value = saved?.[key];
        if (typeof value === 'number' && value >= 0 && value <= 1) volume[key] = value;
      }
    } catch {
      // 首次运行或存档损坏时使用默认设置。
    }
    return volume;
  }
}

export function workshopAudio(scene: BaseScene) {
  const existing = controllers.get(scene.game);
  if (existing) return existing;
  const audio = new WorkshopAudio(scene.game, `${scene.ctx.config.saveKey}:audio`);
  controllers.set(scene.game, audio);
  return audio;
}
