import {
  AREA_LABELS, PART_LABELS, SCORE_LABELS, SHOT_TAGS, TAGGED, TAG_LABELS, analyze, finished, formatToPar, isSplit, roundCourse, roundLabel, secondOf, shortOf, strokes,
  totals, type Analysis, type Hole, type Part, type Round, type ScoreName, type Tagged,
} from './round';

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Plain-language notes on the round, shared by the page and the report. */
export function insights(a: Analysis): string[] {
  const t = a.totals;
  const out: string[] = [];
  if (a.worstAreas.length) {
    const names = a.worstAreas.map((k) => AREA_LABELS[k]).join('·');
    out.push(`기준(티샷 1, ${AREA_LABELS.approach} Par−3, 퍼트 2) 대비 가장 많이 잃은 곳은 ${names}입니다 (+${a.lost[a.worstAreas[0]]}타).`);
  } else {
    out.push('모든 영역이 기준 타수 안에 있습니다. 좋은 라운드입니다.');
  }
  if (a.threePutts) out.push(`3퍼트 이상이 ${a.threePutts}홀 있습니다. 첫 퍼트 거리감을 맞추면 바로 줄일 수 있는 타수입니다.`);
  if (t.ob || t.hazard) {
    const counts = [t.ob ? `OB ${t.ob}회` : '', t.hazard ? `해저드 ${t.hazard}회` : ''].filter(Boolean).join('·');
    const retee = t.ob ? ' 다시 친 샷까지 치면 OB 하나에 보통 2타를 잃습니다.' : '';
    out.push(`${counts}로 벌타 ${t.ob + t.hazard}타가 더해졌습니다.${retee}`);
  }
  if (t.mulligan) out.push(`멀리건 ${t.mulligan}회를 썼습니다. 멀리건 없이 쳤다면 스코어가 더 나왔을 수 있습니다.`);
  out.push(`그린 적중(GIR)은 ${a.girHoles}/${t.holes}홀 (${pct(a.girHoles, t.holes)}%)입니다.`);
  // The holes split in 상세 (v28), against their own pattern: 세컨 Par−3, 어프로치 none.
  const s = a.split;
  if (s.holes) out.push(`상세로 나눈 ${s.holes}홀에서 세컨은 기준(Par−3)보다 +${s.lost.second}타, 어프로치는 +${s.lost.short}타입니다.`);
  if (s.upDown.chances) out.push(`업앤다운은 ${s.upDown.chances}번 중 ${s.upDown.made}번 (${pct(s.upDown.made, s.upDown.chances)}%)입니다.`);
  return out;
}

/** A rate's percent, only from three or more (v29): "1/1 100%" says nothing. */
export function rateSub(n: number, d: number): string {
  return d >= 3 ? `${pct(n, d)}%` : '';
}

/**
 * The page's 정리 (v29): only what the tiles and the lost strokes do not already say (three putts, penalties,
 * mulligans), in the page's 해요체. The outgoing report keeps its formal insights().
 */
export function adviceLines(a: Analysis): string[] {
  const t = a.totals;
  const out: string[] = [];
  if (a.threePutts) out.push(`3퍼트 이상이 ${a.threePutts}홀 있어요. 첫 퍼트 거리감을 맞추면 바로 줄일 수 있어요.`);
  if (t.ob || t.hazard) {
    const counts = [t.ob ? `OB ${t.ob}회` : '', t.hazard ? `해저드 ${t.hazard}회` : ''].filter(Boolean).join('·');
    const retee = t.ob ? ' 다시 친 샷까지 치면 OB 하나에 보통 2타를 잃어요.' : '';
    out.push(`${counts}로 벌타 ${t.ob + t.hazard}타가 더해졌어요.${retee}`);
  }
  if (t.mulligan) out.push(`멀리건 ${t.mulligan}회를 썼어요. 멀리건 없이 쳤다면 스코어가 더 나왔을 수 있어요.`);
  return out;
}

