import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfPreview } from '../blueprints/files/components/PdfPreview';

const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' } }));
vi.mock('pdfjs-dist', () => pdf);

afterEach(() => { cleanup(); vi.restoreAllMocks(); pdf.getDocument.mockReset(); });

describe('B08 PDF preview delivery', () => {
  it('renders only canvas pixels and destroys the worker when closed', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const page = { getViewport: () => ({ width: 300, height: 200 }),
      render: vi.fn(() => ({ promise: Promise.resolve() })), cleanup: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1,
      getPage: vi.fn().mockResolvedValue(page) }), destroy });
    const { container, unmount } = render(<PdfPreview url="/api/v1/private-file/preview" />);
    await waitFor(() => expect(screen.getByTestId('secure-pdf-preview')).toHaveAttribute('data-state', 'ready'));
    expect(container.querySelector('canvas')).toHaveAttribute('aria-label', 'Trang 1');
    expect(container.querySelector('iframe, script, a, form, object, embed')).toBeNull();
    expect(pdf.getDocument).toHaveBeenCalledWith(expect.objectContaining({
      url: '/api/v1/private-file/preview', withCredentials: true, enableXfa: false,
    }));
    unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('shows an error rather than claiming a denied or malformed PDF rendered', async () => {
    pdf.getDocument.mockReturnValue({ promise: Promise.reject(new Error('403 denied')),
      destroy: vi.fn().mockResolvedValue(undefined) });
    const { container } = render(<PdfPreview url="/api/v1/revoked/preview" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể hiển thị PDF');
    expect(screen.getByTestId('secure-pdf-preview')).toHaveAttribute('data-state', 'error');
    expect(container.querySelector('canvas')).toBeNull();
  });
});
