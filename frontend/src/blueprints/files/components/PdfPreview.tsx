import { useEffect, useRef, useState } from 'react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** Render page pixels only: PDF scripts, links, forms and embedded HTML are not mounted. */
export function PdfPreview({ url }: { url: string }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    const container = pagesRef.current;
    container?.replaceChildren();
    setState('loading');
    setTruncated(false);

    async function render() {
      const pdfjs = await import('pdfjs-dist');
      if (cancelled || !container) return;
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = pdfjs.getDocument({
        url,
        withCredentials: true,
        disableFontFace: true,
        enableXfa: false,
        stopAtErrors: true,
        maxImageSize: 16_777_216,
      });
      dispose = () => { void task.destroy(); };
      const document = await task.promise;
      if (cancelled) return;
      const pageCount = Math.min(document.numPages, 20);
      setTruncated(document.numPages > pageCount);
      for (let number = 1; number <= pageCount; number++) {
        const page = await document.getPage(number);
        if (cancelled) return;
        const original = page.getViewport({ scale: 1 });
        const width = Math.max(1, Math.min(container.clientWidth || 860, 860));
        const scale = Math.min(width / original.width, 4096 / original.height);
        const viewport = page.getViewport({ scale });
        const canvas = window.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute('aria-label', `Trang ${number}`);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (cancelled) return;
        container.append(canvas);
        page.cleanup();
      }
      if (!cancelled) setState('ready');
    }

    void render().catch(() => {
      if (!cancelled) {
        container?.replaceChildren();
        setState('error');
      }
    });
    return () => {
      cancelled = true;
      dispose();
      container?.replaceChildren();
    };
  }, [url]);

  return (
    <div className="secure-pdf-preview" data-testid="secure-pdf-preview" data-state={state}>
      {state === 'loading' && <p role="status">Đang hiển thị PDF…</p>}
      {state === 'error' && <p role="alert">Không thể hiển thị PDF. Vui lòng tải tệp để xem.</p>}
      {truncated && <p>Hiển thị 20 trang đầu. Tải tệp để đọc toàn bộ tài liệu.</p>}
      <div ref={pagesRef} className="secure-pdf-pages" />
    </div>
  );
}
