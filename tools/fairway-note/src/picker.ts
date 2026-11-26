import { AREAS, CUSTOM_NAME, MAX_CUSTOM_NAME, defaultNines, findCourse, resolveChoice, roundSetup, searchCourses, type Course } from './courses';
import type { CourseChoice } from './storage';
import { loadMyCourses, saveMyCourses, withoutMyCourse, type MyCourse } from './my-courses';

type Children = (Node | string | null | false)[];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: Children): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const CUSTOM = '__custom__';

export interface PickerOptions {
  /** 'first': no round yet, so there is nothing to go back to. 'new': replacing the current round. */
  mode: 'first' | 'new';
  initial: CourseChoice | null;
  onStart: (choice: CourseChoice) => void;
  /** Text of the button that closes the picker in 'new' mode (default "취소"). */
  cancelLabel?: string;
  /** Called when that button closes the picker. */
  onCancel?: () => void;
  /** Title and start button for another use of the picker, e.g. changing this round's course (default "어디서 치세요?", "이 코스로 시작"). */
  title?: string;
  startLabel?: string;
  /** Fixes the number of holes and hides 18홀/9홀, e.g. when a round moves to another course and keeps its holes. */
  holes?: 9 | 18;
}

let choice: CourseChoice = resolveChoice(null);
let area: string | null = null;
let onStart: PickerOptions['onStart'] = () => undefined;
let onCancel: PickerOptions['onCancel'];
let mode: PickerOptions['mode'] = 'first';
let bound = false;

const dialog = () => $<HTMLDialogElement>('picker');

export function pickerOpen(): 'first' | 'new' | null {
  return dialog().open ? mode : null;
}

export function closePicker(): void {
  if (dialog().open) dialog().close();
}

/** Shows the course picker with the remembered course chosen, so one tap on start accepts it. */
export function openPicker(options: PickerOptions): void {
  bind();
  mode = options.mode;
  onStart = options.onStart;
  onCancel = options.onCancel;
  choice = withHoles(resolveChoice(options.initial), options.holes ?? (options.initial?.holes === 9 ? 9 : 18));
  // 내 코스 (v45): a name typed last time that is now a kept course comes back as that course, with its pars.
  const typed = choice.course === null && !choice.mine ? (choice.name ?? '').trim() : '';
  const kept = typed ? loadMyCourses().find((c) => c.name === typed) : undefined;
  if (kept) choice = { ...choice, mine: kept.id };
  $('picker-len').hidden = options.holes !== undefined;
  // Where the round's holes are fixed, the count stands in the toggle's place (v23: the name above no longer says it).
  $('picker-holes').hidden = options.holes === undefined;
  $('picker-holes').textContent = options.holes ? `${options.holes}홀` : '';
  area = null;
  $<HTMLInputElement>('picker-search').value = '';
  $('picker-cancel').hidden = mode === 'first';
  // 홈 (v37) goes back to 기록 as 취소 does, so it shows only where there is a round to go back to.
  $('picker-home').hidden = mode === 'first';
  $('picker-cancel').textContent = options.cancelLabel ?? '취소';
  $('picker-title').textContent = options.title ?? '어디서 치세요?';
  // The first visit says what the app is not: no sign-up, records only on this phone.
  $('picker-first').hidden = mode !== 'first';
  $('picker-start').textContent = options.startLabel ?? '이 코스로 시작';
  renderAreas();
  renderList();
  renderChosen();
  if (!dialog().open) dialog().showModal();
  // The dialog itself takes focus: not the search box, so the keyboard does not pop up, and not 이 코스로 시작,
  // which would show a focus ring nobody asked for. Tab goes on to the controls.
  dialog().focus();
  // The chosen course's row at the list's top (v23), never half a row; the list is its rows' offset parent.
  const list = $('picker-list');
  const chosen = list.querySelector<HTMLElement>('[aria-pressed="true"]')?.closest('li');
  // The first row under a heading (내 코스, 골프장; v45) brings its heading into view with it.
  const head = chosen?.previousElementSibling?.classList.contains('course-group') ? (chosen.previousElementSibling as HTMLElement) : null;
  if (chosen) list.scrollTop = (head ?? chosen).offsetTop;
}

/** The choice for 18 holes (no field) or one nine (`holes: 9`). */
function withHoles(c: CourseChoice, holes: 9 | 18): CourseChoice {
  const { holes: _old, ...rest } = c;
  return holes === 9 ? { ...rest, holes: 9 } : rest;
}

