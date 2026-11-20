import { MAX_COUNT } from './round';

/**
 * 말로 입력 (v21): one line of Korean, dictated with the keyboard's microphone or typed, read as commands for the hole
 * being played. A small hand-written parser that runs on the device. A line it cannot read one way only changes
 * nothing: it says why instead of guessing.
 *
 * - "<club> <number>" sets that count (decision D1): 드라이버 하나 아이언 둘 퍼터 두 번. A club said alone adds one, as
 *   do OB, 해저드, 벙커 and 멀리건; 더 adds and 빼 takes off.
 * - One hole move may end the line: 다음 홀, 이전 홀, 7번 홀. 되돌리기 is said alone.
 * - Dictation spaces words its own way, writes digits or words, and adds particles and endings: all are accepted.
 * - Traps (the voice research note): 이번 홀 is this hole but 이 번 홀 is hole 2; 오비 is OB, not 오 (5) and 비; 네 is a
 *   number only after a club; 포 is never four; "안 났어" and other negations change nothing.
 * - The middle count (v28): 그린까지 sets it, and so does 아이언 in a line without 세컨 or 어프로치. 세컨 and 어프로치 set its
 *   parts; beside them 아이언 is the club they were hit with ("세컨 아이언으로 하나"). The count and its parts are
 *   said one at a time: a line with both changes nothing.
 */

/** `approach` is the middle count (그린까지); `second` and `short` its two parts, 세컨 and 어프로치 (v28). */
export type VoiceKey = 'driver' | 'approach' | 'second' | 'short' | 'putts' | 'ob' | 'hazard' | 'bunker' | 'mulligan';

export type Command =
  | { kind: 'set'; key: VoiceKey; n: number; atLeast?: true }
  | { kind: 'add'; key: VoiceKey; n: number }
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'hole'; n: number }
  | { kind: 'undo' };

export type Failure =
  | { reason: 'empty' }
  | { reason: 'unknown'; word: string }
  | { reason: 'ambiguous'; word: string }
  | { reason: 'negated'; word: string }
  | { reason: 'range'; what: 'count' | 'hole'; max: number }
  | { reason: 'order' }
  | { reason: 'undo-alone' }
  | { reason: 'mixed' };

export type Parsed = { ok: true; commands: Command[] } | ({ ok: false } & Failure);

/* ---------- vocabulary: a space in a word is an optional space in the line; other letters must touch ---------- */

/** The club the middle count's shots are hit with: the count itself in a line without its parts, else just a word. */
const IRON = ['아이언'];
const CLUBS: readonly (readonly [VoiceKey, readonly string[]])[] = [
  ['driver', ['드라이버', '드라이브', '티 샷']],
  // 그린까지 since v28 (아이언 in v20–v26, see IRON); the second-shot and short-game words are its parts now.
  ['approach', ['그린까지', ...IRON]],
  ['second', ['세컨드 샷', '세컨 샷', '세컨드', '세컨']],
  ['short', ['어프로치 샷', '어프로치', '칩 샷']],
  ['putts', ['퍼터', '퍼트', '퍼팅', '펏']],
  ['ob', ['ob', '오비']],
  ['hazard', ['워터 해저드', '해저드', '페널티 구역', '패널티 구역']],
  ['bunker', ['벙커']],
  ['mulligan', ['멀리건', '멀리간']],
];

type Sort = 'digit' | 'count' | 'before' | 'sino' | 'english';
const WORD_NUMBERS: Record<Exclude<Sort, 'digit'>, readonly (readonly [string, number])[]> = {
  // Counting: 하나, 둘 … 스물.
  count: [['하나', 1], ['둘', 2], ['셋', 3], ['넷', 4], ['다섯', 5], ['여섯', 6], ['일곱', 7], ['여덟', 8], ['아홉', 9], ['열', 10], ['열하나', 11], ['열둘', 12],
    ['열셋', 13], ['열넷', 14], ['열다섯', 15], ['열여섯', 16], ['열일곱', 17], ['열여덟', 18], ['열아홉', 19], ['스물', 20]],
  // The forms before 번, 개 or 타: 한 번, 두 개, 세 타.
  before: [['한', 1], ['두', 2], ['세', 3], ['석', 3], ['네', 4], ['넉', 4], ['열한', 11], ['열두', 12], ['열세', 13], ['열네', 14], ['스무', 20]],
  // Sino-Korean, as in 칠 번 홀.
  sino: [['영', 0], ['공', 0], ['일', 1], ['이', 2], ['삼', 3], ['사', 4], ['오', 5], ['육', 6], ['륙', 6], ['칠', 7], ['팔', 8], ['구', 9], ['십', 10],
    ['십일', 11], ['십이', 12], ['십삼', 13], ['십사', 14], ['십오', 15], ['십육', 16], ['십칠', 17], ['십팔', 18], ['십구', 19], ['이십', 20]],
  // Golf talk: 원 퍼트, 투 퍼트, 쓰리 퍼트. Never 포: it is the shout "fore!" as often as four.
  english: [['제로', 0], ['원', 1], ['투', 2], ['쓰리', 3], ['스리', 3], ['파이브', 5]],
};
const ANY: readonly Sort[] = ['digit', 'count', 'before', 'sino', 'english'];

