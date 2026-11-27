// KakaoTalk's in-app browser (v47, U4). A link tapped in KakaoTalk opens in KakaoTalk's own browser, and an app's web
// view keeps its own storage: rounds kept there do not show in the phone's Chrome or Safari, nor in the app on the home
// screen. KakaoTalk's developer documents say its in-app browser puts "KAKAOTALK" in its User-Agent, and its Talk
// Channel FAQ advises guiding people to open an external browser. No URL scheme to open one is documented, so the notice
// gives the steps in KakaoTalk's own menu instead of guessing one. Nothing here makes a request.

export type KakaoPhone = 'android' | 'ios' | 'other';

/** Which phone's KakaoTalk in-app browser this is, from its User-Agent, or null outside KakaoTalk. */
export function kakaoInApp(ua: string): KakaoPhone | null {
  if (!/KAKAOTALK/i.test(ua)) return null;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'other';
}

/**
 * Opens the notice in `dialog` (#kakao) with the steps for `phone`, both phones' when it cannot tell. `onClose` runs
 * once, however it is put away (알겠어요, or Escape), so the notice is not shown again.
 */
export function openKakaoNotice(dialog: HTMLDialogElement, phone: KakaoPhone, onClose: () => void): void {
  const steps: [string, boolean][] = [['kakao-android', phone !== 'ios'], ['kakao-ios', phone !== 'android']];
  for (const [id, shown] of steps) {
    const step = dialog.querySelector<HTMLElement>(`#${id}`);
    if (step) step.hidden = !shown;
  }
  dialog.querySelector('#kakao-ok')?.addEventListener('click', () => dialog.close(), { once: true });
  dialog.addEventListener('close', onClose, { once: true });
  dialog.showModal();
}
