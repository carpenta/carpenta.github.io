/**
 * Publishes the sticky summary's real height as `--summary-h` on <html>, so `scroll-padding-top`
 * keeps scrolled-to parts of the scorecard just below it whatever the screen height, text size or wrapping.
 * Returns the measurement, for a caller that shows or hides the summary (its height is 0 while hidden).
 */
export function trackSummaryHeight(): () => void {
  const summary = document.querySelector<HTMLElement>('.summary');
  if (!summary) return () => undefined;
  const set = () => document.documentElement.style.setProperty('--summary-h', `${Math.ceil(summary.getBoundingClientRect().height)}px`);
  set();
  if (typeof ResizeObserver === 'function') new ResizeObserver(set).observe(summary);
  return set;
}
