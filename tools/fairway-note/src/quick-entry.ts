// 지난 라운드 넣기 (v44): a past round entered as strokes per hole. A chip sets the picked cell relative to par and moves
// on (v49: to the next hole not entered yet), so a round goes in hole by hole from hole 1 in one chip a hole, 18 taps; a
// tap on a cell picks it. v49: a cell starts empty, 모름 leaves a hole out, and saving with cells not pressed asks once
// whether they were pars or are to be left empty. Saved as an entered round (strokes only); nothing leaves the device.
import { enteredRound, formatToPar, localDate, type Round } from './round';
import { roundSetup } from './courses';
import type { CourseChoice } from './storage';
import { h, setText } from './dom';

// v47 (U2): from an eagle to +7, so a double par (양파: 6 on a par 3, 8 on a par 4, 10 on a par 5) and a hole-in-one on a
// par 3 can be entered too. Strokes stay within 1–15 (enteredRound). v49: 모름 comes after them, two columns wide.
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

/** A cell (v49): not pressed yet, given strokes by a chip, or left out with 모름. */
type Cell = 'empty' | 'set' | 'unknown';

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

/** "5번 홀", "5·6번 홀", "7~18번 홀", "3·7~18번 홀" (v49): holes by number (0-based in), a run of three or more as a range. */
export function holeList(indexes: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const i of indexes) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  const parts = runs.flatMap(([a, b]) => (b - a >= 2 ? [`${a + 1}~${b + 1}`] : Array.from({ length: b - a + 1 }, (_, k) => String(a + k + 1))));
  return `${parts.join('·')}번 홀`;
}

/** The question before saving with cells not pressed (v49): static markup in index.html, as 라운드 마치기's check is. */
let ask: { dialog: HTMLDialogElement; sub: HTMLElement; none: HTMLElement; par: HTMLButtonElement; empty: HTMLButtonElement } | null = null;

function askSheet(): NonNullable<typeof ask> {
  if (ask) return ask;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const dialog = get<HTMLDialogElement>('qe-ask');
  // ×, Escape or another close request: back to entering, nothing saved.
  get('qa-close').addEventListener('click', () => dialog.close());
  ask = { dialog, sub: get('qa-sub'), none: get('qa-none'), par: get<HTMLButtonElement>('qa-par'), empty: get<HTMLButtonElement>('qa-empty') };
  return ask;
}