/** The middle count's tags by where they are counted: 그린까지 on holes not split, then 세컨 and 어프로치 (v28). */
const DETAIL_ROWS: { key: Tagged | Part; tags: Tagged; label: string }[] = [
  { key: 'driver', tags: 'driver', label: AREA_LABELS.driver },
  { key: 'approach', tags: 'approach', label: AREA_LABELS.approach },
  { key: 'second', tags: 'approach', label: PART_LABELS.second },
  { key: 'short', tags: 'approach', label: PART_LABELS.short },
  { key: 'putts', tags: 'putts', label: AREA_LABELS.putts },
];

/** Short summary of shot tags on finished holes, shared by the page and the report. Empty without tags. */
export function detailLines(a: Analysis, polite = false): string[] {
  const be = polite ? '이에요' : '입니다';
  const d = a.details;
  if (!d) return [];
  const out: string[] = [];
  for (const { key, tags, label } of DETAIL_ROWS) {
    const counts = d[key] as Record<string, number>;
    const parts = (SHOT_TAGS[tags] as readonly string[]).filter((t) => counts[t]).map((t) => `${(TAG_LABELS[tags] as Record<string, string>)[t]} ${counts[t]}`);
    if (parts.length) out.push(`${label}: ${parts.join(' · ')}`);
    if (key === 'driver') {
      const obL = d.driver['ob-left'] ?? 0;
      const obR = d.driver['ob-right'] ?? 0;
      const left = (d.driver.left ?? 0) + (d.driver['far-left'] ?? 0) + obL;
      const right = (d.driver.right ?? 0) + (d.driver['far-right'] ?? 0) + obR;
      if (left + right) out.push(`티샷 방향: 좌 ${left} (OB ${obL}) · 우 ${right} (OB ${obR})`);
    }
    if (key === 'putts') {
      const short = d.putts.short ?? 0;
      const long = d.putts.long ?? 0;
      if (short > long && short >= 2) out.push(`퍼트가 짧았던 적이 ${short}번, 길었던 적이 ${long}번${be}. 홀을 지나가게 쳐 보세요.`);
      if (long > short && long >= 2) out.push(`퍼트가 길었던 적이 ${long}번, 짧았던 적이 ${short}번${be}. 첫 퍼트 세기를 줄여 보세요.`);
    }
  }
  const whiffs = (d.driver.whiff ?? 0) + (d.approach.whiff ?? 0) + (d.second.whiff ?? 0) + (d.short.whiff ?? 0);
  if (whiffs) out.push(`헛스윙 ${whiffs}번이 타수에 ${polite ? '들어갔어요' : '들어갔습니다'}.`);
  return out;
}

/** One letter per club on a report line: 드, 그 (그린까지; 어 before v28, when it was 어프로치), 퍼, and 세, 어 for its parts. */
const SHORT: Record<Tagged | Part, string> = { driver: '드', approach: '그', second: '세', short: '어', putts: '퍼' };

/** A hole's tags for its report line, e.g. " · 드 좌 OB, 페어웨이 · 세 온그린 · 어 붙음". Empty without tags. */
function holeTags(h: Hole): string {
  const label = (key: Tagged, t: string) => (TAG_LABELS[key] as Record<string, string>)[t];
  const run = (letter: string, key: Tagged, tags: readonly (string | null)[]) => {
    const labels = tags.filter((t) => t !== null).map((t) => label(key, t!));
    return labels.length ? ` · ${letter} ${labels.join(', ')}` : '';
  };
  return TAGGED.map((key) => {
    const tags = h.tags?.[key] ?? [];
    // On a split hole the middle count's tags read by part: 세컨's shots come first in the one list.
    if (key === 'approach' && isSplit(h)) return run(SHORT.second, key, tags.slice(0, secondOf(h))) + run(SHORT.short, key, tags.slice(secondOf(h)));
    return run(SHORT[key], key, tags);
  }).join('');
}

/** "그2(세1 어1)" on a split hole, "그2" otherwise. */
const middle = (h: Hole) => `${SHORT.approach}${h.approach}${isSplit(h) ? `(${SHORT.second}${secondOf(h)} ${SHORT.short}${shortOf(h)})` : ''}`;

export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function reportSubject(round: Round): string {
  const a = analyze(round);
  const score = a.totals.holes ? ` ${a.totals.strokes}타 (${formatToPar(a.toPar)})` : '';
  return `${roundLabel(round)} ${dateLabel(round.date)} 라운드${score}`;
}

