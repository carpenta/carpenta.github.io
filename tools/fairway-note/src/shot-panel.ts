// 클럽 상세 (v18): a short tap on a club's number opens a small panel with that club's detail chips for the shots on
// this hole. The page hands over the hole and a way to change it (bindShotPanel) and calls renderShotPanel after
// each render. + and −, the long press on the number and everything else on 기록 stay as they are.

import { TAGGED, TAG_LABELS, bump, setTag, strokes, tagAt, type Hole, type Par, type ShotTag, type Tagged } from './round';
import { CLUB_ICONS, icon } from './icons';
import { $, h, setText } from './dom';

/**
 * Each club's chips row by row, on a six-column grid: three across (span 2) or two across (span 3). Left things sit
 * on the left, right things on the right, and the target in the middle, so a chip is found where the ball went.
 * 김 comes before 짧음, as on the 상세 tee line.
 */
export const PANEL_ROWS: { [K in Tagged]: ShotTag<K>[][] } = {
  driver: [['left', 'fairway', 'right'], ['long', 'short'], ['far-left', 'whiff', 'far-right'], ['ob-left', 'mishit', 'ob-right']],
  approach: [['left', 'green', 'right'], ['long', 'short'], ['hazard', 'whiff']],
  putts: [['left', 'in', 'right'], ['long', 'short']],
};

/**
 * Details still read from rounds saved before (the live site) but no longer offered (v18): an approach's 벙커, since
 * 상세's 벙커 counts bunkers and one bunker must not be recorded twice. Such a chip shows only on a shot that carries
 * it, so it can be seen and cleared.
 */
export const LEGACY_TAGS: { [K in Tagged]?: ShotTag<K>[] } = { approach: ['bunker'] };

/** What one of a club's shots is called: every drive is a tee shot (a re-tee after OB too), putts are putts. */
const SHOT_NOUN: Record<Tagged, string> = { driver: '티샷', approach: '샷', putts: '퍼트' };

/**
 * Where the ball went, drawn as on the 상세 tee line and pad: up for 김, down for 짧음, and arrows pointing out to
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
export function firstShot(hole: Hole, key: Tagged): number {
  return Math.max(0, hole[key] - 1);
}

/**
 * A chip tap on shot `index`: sets that shot's tag, or clears it when it is the tag already. With no shot counted,
 * the chip counts the first one, as the 상세 tee pad does. OB tags add and take back their penalty (see setTag).
 */
export function chooseTag<K extends Tagged>(hole: Hole, key: K, index: number, tag: ShotTag<K>): Hole {
  if (hole[key] === 0) return index === 0 ? setTag(bump(hole, key, 1), key, 0, tag) : hole;
  return setTag(hole, key, index, tagAt(hole, key, index) === tag ? null : tag);
}

/** A chip's name on this hole: on a par 3 the tee shot's target is the green, as on the 상세 pad. */
function chipLabel(key: Tagged, tag: string, par: Par): string {
  return key === 'driver' && tag === 'fairway' && par === 3 ? '온그린' : (TAG_LABELS[key] as Record<string, string>)[tag];
}

/** What the panel borrows from the page. */
export interface ShotPanelHost {
  /** The hole being recorded. */
  hole(): Hole;
  /** The club's name on this hole: 드라이버, or 티샷 on a par 3. */
  label(key: Tagged): string;
  /** Changes the hole being recorded; false when nothing changed. */
  change(patch: (hole: Hole) => Hole, key: Tagged): boolean;
  announce(text: string): void;
  /** Called as the panel opens, so the page can put its undo toast away. */
  opening(): void;
}

let host: ShotPanelHost | null = null;
/** The club whose panel is open, and the shot its chips write. Kept in memory only. */
let openKey: Tagged | null = null;
let shot = 0;
const numbers = new Map<Tagged, HTMLButtonElement>();