const UNITS = ['번', '개', '타', '회', '샷'];
const MORE = ['더', '더해', '더하기', '추가', '플러스'];
const LESS = ['빼', '빼기', '마이너스', '줄여'];
const NONE = ['없음', '없어', '없어요'];
const AT_LEAST = ['이상', '+'];
const PUTT = ['퍼트', '퍼터', '퍼팅'];
/** Particles between a club and its number: 드라이버는 하나, 아이언이 둘, 퍼터를 두 번. They touch the word before. */
const PARTICLES = ['은', '는', '이', '가', '을', '를', '도', '에', '에서', '로', '으로', '만'];
const UNDO = ['되돌리기', '되돌려', '취소', '실행 취소', '언두'];
const THIS_HOLE = ['이번 홀', '이 홀', '지금 홀', '현재 홀'];
const NEXT = ['다음 홀'];
const PREV = ['이전 홀', '앞 홀', '지난 홀', '전 홀'];

/** Endings that say a shot or a penalty happened: 쳤어요, 났어, 들어갔고 … */
const HAPPENED = ['쳤', '했', '났', '나왔', '들어갔', '빠졌', '갔', '됐', '이었', '였']
  .flatMap((stem) => ['어', '어요', '음', '다', '고', '고요', '네', '네요', '습니다', '는데'].map((end) => stem + end))
  .concat(['침', '함', '남', '나옴', '들어감', '빠짐']);
/** Words that only join or soften a line, standing on their own. */
const FREE_GLUE = [
  '그리고', '그리고 나서', '또', '그다음', '그 다음', '다음에', '그 다음에', '하고', '랑', '이랑', '및',
  '음', '어', '으', '그', '저', '저기', '자', '아', '그럼', '일단', '이번에', '이번엔', '방금', '그냥', '좀', '요',
  '가', '가자', '갈게', '이동', '이동해', '넘어가', '넘어가자', '넘어갈게', '줘', '주세요',
  ...HAPPENED,
];
/** Particles and endings that touch the word before: 둘이요, 하나하고, 다음 홀로, 추가해. */
const TOUCHING_GLUE = [
  '은', '는', '이', '가', '을', '를', '도', '에', '에서', '로', '으로', '요', '이요', '예요', '이에요', '입니다', '이다', '임',
  '고', '이고', '하고', '랑', '이랑', '와', '과', '야', '이야', '해', '해요', '해줘',
];

/** Saying something did not happen ("OB 안 났어", "아니 셋") changes nothing; "퍼터 없음" (none) is a count of 0. */
const NEGATION = /(?:^|\s)(안)(?=\s|$|[났했쳤들빠나갔됐돼해쳐가넣])|(않|아니|아냐|아뇨|못|말고)|(없)(?!음(?:\s|$)|어(?:요)?(?:\s|$))/;

/* ---------- reading ---------- */

