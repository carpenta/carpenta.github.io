import DOMPurify from 'dompurify';

export function cleanMarkup(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'video', 'audio', 'link', 'meta', 'base', 'foreignObject'],
    FORBID_ATTR: ['srcset', 'action', 'formaction', 'target', 'download', 'ping'],
    RETURN_DOM_FRAGMENT: true,
  });
  for (const el of fragment.querySelectorAll('*')) {
    for (const attr of ['href', 'xlink:href', 'src']) {
      const value = el.getAttribute(attr);
      if (value && (el.localName === 'a' || !/^(#|data:image\/|data:font\/|blob:)/i.test(value))) el.removeAttribute(attr);
    }
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

export function previewDocument(html: string, width: number, zoom: number): string {
  const safeWidth = Math.max(200, Math.min(10000, Number.isFinite(width) ? width : 800));
  const safeZoom = Math.max(0.2, Math.min(2, zoom));
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>
    *{box-sizing:border-box}html{background:#eeeee9}body{margin:0;padding:32px 24px;min-height:100vh;width:max-content;min-width:100%;font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#202a28}#folio-page{width:${safeWidth}px;margin:0 auto;zoom:${safeZoom};background:white;box-shadow:0 3px 20px #14251e12;min-height:100px}#folio-page>svg{display:block;width:100%;height:auto}table{border-collapse:collapse}th,td{border:1px solid #dce3df;padding:9px 12px;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;max-width:400px}th{background:#f1f5f2;color:#65716b;font-weight:500}td{vertical-align:top}.sheet-table{width:100%}.sheet-table thead{position:sticky;top:0}.docx-wrapper{padding:0!important;background:white!important}.docx-wrapper>section.docx{box-shadow:none!important;margin:0!important}a{color:inherit;text-decoration:none}.sheet-view table{user-select:none;touch-action:none;outline:none}.sheet-view table{table-layout:fixed}.sheet-view td{cursor:cell;padding:3px 5px;white-space:pre;overflow:hidden;font-family:Calibri,Arial,sans-serif;font-size:11pt;vertical-align:bottom}.sheet-view th{padding:4px 5px}.sheet-view tr{height:20px}.sheet-view td.cell-selected{box-shadow:inset 0 0 0 9999px #1a73e825}.sheet-view td.cell-active{outline:2px solid #1a73e8;outline-offset:-2px}.selection-info{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid #dce3df;padding:10px 12px;font-size:12px;color:#52615a}.sheet-view h2{padding:16px 12px;margin:0;font-size:16px}
  </style></head><body><main id="folio-page">${cleanMarkup(html)}</main></body></html>`;
}
