// 클럽 상세 (v18): a short tap on a club's number opens a small panel with that club's detail chips for the shots on
// this hole. The page hands over the hole and a way to change it (bindShotPanel) and calls renderShotPanel after
// each render. + and −, the long press on the number and everything else on 기록 stay as they are.
//
// v28: 상세's 세컨 and 어프로치 have panels of their own. The middle count's details are still one list, 세컨's shots
// first: the 세컨 panel shows shots 1 … 세컨 of it, the 어프로치 panel the rest, and 기본's 그린까지 all of them.

import { TAG_LABELS, bump, bumpPart, isPart, isSplit, secondOf, setTag, strokes, tagAt, type Hole, type Par, type Part, type ShotTag, type Tagged } from './round';
import { CLUB_ICONS, icon } from './icons';
import { $, h, setText } from './dom';

/** Each panel, in the card's order: 기본's three clubs and 상세's two parts of the middle count. */
export const VIEWS = ['driver', 'approach', 'second', 'short', 'putts'] as const;
export type View = (typeof VIEWS)[number];

/** The tag list a panel writes: 세컨 and 어프로치 write the middle count's one list. */
export const listOf = (view: View): Tagged => (isPart(view) ? 'approach' : view);

/** Where a panel's shots sit in its list: [from, to). A hole entered in 기본 is all 세컨 until it is split. */
export function viewRange(hole: Hole, view: View): [number, number] {
  if (view === 'second') return [0, secondOf(hole)];
  if (view === 'short') return [secondOf(hole), hole.approach];
  return [0, hole[view]];
}

/**
 * Each panel's chips row by row, on a six-column grid: three across (span 2) or two across (span 3). Left things sit
 * on the left, right things on the right, and the target in the middle, so a chip is found where the ball went.
 * 길게 comes before 짧게, as on the 상세 tee line. 세컨 has the middle count's chips as 그린까지 does; 어프로치 (v28) has
 * the short game's: 붙음 is its target, then 칩인 and the chunked or thinned chip.
 */
export const PANEL_ROWS: { driver: ShotTag<'driver'>[][]; approach: ShotTag<'approach'>[][]; second: ShotTag<'approach'>[][]; short: ShotTag<'approach'>[][]; putts: ShotTag<'putts'>[][] } = {
  driver: [['left', 'fairway', 'right'], ['long', 'short'], ['far-left', 'whiff', 'far-right'], ['ob-left', 'mishit', 'ob-right']],
  approach: [['left', 'green', 'right'], ['long', 'short'], ['hazard', 'whiff']],
  second: [['left', 'green', 'right'], ['long', 'short'], ['hazard', 'whiff']],
  short: [['left', 'close', 'right'], ['long', 'short'], ['in', 'mishit']],
  putts: [['left', 'in', 'right'], ['long', 'short']],
};

/**
 * Details still read from rounds saved before (the live site) but no longer offered (v18): an approach's 벙커, since
 * 상세's 벙커 counts bunkers and one bunker must not be recorded twice. Such a chip shows only on a shot that carries
 * it, so it can be seen and cleared; so does a detail of the list another of its panels offers (v28).
 */
export const LEGACY_TAGS: { [K in Tagged]?: ShotTag<K>[] } = { approach: ['bunker'] };

/** What one of a panel's shots is called: every drive is a tee shot (a re-tee after OB too), putts are putts. */
const SHOT_NOUN: Record<View, string> = { driver: '티샷', approach: '샷', second: '샷', short: '샷', putts: '퍼트' };

/** What 세컨 and 어프로치 are, under the panel's name (v28; the same words as 상세's one-time tip). */
export const PART_HELP: Record<Part, string> = { second: '그린을 향한 샷, 레이업 포함', short: '그린 주변 짧은 샷, 벙커샷 포함' };

/**
 * Where the ball went, drawn as on the 상세 tee line and pad: up for 길게, down for 짧게, and arrows pointing out to
 * the side for 좌 and 우 (two for 많이). An arrow to the left comes before its word, one to the right after it. The
 * app's one icon family (v18), at 12px.
 */
