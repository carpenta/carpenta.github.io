import { describe, expect, it } from 'vitest';
import { failureText, parseLine, type Command, type Parsed, type VoiceKey } from '../src/voice-commands';

/** The commands of a line that must be understood. */
function commands(line: string, holes = 18): Command[] {
  const result = parseLine(line, holes);
  if (!result.ok) throw new Error(`"${line}" was not understood: ${JSON.stringify(result)}`);
  return result.commands;
}

const set = (key: VoiceKey, n: number): Command => ({ kind: 'set', key, n });
const add = (key: VoiceKey, n = 1): Command => ({ kind: 'add', key, n });

describe('setting a value: "<club> <number>" (decision D1)', () => {
  it('reads a whole hole in one line', () => {
    expect(commands('드라이버 하나 아이언 둘 퍼터 두 번')).toEqual([set('driver', 1), set('approach', 2), set('putts', 2)]);
  });

  it('takes the line however dictation spaces it', () => {
    const whole = [set('driver', 1), set('approach', 2), set('putts', 2)];
    for (const line of ['드라이버하나아이언둘퍼터두번', '드라이버 하나  아이언 둘   퍼터 두번', ' 드라이버 하나아이언 둘퍼터 두 번 ']) {
      expect(commands(line), line).toEqual(whole);
    }
  });

  it('takes digits as dictation often writes them', () => {
    expect(commands('드라이버 1 아이언 2 퍼터 2')).toEqual([set('driver', 1), set('approach', 2), set('putts', 2)]);
    expect(commands('드라이버 1번 아이언 2번 퍼터 2번')).toEqual([set('driver', 1), set('approach', 2), set('putts', 2)]);
    expect(commands('퍼터2번')).toEqual([set('putts', 2)]);
  });

  it('reads 그린까지 and 아이언 as the middle count, and 세컨 and 어프로치 as its two parts (v28)', () => {
    for (const word of ['그린까지', '아이언']) expect(commands(`${word} 둘`), word).toEqual([set('approach', 2)]);
    for (const word of ['세컨', '세컨드', '세컨샷', '세컨드 샷']) expect(commands(`${word} 하나`), word).toEqual([set('second', 1)]);
    for (const word of ['어프로치', '어프로치샷', '어프로치 샷', '칩샷']) expect(commands(`${word} 둘`), word).toEqual([set('short', 2)]);
  });

  it('reads 아이언 as the middle count only in a line without 세컨 or 어프로치: beside them it is the club they were hit with', () => {
    expect(commands('드라이버 하나 세컨 하나 어프로치 하나 퍼터 둘')).toEqual([set('driver', 1), set('second', 1), set('short', 1), set('putts', 2)]);
    expect(commands('세컨 아이언으로 쳤는데 어프로치 하나')).toEqual([add('second'), set('short', 1)]);
    expect(commands('세컨은 아이언 하나')).toEqual([set('second', 1)]);
    expect(commands('세컨 아이언으로 두 번')).toEqual([set('second', 2)]);
    // Away from a part, 아이언 says nothing there, so its number is left over.
    expect(parseLine('아이언 둘 어프로치 하나', 18)).toEqual({ ok: false, reason: 'unknown', word: '둘' });
    // A club's number is never a count of its part.
    expect(parseLine('세컨 7번 아이언으로', 18)).toEqual({ ok: false, reason: 'unknown', word: '7번' });
    // Without a part in the line, 아이언 is the count as before.
    expect(commands('드라이버 1번 아이언 2번 퍼터 2번')).toEqual([set('driver', 1), set('approach', 2), set('putts', 2)]);
  });

  it('takes 그린까지 and its parts one at a time: a line with both changes nothing and says why', () => {
    expect(parseLine('그린까지 셋 어프로치 하나', 18)).toEqual({ ok: false, reason: 'mixed' });
    expect(failureText({ reason: 'mixed' })).toBe('그린까지와 세컨·어프로치는 따로 말해 주세요. 바꾼 것은 없어요.');
  });

  it('accepts 티샷 and 드라이브 for 드라이버, and 퍼트, 퍼팅 and 펏 for 퍼터', () => {
    expect(commands('티샷 하나')).toEqual([set('driver', 1)]);
    expect(commands('드라이브 하나')).toEqual([set('driver', 1)]);
    for (const word of ['퍼트', '퍼팅', '펏']) expect(commands(`${word} 셋`), word).toEqual([set('putts', 3)]);
  });

  it('reads counting words, the forms before 번, digits and Sino-Korean numbers', () => {
    const table: [string, number][] = [
      ['하나', 1], ['한 번', 1], ['한번', 1], ['1', 1], ['1번', 1], ['일', 1], ['원', 1],
      ['둘', 2], ['두 번', 2], ['두번', 2], ['2', 2], ['2번', 2], ['투', 2],
      ['셋', 3], ['세 번', 3], ['석 번', 3], ['3번', 3], ['삼', 3], ['쓰리', 3], ['스리', 3],
      ['넷', 4], ['네 번', 4], ['넉 번', 4], ['4', 4], ['사', 4],
      ['다섯', 5], ['다섯 번', 5], ['5번', 5], ['오', 5], ['파이브', 5],
      ['여섯', 6], ['일곱 번', 7], ['여덟', 8], ['아홉', 9], ['열', 10], ['열한 번', 11], ['열두 번', 12], ['열다섯', 15], ['15', 15],
      ['영', 0], ['0', 0], ['제로', 0],
    ];
    for (const [word, n] of table) expect(commands(`퍼터 ${word}`), word).toEqual([set('putts', n)]);
  });

  it('takes 개, 타 and 회 after a number as it takes 번', () => {
    expect(commands('퍼트 두 개')).toEqual([set('putts', 2)]);
    expect(commands('드라이버 한 타')).toEqual([set('driver', 1)]);
    expect(commands('아이언 세 회')).toEqual([set('approach', 3)]);
  });

  it('reads golf talk with the number first: 투 퍼트, 쓰리퍼트, 3퍼트', () => {
    expect(commands('투 퍼트')).toEqual([set('putts', 2)]);
    expect(commands('쓰리퍼트')).toEqual([set('putts', 3)]);
    expect(commands('원 퍼트')).toEqual([set('putts', 1)]);
    expect(commands('3퍼트')).toEqual([set('putts', 3)]);
    expect(commands('드라이버 하나 아이언 하나 투 퍼트')).toEqual([set('driver', 1), set('approach', 1), set('putts', 2)]);
  });

  it('skips the particles and endings dictation writes', () => {
    expect(commands('드라이버는 하나')).toEqual([set('driver', 1)]);
    expect(commands('아이언이 둘')).toEqual([set('approach', 2)]);
    expect(commands('퍼터를 두 번')).toEqual([set('putts', 2)]);
    expect(commands('퍼터가 두 번이요')).toEqual([set('putts', 2)]);
    expect(commands('드라이버로 한 번 쳤어요')).toEqual([set('driver', 1)]);
    expect(commands('아이언으로 두 번 쳤고 퍼터는 세 번이에요')).toEqual([set('approach', 2), set('putts', 3)]);
    expect(commands('드라이버 하나요, 아이언 둘이요.')).toEqual([set('driver', 1), set('approach', 2)]);
  });

  it('skips fillers and joining words between clubs', () => {
    expect(commands('음 드라이버 하나 그리고 퍼터 둘')).toEqual([set('driver', 1), set('putts', 2)]);
    expect(commands('드라이버 하나하고 퍼터 둘')).toEqual([set('driver', 1), set('putts', 2)]);
    expect(commands('드라이버 하나랑 아이언 둘이랑 퍼터 둘')).toEqual([set('driver', 1), set('approach', 2), set('putts', 2)]);
    expect(commands('드라이버 하나 그다음 퍼터 둘')).toEqual([set('driver', 1), set('putts', 2)]);
    expect(commands('드라이버 하나 그 다음에 퍼터 둘')).toEqual([set('driver', 1), set('putts', 2)]);
  });

  it('reads 이번 홀 as the hole being played, not a move', () => {
    expect(commands('이번 홀 퍼터 둘')).toEqual([set('putts', 2)]);
    expect(commands('이번 홀은 드라이버 하나 퍼터 셋')).toEqual([set('driver', 1), set('putts', 3)]);
  });

  it('sets a count to 0 with 영, 0 or 없음', () => {
    expect(commands('퍼터 없음')).toEqual([set('putts', 0)]);
    expect(commands('OB는 없어요')).toEqual([set('ob', 0)]);
    expect(commands('해저드 0')).toEqual([set('hazard', 0)]);
  });

  it('reads 다섯 이상 and 5+ as the long press reads 5+: five, or more if there are more', () => {
    expect(commands('퍼터 다섯 번 이상')).toEqual([{ kind: 'set', key: 'putts', n: 5, atLeast: true }]);
    expect(commands('퍼터 5+')).toEqual([{ kind: 'set', key: 'putts', n: 5, atLeast: true }]);
  });

  it('sets penalties the same way: OB 두 번 is two OBs on this hole', () => {
    expect(commands('OB 두 번')).toEqual([set('ob', 2)]);
    expect(commands('해저드 하나')).toEqual([set('hazard', 1)]);
    expect(commands('벙커 두 번')).toEqual([set('bunker', 2)]);
  });

  it('applies the same club twice in order, so the last value wins', () => {
    expect(commands('퍼터 하나 퍼터 둘')).toEqual([set('putts', 1), set('putts', 2)]);
  });
});