function bind(): void {
  if (bound) return;
  bound = true;
  $('picker-len').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-holes]');
    if (!button) return;
    choice = withHoles(choice, button.dataset.holes === '9' ? 9 : 18);
    renderChosen();
    button.focus();
  });
  $('picker-search').addEventListener('input', () => renderList());
  $('picker-areas').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-area]');
    if (!button) return;
    area = button.dataset.area || null;
    renderAreas();
    renderList();
  });
  $('picker-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-course], button[data-mine]');
    if (!button) return;
    const id = button.dataset.course ?? '';
    const holes = choice.holes === 9 ? 9 : 18;
    const kept = button.dataset.mine ? loadMyCourses().find((c) => c.id === button.dataset.mine) : undefined;
    if (kept) {
      // 내 코스 (v45): a typed-in name standing for the kept course; a nine-hole one keeps the 18/9 toggle.
      choice = withHoles({ course: null, front: '', back: '', name: kept.name, mine: kept.id }, holes);
    } else if (button.dataset.mine) {
      return;
    } else if (id === CUSTOM) {
      choice = withHoles({ course: null, front: '', back: '', name: choice.course === null && !choice.mine ? choice.name : '' }, holes);
    } else {
      const [front, back] = defaultNines(findCourse(id)!);
      choice = withHoles({ course: id, front, back }, holes);
    }
    for (const b of $('picker-list').querySelectorAll('button[data-course], button[data-mine]')) b.setAttribute('aria-pressed', String(b === button));
    renderChosen();
  });
  $('picker-chosen').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const nine = target.closest<HTMLButtonElement>('button[data-nine]');
    if (nine) {
      const side = nine.dataset.side as 'front' | 'back';
      choice = { ...choice, [side]: nine.dataset.nine! };
      renderChosen();
      $('picker-chosen').querySelector<HTMLButtonElement>(`button[data-side="${side}"][data-nine="${nine.dataset.nine}"]`)?.focus();
    } else if (target.closest('#picker-swap')) {
      choice = { ...choice, front: choice.back, back: choice.front };
      renderChosen();
      $('picker-swap').focus();
    } else if (target.closest('#picker-mine-delete')) {
      // 내 코스 (v45): asked first; past rounds keep what they recorded, and the name stays as a course typed in by hand.
      const kept = loadMyCourses().find((c) => c.id === choice.mine);
      if (!kept || !confirm(`${kept.name}\n\n내 코스에서 지울까요? 지난 라운드 기록은 그대로예요.`)) return;
      saveMyCourses(withoutMyCourse(loadMyCourses(), kept.id));
      choice = withHoles({ course: null, front: '', back: '', name: kept.name }, choice.holes === 9 ? 9 : 18);
      renderList();
      renderChosen();
      dialog().focus();
    }
  });
  $('picker-chosen').addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id !== 'picker-name') return;
    choice = { ...choice, name: input.value };
    setStartText();
  });
  $('picker-start').addEventListener('click', () => {
    const chosen = resolveChoice(choice);
    if (chosen.course === null) chosen.name = (chosen.name ?? '').trim().slice(0, MAX_CUSTOM_NAME);
    dialog().close();
    onStart(chosen);
  });
  $('picker-cancel').addEventListener('click', () => {
    dialog().close();
    onCancel?.();
  });
  $('picker-home').addEventListener('click', () => {
    dialog().close();
    onCancel?.();
  });
}

function renderAreas(): void {
  const chip = (label: string, value: string) =>
    h('button', { type: 'button', class: 'chip', 'data-area': value, 'aria-pressed': String((area ?? '') === value) }, label);
  $('picker-areas').replaceChildren(chip('전체', ''), ...AREAS.map((a) => chip(a, a)));
}

function courseItem(c: Course): HTMLLIElement {
  const nines = c.nines.length === 1 ? '9홀' : `${c.nines.length * 9}홀 ${c.nines.map((n) => n.name.ko).join('·')}`;
  return h('li', {}, h('button', { type: 'button', class: 'course', 'data-course': c.id, 'aria-pressed': String(choice.course === c.id) },
    h('b', {}, c.name.ko),
    h('span', {}, `${c.region}, ${nines}`),
  ));
}

/** 내 코스 (v45): a kept course, its nines and par beside its name. */
function mineItem(c: MyCourse): HTMLLIElement {
  const par = c.par.reduce((s, p) => s + p, 0);
  const nines = c.par.length === 9 ? `${c.front} 9홀` : `${c.front}·${c.back}`;
  return h('li', {}, h('button', { type: 'button', class: 'course mine', 'data-mine': c.id, 'aria-pressed': String(choice.course === null && choice.mine === c.id) },
    h('b', {}, c.name),
    h('span', {}, `${nines}, Par ${par}`),
  ));
}