const GLYPHS: Record<string, [string, 'before' | 'after']> = {
  long: [icon('chevUp', 12), 'before'],
  short: [icon('chevDown', 12), 'before'],
  left: [icon('chevLeft', 12), 'before'],
  right: [icon('chevRight', 12), 'after'],
  'far-left': [icon('chevLeft2', 12), 'before'],
  'far-right': [icon('chevRight2', 12), 'after'],
};

/** The shot a panel opens on: the last one played, or the first when none is counted yet. */
export function firstShot(hole: Hole, view: View): number {
  const [from, to] = viewRange(hole, view);
  return Math.max(0, to - from - 1);
}

/**
 * A chip tap on a panel's shot `index`: sets that shot's tag, or clears it when it is the tag already. With no shot
 * counted, the chip counts the first one, as the 상세 tee pad does: a 세컨 goes in before the 어프로치s, an 어프로치
 * comes last. A chip of 세컨 or 어프로치 records the hole's split. OB tags add and take back their penalty (see setTag).
 */
export function chooseViewTag(hole: Hole, view: View, index: number, tag: ShotTag): Hole {
  const key = listOf(view);
  const [from, to] = viewRange(hole, view);
  if (to === from) {
    if (index !== 0) return hole;
    const counted = isPart(view) ? bumpPart(hole, view, 1) : bump(hole, key, 1);
    // The new shot sits where the panel's shots end: at 세컨's end for 세컨, last for every other.
    return counted === hole ? hole : setTag(counted, key, to, tag as ShotTag<typeof key>);
  }
  const at = from + index;
  const base = isPart(view) && !isSplit(hole) ? { ...hole, short: 0 } : hole;
  return setTag(base, key, at, (tagAt(hole, key, at) === tag ? null : tag) as ShotTag<typeof key> | null);
}

/** chooseViewTag for a club's own panel (기본's three). */
export function chooseTag<K extends Tagged>(hole: Hole, key: K, index: number, tag: ShotTag<K>): Hole {
  return chooseViewTag(hole, key, index, tag);
}

/** A chip's name on this hole: on a par 3 the tee shot's target is the green, as on the 상세 pad. */
function chipLabel(key: Tagged, tag: string, par: Par): string {
  return key === 'driver' && tag === 'fairway' && par === 3 ? '온그린' : (TAG_LABELS[key] as Record<string, string>)[tag];
}

/** What the panel borrows from the page. */
export interface ShotPanelHost {
  /** The hole being recorded. */
  hole(): Hole;
  /** The panel's name on this hole: 드라이버, or 티샷 on a par 3; 그린까지; 세컨, 어프로치. */
  label(view: View): string;
  /** Changes the hole being recorded; false when nothing changed. */
  change(patch: (hole: Hole) => Hole, view: View): boolean;
  announce(text: string): void;
  /** Called as the panel opens, so the page can put its undo toast away. */
  opening(): void;
}

let host: ShotPanelHost | null = null;
/** The panel that is open, and the shot its chips write. Kept in memory only. */
let openKey: View | null = null;
let shot = 0;
const numbers = new Map<View, HTMLButtonElement>();

const panel = () => $<HTMLDialogElement>('shot-panel');

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Binds each club's name above its capsule to its panel, and the panel itself. Call once, after the capsules exist. */
export function bindShotPanel(page: ShotPanelHost): void {
  host = page;
  // The club's name and icon open the panel (v20): the capsule below is all + and −, half each.
  for (const view of VIEWS) numbers.set(view, $(`lbl-${view}`) as HTMLButtonElement);
  $('clubs').addEventListener('click', (event) => {
    const name = (event.target as HTMLElement).closest<HTMLElement>('.club-lbl');
    if (!name || document.querySelector('dialog[open]')) return;
    open(name.closest<HTMLElement>('.club')!.dataset.key as View);
  });

  const dialog = panel();
  // A tap on the dim backdrop, outside the panel, closes it and presses nothing under it.
  dialog.addEventListener('click', (event) => {
    const r = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientY < r.top || event.clientY > r.bottom || event.clientX < r.left || event.clientX > r.right)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    const key = openKey;
    openKey = null;
    if (!key) return;
    const num = numbers.get(key)!;
    setAttr(num, 'aria-expanded', 'false');
    num.focus({ preventScroll: true });
  });
  $('sp-close').addEventListener('click', () => dialog.close());
  $('sp-shots').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-shot]');
    if (!button || !openKey) return;
    shot = Number(button.dataset.shot);
    renderPanel();
  });
  $('sp-chips').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-tag]');
    if (button && openKey) pick(openKey, button.dataset.tag as ShotTag);
  });
  window.addEventListener('resize', () => {
    if (openKey) place();
  });
}

