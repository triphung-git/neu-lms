import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Modal } from '../../../shared/ui/Modal';
import { formatDateVN, formatFileSize } from '../../../shared/kernel/formatting';
import {
  materialsService,
  type MaterialDetail,
  type MaterialFileManifestItem,
} from '../../../api/materialsService';
import { coursesService, type Course } from '../../../api/coursesService';
import {
  FileText,
  Download,
  Eye,
  Lock,
  Bot,
  AlertTriangle,
  RefreshCw,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  Hash,
} from 'lucide-react';
import './StudentMaterialDetailPage.css';
import { PdfPreview } from '../../files/components/PdfPreview';

interface LoadError {
  title: string;
  message: string;
  statusCode?: number;
}

const isFilePreviewAllowed = (f: MaterialFileManifestItem): boolean => {
  if ('file_policy' in f && (f as any).file_policy) {
    return Boolean((f as any).file_policy.preview_allowed);
  }
  return f.preview_url !== null;
};

export const StudentMaterialDetailPage: React.FC = () => {
  const { monId, hocLieuId } = useParams<{ monId?: string; hocLieuId: string }>();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [material, setMaterial] = useState<MaterialDetail | null>(null);
  const [course, setCourse] = useState<Course | null>(null);

  // File Download & Preview states
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<MaterialFileManifestItem | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Stale request guard
  const reqSeq = useRef(0);
  const previewSeq = useRef(0);

  const fetchMaterialAndCourse = useCallback(async () => {
    if (!hocLieuId) return;
    const currentSeq = ++reqSeq.current;
    setLoading(true);
    setError(null);

    try {
      let matData: MaterialDetail;
      if (monId) {
        matData = await materialsService.getMaterial(monId, hocLieuId);
      } else {
        matData = await materialsService.getMaterialById(hocLieuId);
      }

      if (currentSeq !== reqSeq.current) return;
      setMaterial(matData);

      // Verify student visibility
      if (matData.is_hidden || !matData.published_version) {
        setError({
          title: 'Học liệu chưa công bố',
          message: 'Tài liệu này hiện chưa được công bố hoặc đang ở chế độ ẩn của giảng viên.',
          statusCode: 403,
        });
        setLoading(false);
        return;
      }

      // Fetch course information
      const targetCourseId = monId || matData.course_id;
      if (targetCourseId) {
        const courseData = await coursesService.get(targetCourseId);
        if (currentSeq !== reqSeq.current) return;
        setCourse(courseData);
      }
    } catch (err: unknown) {
      if (currentSeq !== reqSeq.current) return;
      const apiErr = err as { status?: number; message?: string };
      const statusCode = apiErr.status;

      if (statusCode === 403) {
        setError({
          title: 'Không có quyền truy cập',
          message:
            'Bạn chưa được ghi danh vào môn học này, đã rút khỏi môn học hoặc tài liệu đã bị ẩn.',
          statusCode: 403,
        });
      } else if (statusCode === 404) {
        setError({
          title: 'Không tìm thấy học liệu',
          message: 'Học liệu không tồn tại trên hệ thống hoặc đã bị gỡ bỏ.',
          statusCode: 404,
        });
      } else {
        setError({
          title: 'Lỗi tải dữ liệu',
          message: apiErr.message || 'Không thể tải thông tin học liệu từ máy chủ. Vui lòng thử lại.',
          statusCode,
        });
      }
    } finally {
      if (currentSeq === reqSeq.current) {
        setLoading(false);
      }
    }
  }, [monId, hocLieuId]);

  useEffect(() => {
    void fetchMaterialAndCourse();
    return () => {
      reqSeq.current += 1;
      previewSeq.current += 1;
    };
  }, [fetchMaterialAndCourse]);

  useEffect(() => () => { if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl); }, [previewBlobUrl]);

  // Clean up blob URL on unmount or preview close
  const handleClosePreview = () => {
    previewSeq.current++;
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewFile(null);
    setPreviewError(null);
    setIsPreviewLoading(false);
  };

  const handleOpenPreview = async (file: MaterialFileManifestItem) => {
    if (!material) return;
    const targetCourseId = monId || material.course_id;
    if (!targetCourseId) return;

    // Policy check: preview_allowed
    const isAllowed = isFilePreviewAllowed(file);
    if (!isAllowed) {
      showNotification('error', 'Xem trước tệp tin này đã bị khóa theo chính sách của giảng viên.');
      return;
    }

    const previewRequest = ++previewSeq.current;
    setPreviewFile(file);
    setIsPreviewLoading(true);
    setPreviewError(null);

    try {
      const blob = await materialsService.previewMaterialFile(targetCourseId, material.id, file.file_id);
      if (previewRequest !== previewSeq.current) return;
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl(url);
    } catch (err: unknown) {
      if (previewRequest !== previewSeq.current) return;
      const apiErr = err as { message?: string };
      setPreviewError(
        apiErr.message || 'Không thể xem trước tệp: máy chủ từ chối quyền hoặc định dạng không hỗ trợ.'
      );
    } finally {
      if (previewRequest === previewSeq.current) setIsPreviewLoading(false);
    }
  };

  const handleDownloadFile = async (file: MaterialFileManifestItem) => {
    if (!material) return;
    const targetCourseId = monId || material.course_id;
    if (!targetCourseId) return;

    setDownloadingFileId(file.file_id);
    try {
      const blob = await materialsService.downloadMaterialFile(targetCourseId, material.id, file.file_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.file_name || file.label || 'tai-lieu';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification('success', `Đã tải xuống: ${file.file_name || file.label}`);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      showNotification(
        'error',
        apiErr.message || 'Không thể tải xuống tệp: quyền truy cập bị từ chối hoặc tài liệu đã bị ẩn.'
      );
    } finally {
      setDownloadingFileId(null);
    }
  };

  if (loading) {
    return (
      <div className="student-material-detail-page">
        <div className="page-header">
          <Breadcrumb
            items={[
              { label: 'Trang chủ', path: '/sv' },
              { label: 'Môn học', path: '/sv/mon-hoc' },
              { label: 'Đang tải học liệu...' },
            ]}
          />
        </div>
        <div style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--muted)' }}>
          <p>Đang tải thông tin học liệu từ máy chủ...</p>
        </div>
      </div>
    );
  }

  if (error || !material) {
    return (
      <div className="student-material-detail-page">
        <div className="page-header">
          <Breadcrumb
            items={[
              { label: 'Trang chủ', path: '/sv' },
              { label: 'Môn học', path: '/sv/mon-hoc' },
              { label: error?.title || 'Thông báo' },
            ]}
          />
        </div>
        <div className="material-detail-container">
          <EmptyState
            title={error?.title || 'Không tìm thấy học liệu'}
            description={
              error?.message ||
              'Tài liệu không tồn tại hoặc bạn chưa được cấp quyền truy cập.'
            }
            action={
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                {error?.statusCode !== 403 && (
                  <Button
                    variant="secondary"
                    onClick={fetchMaterialAndCourse}
                    icon={<RefreshCw size={16} />}
                  >
                    Thử lại
                  </Button>
                )}
                <Button variant="primary" onClick={() => navigate('/sv/mon-hoc')}>
                  Về danh sách môn học
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const courseId = monId || material.course_id;
  const publishedVer = material.published_version;
  const files = publishedVer?.files || [];
  const tags = Array.isArray(material.tags) ? (material.tags as string[]) : [];

  return (
    <div className="student-material-detail-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Trang chủ', path: '/sv' },
            {
              label: course ? `${course.code} — ${course.name}` : material.course_code || 'Môn học',
              path: courseId ? `/sv/mon-hoc/${courseId}` : '/sv/mon-hoc',
            },
            ...(material.lesson_title && courseId
              ? [
                  {
                    label: material.lesson_title,
                    path: `/sv/mon-hoc/${courseId}?bai=${material.lesson}`,
                  },
                ]
              : []),
            { label: material.title },
          ]}
        />
      </div>

      <div className="material-detail-layout">
        {/* Left Column: Material Info & Files Manifest */}
        <section className="material-content-panel">
          <header className="material-header-block">
            <div className="material-badge-row">
              <span className="filetype-badge">{material.material_type.toUpperCase()}</span>
              {publishedVer && (
                <span className="version-pill">Phiên bản v{publishedVer.version_number}</span>
              )}
              <Badge variant="published" label="Đã công bố" />
              {publishedVer?.processing_status === 'ready' && (
                <Badge variant="ready" label="Đã lập chỉ mục" />
              )}
            </div>

            <h1 className="material-title">{material.title}</h1>

            <div className="material-meta-details">
              <span>
                Môn học: <strong>{course?.name || material.course_code}</strong>
              </span>
              <span className="dot">•</span>
              <span>
                Công bố:{' '}
                <strong>
                  {formatDateVN(publishedVer?.published_at || publishedVer?.created_at || material.created_at)}
                </strong>
              </span>
              <span className="dot">•</span>
              <span>
                Dung lượng: <strong>{formatFileSize(publishedVer?.total_size_bytes || 0)}</strong>
              </span>
              <span className="dot">•</span>
              <span>
                Tệp đính kèm: <strong>{publishedVer?.file_count || files.length} tệp</strong>
              </span>
            </div>

            {tags.length > 0 && (
              <div className="material-tags-stack">
                {tags.map((t: string) => (
                  <span key={t} className="tag-pill">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </header>

          {/* Description */}
          {material.description && (
            <div className="material-description-box">
              <h2 className="section-subheading">Mô tả học liệu</h2>
              <p className="material-desc-content">{material.description}</p>
            </div>
          )}

          {/* Confirmed Summary (if available from worker extraction) */}
          {publishedVer?.summary && (
            <div className="material-summary-card">
              <div className="summary-header">
                <ShieldCheck size={18} style={{ color: 'var(--accent)' }} />
                <strong>Tóm tắt nội dung chính đã xác nhận:</strong>
              </div>
              <p className="summary-body">{publishedVer.summary}</p>
            </div>
          )}

          {/* Changelog */}
          {publishedVer?.changelog && (
            <div className="version-changelog-card">
              <span className="changelog-label">Ghi chú phiên bản v{publishedVer.version_number}:</span>
              <p className="changelog-text">{publishedVer.changelog}</p>
            </div>
          )}

          {/* Files Manifest Section */}
          <div className="files-manifest-section">
            <h2 className="section-subheading">
              Danh sách tệp tài liệu ({files.length})
            </h2>

            {files.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
                Phiên bản này hiện không có tệp đính kèm nào.
              </p>
            ) : (
              <div className="manifest-files-list">
                {files.map((file) => {
                  const isPreviewAllowed = isFilePreviewAllowed(file);
                  const isDownloading = downloadingFileId === file.file_id;

                  return (
                    <article key={file.id} className="manifest-file-card">
                      <div className="file-card-icon">
                        <FileText size={28} />
                      </div>

                      <div className="file-card-info">
                        <h3 className="file-card-title">
                          {file.label || file.file_name}
                        </h3>
                        <div className="file-card-meta">
                          <span className="file-mime">{file.mime_type}</span>
                          <span className="file-size">{formatFileSize(file.file_size)}</span>
                          <span className="file-hash" title={`SHA-256: ${file.sha256_hash}`}>
                            <Hash size={12} />
                            {file.sha256_hash.slice(0, 10)}...
                          </span>
                        </div>

                        {!isPreviewAllowed && (
                          <div className="preview-blocked-chip" role="status">
                            <Lock size={12} />
                            <span>Xem trước trực tuyến bị khóa bởi chính sách môn học</span>
                          </div>
                        )}
                      </div>

                      <div className="file-card-actions">
                        {isPreviewAllowed ? (
                          <Button
                            variant="secondary"
                            onClick={() => handleOpenPreview(file)}
                            icon={<Eye size={15} />}
                          >
                            Xem trực tuyến
                          </Button>
                        ) : (
                          <span className="preview-disabled-tag">Không cho xem trước</span>
                        )}

                        <Button
                          variant="primary"
                          onClick={() => handleDownloadFile(file)}
                          disabled={isDownloading}
                          icon={<Download size={15} />}
                        >
                          {isDownloading ? 'Đang tải...' : 'Tải xuống'}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Context Navigation & B14 AI Status Notice */}
        <aside className="ai-chat-panel" aria-label="Thông tin bài học và trợ lý AI">
          {/* Lesson Link Card */}
          {course && (
            <div className="course-context-card">
              <div className="context-card-header">
                <BookOpen size={18} style={{ color: 'var(--accent)' }} />
                <h3>Thông tin môn học</h3>
              </div>
              <p className="context-course-title">
                <strong>{course.code}</strong> — {course.name}
              </p>
              {material.chapter_title && (
                <p className="context-detail-line">
                  <span>Chương:</span> <strong>{material.chapter_title}</strong>
                </p>
              )}
              {material.lesson_title && (
                <p className="context-detail-line">
                  <span>Bài học:</span> <strong>{material.lesson_title}</strong>
                </p>
              )}

              {material.lesson && (
                <Button
                  variant="secondary"
                  className="go-to-lesson-btn"
                  onClick={() => navigate(`/sv/mon-hoc/${course.id}?bai=${material.lesson}`)}
                  icon={<ArrowRight size={15} />}
                >
                  Đến bài học trong môn
                </Button>
              )}
            </div>
          )}

          {/* Honest AI Notice for B14 */}
          <div className="ai-b14-status-card">
            <div className="ai-brand-row">
              <Bot size={22} className="ai-bot-icon" />
              <div>
                <h3 className="ai-b14-title">Trợ lý học tập AI</h3>
                <span className="ai-b14-subtitle">Phân hệ B14 đang phát triển</span>
              </div>
            </div>

            <div className="ai-b14-description">
              <p>
                Hệ thống chỉ mục kiến thức toàn văn (B09) đã sẵn sàng. Trợ lý AI hỏi đáp ngữ cảnh thông
                minh và gợi ý câu hỏi theo tài liệu sẽ khả dụng khi hoàn tất phân hệ <strong>B14</strong>.
              </p>
            </div>

            <div className="ai-disabled-card">
              <AlertTriangle size={16} />
              <span>Giao diện hỏi đáp AI đang ở chế độ chờ kết nối mô hình B14 thực tế.</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Sandboxed File Preview Modal */}
      {previewFile && (
        <Modal
          isOpen={Boolean(previewFile)}
          onClose={handleClosePreview}
          title={`Xem trước: ${previewFile.file_name || previewFile.label}`}
        >
          <div className="sandboxed-preview-modal-body">
            {isPreviewLoading && (
              <div className="preview-loading-box">
                <p>Đang tải bản xem trước an toàn từ máy chủ...</p>
              </div>
            )}

            {previewError && (
              <div className="preview-error-box" role="alert">
                <AlertTriangle size={24} />
                <p>{previewError}</p>
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <Button variant="secondary" onClick={() => handleDownloadFile(previewFile)}>
                    Tải tệp về máy
                  </Button>
                </div>
              </div>
            )}

            {previewBlobUrl && !isPreviewLoading && !previewError && (
              <div className="preview-canvas-container">
                {previewFile.mime_type.includes('pdf') || previewFile.file_name.toLowerCase().endsWith('.pdf') ? (
                  <div title="Bản xem trước PDF"><PdfPreview url={previewBlobUrl} /></div>
                ) : ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(previewFile.mime_type) || /\.(png|jpe?g|gif|webp)$/i.test(previewFile.file_name) ? (
                  <img
                    src={previewBlobUrl}
                    alt={previewFile.file_name}
                    className="preview-image"
                  />
                ) : (
                  <p role="status">Định dạng này chưa hỗ trợ xem trực tuyến. Vui lòng tải tệp để xem.</p>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
