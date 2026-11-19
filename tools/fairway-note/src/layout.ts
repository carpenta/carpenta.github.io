/**
 * Publishes the sticky summary's real height as `--summary-h` on <html>, so `scroll-padding-top`
 * keeps scrolled-to hole cards just below it whatever the screen height, text size or wrapping.
 */
export function trackSummaryHeight(): void {
  const summary = document.querySelector<HTMLElement>('.summary');
  if (!summary) return;
  const set = () => document.documentElement.style.setProperty('--summary-h', `${Math.ceil(summary.getBoundingClientRect().height)}px`);
  set();
  if (typeof ResizeObserver === 'function') new ResizeObserver(set).observe(summary);
}