describe('adding and taking off', () => {
  it('adds one for a club, a penalty, 벙커 or 멀리건 said alone', () => {
    expect(commands('퍼터')).toEqual([add('putts')]);
    for (const line of ['OB', 'ob', 'Ob', '오비', 'o.b.']) expect(commands(line), line).toEqual([add('ob')]);
    for (const line of ['해저드', '워터 해저드', '페널티 구역']) expect(commands(line), line).toEqual([add('hazard')]);
    expect(commands('벙커')).toEqual([add('bunker')]);
    expect(commands('멀리건')).toEqual([add('mulligan')]);
  });

  it('adds one when the line says it happened', () => {
    expect(commands('OB 났어요')).toEqual([add('ob')]);
    expect(commands('해저드에 들어갔어')).toEqual([add('hazard')]);
    expect(commands('벙커에 빠졌어요')).toEqual([add('bunker')]);
    expect(commands('OB 해저드')).toEqual([add('ob'), add('hazard')]);
  });

  it('adds with 더 or 추가, and takes off with 빼', () => {
    expect(commands('퍼터 하나 더')).toEqual([add('putts', 1)]);
    expect(commands('퍼터 두 번 더')).toEqual([add('putts', 2)]);
    expect(commands('OB 추가')).toEqual([add('ob', 1)]);
    expect(commands('퍼터 빼')).toEqual([add('putts', -1)]);
    expect(commands('퍼터 하나 빼')).toEqual([add('putts', -1)]);
    expect(commands('OB 빼기')).toEqual([add('ob', -1)]);
  });

  it('reads the longest word first: 오비 is OB, not 오 (5), and 세컨샷 is not 세 (3)', () => {
    expect(commands('퍼터 오비')).toEqual([add('putts'), add('ob')]);
    expect(commands('드라이버 세컨샷 둘')).toEqual([add('driver'), set('second', 2)]);
    expect(commands('퍼터 다섯')).toEqual([set('putts', 5)]);
  });
});

