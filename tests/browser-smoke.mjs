import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

// 通过真实键盘完成练习单。传入 --offline 时在无网络的浏览器中打开单文件包。
const offline = process.argv.includes('--offline');
const server = offline ? null : await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 5198 } });
let browser;
const errors = [];

try {
  await server?.listen();
  const url = offline ? pathToFileURL(resolve('release/index.html')).href : server.resolvedUrls.local[0];
  const args = ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];
  browser = await chromium.launch({ channel: 'chrome', args })
    .catch(() => chromium.launch({ channel: 'msedge', args }));
  const context = await browser.newContext({ offline, viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => globalThis.__game?.sceneName === 'title');
  await page.waitForFunction(() => document.querySelector('[data-workshop-music]')?.dataset.track === 'title');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => globalThis.__game.sceneName === 'play');
  await page.waitForFunction(() => {
    const music = document.querySelector('[data-workshop-music]');
    return music?.dataset.track === 'title' && !music.paused;
  });
  assert.equal(await page.evaluate(() => globalThis.__game.game.phase), 'tutorial', '开始后应进入练习单');

  async function moveTo(axis, target) {
    const position = await page.evaluate((coordinate) => globalThis.__game.debug().player[coordinate], axis);
    if (Math.abs(position - target) <= 12) return;
    const positive = position < target;
    const key = axis === 'x' ? positive ? 'KeyD' : 'KeyA' : positive ? 'KeyS' : 'KeyW';
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(({ axis, positive, target }) => {
        const position = globalThis.__game.debug().player[axis];
        return positive ? position >= target : position <= target;
      }, { axis, positive, target }, { timeout: 4000 });
    } finally {
      await page.keyboard.up(key);
    }
  }

  async function useStation(id) {
    assert.equal(await page.evaluate(() => globalThis.__game.debug().near), id);
    await page.keyboard.press('Space');
  }

  await page.keyboard.press('Digit1');
  await useStation('rack');
  await moveTo('x', 437);
  await useStation('heat');
  await page.waitForFunction(() => globalThis.__game.game.benches.heat?.completesAt === null);
  await page.waitForFunction(() => globalThis.__phaser.sound.get('sfx_work_ready')?.isPlaying);
  await useStation('heat');
  await moveTo('x', 583);
  await useStation('forge');
  await page.waitForFunction(() => {
    const { benches, elapsed } = globalThis.__game.game;
    return benches.forge?.completesAt !== null && benches.forge?.completesAt - elapsed <= 2280;
  });
  await page.keyboard.press('KeyF');
  assert.equal(await page.evaluate(() => globalThis.__game.game.benches.forge.piece.quality), 'precise');
  await page.waitForFunction(() => globalThis.__game.game.benches.forge?.completesAt === null);
  await useStation('forge');
  await moveTo('x', 729);
  await useStation('cool');
  await page.waitForFunction(() => globalThis.__game.game.benches.cool?.completesAt === null);
  await useStation('cool');
  await moveTo('x', 615);
  await moveTo('y', 430);
  await useStation('delivery');
  assert.equal(await page.evaluate(() => globalThis.__game.game.score), 25);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => globalThis.__game.sceneName === 'play' && globalThis.__game.game.phase === 'open');
  assert.equal(await page.evaluate(() => globalThis.__game.game.score), 0);
  await page.waitForFunction(() => {
    const music = document.querySelector('[data-workshop-music]');
    return music?.dataset.track === 'workshop' && !music.paused;
  });
  await mkdir('shots', { recursive: true });
  await page.screenshot({ path: offline ? 'shots/offline-gameplay.png' : 'shots/browser-gameplay.png' });

  await page.keyboard.press('Digit1');
  await useStation('rack');
  await moveTo('x', 437);
  await useStation('heat');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => globalThis.__game.debug().paused);
  const pausedState = () => page.evaluate(() => ({ game: globalThis.__game.game, player: globalThis.__game.debug().player }));
  const beforePause = await pausedState();
  await page.keyboard.press('Space');
  await page.keyboard.down('KeyD');
  try {
    await page.waitForTimeout(300);
    assert.deepEqual(await pausedState(), beforePause, '暂停时不能移动、操作工位或推进游戏时钟');
  } finally {
    await page.keyboard.up('KeyD');
  }
  await page.mouse.click(584, 323);
  await page.waitForFunction(() => Math.abs(document.querySelector('[data-workshop-music]').volume - 0.056) < 0.001);
  await page.mouse.click(605, 392);
  await page.waitForFunction(() => Math.abs(globalThis.__phaser.sound.volume - 0.3) < 0.001);
  const audioState = () => page.evaluate(() => ({
    music: document.querySelector('[data-workshop-music]').volume,
    effects: globalThis.__phaser.sound.volume,
  }));
  const ducked = await audioState();
  assert.ok(Math.abs(ducked.music - 0.056) < 0.001);
  assert.ok(Math.abs(ducked.effects - 0.3) < 0.001);
  await page.screenshot({ path: offline ? 'shots/offline-pause.png' : 'shots/browser-pause.png' });
  await page.mouse.click(640, 494);
  await page.waitForFunction(() => !globalThis.__game.debug().paused && globalThis.__game.game.elapsed > 0);
  const resumed = await audioState();
  assert.ok(Math.abs(resumed.music - 0.2) < 0.001);
  assert.ok(Math.abs(resumed.effects - 0.3) < 0.001);

  // 快进收工时钟，验证收工短曲播一次，且沿用音乐音量。
  await page.evaluate(() => {
    const { game, config } = globalThis.__game;
    globalThis.__phaser.scene.getScene('play').update(performance.now(), config.days[game.day - 1].duration - game.elapsed);
  });
  await page.waitForFunction(() => globalThis.__game.sceneName === 'summary');
  await page.waitForFunction(() => {
    const music = document.querySelector('[data-workshop-music]');
    return music?.dataset.track === 'closingRetry' && !music.paused && !music.loop && music.volume === 0.2;
  });
  await page.waitForFunction(() => document.querySelector('[data-workshop-music]')?.ended);
  await page.keyboard.press('KeyX');
  assert.equal(await page.evaluate(() => document.querySelector('[data-workshop-music]').ended), true);

  await page.reload();
  await page.waitForFunction(() => globalThis.__game?.sceneName === 'title');
  const stored = await audioState();
  assert.ok(Math.abs(stored.music - 0.2) < 0.001);
  assert.ok(Math.abs(stored.effects - 0.3) < 0.001);
  assert.deepEqual(errors, []);
  console.log(`通过：${offline ? '断网单文件' : 'Vite 开发版'}完成练习单，验证配乐切换、完工铃、收工短曲、暂停冻结与音量设置。`);
} finally {
  await browser?.close();
  await server?.close();
}
