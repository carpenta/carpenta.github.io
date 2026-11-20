import { failureText, parseLine, type Command } from './voice-commands';
import { loadDisplay, saveDisplay } from './storage';
import { $, setText } from './dom';

/**
 * 말로 입력 (v21): an opt-in, one-line entry on 기록. The keyboard's own dictation (its microphone key) turns speech into
 * text in an ordinary text field; this page reads only that text, with src/voice-commands.ts. It never asks for the
 * microphone and never uses the browser's speech recognition, so nothing new leaves the device through this page. The
 * line is read, applied by main.ts as taps would be, and dropped: it is never stored. Off until turned on in the menu
 * (`voice` in the prefs key).
 */

/** What the sheet borrows from the page. */
export interface VoicePage {
  /** Holes in the round, 18 or 9, for "7번 홀". */
  holes: () => number;
  /** The clubs' names on the card, for the placeholder and the example (아이언 since v20). */
  names: () => { driver: string; approach: string; putts: string };
  /**
   * Applies the commands through the taps' own functions and returns null, or returns why it changed nothing.
   * It calls `close` just before it changes anything, so the sheet is out of the way of what changes.
   */
  apply: (commands: Command[], close: () => void) => string | null;
  /** The sheet opened over 기록. */
  opened: () => void;
  /** The sheet closed with nothing applied. */
  dismissed: () => void;
  announce: (text: string) => void;
}

export function bindVoice(page: VoicePage): void {
  const toggle = $('mi-voice');
  const open = $<HTMLButtonElement>('voice-open');
  const dialog = $<HTMLDialogElement>('voice');
  const line = $<HTMLInputElement>('vc-line');
  const error = $('vc-error');
  /** Open, and whether a line was applied while it was. */
  let shown = false;
  let used = false;

  const show = (on: boolean) => {
    toggle.setAttribute('aria-checked', String(on));
    open.hidden = !on;
  };
  show(loadDisplay().voice);
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-checked') !== 'true';
    show(on);
    saveDisplay({ voice: on });
    page.announce(on ? '말로 입력을 켰어요. 기록 화면의 다음 홀 옆에 있어요' : '말로 입력을 껐어요');
  });

  /** Why nothing changed, under the field; the line is selected so the next dictation replaces it. */
  const say = (why: string | null) => {
    setText(error, why ?? '');
    error.hidden = why === null;
    if (why === null) {
      line.removeAttribute('aria-invalid');
      return;
    }
    line.setAttribute('aria-invalid', 'true');
    line.select();
  };

  /**
   * Once the sheet has closed, however it closed: the line is dropped, not even kept in the field. Run straight away
   * when the page closes it, and by the close event for Escape; that event can come late (a page in the background),
   * so it does nothing once done, or when the sheet has opened again.
   */
  const closed = () => {
    if (!shown || dialog.open) return;
    shown = false;
    line.value = '';
    say(null);
    if (!used) page.dismissed();
    if (!open.hidden) open.focus({ preventScroll: true });
  };
  const shut = () => {
    dialog.close();
    closed();
  };

  open.addEventListener('click', () => {
    const name = page.names();
    line.placeholder = `${name.driver} 하나 ${name.putts} 둘`;
    setText($('vc-example'), `예: ${name.driver} 하나 ${name.approach} 둘 ${name.putts} 둘 다음 홀`);
    line.value = '';
    say(null);
    used = false;
    shown = true;
    page.opened();
    dialog.showModal();
    line.focus();
  });
  // The keyboard's 완료 (enterkeyhint="done") and the 입력 button both submit; nothing is ever sent anywhere.
  $('vc-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const read = parseLine(line.value, page.holes());
    if (!read.ok) {
      say(failureText(read));
      return;
    }
    const why = page.apply(read.commands, () => {
      used = true;
      shut();
    });
    if (why) say(why);
  });
  line.addEventListener('input', () => {
    if (!error.hidden) say(null);
  });
  $('vc-close').addEventListener('click', shut);
  // A tap on the dim backdrop, outside the sheet, closes it.
  dialog.addEventListener('click', (event) => {
    const r = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientY < r.top || event.clientY > r.bottom || event.clientX < r.left || event.clientX > r.right)) shut();
  });
  dialog.addEventListener('close', closed);
}
