// 지난 라운드 넣기 (v44): a past round entered as strokes per hole. Every cell starts at its hole's par; a chip sets the
// picked cell relative to par and moves on (v49: to the next hole not entered yet), so a round goes in hole by hole from
// hole 1 in one chip a hole, 18 taps. A tap on a cell picks it. Saved as an entered round (strokes only); nothing
// leaves the device.
import { enteredRound, formatToPar, localDate, type Round } from './round';
import { roundSetup } from './courses';
import type { CourseChoice } from './storage';
import { h, setText } from './dom';

// v47 (U2): from an eagle to +7, two rows of five under the thumb, so a double par (양파: 6 on a par 3, 8 on a par 4,
// 10 on a par 5) and a hole-in-one on a par 3 can be entered too. Strokes stay within 1–15 (enteredRound).
const CHIPS: [string, number][] = [
  ['−2', -2], ['−1', -1], ['파', 0], ['+1', 1], ['+2', 2],
  ['+3', 3], ['+4', 4], ['+5', 5], ['+6', 6], ['+7', 7],
];

export interface QuickEntry {
  choice: CourseChoice;
  /** True when a round on that day and course is already kept; the screen warns but still saves. */
  kept: (date: string, courseName: string) => boolean;
  onSave: (round: Round) => void;
}

/**
 * Where the next chip goes (v49): the first hole after `at` not entered yet, then the first such hole from hole 1, so
 * fixing an earlier hole leads back to where entering stopped; `at` itself once every hole is in. The one place that
 * decides it, so a second chip on the same hole (putts) can come between a hole's strokes and the next hole.
 */
export function nextHole(done: readonly boolean[], at: number): number {
  for (let i = at + 1; i < done.length; i++) if (!done[i]) return i;
  for (let i = 0; i < at; i++) if (!done[i]) return i;
  return at;
}

/** Opens the quick entry in `dialog` (an empty <dialog>) for the course chosen in the picker. */
export function openQuickEntry(dialog: HTMLDialogElement, q: QuickEntry): void {
  const setup = roundSetup(q.choice);
  const pars = setup.pars;
  const strokes = [...pars] as number[];
  /** The holes a chip has set (v49): the progress counts them, and the next chip goes to the first one not set. */
  const done = pars.map(() => false);
  let at = 0;
  const today = localDate();

  const date = h('input', { id: 'qe-date', type: 'date', max: today, value: today, 'aria-label': '친 날' });
  const dup = h('p', { id: 'qe-dup', class: 'muted small', role: 'status', hidden: '' });
  const total = h('p', { id: 'qe-total', class: 'qe-total' });
  // v49: how far entering has come, "7/18" under the total; a screen reader hears it in words.
  const shown = h('span', { 'aria-hidden': 'true' });
  const spoken = h('span', { class: 'sr-only' });
  const progress = h('p', { id: 'qe-progress', class: 'qe-progress' }, shown, spoken);
  const grid = h('div', { class: 'qe-grid' });
  const cells = pars.map((_, i) => {
    const cell = h('button', { type: 'button', class: 'qe-cell', 'data-hole': String(i + 1), 'aria-pressed': 'false' });
    cell.addEventListener('click', () => {
      at = i;
      draw();
    });
    return cell;
  });
  grid.append(...cells);
  const chips = h('div', { class: 'qe-chips', role: 'group', 'aria-label': '이 홀 타수' },
    ...CHIPS.map(([label, d]) => {
      const chip = h('button', { type: 'button', class: 'qe-chip' }, label);
      chip.addEventListener('click', () => {
        strokes[at] = Math.max(1, pars[at] + d);
        done[at] = true;
        at = nextHole(done, at);
        draw();
      });
      return chip;
    }));
  const save = h('button', { id: 'qe-save', type: 'button', class: 'btn primary' }, '저장');
  const cancel = h('button', { id: 'qe-cancel', type: 'button', class: 'btn' }, '취소');

  function draw(): void {
    cells.forEach((cell, i) => {
      const d = strokes[i] - pars[i];
      cell.replaceChildren(h('span', { class: 'qe-no' }, String(i + 1)), h('b', {}, String(strokes[i])), h('span', { class: 'qe-d' }, d ? formatToPar(d) : `파 ${pars[i]}`));
      cell.classList.toggle('off', d !== 0);
      cell.setAttribute('aria-pressed', String(i === at));
      cell.setAttribute('aria-label', `${i + 1}번 홀 파 ${pars[i]}, ${strokes[i]}타`);
    });
    const sum = strokes.reduce((s, n) => s + n, 0);
    const par = pars.reduce((s, n) => s + n, 0);
    setText(total, `${sum}타 (${formatToPar(sum - par)})`);
    const count = done.filter(Boolean).length;
    setText(shown, `${count}/${pars.length}`);
    setText(spoken, `${pars.length}홀 중 ${count}홀 넣음`);
    const known = date.value !== '' && q.kept(date.value, setup.course.name);
    setText(dup, known ? '이 날 같은 코스 기록이 이미 있어요. 그래도 저장할 수 있어요.' : '');
    dup.hidden = !known;
    save.toggleAttribute('disabled', date.value === '' || date.value > today);
  }

  date.addEventListener('input', draw);
  save.addEventListener('click', () => {
    if (date.value === '' || date.value > today) return;
    q.onSave(enteredRound(date.value, setup, strokes));
    dialog.close();
  });
  cancel.addEventListener('click', () => dialog.close());

  const where = setup.course.front ? `${setup.course.name} · ${setup.course.front}·${setup.course.back}` : setup.course.name;
  dialog.replaceChildren(
    h('div', { class: 'qe-head' }, h('h2', { id: 'qe-title' }, '지난 라운드 넣기'), h('p', { class: 'muted small' }, where)),
    h('label', { class: 'qe-date' }, h('span', {}, '친 날'), date),
    dup,
    grid,
    chips,
    h('p', { id: 'qe-guide', class: 'muted small' }, "1번 홀부터 칩을 차례로 누르세요. 파인 홀은 '파'. 넣은 기록은 타수만 남아요."),
    h('div', { class: 'qe-foot' }, h('div', { class: 'qe-sum' }, total, progress), cancel, save),
  );
  draw();
  dialog.showModal();
}
