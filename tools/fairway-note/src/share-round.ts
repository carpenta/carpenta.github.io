import { h, setText } from './dom';
import { hasFinishedHole } from './history';
import { icon } from './icons';
import { reportSubject, reportText } from './report';
import type { Round } from './round';
import { drawShareCard, shareCardFileName } from './share-card';

/**
 * Sharing a round with its share card (v16; v23 one module for the summary and a past round). The card is drawn once
 * the round is on screen and kept as a `File` and a `data:` URL (the CSP allows `img-src 'self' data:`, not `blob:`).
 * Where the browser can share files, 공유 hands the PNG to the share sheet with the report's title and text; where it can
 * share only text, 공유 sends the report as before; with no share sheet, 공유 is 결과 복사. Wherever the image cannot be
 * shared as a file, 이미지 저장 downloads it. Nothing is stored and no request is made.
 */

interface Card {
  round: Round;
  file: File;
  /** The same PNG as a `data:` URL, for a preview. */
  url: string;
}

/** One round's card: drawn (`card`), or being drawn. */
interface Job {
  round: Round;
  card: Card | null;
  ready: Promise<Card>;
}

/** What 공유 does in this browser: the share sheet, a copy where there is none, or nothing. */
export type ShareKind = 'share' | 'copy' | null;

export function shareKind(): ShareKind {
  if (typeof navigator.share === 'function') return 'share';
  return typeof navigator.clipboard?.writeText === 'function' ? 'copy' : null;
}

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

/** A round button's circle with its glyph, and under it its word (v49), which the button's name already holds. */
const dressed = (glyph: string, word: string) => `<span class="ra-ico">${glyph}</span><span class="ra-lbl" aria-hidden="true">${word}</span>`;

/**
 * The round buttons' glyphs, from the one icon family (24px grid, 1.75 line): 공유 wears the share arrow where there is
 * a share sheet and two sheets where it can only copy, with a name to match; 이미지 저장 a tray arrow down; mail an envelope.
 * v49: each says what it does in a word under its circle (공유 or 복사, 저장, 메일), so it is read without guessing.
 */
export function dressRoundButtons(share: HTMLElement, save: HTMLElement, mail: HTMLElement): void {
  const kind = shareKind();
  share.hidden = kind === null;
  share.dataset.icon = kind === 'copy' ? 'copy' : 'share';
  share.setAttribute('aria-label', kind === 'copy' ? '결과 복사' : '공유');
  // Static icon markup from icons.ts and fixed words, never user input.
  share.innerHTML = dressed(icon(kind === 'copy' ? 'copy' : 'share', 22), kind === 'copy' ? '복사' : '공유');
  save.innerHTML = dressed(icon('download', 22), '저장');
  mail.innerHTML = dressed(icon('mail', 22), '메일');
}

export interface RoundShareParts {
  /** 이미지 저장: shown wherever the image cannot be shared as a file. */
  save: HTMLElement;
  /** The line that says how sharing or saving went. */
  status: HTMLElement;
  /** Where the download link goes: the open dialog, the one part of the page that is not inert. */
  container: HTMLElement;
  /** The row of round buttons: `data-state` says whether the card is drawn ('drawing', 'ready'). */
  row: HTMLElement;
  /** The small preview (the summary's): a tap on it shares or saves the image as the buttons do. */
  preview?: HTMLElement;
  image?: HTMLImageElement;
  /** The text share, or 결과 복사 where the browser has no share sheet (the page's shareReport). */
  shareText: (round: Round) => Promise<void>;
}

export interface RoundShare {
  /** As the round shows: the card is drawn after the next paint; a preview shows a calm placeholder until then. */
  open(round: Round): void;
  /** As it closes: the drawn card is let go. */
  close(): void;
  /** 공유: the PNG where the share sheet takes files, otherwise the text share or 결과 복사. */
  share(round: Round): Promise<void>;
  /** 이미지 저장: the PNG through an `a[download]` and an object URL, revoked afterwards. */
  save(round: Round): void;
}

