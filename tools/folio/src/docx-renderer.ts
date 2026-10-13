import { renderAsync } from 'docx-preview';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { validateDocument } from './validation';

let started = false;
window.addEventListener('message', async (event: MessageEvent) => {
  if (started || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'render-docx') return;
  started = true;
  try {
    const buffer: ArrayBuffer = event.data.buffer;
    validateDocument(buffer, 'docx');
    const entries = unzipSync(new Uint8Array(buffer));
    // External relationships (images, hyperlinks, linked templates) never reach the renderer.
    for (const [name, bytes] of Object.entries(entries)) {
      if (!name.endsWith('.rels')) continue;
      const xml = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('문서 관계 정보가 손상되었습니다.');
      for (const rel of Array.from(xml.getElementsByTagNameNS('*', 'Relationship'))) {
        const target = rel.getAttribute('Target') ?? '';
        if (rel.getAttribute('TargetMode')?.toLowerCase() === 'external' || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) rel.remove();
      }
      entries[name] = strToU8(new XMLSerializer().serializeToString(xml));
    }
    const host = document.createElement('div');
    const styles = document.createElement('div');
    document.body.append(styles, host);
    await renderAsync(zipSync(entries), host, styles, {
      renderAltChunks: false, useBase64URL: true, breakPages: true,
      ignoreLastRenderedPageBreak: false, renderComments: false,
      renderChanges: false, experimental: false, ignoreFonts: false,
    });
    const pages = Array.from(host.querySelectorAll('section.docx'));
    if (!pages.length) throw new Error('표시할 문서 본문이 없습니다.');
    if (pages.length > 500) throw new Error('최대 500페이지까지 열 수 있습니다.');
    // Documents without page geometry must not inherit the hidden helper's width.
    for (const element of pages) {
      const page = element as HTMLElement;
      if (!page.style.width) page.style.width = '595.3pt';
      if (!page.style.minHeight && !page.style.height) page.style.minHeight = '841.9pt';
    }
    const css = styles.innerHTML;
    parent.postMessage({ type: 'docx-ready', pages: pages.map(page => ({
      html: `${css}<div class="docx-wrapper">${page.outerHTML}</div>`,
      width: (page as HTMLElement).getBoundingClientRect().width || 794,
    })) }, location.origin);
  } catch {
    parent.postMessage({ type: 'docx-error', message: 'DOCX 문서를 열지 못했습니다. 손상되었거나 지원하지 않는 내용이 있는지 확인해 주세요.' }, location.origin);
  }
});
parent.postMessage({ type: 'docx-loaded' }, location.origin);