const panel = () => $<HTMLDialogElement>('shot-panel');

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Binds each club's name above its capsule to its panel, and the panel itself. Call once, after the capsules exist. */
export function bindShotPanel(page: ShotPanelHost): void {
  host = page;
  // The club's name and icon open the panel (v20): the capsule below is all + and −, half each.
  for (const key of TAGGED) numbers.set(key, $(`lbl-${key}`) as HTMLButtonElement);
  $('clubs').addEventListener('click', (event) => {
    const name = (event.target as HTMLElement).closest<HTMLElement>('.club-lbl');
    if (!name || document.querySelector('dialog[open]')) return;
    open(name.closest<HTMLElement>('.club')!.dataset.key as Tagged);
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

function open(key: Tagged): void {
  if (!host || panel().open) return;
  host.opening();
  openKey = key;
  shot = firstShot(host.hole(), key);
  renderPanel();
  panel().showModal();
  place();
  setAttr(numbers.get(key)!, 'aria-expanded', 'true');
  // The panel itself: its name is read first, and nothing gets a ring nobody asked for.
  panel().focus();
}

/**
 * Side to side, the card's inner edges, so the panel spans the steppers exactly (the wrapper is measured: the sheet
 * itself may be sliding between holes). Up and down, under the club's pill so its number stays in view, or higher,
 * over the pill, so it ends 8px above the tab bar and never cuts through the tab names. CSSOM, allowed by the CSP.
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
  const floor = Math.min(window.innerHeight, $('views').getBoundingClientRect().top) - 8;
  const top = Math.min(pill.bottom + 8, floor - dialog.offsetHeight);
  dialog.style.top = `${Math.round(Math.max(8, top))}px`;
}

function pick(key: Tagged, tag: ShotTag): void {
  if (!host) return;
  const before = host.hole();
  const index = before[key] ? shot : 0;
  if (!host.change((x) => chooseTag(x, key, index, tag as ShotTag<typeof key>), key)) return;
  navigator.vibrate?.(8);
  const after = host.hole();
  const now = tagAt(after, key, index);
  const label = host.label(key);
  const said = [`${label} ${index + 1}번째 ${SHOT_NOUN[key]} ${now === null ? '지움' : chipLabel(key, now, after.par)}`];
  if (after[key] !== before[key]) said.push(`${label} ${after[key]}`);
  if (after.ob !== before.ob) said.push(`OB ${after.ob}`);
  if (strokes(after) !== strokes(before)) said.push(`${strokes(after)}타`);
  host.announce(said.join(', '));
}

/** Keeps each club name's dot and spoken name in step with the hole, and the open panel with it. Call after every render. */
export function renderShotPanel(): void {
  if (!host) return;
  const cur = host.hole();
  for (const [key, num] of numbers) {
    const tagged = (cur.tags?.[key] ?? []).filter((t) => t !== null).length;
    num.classList.toggle('tagged', tagged > 0);
    setAttr(num, 'aria-label', `${host.label(key)} 샷 세부${tagged ? ` ${tagged}개` : ''}`);
  }
  if (openKey) renderPanel();
}

function renderPanel(): void {
  if (!host || !openKey) return;
  const key = openKey;
  const cur = host.hole();
  const n = cur[key];
  shot = Math.min(shot, Math.max(0, n - 1));
  const box = $('sp-chips');
  if (box.dataset.key !== key) {
    // Rebuilt only when the club changes, so a chip keeps focus after it is tapped. Static icon markup from icons.ts.
    box.dataset.key = key;
    $('sp-ico').innerHTML = CLUB_ICONS[key];
    const rows: { tags: string[]; legacy: boolean }[] = [
      ...PANEL_ROWS[key].map((tags) => ({ tags: tags as string[], legacy: false })),
      ...(LEGACY_TAGS[key] ?? []).map((tag) => ({ tags: [tag as string], legacy: true })),
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
  }
  setText($('sp-club'), host.label(key));
  setText($('sp-shot'), n ? `${shot + 1}번째 ${SHOT_NOUN[key]}` : '고르면 1타가 더해져요');
  const chosen = n ? tagAt(cur, key, shot) : null;
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
    if (row.children.length !== n) {
      row.replaceChildren(...Array.from({ length: n }, (_, i) => h('button', { type: 'button', 'data-shot': String(i) }, String(i + 1), h('i', { class: 'sp-dot', 'aria-hidden': 'true' }))));
      row.style.setProperty('--n', String(Math.min(n, 5)));
    }
    for (const button of row.querySelectorAll<HTMLButtonElement>('button[data-shot]')) {
      const i = Number(button.dataset.shot);
      const tag = tagAt(cur, key, i);
      setAttr(button, 'aria-pressed', String(i === shot));
      button.classList.toggle('tagged', tag !== null);
      setAttr(button, 'aria-label', `${i + 1}번째 ${SHOT_NOUN[key]}${tag === null ? '' : `, ${chipLabel(key, tag, cur.par)}`}`);
    }
  }
}