export function createRoundShare(parts: RoundShareParts): RoundShare {
  const { save, status, container, row, preview, image } = parts;
  let job: Job | null = null;
  /** The round on screen; null while closed. */
  let shown: Round | null = null;
  let sharing = false;

  /** The round's card: the one drawn or being drawn for it, or a new drawing (after the next paint when `later`). */
  const prepare = (round: Round, later = false): Job => {
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
  };

  const sendCard = async (round: Round, card: Card): Promise<void> => {
    if (!sharesFiles(card.file)) return parts.shareText(round);
    try {
      await navigator.share({ files: [card.file], title: reportSubject(round), text: reportText(round) });
      setText(status, '');
    } catch (error) {
      // Closing the share sheet is not an error worth showing.
      if ((error as DOMException).name !== 'AbortError') setText(status, '공유하지 못했어요. 다시 누르거나 이메일로 보내기를 써 주세요.');
    }
  };

  const api: RoundShare = {
    open(round) {
      const any = hasFinishedHole(round);
      const act = (file?: File) => {
        const files = sharesFiles(file);
        if (preview) preview.dataset.act = files ? 'share' : 'save';
        save.hidden = files;
      };
      shown = round;
      if (image) {
        image.hidden = true;
        image.removeAttribute('src');
      }
      if (preview) preview.hidden = !any;
      save.hidden = true;
      if (!any) {
        job = null;
        delete row.dataset.state;
        return;
      }
      row.dataset.state = 'drawing';
      if (preview) preview.dataset.state = 'drawing';
      act();
      const current = prepare(round, true);
      current.ready.then(
        async (card) => {
          if (job !== current) return;
          if (image && preview) {
            image.src = card.url;
            // Shown once decoded, so it fades in whole.
            await image.decode().catch(() => {});
            if (job !== current) return;
            image.hidden = false;
            preview.dataset.state = 'ready';
          }
          row.dataset.state = 'ready';
          act(card.file);
        },
        () => {
          if (job !== current) return;
          // No canvas: nothing to show or save, and 공유 sends the text as before.
          job = null;
          delete row.dataset.state;
          if (preview) preview.hidden = true;
          save.hidden = true;
        },
      );
    },
    close() {
      job = null;
      shown = null;
      sharing = false;
      delete row.dataset.state;
      if (image) {
        image.hidden = true;
        image.removeAttribute('src');
      }
    },
    share(round) {
      if (!hasFinishedHole(round) || !sharesFiles()) return parts.shareText(round);
      if (sharing) return Promise.resolve();
      const current = prepare(round);
      // Drawn already, as it is once the round has shown: shared within the tap, as iPhone Safari requires.
      const sent = current.card ? sendCard(round, current.card) : current.ready.then((card) => sendCard(round, card), () => parts.shareText(round));
      sharing = true;
      return sent.finally(() => {
        sharing = false;
      });
    },
    save(round) {
      const keep = (card: Card) => {
        const url = URL.createObjectURL(card.file);
        const link = h('a', { href: url, download: card.file.name, hidden: '' });
        container.append(link);
        link.click();
        link.remove();
        // The download keeps its own copy; the URL only has to outlive the click.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setText(status, `이미지를 저장했어요 (${card.file.name}).`);
      };
      const current = prepare(round);
      if (current.card) keep(current.card);
      else current.ready.then(keep, () => setText(status, '이미지를 만들지 못했어요. 이메일로 보내기를 써 주세요.'));
    },
  };

  // A tap on the preview does what the buttons do with the image: shares it where the share sheet takes files, otherwise saves it.
  preview?.addEventListener('click', () => {
    if (!shown) return;
    if (preview.dataset.act === 'share') void api.share(shown);
    else api.save(shown);
  });
  return api;
}
