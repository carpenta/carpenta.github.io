import { AREA_LABELS, HOLE_COUNT, SCORE_LABELS, SHOT_TAGS, TAGGED, TAG_LABELS, analyze, courseLabel, finished, formatToPar, roundCourse, strokes, type Analysis, type Hole, type Round, type ScoreName, type Tagged } from './round';

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Plain-language notes on the round, shared by the page and the report. */
export function insights(a: Analysis): string[] {
  const t = a.totals;
  const out: string[] = [];
  if (a.worstAreas.length) {
    const names = a.worstAreas.map((k) => AREA_LABELS[k]).join('·');
    out.push(`기준(티샷 1, 어프로치 Par−3, 퍼트 2) 대비 가장 많이 잃은 곳은 ${names}입니다 (+${a.lost[a.worstAreas[0]]}타).`);
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
  return out;
}

/** Short summary of shot tags on finished holes, shared by the page and the report. Empty without tags. */
export function detailLines(a: Analysis): string[] {
  const d = a.details;
  if (!d) return [];
  const out: string[] = [];
  for (const key of TAGGED) {
    const counts = d[key] as Record<string, number>;
    const parts = (SHOT_TAGS[key] as readonly string[]).filter((t) => counts[t]).map((t) => `${(TAG_LABELS[key] as Record<string, string>)[t]} ${counts[t]}`);
    if (parts.length) out.push(`${AREA_LABELS[key]}: ${parts.join(' · ')}`);
    if (key === 'driver') {
      const obL = d.driver['ob-left'] ?? 0;
      const obR = d.driver['ob-right'] ?? 0;
      const left = (d.driver.left ?? 0) + obL;
      const right = (d.driver.right ?? 0) + obR;
      if (left + right) out.push(`티샷 방향: 좌 ${left} (OB ${obL}) · 우 ${right} (OB ${obR})`);
    }
    if (key === 'putts') {
      const short = d.putts.short ?? 0;
      const long = d.putts.long ?? 0;
      if (short > long && short >= 2) out.push(`퍼트가 짧았던 적이 ${short}번, 길었던 적이 ${long}번입니다. 홀을 지나가게 쳐 보세요.`);
      if (long > short && long >= 2) out.push(`퍼트가 길었던 적이 ${long}번, 짧았던 적이 ${short}번입니다. 첫 퍼트 세기를 줄여 보세요.`);
    }
  }
  const whiffs = (d.driver.whiff ?? 0) + (d.approach.whiff ?? 0);
  if (whiffs) out.push(`헛스윙 ${whiffs}번이 타수에 들어갔습니다.`);
  return out;
}

const SHORT: Record<Tagged, string> = { driver: '드', approach: '어', putts: '퍼' };

/** A hole's tags for its report line, e.g. " · 드 좌 OB, 페어웨이 · 퍼 짧음". Empty without tags. */
function holeTags(h: Hole): string {
  return TAGGED.map((key) => {
    const labels = (h.tags?.[key] ?? []).filter((t) => t !== null).map((t) => (TAG_LABELS[key] as Record<string, string>)[t!]);
    return labels.length ? ` · ${SHORT[key]} ${labels.join(', ')}` : '';
  }).join('');
}

export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function reportSubject(round: Round): string {
  const a = analyze(round);
  const score = a.totals.holes ? ` ${a.totals.strokes}타 (${formatToPar(a.toPar)})` : '';
  return `${courseLabel(roundCourse(round))} ${dateLabel(round.date)} 라운드${score}`;
}

/** The round as plain text for email or sharing: summary, hole by hole, then analysis. */
export function reportText(round: Round): string {
  const a = analyze(round);
  const t = a.totals;
  const lines: string[] = [];
  lines.push(`${courseLabel(roundCourse(round))} · ${dateLabel(round.date)}`);
  if (!t.holes) {
    lines.push('', '아직 끝낸 홀이 없습니다.');
    return lines.join('\n');
  }
  lines.push(
    `총 ${t.strokes}타 (${formatToPar(a.toPar)}) · ${t.holes}/${HOLE_COUNT}홀`,
    `전반 ${a.front.holes ? `${a.front.strokes}타` : '-'} · 후반 ${a.back.holes ? `${a.back.strokes}타` : '-'}`,
    `퍼트 ${t.putts} · OB ${t.ob}${t.hazard ? ` · 해저드 ${t.hazard}` : ''} · 멀리건 ${t.mulligan}`,
    '',
    '[홀별] 타수 = 드라이버 + 어프로치 + 퍼트 + 벌타(OB·해저드)',
  );
  round.holes.forEach((h, i) => {
    if (!finished(round, i)) return;
    const s = strokes(h);
    const extra = [h.ob ? `OB ${h.ob}` : '', h.hazard ? `해저드 ${h.hazard}` : '', h.mulligan ? `멀리건 ${h.mulligan}` : ''].filter(Boolean).join(' ');
    lines.push(`${i + 1}번 Par${h.par}: ${s}타 (${formatToPar(s - h.par)}) 드${h.driver} 어${h.approach} 퍼${h.putts}${extra ? ` ${extra}` : ''}${holeTags(h)}`);
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
    `분포: ${dist}`,
    `Par별 평균: ${a.byPar.filter((p) => p.holes).map((p) => `Par${p.par} ${one(p.average)}타`).join(' · ')}`,
    ...insights(a).map((s) => `- ${s}`),
  );
  const detail = detailLines(a);
  if (detail.length) lines.push('', '[샷 세부]', ...detail.map((s) => `- ${s}`));
  return lines.join('\n');
}

/** A mailto: link that opens the mail app with the report filled in; the recipient is left to the user. */
export function mailtoHref(round: Round): string {
  return `mailto:?subject=${encodeURIComponent(reportSubject(round))}&body=${encodeURIComponent(reportText(round))}`;
}