function open(view: View): void {
  if (!host || panel().open) return;
  host.opening();
  openKey = view;
  shot = firstShot(host.hole(), view);
  renderPanel();
  panel().showModal();
  place();
  setAttr(numbers.get(view)!, 'aria-expanded', 'true');
  // The panel itself: its name is read first, and nothing gets a ring nobody asked for.
  panel().focus();
}

/**
 * Side to side, the card's inner edges, so the panel spans the steppers exactly (the wrapper is measured: the sheet
 * itself may be sliding between holes). Up and down, under the club's pill so its number stays in view, or higher,
 * over the pill, so it ends 8px above 다음 홀 (v32; the tab bar before, which on 375×553 left the panel over the top
 * half of 다음 홀, its words cut). CSSOM, allowed by the CSP.
 */
function place(): void {
  if (!openKey) return;
  const dialog = panel();
  const wrap = $('sheet-wrap').getBoundingClientRect();
  const card = getComputedStyle($('sheet'));
  const left = wrap.left + parseFloat(card.borderLeftWidth) + parseFloat(card.paddingLeft);
  const right = wrap.right - parseFloat(card.borderRightWidth) - parseFloat(card.paddingRight);
  dialog.style.left = `${left}px`;
  dialog.style.width = `${right - left}px`;
  const pill = numbers.get(openKey)!.closest('.club')!.querySelector('.pill')!.getBoundingClientRect();
  const next = $('go-next').getBoundingClientRect();
  const floor = (next.height > 0 ? next.top : Math.min(window.innerHeight, $('views').getBoundingClientRect().top)) - 8;
  const top = Math.min(pill.bottom + 8, floor - dialog.offsetHeight);
  dialog.style.top = `${Math.round(Math.max(8, top))}px`;
}

/** A panel's count on a hole: its shots in the list. */
const shotsIn = (hole: Hole, view: View) => {
  const [from, to] = viewRange(hole, view);
  return to - from;
};

function pick(view: View, tag: ShotTag): void {
  if (!host) return;
  const key = listOf(view);
  const before = host.hole();
  const index = shotsIn(before, view) ? shot : 0;
  if (!host.change((x) => chooseViewTag(x, view, index, tag), view)) return;
  navigator.vibrate?.(8);
  const after = host.hole();
  const now = tagAt(after, key, viewRange(after, view)[0] + index);
  const label = host.label(view);
  const said = [`${label} ${index + 1}번째 ${SHOT_NOUN[view]} ${now === null ? '지움' : chipLabel(key, now, after.par)}`];
  if (shotsIn(after, view) !== shotsIn(before, view)) said.push(`${label} ${shotsIn(after, view)}`);
  if (after.ob !== before.ob) said.push(`OB ${after.ob}`);
  if (strokes(after) !== strokes(before)) said.push(`${strokes(after)}타`);
  host.announce(said.join(', '));
}

/** Keeps each club name's dot and spoken name in step with the hole, and the open panel with it. Call after every render. */
export function renderShotPanel(): void {
  if (!host) return;
  const cur = host.hole();
  for (const [view, num] of numbers) {
    const [from, to] = viewRange(cur, view);
    const tagged = (cur.tags?.[listOf(view)] ?? []).slice(from, to).filter((t) => t !== null).length;
    num.classList.toggle('tagged', tagged > 0);
    setAttr(num, 'aria-label', `${host.label(view)} 샷 세부${tagged ? ` ${tagged}개` : ''}`);
  }
  if (openKey) renderPanel();
}