/** Opens the quick entry in `dialog` (an empty <dialog>) for the course chosen in the picker. */
export function openQuickEntry(dialog: HTMLDialogElement, q: QuickEntry): void {
  const setup = roundSetup(q.choice);
  const pars = setup.pars;
  const strokes = [...pars] as number[];
  /** What each cell holds (v49): the progress counts the ones decided, and the next chip goes to the first one empty. */
  const state: Cell[] = pars.map(() => 'empty');
  let at = 0;
  const today = localDate();

  const date = h('input', { id: 'qe-date', type: 'date', max: today, value: today, 'aria-label': '친 날' });
  const dup = h('p', { id: 'qe-dup', class: 'muted small', role: 'status', hidden: '' });
  const total = h('p', { id: 'qe-total', class: 'qe-total' });
  // v49: how far entering has come, "7/18" under the total; a screen reader hears it in words.
  const shown = h('span', { 'aria-hidden': 'true' });
  const spoken = h('span', { class: 'sr-only' });
  const progress = h('p', { id: 'qe-progress', class: 'qe-progress' }, shown, spoken);
  // v49: with every hole 모름 there is nothing to keep.
  const none = h('p', { id: 'qe-none', class: 'muted small', role: 'status', hidden: '' }, '타수를 넣은 홀이 하나는 있어야 저장할 수 있어요.');
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
  const pick = (cell: Cell) => {
    state[at] = cell;
    at = nextHole(state.map((s) => s !== 'empty'), at);
    draw();
  };
  const chips = h('div', { class: 'qe-chips', role: 'group', 'aria-label': '이 홀 타수' },
    ...CHIPS.map(([label, d]) => {
      const chip = h('button', { type: 'button', class: 'qe-chip' }, label);
      chip.addEventListener('click', () => {
        strokes[at] = Math.max(1, pars[at] + d);
        pick('set');
      });
      return chip;
    }));
  // v49: 모름 leaves the hole out, as a hole skipped while recording; its cell shows –, the dash this chip wears.
  const unknown = h('button', { type: 'button', class: 'qe-chip qe-unknown', 'aria-label': '모름' }, h('span', { 'aria-hidden': 'true' }, '–'), ' 모름');
  unknown.addEventListener('click', () => pick('unknown'));
  chips.append(unknown);
  const save = h('button', { id: 'qe-save', type: 'button', class: 'btn primary' }, '저장');
  const cancel = h('button', { id: 'qe-cancel', type: 'button', class: 'btn' }, '취소');

  function draw(): void {
    cells.forEach((cell, i) => {
      const s = state[i];
      const d = strokes[i] - pars[i];
      const value = s === 'set' ? String(strokes[i]) : s === 'unknown' ? '–' : '';
      const note = s === 'set' && d ? formatToPar(d) : s === 'unknown' ? '모름' : `파 ${pars[i]}`;
      cell.replaceChildren(h('span', { class: 'qe-no' }, String(i + 1)), h('b', {}, value), h('span', { class: 'qe-d' }, note));
      cell.classList.toggle('empty', s === 'empty');
      cell.classList.toggle('unknown', s === 'unknown');
      cell.classList.toggle('off', s === 'set' && d !== 0);
      cell.setAttribute('aria-pressed', String(i === at));
      cell.setAttribute('aria-label', `${i + 1}번 홀 파 ${pars[i]}, ${s === 'set' ? `${strokes[i]}타` : s === 'unknown' ? '모름' : '아직 안 넣음'}`);
    });
    // v49: the total counts the holes entered; a cell not pressed is not taken for a par.
    const set = state.flatMap((s, i) => (s === 'set' ? [i] : []));
    const sum = set.reduce((n, i) => n + strokes[i], 0);
    const par = set.reduce((n, i) => n + pars[i], 0);
    setText(total, set.length ? `${sum}타 (${formatToPar(sum - par)})` : '0타');
    const count = state.filter((s) => s !== 'empty').length;
    setText(shown, `${count}/${pars.length}`);
    setText(spoken, `${pars.length}홀 중 ${count}홀 넣음`);
    const known = date.value !== '' && q.kept(date.value, setup.course.name);
    setText(dup, known ? '이 날 같은 코스 기록이 이미 있어요. 그래도 저장할 수 있어요.' : '');
    dup.hidden = !known;
    const nothing = state.every((s) => s === 'unknown');
    none.hidden = !nothing;
    save.toggleAttribute('disabled', date.value === '' || date.value > today || nothing);
  }

  /** Keeps the round: the cells not pressed as pars or left empty, a 모름 hole always empty. */
  const keep = (blank: 'par' | 'empty') => {
    const list = state.map((s, i) => (s === 'set' ? strokes[i] : s === 'empty' && blank === 'par' ? pars[i] : 0));
    if (list.every((n) => n === 0)) return;
    q.onSave(enteredRound(date.value, setup, list));
    dialog.close();
  };
  date.addEventListener('input', draw);
  save.addEventListener('click', () => {
    if (date.value === '' || date.value > today) return;
    const blanks = state.flatMap((s, i) => (s === 'empty' ? [i] : []));
    if (!blanks.length) {
      keep('empty');
      return;
    }
    // v49: asked once, before saving, never while entering.
    const a = askSheet();
    setText(a.sub, `${holeList(blanks)}을 파로 저장할까요, 비워 둘까요?`);
    const nothing = !state.includes('set');
    a.none.hidden = !nothing;
    a.empty.disabled = nothing;
    a.par.onclick = () => {
      a.dialog.close();
      keep('par');
    };
    a.empty.onclick = () => {
      a.dialog.close();
      keep('empty');
    };
    a.dialog.showModal();
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
    none,
    // v49: 취소 and 저장 kept together, beside the total or, where the three do not fit, under it (style.css).
    h('div', { class: 'qe-foot' }, h('div', { class: 'qe-sum' }, total, progress), h('div', { class: 'qe-acts' }, cancel, save)),
  );
  draw();
  dialog.showModal();
}