/** The round as plain text for email or sharing: summary, hole by hole, then analysis. */
export function reportText(round: Round): string {
  const a = analyze(round);
  const t = a.totals;
  const lines: string[] = [];
  lines.push(`${roundLabel(round)} · ${dateLabel(round.date)}`);
  if (!t.holes) {
    lines.push('', '아직 끝낸 홀이 없습니다.');
    return lines.join('\n');
  }
  lines.push(
    `총 ${t.strokes}타 (${formatToPar(a.toPar)}) · ${t.holes}/${round.holes.length}홀`,
    // A round of one nine has no nines to compare.
    ...(round.holes.length === 9 ? [] : [`전반 ${a.front.holes ? `${a.front.strokes}타` : '-'} · 후반 ${a.back.holes ? `${a.back.strokes}타` : '-'}`]),
    `퍼트 ${t.putts} · OB ${t.ob}${t.hazard ? ` · 해저드 ${t.hazard}` : ''} · 멀리건 ${t.mulligan}`,
    '',
    `[홀별] 타수 = 드라이버 + ${AREA_LABELS.approach}${a.split.holes ? `(${PART_LABELS.second} + ${PART_LABELS.short})` : ''} + 퍼트 + 벌타(OB·해저드)`,
  );
  round.holes.forEach((h, i) => {
    if (!finished(round, i)) return;
    const s = strokes(h);
    const extra = [h.ob ? `OB ${h.ob}` : '', h.hazard ? `해저드 ${h.hazard}` : '', h.mulligan ? `멀리건 ${h.mulligan}` : ''].filter(Boolean).join(' ');
    lines.push(`${i + 1}번 Par${h.par}: ${s}타 (${formatToPar(s - h.par)}) 드${h.driver} ${middle(h)} 퍼${h.putts}${extra ? ` ${extra}` : ''}${holeTags(h)}`);
  });
  const dist = (Object.keys(SCORE_LABELS) as ScoreName[])
    .filter((k) => a.distribution[k])
    .map((k) => `${SCORE_LABELS[k]} ${a.distribution[k]}`)
    .join(' · ');
  lines.push(
    '',
    '[분석]',
    `평균 퍼트 ${one(a.puttsPerHole)}개 · 1퍼트 ${a.onePutts}홀 · 3퍼트 이상 ${a.threePutts}홀`,
    `그린 적중 ${a.girHoles}/${t.holes} (${pct(a.girHoles, t.holes)}%)`,
    ...(a.split.holes ? [`세컨·어프로치 (상세로 나눈 ${a.split.holes}홀): 그린 적중 ${a.split.gir}/${a.split.holes} · 업앤다운 ${a.split.upDown.made}/${a.split.upDown.chances}`] : []),
    `분포: ${dist}`,
    `Par별 평균: ${a.byPar.filter((p) => p.holes).map((p) => `Par${p.par} ${one(p.average)}타`).join(' · ')}`,
    ...insights(a).map((s) => `- ${s}`),
  );
  const detail = detailLines(a);
  if (detail.length) lines.push('', '[샷 세부]', ...detail.map((s) => `- ${s}`));
  return lines.join('\n');
}

/** One CSV field: quoted when it holds a comma, a quote or a line break. */
const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The round's holes for a spreadsheet: one row per hole (counts left blank on a hole not finished), then 합계 over
 * the finished holes. "파 대비" is a plain number so it adds up. The caller adds the UTF-8 BOM so Excel reads Korean.
 * 세컨 and 어프로치 (v28) are the last columns, so the columns before them stay where a sheet made earlier expects them;
 * they are blank on a hole whose split is not known, and their 합계 counts the split holes.
 */
