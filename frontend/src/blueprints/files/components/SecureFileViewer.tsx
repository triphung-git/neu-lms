import React, { useEffect } from 'react';
import {
  X,
  Download,
  Lock,
  FileText,
  Image as ImageIcon,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { filesService, type CourseFilePolicy, type StoredFile } from '../../../api/filesService';
import { formatFileSize } from '../../../shared/kernel/formatting';
import { Button } from '../../../shared/ui/Button';
import './SecureFileViewer.css';
import { PdfPreview } from './PdfPreview';

export interface SecureFileViewerProps {
  courseId: string;
  file: StoredFile | null;
  policy?: CourseFilePolicy | null;
  isOpen: boolean;
  onClose: () => void;
}

export const SecureFileViewer: React.FC<SecureFileViewerProps> = ({
  courseId,
  file,
  policy,
  isOpen,
  onClose,
}) => {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !file) {
    return null;
  }

  // Determine file type from extension
  const ext = file.file_name.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
  const isClean = file.status === 'clean';

  // Preview permission policy check
  const isPreviewAllowed = policy ? (policy.preview_allowed ?? true) : true;

  const downloadUrl = filesService.getDownloadUrl(courseId, file.id);
  const previewUrl = filesService.getPreviewUrl(courseId, file.id);

  return (
    <div
      className="secure-viewer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="viewer-file-title"
      data-testid="secure-file-viewer-modal"
    >
      <div
        className="secure-viewer-modal"
        onClick={(e) => e.stopPropagation()}
        data-testid="viewer-modal-content"
      >
        {/* Modal Header */}
        <header className="viewer-header">
          <div className="viewer-title-group">
            <div className="viewer-file-icon">
              {isPdf ? (
                <FileText size={20} className="text-primary" />
              ) : isImage ? (
                <ImageIcon size={20} className="text-primary" />
              ) : (
                <FileText size={20} className="text-secondary" />
              )}
            </div>
            <div className="viewer-file-meta">
              <h2 id="viewer-file-title" className="viewer-file-name" title={file.file_name}>
                {file.file_name}
              </h2>
              <div className="viewer-submeta">
                <span className="viewer-file-size">{formatFileSize(file.file_size)}</span>
                <span className="viewer-meta-divider">•</span>
                {isClean ? (
                  <span className="viewer-badge-clean">
                    <ShieldCheck size={14} /> An toàn
                  </span>
                ) : (
                  <span className="viewer-badge-warning">
                    <AlertCircle size={14} /> {file.status}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="viewer-actions">
            {isClean && (
              <a
                href={downloadUrl}
                download={file.file_name}
                className="viewer-download-link"
                data-testid="viewer-download-btn"
                title="Tải về tệp an toàn"
              >
                <Download size={16} />
                <span>Tải về</span>
              </a>
            )}
            <button
              type="button"
              className="viewer-close-btn"
              onClick={onClose}
              aria-label="Đóng cửa sổ xem trước"
              data-testid="viewer-close-btn"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Modal Body / Viewer Content */}
        <div className="viewer-body" data-testid="viewer-body">
          {/* Case 1: File is NOT clean */}
          {!isClean && (
            <div className="viewer-blocked-card status-unsafe" data-testid="preview-unsafe-alert">
              <div className="blocked-icon-wrapper danger">
                <AlertCircle size={48} />
              </div>
              <h3 className="blocked-title">Không thể xem trước tệp</h3>
              <p className="blocked-desc">
                Tệp tin này chưa vượt qua kiểm định an toàn hoặc đang ở trạng thái cách ly (
                <code>{file.status}</code>). Để bảo vệ người dùng, hệ thống vô hiệu hóa toàn bộ quyền xem trước và tải về.
              </p>
            </div>
          )}

          {/* Case 2: Clean, but preview_allowed is explicitly disabled */}
          {isClean && !isPreviewAllowed && (
            <div className="viewer-blocked-card" data-testid="preview-blocked-notice">
              <div className="blocked-icon-wrapper warning">
                <Lock size={48} />
              </div>
              <h3 className="blocked-title">Xem trước bị vô hiệu hóa</h3>
              <p className="blocked-desc">
                Tệp này không hỗ trợ xem trước theo quy định của môn học. Vui lòng tải về để xem nội dung tệp tin trên máy tính của bạn.
              </p>
              <div className="blocked-action-row">
                <a
                  href={downloadUrl}
                  download={file.file_name}
                  className="btn btn-primary"
                  data-testid="download-fallback-btn"
                >
                  <Download size={16} />
                  <span>Tải về tệp tin</span>
                </a>
              </div>
            </div>
          )}

          {/* Case 3: Clean, preview_allowed is true, PDF viewer */}
          {isClean && isPreviewAllowed && isPdf && (
            <div className="viewer-iframe-wrapper" data-testid="pdf-preview-container">
              <PdfPreview url={previewUrl} />
            </div>
          )}

          {/* Case 4: Clean, preview_allowed is true, Image viewer */}
          {isClean && isPreviewAllowed && isImage && (
            <div className="viewer-image-wrapper" data-testid="image-preview-container">
              <img
                src={previewUrl}
                alt={file.file_name}
                className="secure-preview-image"
                data-testid="secure-preview-image"
              />
            </div>
          )}

          {/* Case 5: Clean, preview_allowed is true, but format is not directly previewable in browser */}
          {isClean && isPreviewAllowed && !isPdf && !isImage && (
            <div className="viewer-blocked-card" data-testid="unsupported-preview-notice">
              <div className="blocked-icon-wrapper info">
                <ExternalLink size={48} />
              </div>
              <h3 className="blocked-title">Không hỗ trợ xem trực tiếp</h3>
              <p className="blocked-desc">
                Định dạng <code>.{ext.toUpperCase()}</code> không hỗ trợ hiển thị trực tiếp trên trình duyệt web. Vui lòng tải về máy tính để mở bằng phần mềm chuyên dụng.
              </p>
              <div className="blocked-action-row">
                <a
                  href={downloadUrl}
                  download={file.file_name}
                  className="btn btn-primary"
                  data-testid="download-unsupported-btn"
                >
                  <Download size={16} />
                  <span>Tải về để xem</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
