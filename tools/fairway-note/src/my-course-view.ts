// 내 코스 (v45): the sheet that keeps a course typed in by hand (the nines' names, asked once, and an optional
// handicap index per hole), and the update of its pars from a later round there.
import { type Round } from './round';
import { MAX_NINE_NAME, loadMyCourses, myCourseOf, saveMyCourses, validHcp, withMyCourse } from './my-courses';
import { h, setText } from './dom';

export const HCP_ERROR = 'HCP는 9홀마다 1–9, 또는 18홀에 1–18이 한 번씩 들어가야 해요. 비워 두어도 돼요.';

/**
 * Opens the save sheet in `dialog` (an empty <dialog>) for the round's course. On save, the course is kept and
 * `onSaved` is called; false when storage refused.
 */
export function openMineSheet(dialog: HTMLDialogElement, round: Round, onSaved: (ok: boolean) => void): void {
  const pars = round.holes.map((x) => x.par);
  const nine = pars.length === 9;
  const nameInput = (id: string, label: string, value: string) => {
    const input = h('input', { id, type: 'text', maxlength: String(MAX_NINE_NAME), autocomplete: 'off', 'aria-label': label });
    input.value = value;
    return h('label', { class: 'mine-nine' }, h('span', {}, label), input);
  };
  const front = nameInput('mine-front', nine ? '코스 이름' : '전반 이름', nine ? '코스' : '전반');
  const back = nine ? null : nameInput('mine-back', '후반 이름', '후반');
  const cells = pars.map((par, i) => {
    // "–" marks the place to type, as the hole bar shows an unknown HCP.
    const input = h('input', { type: 'text', inputmode: 'numeric', maxlength: '2', autocomplete: 'off', placeholder: '–', 'data-hole': String(i + 1), 'aria-label': `${i + 1}번 홀 HCP` });
    return h('label', { class: 'qe-cell mine-cell' }, h('span', { class: 'qe-no' }, String(i + 1)), input, h('span', { class: 'qe-d' }, `파 ${par}`));
  });
  // The app's one disclosure (세는 방법, 샷 세부): the label, then a small chevron that turns when open.
  const hcp = h('details', { class: 'mine-hcp' },
    h('summary', {}, 'HCP(선택)'),
    h('p', { class: 'muted small' }, '스코어카드의 HCP(핸디캡) 순서를 홀마다 넣으면 홀 안내에 보여요.'),
    h('div', { class: 'qe-grid' }, ...cells));
  const error = h('p', { id: 'mine-error', class: 'mine-error small', role: 'alert' });
  const save = h('button', { id: 'mine-save', type: 'button', class: 'btn primary' }, '저장');
  const cancel = h('button', { id: 'mine-cancel', type: 'button', class: 'btn' }, '취소');

  save.addEventListener('click', () => {
    const values = cells.map((c) => c.querySelector('input')!.value.trim());
    let list: number[] | undefined;
    if (values.some((v) => v !== '')) {
      list = values.map((v) => (/^\d{1,2}$/.test(v) ? Number(v) : NaN));
      if (!validHcp(list, pars.length)) {
        setText(error, HCP_ERROR);
        return;
      }
    }
    const value = (label: HTMLElement | null) => label?.querySelector('input')?.value ?? '';
    const course = myCourseOf(round, value(front), value(back), list);
    const ok = saveMyCourses(withMyCourse(loadMyCourses(), course));
    dialog.close();
    onSaved(ok);
  });
  cancel.addEventListener('click', () => dialog.close());

  dialog.replaceChildren(
    h('div', { class: 'qe-head' }, h('h2', { id: 'mine-title' }, '내 코스로 저장'), h('p', { class: 'muted small' }, round.course?.name ?? '')),
    h('p', { class: 'muted small' }, '다음에 코스 선택 맨 위에서 고르면 홀마다 파가 채워져요.'),
    front,
    back ?? '',
    hcp,
    error,
    h('div', { class: 'qe-foot mine-foot' }, cancel, save),
  );
  dialog.showModal();
}

/** Puts this round's pars on the 내 코스 of its name, keeping its nines and handicap. False when storage refused. */
export function updateMinePars(round: Round): boolean {
  const list = loadMyCourses();
  const known = list.find((c) => c.name === round.course?.name);
  if (!known) return false;
  return saveMyCourses(withMyCourse(list, { ...known, par: round.holes.map((x) => x.par) }));
}