export function roundCsv(round: Round): string {
  const rows: (string | number)[][] = [['홀', '파', '드라이버', AREA_LABELS.approach, '퍼트', 'OB', '해저드', '타수', '파 대비', PART_LABELS.second, PART_LABELS.short]];
  round.holes.forEach((h, i) => {
    if (!finished(round, i)) {
      rows.push([i + 1, h.par, '', '', '', '', '', '', '', '', '']);
      return;
    }
    const s = strokes(h);
    rows.push([i + 1, h.par, h.driver, h.approach, h.putts, h.ob, h.hazard, s, s - h.par, ...(isSplit(h) ? [secondOf(h), shortOf(h)] : ['', ''])]);
  });
  const t = totals(round);
  const split = analyze(round).split;
  rows.push(['합계', t.par, t.driver, t.approach, t.putts, t.ob, t.hazard, t.strokes, t.strokes - t.par, ...(split.holes ? [split.second, split.short] : ['', ''])]);
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** "fairway-note-2026-11-20.csv": the round's own date. */
export function csvName(round: Round): string {
  return `fairway-note-${round.date}.csv`;
}

/**
 * The round as a plain block of facts to paste into a note or any chat that analyses text: course, nines, date,
 * hole by hole, totals and the strokes lost against a simple pattern. No instructions and no links.
 */
export function analysisText(round: Round): string {
  const a = analyze(round);
  const t = a.totals;
  const c = roundCourse(round);
  const single = round.holes.length === 9;
  const lines = [
    '[Fairway Note 라운드 기록]',
    `골프장: ${c.name}`,
    single ? `코스: ${c.front || '9홀'} (9홀)` : `코스: 전반 ${c.front || '-'} · 후반 ${c.back || '-'}`,
    `날짜: ${round.date}`,
    `기록한 홀: ${t.holes}/${round.holes.length}`,
    '',
    `[홀별] 홀 | 파 | 드라이버 | ${AREA_LABELS.approach} | ${PART_LABELS.second} | ${PART_LABELS.short} | 퍼트 | OB | 해저드 | 타수 | 파 대비`,
  ];
  round.holes.forEach((h, i) => {
    if (!finished(round, i)) {
      lines.push(`${i + 1} | ${h.par} | 기록 없음`);
      return;
    }
    const s = strokes(h);
    // 세컨 and 어프로치 only where the hole was split (v28); "-" where it was not.
    const parts = isSplit(h) ? [secondOf(h), shortOf(h)] : ['-', '-'];
    lines.push([i + 1, h.par, h.driver, h.approach, ...parts, h.putts, h.ob, h.hazard, s, formatToPar(s - h.par)].join(' | '));
  });
  lines.push('', '[합계]', `타수 ${t.strokes} (${formatToPar(a.toPar)}) · 퍼트 ${t.putts} · OB ${t.ob} · 해저드 ${t.hazard}`);
  if (!single) lines.push(`전반 ${a.front.holes ? `${a.front.strokes}타 (${a.front.holes}홀)` : '기록 없음'} · 후반 ${a.back.holes ? `${a.back.strokes}타 (${a.back.holes}홀)` : '기록 없음'}`);
  lines.push(`그린 적중 ${a.girHoles}/${t.holes} · 1퍼트 ${a.onePutts}홀 · 3퍼트 이상 ${a.threePutts}홀`);
  lines.push(
    '',
    `[잃은 타수] 기준: 티샷 1번, ${AREA_LABELS.approach} 파-3번, 퍼트 2번`,
    `티샷 +${a.lost.driver} · ${AREA_LABELS.approach} +${a.lost.approach} · 퍼트 +${a.lost.putts} · 벌타 +${a.lost.penalty}`,
  );
  const s = a.split;
  if (s.holes) {
    lines.push(
      `상세로 나눈 ${s.holes}홀, 기준: ${PART_LABELS.second} 파-3번, ${PART_LABELS.short} 0번`,
      `${PART_LABELS.second} +${s.lost.second} · ${PART_LABELS.short} +${s.lost.short}`,
      `그린 적중(어프로치 없이) ${s.gir}/${s.holes} · 업앤다운 ${s.upDown.made}/${s.upDown.chances}`,
    );
  }
  return lines.join('\n');
}

/** A mailto: link that opens the mail app with the report filled in; the recipient is left to the user. */
export function mailtoHref(round: Round): string {
  return `mailto:?subject=${encodeURIComponent(reportSubject(round))}&body=${encodeURIComponent(reportText(round))}`;
}
