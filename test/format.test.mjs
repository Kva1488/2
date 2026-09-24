import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plural, lightStory, tzOffset, msFromLocal, localParts, fmtDuration, dirWords, fmtLy } from '../src/ui/format.js';

test('склонения', () => {
  const f = ['год', 'года', 'лет'];
  assert.equal(plural(1, f), 'год');
  assert.equal(plural(3, f), 'года');
  assert.equal(plural(11, f), 'лет');
  assert.equal(plural(21, f), 'год');
  assert.equal(plural(112, f), 'лет');
});

test('история света звезды', () => {
  const s = lightStory(433, 2026);
  assert.match(s, /около 1593 года/);
  assert.match(s, /первых наблюдений Галилея в телескоп оставалось ещё 16 лет/);
  assert.match(lightStory(2500000, 2026), /2,5 млн лет назад/);
  assert.match(lightStory(2600, 2026), /до н\. э\./);
  assert.equal(lightStory(4.37, 2026), 'Этот свет отправился в путь около 2022 года.');
});

test('часовые пояса: Москва UTC+3, Нью-Йорк с летним временем', () => {
  assert.equal(tzOffset('Europe/Moscow', Date.UTC(2025, 0, 1)), 180);
  assert.equal(tzOffset('America/New_York', Date.UTC(2025, 6, 1)), -240);
  assert.equal(tzOffset('America/New_York', Date.UTC(2025, 0, 1)), -300);
  const ms = msFromLocal('Europe/Moscow', 2025, 6, 21, 3, 44);
  assert.equal(new Date(ms).toISOString(), '2025-06-21T00:44:00.000Z');
  const p = localParts('Asia/Kamchatka', Date.UTC(2025, 11, 31, 13, 0));
  assert.deepEqual([p.y, p.mo, p.d, p.h], [2026, 1, 1, 1]);
});

test('длительности и стороны света', () => {
  assert.equal(fmtDuration(499), '8 минут 19 секунд');
  assert.equal(fmtDuration(1.3), '1,3 секунды');
  assert.equal(dirWords(225), 'на юго-западе');
  assert.equal(dirWords(359), 'на севере');
  assert.equal(fmtLy(8.6), '8,6 световых года');
  assert.equal(fmtLy(2500000), '2,5 млн световых лет');
});