function renderPanel(): void {
  if (!host || !openKey) return;
  const view = openKey;
  const key = listOf(view);
  const cur = host.hole();
  const [from] = viewRange(cur, view);
  const n = shotsIn(cur, view);
  shot = Math.min(shot, Math.max(0, n - 1));
  const box = $('sp-chips');
  if (box.dataset.key !== view) {
    // Rebuilt only when the panel changes, so a chip keeps focus after it is tapped. Static icon markup from icons.ts.
    box.dataset.key = view;
    $('sp-ico').innerHTML = CLUB_ICONS[view];
    const offered = new Set<string>(PANEL_ROWS[view].flat());
    // After its own chips, the list's other details, each shown only on a shot that carries it (old or another panel's).
    const others = (Object.keys(TAG_LABELS[key]) as string[]).filter((tag) => !offered.has(tag));
    const rows: { tags: string[]; legacy: boolean }[] = [
      ...PANEL_ROWS[view].map((tags) => ({ tags: tags as string[], legacy: false })),
      ...others.map((tag) => ({ tags: [tag], legacy: true })),
    ];
    box.replaceChildren(...rows.flatMap((row) => row.tags.map((tag) => {
      const kind = `${row.tags.length === 2 ? ' half' : ''}${tag.startsWith('ob-') ? ' ob' : ''}`;
      const chip = h('button', { type: 'button', class: `sp-chip${kind}`, 'data-tag': tag, 'aria-pressed': 'false' }, h('span', { class: 'sp-lbl' }));
      if (row.legacy) chip.dataset.legacy = '';
      const glyph = GLYPHS[tag];
      // Static icon markup, never user input.
      if (glyph) chip.insertAdjacentHTML(glyph[1] === 'before' ? 'afterbegin' : 'beforeend', glyph[0]);
      return chip;
    })));
    // 세컨 and 어프로치 say what they are under their name (v28).
    const help = $('sp-help');
    setText(help, isPart(view) ? PART_HELP[view] : '');
    help.hidden = !isPart(view);
  }
  setText($('sp-club'), host.label(view));
  setText($('sp-shot'), n ? `${shot + 1}번째 ${SHOT_NOUN[view]}` : '고르면 1타가 더해져요');
  const chosen = n ? tagAt(cur, key, from + shot) : null;
  for (const chip of box.querySelectorAll<HTMLButtonElement>('button[data-tag]')) {
    setText(chip.querySelector('.sp-lbl')!, chipLabel(key, chip.dataset.tag!, cur.par));
    setAttr(chip, 'aria-pressed', String(chip.dataset.tag === chosen));
    // An old-only detail shows on the shot that carries it, and goes once cleared (focus moves on to the first chip).
    const gone = chip.dataset.legacy !== undefined && chip.dataset.tag !== chosen;
    if (gone && document.activeElement === chip) box.querySelector<HTMLButtonElement>('button[data-tag]')!.focus();
    chip.hidden = gone;
  }
  // With two shots or more, which one the chips write: the last one first, those with a detail marked.
  const row = $('sp-shots');
  row.hidden = n < 2;
  if (n >= 2) {
    if (row.children.length !== n || row.dataset.key !== view) {
      row.dataset.key = view;
      row.replaceChildren(...Array.from({ length: n }, (_, i) => h('button', { type: 'button', 'data-shot': String(i) }, String(i + 1), h('i', { class: 'sp-dot', 'aria-hidden': 'true' }))));
      row.style.setProperty('--n', String(Math.min(n, 5)));
    }
    for (const button of row.querySelectorAll<HTMLButtonElement>('button[data-shot]')) {
      const i = Number(button.dataset.shot);
      const tag = tagAt(cur, key, from + i);
      setAttr(button, 'aria-pressed', String(i === shot));
      button.classList.toggle('tagged', tag !== null);
      setAttr(button, 'aria-label', `${i + 1}번째 ${SHOT_NOUN[view]}${tag === null ? '' : `, ${chipLabel(key, tag, cur.par)}`}`);
    }
  }
}
