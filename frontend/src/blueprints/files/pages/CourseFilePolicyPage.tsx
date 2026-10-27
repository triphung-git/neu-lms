import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import {
  filesService,
  type CourseFilePolicy,
  type StoredFile,
} from '../../../api/filesService';
import { coursesService, type Course } from '../../../api/coursesService';
import { useNotification } from '../../../app/providers/NotificationContext';
import { QuotaGaugeBar } from '../../../shared/ui/QuotaGaugeBar';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { Modal } from '../../../shared/ui/Modal';
import { formatDateVN, formatFileSize } from '../../../shared/kernel/formatting';
import {
  FileText,
  Download,
  Eye,
  Trash2,
  Archive,
  Save,
  Check,
  Filter,
  Layers,
  Settings,
  AlertCircle,
  UploadCloud,
} from 'lucide-react';
import { SecureFileUploader } from '../components/SecureFileUploader';
import { SecureFileViewer } from '../components/SecureFileViewer';
import './CourseFilePolicyPage.css';

const AVAILABLE_EXTENSIONS = [
  { ext: 'pdf', label: 'PDF (.pdf)' },
  { ext: 'docx', label: 'Word (.docx)' },
  { ext: 'xlsx', label: 'Excel (.xlsx)' },
  { ext: 'pptx', label: 'PowerPoint (.pptx)' },
  { ext: 'zip', label: 'Nén (.zip)' },
  { ext: 'png', label: 'Hình ảnh PNG (.png)' },
  { ext: 'jpg', label: 'Hình ảnh JPG (.jpg)' },
  { ext: 'jpeg', label: 'Hình ảnh JPEG (.jpeg)' },
];

export interface CourseFilePolicyPageProps {
  initialTab?: 'files' | 'policy';
}