/** NFC, half-width, lower case; periods and commas go (o.b. is ob), other marks become spaces; one space between words. */
export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[−–—]/g, '-')
    .toLowerCase()
    .replace(/[.,·]/g, '')
    .replace(/[!?~…"'“”‘’()[\]{}:;/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Reader {
  s: string;
  /** The furthest place a whole word or clause ended: what follows it is what was not understood. */
  far: number;
  memo: Map<number, Item[][]>;
  /** The line names 세컨 or 어프로치 (v28): 아이언 is then only the club they were hit with. */
  split: boolean;
}

const SPLIT_WORDS = /세컨|어프로치|칩 ?샷/;

type Item = { cmd: Command; bare?: true } | { here: true };

const skip = (s: string, at: number) => {
  let i = at;
  while (s[i] === ' ') i += 1;
  return i;
};

/** Where `word` ends if it starts at `at`, or -1. */
function matchAt(s: string, at: number, word: string): number {
  let i = at;
  for (const ch of word) {
    if (ch === ' ') {
      i = skip(s, i);
      continue;
    }
    if (s[i] !== ch) return -1;
    i += 1;
  }
  return i;
}

/** The ends of `words` at `at`: after any spaces, or only right there when they must touch the word before. */
function ends(r: Reader, at: number, words: readonly string[], touching = false): number[] {
  const from = touching ? at : skip(r.s, at);
  if (touching && (at === 0 || r.s[at - 1] === ' ')) return [];
  const out: number[] = [];
  for (const w of words) {
    const end = matchAt(r.s, from, w);
    if (end > from && !out.includes(end)) out.push(end);
  }
  return out;
}

/** Numbers at `at` of the given sorts: [end, value, the word]. Digits are any run of digits. */
function numbers(r: Reader, at: number, sorts: readonly Sort[], touching = false): [number, number, string][] {
  const from = touching ? at : skip(r.s, at);
  const out: [number, number, string][] = [];
  if (sorts.includes('digit')) {
    const m = /^\d+/.exec(r.s.slice(from));
    if (m) out.push([from + m[0].length, Number(m[0]), m[0]]);
  }
  for (const sort of sorts) {
    if (sort === 'digit') continue;
    for (const [word, n] of WORD_NUMBERS[sort]) {
      const end = matchAt(r.s, from, word);
      if (end > from) out.push([end, n, word]);
    }
  }
  return out;
}

const setCmd = (key: VoiceKey, n: number, atLeast = false): Command => (atLeast ? { kind: 'set', key, n, atLeast: true } : { kind: 'set', key, n });

/** What may follow a club: a number (with 번, 이상, 더 or 빼), or 더, 빼 or 없음 alone, or +2 / -1. */
function amounts(r: Reader, at: number, key: VoiceKey): [number, Command][] {
  const out: [number, Command][] = [];
  for (const [end, n, word] of numbers(r, at, ANY)) {
    // Beside 세컨 or 어프로치, "7번 아이언" (or 칠 번, or 7) names a club, never a count: "세컨 7번 아이언으로" is not seven 세컨 (v28).
    const clubNumber = r.split && (/^\d+$/.test(word) || WORD_NUMBERS.sino.some(([w]) => w === word));
    for (const e of [end, ...ends(r, end, UNITS)]) {
      if (clubNumber && (e === end || r.s.slice(end, e).trim() === '번') && ends(r, e, IRON).length) continue;
      out.push([e, setCmd(key, n)]);
      for (const e2 of ends(r, e, AT_LEAST)) out.push([e2, setCmd(key, n, true)]);
      for (const e2 of ends(r, e, MORE)) out.push([e2, { kind: 'add', key, n }]);
      for (const e2 of ends(r, e, LESS)) out.push([e2, { kind: 'add', key, n: -n }]);
    }
  }
  for (const e of ends(r, at, MORE)) out.push([e, { kind: 'add', key, n: 1 }]);
  for (const e of ends(r, at, LESS)) out.push([e, { kind: 'add', key, n: -1 }]);
  for (const e of ends(r, at, NONE)) out.push([e, setCmd(key, 0)]);
  for (const [sign, by] of [['+', 1], ['-', -1]] as const) {
    for (const e of ends(r, at, [sign])) for (const [e2, n] of numbers(r, e, ['digit'], true)) out.push([e2, { kind: 'add', key, n: by * n }]);
  }
  return out;
}

/** A club and what was said about it, or golf talk with the number first (투 퍼트, 3퍼트). */
function clauses(r: Reader, at: number): [number, Command][] {
  const out: [number, Command][] = [];
  for (const [key, list] of CLUBS) {
    // Beside 세컨 or 어프로치, 아이언 is not the middle count (v28).
    const words = key === 'approach' && r.split ? list.filter((w) => !IRON.includes(w)) : list;
    for (const end of ends(r, at, words)) {
      const after = [end, ...ends(r, end, PARTICLES, true)];
      // 세컨 or 어프로치, then the club it was hit with: "세컨 아이언으로 하나", "세컨은 아이언 둘".
      if (key === 'second' || key === 'short') {
        for (const e of after.slice()) for (const e2 of ends(r, e, IRON)) after.push(e2, ...ends(r, e2, PARTICLES, true));
      }
      for (const e of after) {
        out.push([e, { kind: 'add', key, n: 1 }]);
        out.push(...amounts(r, e, key));
      }
    }
  }
  for (const [end, n] of numbers(r, at, ['english'])) for (const e of ends(r, end, PUTT)) out.push([e, setCmd('putts', n)]);
  for (const [end, n] of numbers(r, at, ['digit'])) for (const e of ends(r, end, PUTT, true)) out.push([e, setCmd('putts', n)]);
  return out;
}

/** 다음 홀 (or 다음 at the very end), 이전 홀, and a hole by its number: 7번 홀, 칠 번 홀, 일곱 번째 홀, 첫 홀. */
function moves(r: Reader, at: number): [number, Item][] {
  const out: [number, Item][] = [];
  for (const e of ends(r, at, NEXT)) out.push([e, { cmd: { kind: 'next' } }]);
  for (const e of ends(r, at, ['다음'])) out.push([e, { cmd: { kind: 'next' }, bare: true }]);
  for (const e of ends(r, at, PREV)) out.push([e, { cmd: { kind: 'prev' } }]);
  const hole = (n: number, from: number) => {
    for (const e of ends(r, from, ['홀'])) out.push([e, { cmd: { kind: 'hole', n } }]);
  };
  // Digits: 7번 홀, 7번째 홀. Not "7홀": "9홀" is as often nine holes as hole 9.
  for (const [end, n] of numbers(r, at, ['digit'])) {
    for (const e of ends(r, end, ['번'])) {
      hole(n, e);
      for (const e2 of ends(r, e, ['째'])) hole(n, e2);
    }
  }
  // Sino-Korean with 번: 칠 번 홀, 이 번 홀. Written together, 이번 is "this time", never hole 2.
  for (const [end, n, word] of numbers(r, at, ['sino'])) {
    for (const e of ends(r, end, ['번'])) if (!(word === '이' && r.s[end] === '번')) hole(n, e);
  }
  // Ordinals: 두 번째 홀, 일곱 번째 홀, 첫 홀.
  for (const [end, n] of numbers(r, at, ['count', 'before'])) for (const e of ends(r, end, ['번 째'])) hole(n, e);
  for (const end of ends(r, at, ['첫'])) {
    hole(1, end);
    for (const e of ends(r, end, ['번 째'])) hole(1, e);
  }
  return out;
}

function items(r: Reader, at: number): [number, Item][] {
  const out: [number, Item][] = clauses(r, at).map(([e, cmd]) => [e, { cmd }]);
  out.push(...moves(r, at));
  for (const e of ends(r, at, UNDO)) out.push([e, { cmd: { kind: 'undo' } }]);
  for (const e of ends(r, at, THIS_HOLE)) out.push([e, { here: true }]);
  return out;
}

/** Every way to read the line from `at` to its end, as items; glue words are read and dropped. */
function rest(r: Reader, at: number): Item[][] {
  const known = r.memo.get(at);
  if (known) return known;
  r.far = Math.max(r.far, at);
  const found = new Map<string, Item[]>();
  if (skip(r.s, at) === r.s.length) found.set('', []);
  else {
    // Beside 세컨 or 어프로치 (v28), 아이언 on its own is a word that only says which club.
    for (const e of [...ends(r, at, FREE_GLUE), ...ends(r, at, TOUCHING_GLUE, true), ...(r.split ? ends(r, at, IRON) : [])]) {
      for (const tail of rest(r, e)) found.set(JSON.stringify(tail), tail);
    }
    for (const [e, item] of items(r, at)) {
      for (const tail of rest(r, e)) {
        const list = [item, ...tail];
        found.set(JSON.stringify(list), list);
      }
    }
  }
  const list = [...found.values()];
  r.memo.set(at, list);
  return list;
}

const isMove = (c: Command) => c.kind === 'next' || c.kind === 'prev' || c.kind === 'hole';

/** One reading against the rules: 이번 홀 first, 되돌리기 alone, one move and only at the end, counts and holes in range. */
function judge(list: Item[], holes: number): Parsed {
  const first = list.findIndex((x) => !('here' in x));
  if (first >= 0 && list.slice(first).some((x) => 'here' in x)) return { ok: false, reason: 'order' };
  const acts = list.filter((x): x is { cmd: Command; bare?: true } => 'cmd' in x);
  if (!acts.length) return { ok: false, reason: 'empty' };
  const cmds = acts.map((x) => x.cmd);
  if (cmds.some((c) => c.kind === 'undo')) return cmds.length === 1 ? { ok: true, commands: cmds } : { ok: false, reason: 'undo-alone' };
  const movesAt = cmds.flatMap((c, k) => (isMove(c) ? [k] : []));
  if (movesAt.length > 1 || (movesAt.length === 1 && movesAt[0] !== cmds.length - 1)) return { ok: false, reason: 'order' };
  // 그린까지 and its parts in one line would say the same strokes twice (v28).
  const keys = new Set(cmds.flatMap((c) => (c.kind === 'set' || c.kind === 'add' ? [c.key] : [])));
  if (keys.has('approach') && (keys.has('second') || keys.has('short'))) return { ok: false, reason: 'mixed' };
  for (const c of cmds) {
    if ((c.kind === 'set' || c.kind === 'add') && Math.abs(c.n) > MAX_COUNT) return { ok: false, reason: 'range', what: 'count', max: MAX_COUNT };
    if (c.kind === 'hole' && (c.n < 1 || c.n > holes)) return { ok: false, reason: 'range', what: 'hole', max: holes };
  }
  return { ok: true, commands: cmds };
}

/** When no reading passes, the most telling reason a reading failed. */
const WORST: Failure['reason'][] = ['range', 'mixed', 'undo-alone', 'order', 'empty'];

/** Reads one line for a round of `holes` holes. */
export function parseLine(text: string, holes: number): Parsed {
  const s = normalize(text);
  if (!s) return { ok: false, reason: 'empty' };
  const no = NEGATION.exec(s);
  if (no) return { ok: false, reason: 'negated', word: no[1] ?? no[2] ?? no[3] };
  const r: Reader = { s, far: 0, memo: new Map(), split: SPLIT_WORDS.test(s) };
  const readings = rest(r, 0).map((list) => judge(list, holes));
  const passed = new Map<string, Command[]>();
  for (const x of readings) if (x.ok) passed.set(JSON.stringify(x.commands), x.commands);
  if (passed.size === 1) return { ok: true, commands: [...passed.values()][0] };
  if (passed.size > 1) return { ok: false, reason: 'ambiguous', word: s };
  for (const reason of WORST) {
    const failed = readings.find((x) => !x.ok && x.reason === reason);
    if (failed) return failed;
  }
  return { ok: false, reason: 'unknown', word: wordAt(s, r.far) };
}

/** The word, as written between spaces, where reading stopped: "더블" in "퍼터 더블", not the "블" after 더. */
function wordAt(s: string, far: number): string {
  let start = skip(s, far);
  if (start === far) while (start > 0 && s[start - 1] !== ' ') start -= 1;
  const end = s.indexOf(' ', start);
  return s.slice(start, end < 0 ? undefined : end);
}

/* ---------- what to say ---------- */

/** 은 or 는, by whether the word ends in a final consonant. */
function topic(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? '은' : '는';
}

const NOTHING = '바꾼 것은 없어요.';

/** Why a line changed nothing, in one or two short sentences. */
export function failureText(f: Failure): string {
  switch (f.reason) {
    case 'empty':
      return '기록할 말이 없어요.';
    case 'unknown':
      return f.word ? `‘${f.word}’${topic(f.word)} 알아듣지 못했어요. ${NOTHING}` : `알아듣지 못했어요. ${NOTHING}`;
    case 'ambiguous':
      return `‘${f.word}’${topic(f.word)} 두 가지로 읽혀요. 띄어 쓰거나 다르게 말해 주세요.`;
    case 'negated':
      return `‘${f.word}’처럼 아니라는 말이 있어 바꾸지 않았어요.`;
    case 'range':
      return f.what === 'count' ? `한 홀에 ${f.max}번까지 적을 수 있어요. ${NOTHING}` : `이 라운드는 ${f.max}번 홀까지예요. ${NOTHING}`;
    case 'order':
      return `홀 이동은 한 번만, 맨 끝에 말해 주세요. ${NOTHING}`;
    case 'undo-alone':
      return `되돌리기는 따로 말해 주세요. ${NOTHING}`;
    case 'mixed':
      return `그린까지와 세컨·어프로치는 따로 말해 주세요. ${NOTHING}`;
  }
}
