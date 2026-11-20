/**
 * A Tabler Icons file's shapes (v25): its `<svg>` wrapper and its invisible bounding box (`<path stroke="none" …>`)
 * dropped, one tag per shape with its spacing normalised. The app draws them in its own wrapper at its own line
 * (`icon()` in icons.ts, and the build's fill of index.html in vite.config.ts), so this stays free of Vite and the DOM.
 */
export function tablerInner(svg: string): string {
  return (svg.replace(/<path stroke="none"[^>]*\/>/, '').match(/<(?:path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*\/>/g) ?? [])
    .map((el) => el.replace(/\s+/g, ' ').replace(/ \/>$/, '/>'))
    .join('');
}
