import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud,
  FileCheck2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  X,
  FileText,
  CheckCircle2,
} from 'lucide-react';
import { filesService, type CourseFilePolicy, type StoredFile } from '../../../api/filesService';
import { formatFileSize } from '../../../shared/kernel/formatting';
import { Button } from '../../../shared/ui/Button';
import './SecureFileUploader.css';

export interface SecureFileUploaderProps {
  courseId: string;
  policy?: CourseFilePolicy | null;
  purpose?: 'course_material' | 'assignment_attachment' | 'assignment_submission' | 'general';
  isArchived?: boolean;
  onUploadSuccess?: (file: StoredFile) => void;
  onUploadError?: (errorMsg: string) => void;
  onCancel?: () => void;
  className?: string;
}

export type UploadStep =
  | 'idle'
  | 'validating'
  | 'uploading'
  | 'scanning'
  | 'clean'
  | 'infected'
  | 'error';

export const SecureFileUploader: React.FC<SecureFileUploaderProps> = ({
  courseId,
  policy,
  purpose = 'course_material',
  isArchived = false,
  onUploadSuccess,
  onUploadError,
  onCancel,
  className = '',
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStep, setUploadStep] = useState<UploadStep>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadedStoredFile, setUploadedStoredFile] = useState<StoredFile | null>(null);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  // Compute allowed extensions list
  const allowedExtensions: string[] = React.useMemo(() => {
    if (policy && Array.isArray(policy.allowed_extensions) && policy.allowed_extensions.length > 0) {
      return (policy.allowed_extensions as string[]).map((e) => e.toLowerCase().replace(/^\./, ''));
    }
    return ['pdf', 'docx'];
  }, [policy]);

  const maxFileSizeBytes = policy?.max_file_size_bytes ?? 26214400; // 25 MB default, 50 MB ceiling

  // Client-side validation function
  const validateFile = (file: File): string | null => {
    if (isArchived) {
      return 'Môn học đã lưu trữ, không thể tải lên tệp tin mới.';
    }

    const nameParts = file.name.split('.');
    const ext = nameParts.length > 1 ? (nameParts.pop()?.toLowerCase() || '') : '';

    if (!ext || !allowedExtensions.includes(ext)) {
      return `Định dạng tệp ".${ext || 'không xác định'}" không được phép. Các định dạng được chấp nhận: ${allowedExtensions.map((e) => `.${e}`).join(', ')}`;
    }

    if (file.size <= 0) {
      return 'Tệp tin rỗng (0 bytes). Vui lòng chọn tệp tin hợp lệ.';
    }

    if (file.size > maxFileSizeBytes) {
      return `Kích thước tệp (${formatFileSize(file.size)}) vượt quá giới hạn cho phép của môn học (${formatFileSize(maxFileSizeBytes)}).`;
    }

    // Quota availability check
    if (policy) {
      const currentUsed = policy.used_quota_bytes ?? 0;
      const currentReserved = policy.reserved_quota_bytes ?? 0;
      const totalQuota = policy.course_quota_bytes ?? 1073741824;

      if (currentUsed + currentReserved + file.size > totalQuota) {
        return `Dung lượng còn lại của môn học không đủ để tải lên tệp này (${formatFileSize(file.size)}).`;
      }
    }

    return null;
  };

  // Helper to compute SHA-256 hash
  const computeSHA256 = async (file: File): Promise<string> => {
    try {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Server always computes the checksum; never invent a client digest.
      return '';
    }
  };

  // Poll scan status until clean or infected
  const pollScanStatus = useCallback(
    async (fileId: string) => {
      pollCountRef.current += 1;
      try {
        const file = await filesService.getFile(courseId, fileId);

        if (file.status === 'clean') {
          setUploadStep('clean');
          setUploadedStoredFile(file);
          setStatusMessage('Tệp tin đã được quét an toàn và sẵn sàng sử dụng.');
          onUploadSuccess?.(file);
          return;
        }

        if (file.status === 'infected') {
          setUploadStep('infected');
          const err =
            'CẢNH BÁO AN NINH: Tệp tin bị phát hiện chứa mã độc hoặc vi phạm an ninh hệ thống và đã bị hủy!';
          setErrorMessage(err);
          onUploadError?.(err);
          return;
        }

        // Still scanning, continue polling up to 20 times (30s)
        if (pollCountRef.current < 20) {
          pollTimerRef.current = setTimeout(() => {
            void pollScanStatus(fileId);
          }, 1500);
        } else {
          // Timeout
          setUploadStep('error');
          setUploadedStoredFile(file);
          setStatusMessage('Tệp đang tiếp tục được quét trong chế độ nền.');
          setErrorMessage('Quét chưa hoàn tất. Kiểm tra lại trong kho tệp.');
        }
      } catch (err) {
        setUploadStep('error');
        const msg = err instanceof Error ? err.message : 'Không thể kiểm tra trạng thái quét mã độc.';
        setErrorMessage(msg);
        onUploadError?.(msg);
      }
    },
    [courseId, onUploadSuccess, onUploadError],
  );

  // Start Upload Flow
  const handleUpload = async (fileToUpload: File) => {
    if (uploadStep === 'uploading' || uploadStep === 'scanning') return;
    setErrorMessage(null);
    setUploadStep('validating');
    setStatusMessage('Đang kiểm tra tính hợp lệ của tệp...');

    const validationError = validateFile(fileToUpload);
    if (validationError) {
      setUploadStep('error');
      setErrorMessage(validationError);
      onUploadError?.(validationError);
      return;
    }

    try {
      // Step 1: Create Upload Intent
      setUploadStep('uploading');
      setStatusMessage('Đang khởi tạo phiên tải lên và giữ chỗ hạn ngạch...');
      setUploadProgress(15);

      const intent = await filesService.createUploadIntent(courseId, {
        file_name: fileToUpload.name,
        file_size: fileToUpload.size,
        purpose,
      });

      setCurrentFileId(intent.file_id);
      setUploadProgress(50);
      setStatusMessage('Đang tải nội dung tệp lên máy chủ lưu trữ an toàn...');

      await filesService.uploadContent(courseId, intent.file_id, fileToUpload);

      // Commit only after the actual bytes were accepted by the server.
      // We compute SHA-256 hash for authoritative verification
      const sha256 = await computeSHA256(fileToUpload);
      setUploadProgress(85);

      // Step 2: Commit Upload
      setStatusMessage('Đang đối soát checksum và chuyển sang khu vực cách ly (Quarantine)...');
      await filesService.commitUpload(courseId, intent.file_id, {
        client_checksum: sha256,
      });
      setUploadProgress(100);

      // Step 3: Scanning Phase
      setUploadStep('scanning');
      setStatusMessage('Đang kiểm tra an toàn (Quét mã độc & xác thực cấu trúc MIME)...');
      pollCountRef.current = 0;

      // Start polling for scan completion
      await pollScanStatus(intent.file_id);
    } catch (err) {
      setUploadStep('error');
      const msg = err instanceof Error ? err.message : 'Quá trình tải lên tệp tin thất bại.';
      setErrorMessage(msg);
      onUploadError?.(msg);
    }
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isArchived) setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (isArchived) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      void handleUpload(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setSelectedFile(file);
      void handleUpload(file);
    }
  };

  const handleReset = async () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }

    // If cancelled while uploading/scanning, abort upload if needed
    if (currentFileId && (uploadStep === 'uploading' || uploadStep === 'scanning')) {
      try {
        await filesService.deleteFile(courseId, currentFileId);
      } catch {
        // Ignore deletion errors on reset
      }
    }

    setSelectedFile(null);
    setCurrentFileId(null);
    setUploadStep('idle');
    setUploadProgress(0);
    setStatusMessage('');
    setErrorMessage(null);
    setUploadedStoredFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onCancel?.();
  };

  return (
    <div
      className={`secure-file-uploader-container ${className} ${isArchived ? 'is-archived' : ''}`}
      data-testid="secure-file-uploader"
    >
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        disabled={isArchived || uploadStep === 'uploading' || uploadStep === 'scanning'}
        className="sr-only"
        data-testid="secure-file-input"
        aria-label="Chọn tệp tin tải lên"
      />

      {/* 1. IDLE / SELECT STEP */}
      {uploadStep === 'idle' && (
        <div
          className={`dropzone-card ${dragOver ? 'drag-over' : ''} ${isArchived ? 'disabled' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isArchived && fileInputRef.current?.click()}
          role="button"
          tabIndex={isArchived ? -1 : 0}
          onKeyDown={(e) => {
            if (!isArchived && (e.key === 'Enter' || e.key === ' ')) {
              fileInputRef.current?.click();
            }
          }}
          data-testid="file-dropzone"
        >
          <div className="dropzone-icon-box">
            <UploadCloud size={40} className="dropzone-icon" />
          </div>
          <div className="dropzone-text-block">
            <h3 className="dropzone-title">
              {isArchived
                ? 'Môn học đã lưu trữ — Không thể tải lên tệp'
                : 'Kéo thả tệp vào đây hoặc nhấn để duyệt'}
            </h3>
            <p className="dropzone-desc">
              Hỗ trợ: {allowedExtensions.map((ext) => `.${ext.toUpperCase()}`).join(', ')} • Tối đa:{' '}
              {formatFileSize(maxFileSizeBytes)}
            </p>
          </div>
          {!isArchived && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="dropzone-browse-btn"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Chọn tệp từ máy
            </Button>
          )}
        </div>
      )}

      {/* 2. PROGRESS / SCANNING / RESULT CARD */}
      {uploadStep !== 'idle' && (
        <div className={`upload-status-card status-${uploadStep}`} data-testid="upload-status-card">
          <div className="status-header">
            <div className="status-file-meta">
              <div className="file-icon-wrapper">
                {uploadStep === 'clean' ? (
                  <FileCheck2 size={24} className="text-success" />
                ) : uploadStep === 'infected' ? (
                  <ShieldAlert size={24} className="text-danger" />
                ) : uploadStep === 'error' ? (
                  <AlertTriangle size={24} className="text-danger" />
                ) : uploadStep === 'scanning' ? (
                  <ShieldCheck size={24} className="text-warning spin-slow" />
                ) : (
                  <FileText size={24} className="text-primary" />
                )}
              </div>
              <div className="file-info-text">
                <span className="file-name" title={selectedFile?.name}>
                  {selectedFile?.name || 'Tệp tải lên'}
                </span>
                <span className="file-size-status">
                  {selectedFile ? formatFileSize(selectedFile.size) : ''}
                  {uploadStep === 'uploading' && ` • Đang tải lên ${uploadProgress}%`}
                  {uploadStep === 'scanning' && ' • Khu vực cách ly an toàn'}
                  {uploadStep === 'clean' && ' • Đã qua kiểm duyệt mã độc'}
                  {uploadStep === 'infected' && ' • Tệp nguy hại đã bị hủy'}
                </span>
              </div>
            </div>

            {/* Cancel/Reset button */}
            <button
              type="button"
              className="status-close-btn"
              onClick={() => void handleReset()}
              aria-label="Đóng hoặc hủy tải lên"
              data-testid="uploader-reset-btn"
            >
              <X size={18} />
            </button>
          </div>

          {/* Progress bar during uploading */}
          {uploadStep === 'uploading' && (
            <div className="upload-progress-section">
              <div className="progress-bar-track" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
              <p className="progress-status-note">{statusMessage}</p>
            </div>
          )}

          {/* Scanning Animation */}
          {uploadStep === 'scanning' && (
            <div className="scanning-quarantine-box" data-testid="scanning-quarantine-box">
              <div className="scanner-badge-row">
                <Loader2 size={18} className="spinner text-warning" />
                <span className="scanning-label">Đang kiểm tra an toàn (Quét mã độc)...</span>
              </div>
              <p className="scanning-details">
                Hệ thống đang kiểm tra chữ ký virus EICAR, phát hiện ngụy trang nhị phân PE/ELF và đối soát định dạng MIME thực tế qua magic bytes.
              </p>
            </div>
          )}

          {/* Clean Success State */}
          {uploadStep === 'clean' && uploadedStoredFile && (
            <div className="clean-success-box" data-testid="clean-success-box">
              <div className="success-badge-row">
                <CheckCircle2 size={18} className="text-success" />
                <span className="success-label">Tải lên & Quét an toàn thành công!</span>
              </div>
              <p className="success-details">
                Mã định danh tệp: <code>{uploadedStoredFile.id}</code> • Đã chuyển vào kho lưu trữ môn học an toàn.
              </p>
            </div>
          )}

          {/* Infected Danger Alert */}
          {uploadStep === 'infected' && (
            <div className="infected-alert-box" role="alert" data-testid="infected-alert-box">
              <div className="infected-badge-row">
                <ShieldAlert size={20} className="text-danger" />
                <strong className="infected-title">PHÁT HIỆN MÃ ĐỘC NGUY HẠI!</strong>
              </div>
              <p className="infected-details">
                {errorMessage ||
                  'Tệp tin đã bị hệ thống phát hiện chứa mã độc hoặc vi phạm an ninh. Tệp đã bị hủy vĩnh viễn và dung lượng đã được hoàn trả lại môn học.'}
              </p>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => void handleReset()}
                className="mt-2"
                data-testid="dismiss-infected-btn"
              >
                Chọn tệp khác an toàn
              </Button>
            </div>
          )}

          {/* Generic Error Alert */}
          {uploadStep === 'error' && errorMessage && (
            <div className="error-alert-box" role="alert" data-testid="error-alert-box">
              <div className="error-badge-row">
                <AlertTriangle size={18} className="text-danger" />
                <span className="error-title">Không thể tải tệp lên</span>
              </div>
              <p className="error-details">{errorMessage}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleReset()}
                className="mt-2"
                data-testid="retry-upload-btn"
              >
                Thử lại với tệp khác
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