describe('moving between holes', () => {
  it('goes to the next hole', () => {
    for (const line of ['다음 홀', '다음홀', '다음', '다음 홀로', '다음 홀로 가자', '그 다음 홀']) expect(commands(line), line).toEqual([{ kind: 'next' }]);
  });

  it('goes back a hole', () => {
    for (const line of ['이전 홀', '앞 홀', '이전 홀로']) expect(commands(line), line).toEqual([{ kind: 'prev' }]);
  });

  it('goes to a hole by its number, said any of the usual ways', () => {
    for (const line of ['7번 홀', '7번홀', '7 번 홀', '칠 번 홀', '칠번홀', '일곱 번째 홀', '7번째 홀', '7번 홀로 가']) {
      expect(commands(line), line).toEqual([{ kind: 'hole', n: 7 }]);
    }
    expect(commands('첫 홀')).toEqual([{ kind: 'hole', n: 1 }]);
    expect(commands('첫 번째 홀')).toEqual([{ kind: 'hole', n: 1 }]);
    expect(commands('십팔 번 홀')).toEqual([{ kind: 'hole', n: 18 }]);
    expect(commands('열여덟 번째 홀')).toEqual([{ kind: 'hole', n: 18 }]);
  });

  it('reads 이 번 홀 as hole 2, but 이번 홀 alone as nothing to do', () => {
    expect(commands('이 번 홀')).toEqual([{ kind: 'hole', n: 2 }]);
    expect(commands('2번 홀')).toEqual([{ kind: 'hole', n: 2 }]);
    expect(parseLine('이번 홀', 18)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('records the hole and then moves on when the move comes last', () => {
    expect(commands('드라이버 하나 아이언 둘 퍼터 둘 다음 홀')).toEqual([set('driver', 1), set('approach', 2), set('putts', 2), { kind: 'next' }]);
    expect(commands('퍼터 둘 다음')).toEqual([set('putts', 2), { kind: 'next' }]);
    expect(commands('퍼터 다음')).toEqual([add('putts'), { kind: 'next' }]);
  });
});

describe('되돌리기', () => {
  it('takes back the last change', () => {
    for (const line of ['되돌리기', '되돌려', '되돌려 줘', '취소', '취소해', '실행 취소']) expect(commands(line), line).toEqual([{ kind: 'undo' }]);
  });

  it('is said alone', () => {
    expect(parseLine('퍼터 둘 되돌리기', 18)).toMatchObject({ ok: false, reason: 'undo-alone' });
  });
});

describe('does not guess', () => {
  it('says what it did not understand, and nothing else', () => {
    expect(parseLine('버디', 18)).toEqual({ ok: false, reason: 'unknown', word: '버디' });
    expect(parseLine('드라이버 하나 버디', 18)).toEqual({ ok: false, reason: 'unknown', word: '버디' });
    // The word as written: 더 is a word the parser knows, 더블 is not.
    expect(parseLine('퍼터 더블', 18)).toEqual({ ok: false, reason: 'unknown', word: '더블' });
    expect(parseLine('드라이버하나버디', 18)).toEqual({ ok: false, reason: 'unknown', word: '드라이버하나버디' });
    expect(parseLine('안녕하세요', 18)).toMatchObject({ ok: false, reason: 'unknown' });
    // 네 is 4 only after a club; alone it is "yes".
    expect(parseLine('네', 18)).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('never reads a club number as a count, 포 as four, or 9홀 (nine holes) as a move', () => {
    expect(parseLine('5번 아이언', 18)).toEqual({ ok: false, reason: 'unknown', word: '5번' });
    expect(parseLine('7번 아이언으로 쳤어', 18)).toEqual({ ok: false, reason: 'unknown', word: '7번' });
    expect(parseLine('포 퍼트', 18)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(parseLine('9홀', 18)).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('says so when a line reads two ways, and picks neither', () => {
    // 이 right after 퍼터: a particle (one more putt) or 이 (two putts).
    expect(parseLine('퍼터이', 18)).toEqual({ ok: false, reason: 'ambiguous', word: '퍼터이' });
    // 드라이버 투 + 퍼트, or 드라이버 + 투 퍼트.
    expect(parseLine('드라이버 투 퍼트', 18)).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(commands('드라이버 하나 투 퍼트')).toEqual([set('driver', 1), set('putts', 2)]);
  });

  it('changes nothing when the line says something did not happen', () => {
    for (const line of ['OB 안 났어', 'OB 안났어요', '벙커에 안 들어갔어', '해저드 아니야', '퍼터 둘 아니 셋', '드라이버 못 쳤어', '다음 홀 말고 이전 홀', 'OB 없었어', '들어가지 않았어']) {
      expect(parseLine(line, 18), line).toMatchObject({ ok: false, reason: 'negated' });
    }
  });

  it('says when there is nothing to do', () => {
    for (const line of ['', '   ', '음', '.', '이번 홀']) expect(parseLine(line, 18), JSON.stringify(line)).toEqual({ ok: false, reason: 'empty' });
  });

  it('keeps counts within 0 … 15 and holes within the round', () => {
    expect(parseLine('퍼터 스물', 18)).toEqual({ ok: false, reason: 'range', what: 'count', max: 15 });
    expect(parseLine('퍼터 16', 18)).toEqual({ ok: false, reason: 'range', what: 'count', max: 15 });
    expect(parseLine('25번 홀', 18)).toEqual({ ok: false, reason: 'range', what: 'hole', max: 18 });
    expect(parseLine('0번 홀', 18)).toEqual({ ok: false, reason: 'range', what: 'hole', max: 18 });
    // A 9-hole round has holes 1 to 9.
    expect(parseLine('15번 홀', 9)).toEqual({ ok: false, reason: 'range', what: 'hole', max: 9 });
    expect(commands('9번 홀', 9)).toEqual([{ kind: 'hole', n: 9 }]);
  });

  it('takes one hole move, and only at the end of the line', () => {
    expect(parseLine('다음 홀 드라이버 하나', 18)).toEqual({ ok: false, reason: 'order' });
    expect(parseLine('7번 홀 퍼터 둘', 18)).toEqual({ ok: false, reason: 'order' });
    expect(parseLine('다음 홀 이전 홀', 18)).toEqual({ ok: false, reason: 'order' });
    expect(parseLine('퍼터 둘 다음 드라이버 하나', 18)).toEqual({ ok: false, reason: 'order' });
  });
});

describe('normalising what the keyboard sends', () => {
  it('reads full-width digits, decomposed Hangul and punctuation', () => {
    expect(commands('퍼터 ２')).toEqual([set('putts', 2)]);
    expect(commands('퍼터 둘'.normalize('NFD'))).toEqual([set('putts', 2)]);
    expect(commands('드라이버 하나, 아이언 둘. 퍼터 둘!')).toEqual([set('driver', 1), set('approach', 2), set('putts', 2)]);
    expect(commands('"퍼터 둘"')).toEqual([set('putts', 2)]);
  });
});

describe('a generated corpus: every club word × number form × spacing', () => {
  it('reads each one as setting that value', () => {
    const clubs: [VoiceKey, string[]][] = [
      ['driver', ['드라이버', '티샷']], ['approach', ['아이언', '그린까지']], ['second', ['세컨', '세컨샷']], ['short', ['어프로치', '어프로치 샷']], ['putts', ['퍼터', '퍼트']],
      ['ob', ['OB', '오비']], ['hazard', ['해저드']], ['bunker', ['벙커']], ['mulligan', ['멀리건']],
    ];
    const numbers: [string, number][] = [
      ['하나', 1], ['한 번', 1], ['1번', 1], ['둘', 2], ['두 번', 2], ['2번', 2], ['셋', 3], ['세 번', 3], ['3번', 3],
      ['넷', 4], ['네 번', 4], ['4번', 4], ['다섯', 5], ['다섯 번', 5], ['5번', 5], ['여섯 번', 6], ['열 번', 10], ['0', 0],
    ];
    const wrong: string[] = [];
    let checked = 0;
    for (const [key, words] of clubs) {
      for (const word of words) {
        for (const [number, n] of numbers) {
          for (const line of [`${word} ${number}`, `${word}${number.replace(/ /g, '')}`, `${word}는 ${number}이요`]) {
            checked += 1;
            const got: Parsed = parseLine(line, 18);
            if (!got.ok || JSON.stringify(got.commands) !== JSON.stringify([set(key, n)])) wrong.push(`${line} → ${JSON.stringify(got)}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(wrong).toEqual([]);
  });

  it('reads any three clubs in one line, with or without spaces', () => {
    const wrong: string[] = [];
    const words = ['하나', '둘', '셋', '넷', '다섯'];
    for (let d = 1; d <= 3; d++) {
      for (let a = 0; a <= 4; a++) {
        for (let p = 0; p <= 4; p++) {
          const spoken = `드라이버 ${words[d - 1]} 아이언 ${a ? words[a - 1] : '영'} 퍼터 ${p ? words[p - 1] : '영'}`;
          for (const line of [spoken, spoken.replace(/ /g, '')]) {
            const got = parseLine(line, 18);
            const want = [set('driver', d), set('approach', a), set('putts', p)];
            if (!got.ok || JSON.stringify(got.commands) !== JSON.stringify(want)) wrong.push(`${line} → ${JSON.stringify(got)}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('failureText', () => {
  it('says plainly why nothing changed', () => {
    expect(failureText({ reason: 'unknown', word: '버디' })).toBe('‘버디’는 알아듣지 못했어요. 바꾼 것은 없어요.');
    expect(failureText({ reason: 'unknown', word: '안녕하세요' })).toBe('‘안녕하세요’는 알아듣지 못했어요. 바꾼 것은 없어요.');
    expect(failureText({ reason: 'unknown', word: '홀' })).toBe('‘홀’은 알아듣지 못했어요. 바꾼 것은 없어요.');
    expect(failureText({ reason: 'unknown', word: '' })).toBe('알아듣지 못했어요. 바꾼 것은 없어요.');
    expect(failureText({ reason: 'negated', word: '안' })).toBe('‘안’처럼 아니라는 말이 있어 바꾸지 않았어요.');
    expect(failureText({ reason: 'empty' })).toBe('기록할 말이 없어요.');
    expect(failureText({ reason: 'range', what: 'count', max: 15 })).toBe('한 홀에 15번까지 적을 수 있어요. 바꾼 것은 없어요.');
    expect(failureText({ reason: 'range', what: 'hole', max: 9 })).toBe('이 라운드는 9번 홀까지예요. 바꾼 것은 없어요.');
    expect(failureText({ reason: 'order' })).toBe('홀 이동은 한 번만, 맨 끝에 말해 주세요. 바꾼 것은 없어요.');
    expect(failureText({ reason: 'undo-alone' })).toBe('되돌리기는 따로 말해 주세요. 바꾼 것은 없어요.');
    expect(failureText({ reason: 'ambiguous', word: '퍼터이' })).toBe('‘퍼터이’는 두 가지로 읽혀요. 띄어 쓰거나 다르게 말해 주세요.');
  });
});
