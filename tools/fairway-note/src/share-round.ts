import { $, h, setText } from './dom';
import { hasFinishedHole } from './history';
import { reportSubject, reportText } from './report';
import type { Round } from './round';
import { drawShareCard, shareCardFileName } from './share-card';

/**
 * The round summary's 공유 with the share card (v16). The card is drawn once the summary is on screen and shown there
 * as a small preview (a `data:` URL: the CSP allows `img-src 'self' data:`, not `blob:`). Where the browser can share
 * files, 공유 hands the PNG to the share sheet with the report's title and text; where it can share only text, 공유 sends
 * the report as before; with no share sheet, 공유 is 결과 복사. Wherever the image cannot be shared as a file,
 * 이미지 저장 downloads it. A tap on the preview does the same with the image. Nothing is stored and no request is made.
 */

interface Card {
  round: Round;
  file: File;
  /** The same PNG as a `data:` URL, for the preview. */
  url: string;
}

/** One round's card: drawn (`card`), or being drawn. */
interface Job {
  round: Round;
  card: Card | null;
  ready: Promise<Card>;
}

let job: Job | null = null;
/** The round the open summary shows; null while it is closed. */
let shown: Round | null = null;
let sharing = false;
let shareText: (round: Round) => Promise<void> = async () => {};

/** Whether the share sheet takes the PNG: asked with the drawn file, or with an empty stand-in before it is drawn. */
function sharesFiles(file?: File): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [file ?? new File([], 'fairway-note.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Resolves once the next frame is painted, so a sheet that has just opened shows before the canvas work starts. */
const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** The round's card: the one drawn or being drawn for it, or a new drawing (after the next paint when `later`). */
function prepare(round: Round, later = false): Job {
  if (job?.round === round) return job;
  const draw = async (): Promise<Card> => {
    if (later) await afterPaint();
    const blob = await drawShareCard(round);
    return { round, file: new File([blob], shareCardFileName(round), { type: 'image/png' }), url: await dataUrl(blob) };
  };
  const next: Job = { round, card: null, ready: draw() };
  next.ready.then((card) => { next.card = card; }, () => {});
  job = next;
  return next;
}

/**
 * `shareReport` from the page: today's text share, or 결과 복사 where there is no share sheet. A tap on the preview
 * does what the buttons do with the image: shares it where the share sheet takes files, otherwise saves it.
 */
export function bindSummaryShare(text: (round: Round) => Promise<void>): void {
  shareText = text;
  const box = $('sum-card');
  box.addEventListener('click', () => {
    if (!shown) return;
    if (box.dataset.act === 'share') void shareSummary(shown);
    else saveSummaryImage(shown);
  });
}

/**
 * As the summary opens: a calm placeholder where the preview goes, then the card once it is drawn. A round with no
 * finished hole has no image. 이미지 저장 shows wherever the share sheet cannot take the PNG.
 */
export function openSummaryShare(round: Round): void {
  const box = $('sum-card');
  const img = $<HTMLImageElement>('sum-card-img');
  const save = $('sum-save');
  const any = hasFinishedHole(round);
  const act = (file?: File) => {
    const files = sharesFiles(file);
    box.dataset.act = files ? 'share' : 'save';
    save.hidden = files;
  };
  shown = round;
  img.hidden = true;
  img.removeAttribute('src');
  box.hidden = !any;
  save.hidden = true;
  if (!any) {
    job = null;
    return;
  }
  box.dataset.state = 'drawing';
  act();
  const current = prepare(round, true);
  current.ready.then(
    async (card) => {
      if (job !== current) return;
      img.src = card.url;
      // Shown once decoded, so it fades in whole.
      await img.decode().catch(() => {});
      if (job !== current) return;
      img.hidden = false;
      box.dataset.state = 'ready';
      act(card.file);
    },
    () => {
      if (job !== current) return;
      // No canvas: nothing to show or save, and 공유 sends the text as before.
      job = null;
      box.hidden = true;
      save.hidden = true;
    },
  );
}

/** As the summary closes: the drawn card is let go. */
export function closeSummaryShare(): void {
  job = null;
  shown = null;
  sharing = false;
  const img = $<HTMLImageElement>('sum-card-img');
  img.hidden = true;
  img.removeAttribute('src');
}

async function sendCard(round: Round, card: Card): Promise<void> {
  if (!sharesFiles(card.file)) return shareText(round);
  try {
    await navigator.share({ files: [card.file], title: reportSubject(round), text: reportText(round) });
    setText($('sum-status'), '');
  } catch (error) {
    // Closing the share sheet is not an error worth showing.
    if ((error as DOMException).name !== 'AbortError') setText($('sum-status'), '공유하지 못했어요. 다시 누르거나 이메일로 보내기를 써 주세요.');
  }
}

/** 공유 in the summary: the PNG where the share sheet takes files, otherwise the text share or 결과 복사 as before. */
export function shareSummary(round: Round): Promise<void> {
  if (!hasFinishedHole(round) || !sharesFiles()) return shareText(round);
  if (sharing) return Promise.resolve();
  const current = prepare(round);
  // Drawn already, as it is once the preview shows: shared within the tap, as iPhone Safari requires.
  const sent = current.card ? sendCard(round, current.card) : current.ready.then((card) => sendCard(round, card), () => shareText(round));
  sharing = true;
  return sent.finally(() => {
    sharing = false;
  });
}

/** 이미지 저장: the PNG through an `a[download]` and an object URL, revoked afterwards. */
export function saveSummaryImage(round: Round): void {
  const status = $('sum-status');
  const save = (card: Card) => {
    const url = URL.createObjectURL(card.file);
    // Inside the open dialog, the one part of the page that is not inert.
    const link = h('a', { href: url, download: card.file.name, hidden: '' });
    $('summary').append(link);
    link.click();
    link.remove();
    // The download keeps its own copy; the URL only has to outlive the click.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setText(status, `이미지를 저장했어요 (${card.file.name}).`);
  };
  const current = prepare(round);
  if (current.card) save(current.card);
  else current.ready.then(save, () => setText(status, '이미지를 만들지 못했어요. 이메일로 보내기를 써 주세요.'));
}