export const CourseFilePolicyPage: React.FC<CourseFilePolicyPageProps> = ({
  initialTab = 'files',
}) => {
  const { monId } = useParams<{ monId: string }>();
  const outletContext = useOutletContext<{ course?: Course; isArchived?: boolean } | null>();
  const { notifySuccess, notifyError } = useNotification();

  // Course info
  const [course, setCourse] = useState<Course | null>(outletContext?.course || null);
  const [courseLoading, setCourseLoading] = useState(!outletContext?.course);
  const isArchived = Boolean(
    outletContext?.isArchived || course?.status === 'archived',
  );

  // Tabs
  const [activeTab, setActiveTab] = useState<'files' | 'policy'>(initialTab);

  // Policy state
  const [policy, setPolicy] = useState<CourseFilePolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState<string | null>(null);

  // Policy Form fields
  const [allowedExtensions, setAllowedExtensions] = useState<string[]>([]);
  const [maxFileSizeMB, setMaxFileSizeMB] = useState<number>(25);
  const [courseQuotaMB, setCourseQuotaMB] = useState<number>(1024);
  const [maxFilesPerAssignment, setMaxFilesPerAssignment] = useState<number>(5);
  const [previewAllowed, setPreviewAllowed] = useState<boolean>(true);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  // Files state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const filesSeq = useRef(0);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [purposeFilter, setPurposeFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Delete modal state
  const [pendingDeleteFile, setPendingDeleteFile] = useState<StoredFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Uploader & Preview modal states
  const [showUploader, setShowUploader] = useState(false);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<StoredFile | null>(null);

  // Sequence guards
  const loadSeq = useRef(0);

  const courseId = course?.id || monId || '';

  // 1. Load course if not passed from outlet
  useEffect(() => {
    if (outletContext?.course) {
      setCourse(outletContext.course);
      setCourseLoading(false);
      return;
    }
    if (!monId) return;

    let isMounted = true;
    setCourseLoading(true);
    void coursesService
      .get(monId)
      .then((c) => {
        if (isMounted) setCourse(c);
      })
      .catch((err) => {
        if (isMounted) {
          notifyError(err instanceof Error ? err.message : 'Không thể tải môn học.');
        }
      })
      .finally(() => {
        if (isMounted) setCourseLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [monId, outletContext, notifyError]);

  // 2. Load Policy
  const loadPolicy = useCallback(async () => {
    if (!courseId) return;
    const seq = ++loadSeq.current;
    setPolicyLoading(true);
    setPolicyError(null);
    try {
      const p = await filesService.getFilePolicy(courseId);
      if (seq !== loadSeq.current) return;
      setPolicy(p);
      setAllowedExtensions(
        Array.isArray(p.allowed_extensions)
          ? (p.allowed_extensions as string[])
          : ['pdf', 'docx', 'xlsx', 'pptx', 'zip'],
      );
      setMaxFileSizeMB(
        Math.round((p.max_file_size_bytes ?? 26214400) / (1024 * 1024)) || 25,
      );
      setCourseQuotaMB(
        Math.round((p.course_quota_bytes ?? 1073741824) / (1024 * 1024)) || 1024,
      );
      setMaxFilesPerAssignment(p.max_files_per_assignment ?? 5);
      setPreviewAllowed(p.preview_allowed ?? true);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setPolicyError(err instanceof Error ? err.message : 'Không thể tải chính sách tệp.');
    } finally {
      if (seq === loadSeq.current) setPolicyLoading(false);
    }
  }, [courseId]);

  // 3. Load Files
  const loadFiles = useCallback(async () => {
    if (!courseId) return;
    const seq = ++filesSeq.current;
    setFilesLoading(true);
    setFilesError(null);
    try {
      const params = { purpose: purposeFilter !== 'all' ? purposeFilter : undefined, page, page_size: 20 };
      const response = await filesService.listFiles(courseId, params);
      if (seq !== filesSeq.current) return;
      setFiles(response.items);
      setTotalPages(Number(response.pagination.total_pages));
    } catch (err) {
      if (seq === filesSeq.current) setFilesError(err instanceof Error ? err.message : 'Không thể tải danh sách tệp tin.');
    } finally {
      if (seq === filesSeq.current) setFilesLoading(false);
    }
  }, [courseId, purposeFilter, page]);

  useEffect(() => {
    if (courseId) {
      void loadPolicy();
      void loadFiles();
    }
    return () => { loadSeq.current += 1; filesSeq.current += 1; };
  }, [courseId, loadPolicy, loadFiles]);

  // Validate form
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (allowedExtensions.length === 0) {
      errors.allowedExtensions = 'Phải chọn ít nhất một định dạng tệp cho phép.';
    }

    if (maxFileSizeMB <= 0) {
      errors.maxFileSizeMB = 'Kích thước tệp tối đa phải lớn hơn 0 MB.';
    } else if (maxFileSizeMB > 50) {
      errors.maxFileSizeMB = 'Kích thước tối đa không được vượt quá trần hệ thống 50MB.';
    }

    if (courseQuotaMB <= 0) {
      errors.courseQuotaMB = 'Dung lượng môn học tối đa phải lớn hơn 0 MB.';
    } else if (courseQuotaMB > 5120) {
      errors.courseQuotaMB = 'Dung lượng môn học không được vượt quá trần hệ thống 5,0 GB (5120 MB).';
    }

    if (maxFilesPerAssignment < 1 || maxFilesPerAssignment > 10) {
      errors.maxFilesPerAssignment = 'Số tệp tối đa cho một lần nộp phải từ 1 đến 10.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle Save Policy
  const handleSavePolicy = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isArchived) {
      notifyError('Môn học đã lưu trữ, không thể chỉnh sửa chính sách.');
      return;
    }

    if (!validateForm()) return;

    setIsSavingPolicy(true);
    try {
      const updated = await filesService.updateFilePolicy(courseId, {
        allowed_extensions: allowedExtensions,
        max_file_size_bytes: maxFileSizeMB * 1024 * 1024,
        course_quota_bytes: courseQuotaMB * 1024 * 1024,
        max_files_per_assignment: maxFilesPerAssignment,
        preview_allowed: previewAllowed,
      });
      setPolicy(updated);
      notifySuccess('Đã cập nhật chính sách tệp môn học thành công.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể cập nhật chính sách.');
    } finally {
      setIsSavingPolicy(false);
    }
  };

  // Toggle extension in allowlist
  const handleToggleExtension = (ext: string) => {
    if (isArchived) return;
    setAllowedExtensions((prev) =>
      prev.includes(ext) ? prev.filter((item) => item !== ext) : [...prev, ext],
    );
  };

  // Toggle publish
  const handleTogglePublish = async (file: StoredFile) => {
    if (isArchived) {
      notifyError('Môn học đã lưu trữ, không thể thay đổi trạng thái công bố.');
      return;
    }

    setActionLoading((prev) => ({ ...prev, [file.id]: true }));
    const newStatus = !file.is_published;
    try {
      const updated = await filesService.updatePublish(courseId, file.id, newStatus);
      setFiles((prev) => prev.map((f) => (f.id === file.id ? updated : f)));
      notifySuccess(
        newStatus
          ? `Đã công bố học liệu "${file.file_name}" cho sinh viên.`
          : `Đã chuyển học liệu "${file.file_name}" về bản nháp.`,
      );
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể cập nhật công bố.');
    } finally {
      setActionLoading((prev) => ({ ...prev, [file.id]: false }));
    }
  };

  // Handle confirm delete
  const handleConfirmDelete = async () => {
    if (!pendingDeleteFile) return;
    if (isArchived) {
      notifyError('Môn học đã lưu trữ, không thể xóa tệp.');
      return;
    }

    setIsDeleting(true);
    try {
      await filesService.deleteFile(courseId, pendingDeleteFile.id);
      notifySuccess(`Đã xóa tệp "${pendingDeleteFile.file_name}" và hoàn trả dung lượng.`);
      setPendingDeleteFile(null);
      void loadFiles();
      void loadPolicy(); // cập nhật lại used_quota trên thanh đo
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể xóa tệp tin.');
    } finally {
      setIsDeleting(false);
    }
  };

  if (courseLoading) {
    return (
      <div className="course-files-page-container">
        <LoadingSkeleton />
      </div>
    );
  }

  return (
    <div className="course-files-page-container" data-testid="course-file-policy-page">
      {/* 1. Header Banner */}
      <div className="files-header-card">
        <div className="files-header-info">
          <div className="files-header-badge-row">
            <Badge variant="published" label="Học liệu & Kho Tệp" />
            {isArchived ? (
              <Badge variant="archived" label="Môn học đã lưu trữ" />
            ) : (
              <Badge variant="active" label="Đang hoạt động" />
            )}
          </div>
          <h1 className="files-header-title">Quản lý Kho Tệp & Chính Sách Môn Học</h1>
          <p className="files-header-subtitle">
            Cấu hình hạn ngạch dung lượng, định dạng tải lên cho phép và quản lý toàn bộ tệp tin, học liệu của môn học.
          </p>
        </div>

        {/* Quota Gauge Summary */}
        {policy && (
          <div className="files-header-quota">
            <QuotaGaugeBar
              usedBytes={policy.used_quota_bytes ?? 0}
              totalBytes={policy.course_quota_bytes ?? 1073741824}
              reservedBytes={policy.reserved_quota_bytes ?? 0}
            />
          </div>
        )}
      </div>

      {/* 2. Archived Warning Banner */}
      {isArchived && (
        <div className="course-archived-banner" role="alert" data-testid="archived-warning-banner">
          <Archive size={18} />
          <span>
            <strong>Chế độ chỉ đọc:</strong> Môn học này đã được lưu trữ. Mọi cài đặt chính sách,
            thao tác công bố và xóa tệp đã bị khóa an toàn nhằm bảo toàn dữ liệu lịch sử.
          </span>
        </div>
      )}

      {/* 3. Subnav Tabs */}
      <div className="files-nav-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'files'}
          className={`files-tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
          data-testid="tab-files"
        >
          <Layers size={16} />
          Kho tệp môn học ({files.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'policy'}
          className={`files-tab-btn ${activeTab === 'policy' ? 'active' : ''}`}
          onClick={() => setActiveTab('policy')}
          data-testid="tab-policy"
        >
          <Settings size={16} />
          Cấu hình chính sách
        </button>
      </div>

      {/* 4. Tab Content: Policy */}
      {activeTab === 'policy' && (
        <div className="policy-tab-content" data-testid="policy-form-section">
          {policyError && (
            <ErrorBanner
              title="Lỗi tải chính sách"
              message={policyError}
              onRetry={() => void loadPolicy()}
            />
          )}

          {policyLoading ? (
            <LoadingSkeleton />
          ) : (
            <form onSubmit={(e) => void handleSavePolicy(e)} className="policy-form-card" noValidate>
              <div className="policy-section-header">
                <h2 className="policy-section-title">Chính sách tệp tin môn học</h2>
                <p className="policy-section-desc">
                  Thiết lập quy định về định dạng, dung lượng và quyền xem trước đối với sinh viên khi nộp bài hoặc xem tài liệu.
                </p>
              </div>

              {/* Allowlist Checkboxes */}
              <div className="form-group">
                <label className="form-label" id="allowlist-label">
                  Định dạng tệp cho phép tải lên <span className="text-danger">*</span>
                </label>
                <div
                  className="extension-checkbox-grid"
                  role="group"
                  aria-labelledby="allowlist-label"
                >
                  {AVAILABLE_EXTENSIONS.map(({ ext, label }) => {
                    const isChecked = allowedExtensions.includes(ext);
                    return (
                      <label
                        key={ext}
                        className={`extension-checkbox-item ${isChecked ? 'selected' : ''} ${isArchived ? 'disabled' : ''}`}
                      >
                        <input
                          type="checkbox"
                          value={ext}
                          checked={isChecked}
                          disabled={isArchived}
                          onChange={() => handleToggleExtension(ext)}
                          aria-label={label}
                        />
                        <span className="checkbox-custom">
                          {isChecked && <Check size={12} />}
                        </span>
                        <span className="checkbox-text">{label}</span>
                      </label>
                    );
                  })}
                </div>
                {formErrors.allowedExtensions && (
                  <span className="field-error" role="alert">
                    {formErrors.allowedExtensions}
                  </span>
                )}
              </div>

              {/* Numerical Inputs Grid */}
              <div className="form-row-grid">
                <div className="form-group">
                  <label htmlFor="maxFileSizeInput" className="form-label">
                    Kích thước tối đa 1 tệp (MB) <span className="text-danger">*</span>
                  </label>
                  <input
                    id="maxFileSizeInput"
                    type="number"
                    min="1"
                    max="50"
                    className={`form-input ${formErrors.maxFileSizeMB ? 'is-invalid' : ''}`}
                    value={maxFileSizeMB}
                    disabled={isArchived}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setMaxFileSizeMB(isNaN(val) ? 0 : val);
                    }}
                    aria-describedby="maxFileSizeHint"
                  />
                  <span id="maxFileSizeHint" className="form-hint">
                    Trần tối đa toàn hệ thống: <strong>50 MB</strong>.
                  </span>
                  {formErrors.maxFileSizeMB && (
                    <span className="field-error" role="alert" data-testid="error-max-file-size">
                      {formErrors.maxFileSizeMB}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="courseQuotaInput" className="form-label">
                    Dung lượng tối đa môn học (MB) <span className="text-danger">*</span>
                  </label>
                  <input
                    id="courseQuotaInput"
                    type="number"
                    min="100"
                    max="1024"
                    className={`form-input ${formErrors.courseQuotaMB ? 'is-invalid' : ''}`}
                    value={courseQuotaMB}
                    disabled={isArchived}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setCourseQuotaMB(isNaN(val) ? 0 : val);
                    }}
                    aria-describedby="courseQuotaHint"
                  />
                  <span id="courseQuotaHint" className="form-hint">
                    Trần tối đa toàn hệ thống: <strong>5.120 MB (5,0 GB)</strong>.
                  </span>
                  {formErrors.courseQuotaMB && (
                    <span className="field-error" role="alert" data-testid="error-course-quota">
                      {formErrors.courseQuotaMB}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="maxFilesInput" className="form-label">
                    Số tệp tối đa mỗi lần nộp <span className="text-danger">*</span>
                  </label>
                  <input
                    id="maxFilesInput"
                    type="number"
                    min="1"
                    max="10"
                    className={`form-input ${formErrors.maxFilesPerAssignment ? 'is-invalid' : ''}`}
                    value={maxFilesPerAssignment}
                    disabled={isArchived}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setMaxFilesPerAssignment(isNaN(val) ? 1 : val);
                    }}
                    aria-describedby="maxFilesHint"
                  />
                  <span id="maxFilesHint" className="form-hint">
                    Giới hạn từ <strong>1 đến 10</strong> tệp.
                  </span>
                  {formErrors.maxFilesPerAssignment && (
                    <span className="field-error" role="alert">
                      {formErrors.maxFilesPerAssignment}
                    </span>
                  )}
                </div>
              </div>

              {/* Preview Switch */}
              <div className="form-group preview-toggle-group">
                <div className="toggle-text-block">
                  <span className="toggle-label-title">Bật xem trước tệp an toàn (Safe Preview)</span>
                  <span className="toggle-label-desc">
                    Cho phép sinh viên xem trực tiếp tệp PDF và hình ảnh sạch mã độc trên trình duyệt mà không cần tải về máy.
                  </span>
                </div>
                <label className="toggle-switch-label">
                  <input
                    type="checkbox"
                    checked={previewAllowed}
                    disabled={isArchived}
                    onChange={(e) => setPreviewAllowed(e.target.checked)}
                    aria-label="Bật xem trước tệp an toàn"
                    data-testid="preview-allowed-toggle"
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              {/* Submit Buttons */}
              <div className="form-actions-row">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isArchived || isSavingPolicy}
                  data-testid="save-policy-btn"
                >
                  <Save size={16} />
                  {isSavingPolicy ? 'Đang lưu...' : 'Lưu thay đổi chính sách'}
                </Button>
                {isArchived && (
                  <span className="archived-lock-note">
                    <Archive size={14} /> Môn học đã lưu trữ — Không thể lưu thay đổi
                  </span>
                )}
              </div>
            </form>
          )}
        </div>
      )}

      {/* 5. Tab Content: Files Repository */}
      {activeTab === 'files' && (
        <div className="files-tab-content" data-testid="files-table-section">
          {/* Filter Bar */}
          <div className="files-filter-bar">
            <div className="filter-group">
              <Filter size={16} className="filter-icon" />
              <label htmlFor="purposeSelect" className="filter-label">Mục đích:</label>
              <select
                id="purposeSelect"
                className="filter-select"
                value={purposeFilter}
                onChange={(e) => { setPurposeFilter(e.target.value); setPage(1); }}
                data-testid="purpose-filter"
              >
                <option value="all">Tất cả mục đích</option>
                <option value="course_material">Học liệu môn học</option>
                <option value="assignment_attachment">Đính kèm bài tập</option>
                <option value="assignment_submission">Bài nộp sinh viên</option>
                <option value="general">Tệp chung</option>
              </select>
            </div>
            <div className="filter-actions-group">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadFiles()}
                disabled={filesLoading}
              >
                Làm mới
              </Button>
              {!isArchived && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowUploader((prev) => !prev)}
                  data-testid="toggle-uploader-btn"
                >
                  <UploadCloud size={16} />
                  {showUploader ? 'Đóng tải tệp' : 'Tải tệp lên'}
                </Button>
              )}
            </div>
          </div>

          {/* Secure File Uploader Section */}
          {showUploader && !isArchived && (
            <div className="uploader-embed-wrapper" data-testid="uploader-embed-section">
              <SecureFileUploader
                courseId={courseId}
                policy={policy}
                purpose={purposeFilter !== 'all' ? (purposeFilter as any) : 'course_material'}
                isArchived={isArchived}
                onUploadSuccess={(_file) => {
                  notifySuccess('Tải lên và quét an toàn tệp tin thành công!');
                  void loadFiles();
                  void loadPolicy();
                }}
                onCancel={() => setShowUploader(false)}
              />
            </div>
          )}

          {filesError && (
            <ErrorBanner
              title="Lỗi tải tệp tin"
              message={filesError}
              onRetry={() => void loadFiles()}
            />
          )}

          {filesLoading ? (
            <LoadingSkeleton />
          ) : files.length === 0 ? (
            <EmptyState
              title="Kho tệp trống"
              description={
                purposeFilter === 'all'
                  ? 'Chưa có tệp tin hoặc học liệu nào được tải lên trong môn học này.'
                  : 'Không có tệp nào phù hợp với bộ lọc mục đích đã chọn.'
              }
            />
          ) : (
            <div className="files-table-wrapper">
              <table className="files-table" data-testid="files-table">
                <thead>
                  <tr>
                    <th>Tên tệp</th>
                    <th>Kích thước</th>
                    <th>Mục đích</th>
                    <th>Người tải</th>
                    <th>Ngày tải</th>
                    <th>Kiểm tra mã độc</th>
                    <th>Công bố học liệu</th>
                    <th className="text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => {
                    const isClean = file.status === 'clean';
                    const isMaterial = file.purpose === 'course_material';
                    const isMutating = Boolean(actionLoading[file.id]);

                    return (
                      <tr key={file.id} data-testid={`file-row-${file.id}`}>
                        <td className="cell-filename">
                          <div className="filename-group">
                            <FileText size={18} className="file-icon" />
                            <span className="filename-text" title={file.file_name}>
                              {file.file_name}
                            </span>
                          </div>
                        </td>
                        <td className="cell-size">{formatFileSize(file.file_size)}</td>
                        <td className="cell-purpose">
                          {file.purpose === 'course_material' && (
                            <Badge variant="published" label="Học liệu" />
                          )}
                          {file.purpose === 'assignment_attachment' && (
                            <Badge variant="draft" label="Đính kèm bài tập" />
                          )}
                          {file.purpose === 'assignment_submission' && (
                            <Badge variant="submitted" label="Bài nộp sinh viên" />
                          )}
                          {file.purpose === 'general' && (
                            <Badge variant="draft" label="Tệp chung" />
                          )}
                        </td>
                        <td className="cell-uploader">{file.uploader_name || 'Hệ thống'}</td>
                        <td className="cell-date">{formatDateVN(file.created_at)}</td>
                        <td className="cell-status">
                          {file.status === 'clean' && (
                            <Badge variant="ready" label="An toàn" />
                          )}
                          {file.status === 'scanning' && (
                            <Badge variant="processing" label="Đang quét" />
                          )}
                          {file.status === 'quarantine_pending' && (
                            <Badge variant="pending" label="Chờ cách ly" />
                          )}
                          {file.status === 'infected' && (
                            <Badge variant="error" label="Nhiễm mã độc" />
                          )}
                          {file.status === 'deleted' && (
                            <Badge variant="locked" label="Đã xóa" />
                          )}
                        </td>
                        <td className="cell-publish">
                          {isMaterial ? (
                            <div className="publish-control-cell">
                              <button
                                type="button"
                                className={`publish-badge-btn ${file.is_published ? 'published' : 'draft'}`}
                                disabled={isArchived || isMutating || !isClean}
                                onClick={() => void handleTogglePublish(file)}
                                title={
                                  !isClean
                                    ? 'Chỉ tệp an toàn mới có thể công bố'
                                    : isArchived
                                      ? 'Môn học đã lưu trữ'
                                      : file.is_published
                                        ? 'Nhấn để hủy công bố'
                                        : 'Nhấn để công bố'
                                }
                                data-testid={`publish-btn-${file.id}`}
                              >
                                {file.is_published ? 'Đã công bố' : 'Bản nháp'}
                              </button>
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="cell-actions text-right">
                          <div className="action-buttons-group">
                            {/* Download button */}
                            {isClean ? (
                              <a
                                href={filesService.getDownloadUrl(courseId, file.id)}
                                download={file.file_name}
                                className="btn-action-icon"
                                title="Tải về tệp tin"
                                data-testid={`download-btn-${file.id}`}
                              >
                                <Download size={15} />
                              </a>
                            ) : (
                              <button
                                type="button"
                                className="btn-action-icon disabled"
                                disabled
                                title="Tệp chưa quét sạch, không thể tải"
                              >
                                <Download size={15} />
                              </button>
                            )}

                            {/* Preview button */}
                            {isClean ? (
                              <button
                                type="button"
                                className="btn-action-icon"
                                onClick={() => setSelectedPreviewFile(file)}
                                title="Xem trước tệp tin an toàn"
                                data-testid={`preview-btn-${file.id}`}
                              >
                                <Eye size={15} />
                              </button>
                            ) : null}

                            {/* Delete button */}
                            <button
                              type="button"
                              className="btn-action-icon delete"
                              disabled={isArchived}
                              onClick={() => setPendingDeleteFile(file)}
                              title={isArchived ? 'Môn học đã lưu trữ' : 'Xóa tệp tin'}
                              data-testid={`delete-btn-${file.id}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 6. Modal Confirm Delete File */}
        {activeTab === 'files' && !filesLoading && !filesError && totalPages > 1 && (
        <div className="course-pagination" aria-label="Phân trang kho tệp">
          <Button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Trang trước</Button>
          <span>Trang {page} / {totalPages}</span>
          <Button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Trang sau</Button>
        </div>
      )}
      {pendingDeleteFile && (
      <Modal
          isOpen={true}
          title="Xác nhận xóa tệp tin"
          onClose={() => !isDeleting && setPendingDeleteFile(null)}
        >
          <div className="delete-modal-content">
            <div className="delete-warning-icon">
              <AlertCircle size={32} color="#dc2626" />
            </div>
            <p>
              Bạn có chắc chắn muốn xóa tệp tin{' '}
              <strong>"{pendingDeleteFile.file_name}"</strong>?
            </p>
            <p className="delete-note">
              Dung lượng <strong>{formatFileSize(pendingDeleteFile.file_size)}</strong> sẽ được hoàn trả lại cho hạn mức môn học. Thao tác này không thể hoàn tác.
            </p>
            <div className="modal-actions-row">
              <Button
                variant="secondary"
                disabled={isDeleting}
                onClick={() => setPendingDeleteFile(null)}
              >
                Hủy bỏ
              </Button>
              <Button
                variant="danger"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                data-testid="confirm-delete-btn"
              >
                {isDeleting ? 'Đang xóa...' : 'Xác nhận xóa tệp'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 7. Secure File Viewer Modal */}
      <SecureFileViewer
        courseId={courseId}
        file={selectedPreviewFile}
        policy={policy}
        isOpen={Boolean(selectedPreviewFile)}
        onClose={() => setSelectedPreviewFile(null)}
      />
    </div>
  );
};