function renderList(): void {
  const query = $<HTMLInputElement>('picker-search').value;
  const found = searchCourses(query, area);
  // Kept courses first, under their own heading, while no area is chosen; the search finds them by name.
  const q = query.replace(/\s+/g, '').toLowerCase();
  const mine = area ? [] : loadMyCourses().filter((c) => !q || c.name.replace(/\s+/g, '').toLowerCase().includes(q));
  $('picker-list').replaceChildren(
    // Read aloud too: the heading is what says a row is the player's own course.
    ...(mine.length ? [h('li', { class: 'course-group' }, '내 코스'), ...mine.map(mineItem), h('li', { class: 'course-group' }, '골프장')] : []),
    ...found.map(courseItem),
    found.length ? '' : h('li', { class: 'empty muted' }, '찾는 골프장이 없어요. 직접 입력으로 시작하세요.'),
    h('li', {}, h('button', { type: 'button', class: 'course custom', 'data-course': CUSTOM, 'aria-pressed': String(choice.course === null && !choice.mine) },
      h('b', {}, CUSTOM_NAME),
      h('span', {}, '목록에 없는 골프장, Par 4로 시작해 홀마다 바꿔요'),
    )),
  );
}

function nineRow(course: Course, side: 'front' | 'back', label = side === 'front' ? '전반' : '후반'): HTMLElement {
  return h('div', { class: 'nine-row' },
    h('span', { class: 'nine-label', id: `picker-${side}-label` }, label),
    h('div', { class: 'nine-pick', role: 'radiogroup', 'aria-labelledby': `picker-${side}-label` },
      ...course.nines.map((n) => h('button', { type: 'button', role: 'radio', 'data-side': side, 'data-nine': n.id, 'aria-checked': String(choice[side] === n.id) }, n.name.ko)),
    ),
  );
}

function renderChosen(): void {
  const box = $('picker-chosen');
  const course = findCourse(choice.course);
  const nine = choice.holes === 9;
  for (const b of $('picker-len').querySelectorAll('button[data-holes]')) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.holes === (nine ? '9' : '18')));
  const kept = !course && choice.mine ? loadMyCourses().find((c) => c.id === choice.mine) : undefined;
  if (kept) {
    // 내 코스 (v45): what it starts with, no name to type.
    const setup = roundSetup(choice);
    const par = setup.pars.reduce((s, p) => s + p, 0);
    const nines = nine ? `${setup.course.front} 9홀` : setup.course.front === setup.course.back ? `${setup.course.front} 9홀을 두 번 돌아요` : `전반 ${setup.course.front}, 후반 ${setup.course.back}`;
    // 지우기 in the place 전·후반 바꾸기 takes for a bundled course: kept courses are listed above, and removed here.
    box.replaceChildren(h('div', { class: 'nine-row' }, h('span', { class: 'nine-fixed' }, nines),
      h('button', { type: 'button', class: 'btn swap', id: 'picker-mine-delete', 'aria-label': `${kept.name} 내 코스에서 지우기` }, '지우기')),
    h('p', { class: 'muted small' }, `내 코스, Par ${par}${kept.hcp ? ', HCP 있음' : ''}`));
  } else if (!course) {
    const input = h('input', { id: 'picker-name', type: 'text', maxlength: String(MAX_CUSTOM_NAME), placeholder: '골프장 이름', autocomplete: 'off', 'aria-label': '골프장 이름' });
    input.value = choice.name ?? '';
    box.replaceChildren(input, h('p', { class: 'muted small' }, 'Par는 모두 4로 시작해요. 홀마다 3, 4, 5로 바꿀 수 있어요.'));
  } else {
    const setup = roundSetup(choice);
    const par = setup.pars.reduce((s, p) => s + p, 0);
    const source = h('p', { class: 'muted small' }, `${course.region}, Par ${par}, 공식 스코어카드(${course.checked} 확인)`);
    if (nine) {
      // One nine: no 후반, and the row is the course to play.
      box.replaceChildren(course.nines.length > 1
        ? nineRow(course, 'front', '코스')
        : h('div', { class: 'nine-row' }, h('span', { class: 'nine-fixed' }, `${setup.course.front} 9홀`)), source);
    } else if (course.nines.length >= 3) {
      box.replaceChildren(nineRow(course, 'front'), nineRow(course, 'back'), source);
    } else if (course.nines.length === 2) {
      box.replaceChildren(
        h('div', { class: 'nine-row' },
          h('span', { class: 'nine-fixed' }, `전반 ${setup.course.front}, 후반 ${setup.course.back}`),
          h('button', { type: 'button', class: 'btn swap', id: 'picker-swap' }, '전·후반 바꾸기'),
        ),
        source,
      );
    } else {
      box.replaceChildren(h('div', { class: 'nine-row' }, h('span', { class: 'nine-fixed' }, `${setup.course.front} 9홀을 두 번 돌아요`)), source);
    }
  }
  setStartText();
}

/** The chosen course's name, or the typed one (v23): its nines are the rows right under it, 18 or 9 the toggle beside it. */
function setStartText(): void {
  $('picker-label').textContent = roundSetup(choice).course.name;
}
