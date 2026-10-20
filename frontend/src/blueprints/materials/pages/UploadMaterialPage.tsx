import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { TextField, SelectField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import {
  Upload,
  FileText,
  CheckCircle2,
  Trash2,
  Layers,
  ShieldCheck
} from 'lucide-react';
import './UploadMaterialPage.css';

interface FileUploadItem {
  id: string;
  name: string;
  size: number;
  type: string;
  title: string;
  lessonId: string;
  tags: string;
  progress: number;
  status: 'idle' | 'uploading' | 'scanning' | 'success' | 'error';
  errorMsg?: string;
}

export const UploadMaterialPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const { courses, lessons, materials, materialVersions, createMaterial, addMaterialVersion } = useDatabase();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const course = courses.find((c) => c.id === monId || c.code.toLowerCase() === monId?.toLowerCase());
  const isArchived = course?.status === 'archived';

  // Mode: new material vs new version for existing material
  const [uploadMode, setUploadMode] = useState<'new_material' | 'new_version'>('new_material');
  const [targetMaterialId, setTargetMaterialId] = useState('');

  // Course lessons
  const courseLessons = useMemo(() => {
    if (!course) return [];
    return lessons.filter((l) => l.courseId === course.id);
  }, [lessons, course]);

  // Existing materials in this course
  const existingMaterials = useMemo(() => {
    return materials.filter((m) => m.courseId === course?.id);
  }, [materials, course]);

  // Selected existing material
  const selectedExistingMaterial = useMemo(() => {
    return existingMaterials.find((m) => m.id === targetMaterialId) || null;
  }, [existingMaterials, targetMaterialId]);

  // Queue of files to upload
  const [fileQueue, setFileQueue] = useState<FileUploadItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!course) {
    return (
      <div className="upload-page-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại trên hệ thống."
          action={
            <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  if (isArchived) {
    return (
      <div className="upload-page-container">
        <EmptyState
          title="Môn học đã lưu trữ"
          description="Không thể tải thêm tài liệu vào môn học đã kết thúc và lưu trữ."
          action={
            <Button variant="secondary" onClick={() => navigate(`/gv/mon-hoc/${course.id}/hoc-lieu`)}>
              Quay lại danh sách học liệu
            </Button>
          }
        />
      </div>
    );
  }

  // Handle mock file selection
  const handleSimulateAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: FileUploadItem[] = Array.from(files).map((f, idx) => {
      const ext = f.name.split('.').pop()?.toLowerCase() || 'pdf';
      const cleanTitle = f.name.replace(/\.[^/.]+$/, '');
      return {
        id: `f-${Date.now()}-${idx}`,
        name: f.name,
        size: f.size || 2500000,
        type: ext,
        title: cleanTitle,
        lessonId: courseLessons.length > 0 ? courseLessons[0].id : '',
        tags: 'bai-giang, tham-khao',
        progress: 0,
        status: 'idle'
      };
    });

    setFileQueue(prev => [...prev, ...newItems]);
  };

  const handleAddDemoFile = () => {
    const demoId = Date.now();
    const newItem: FileUploadItem = {
      id: `demo-${demoId}`,
      name: `Giao_trinh_Hoc_phan_Phan_${fileQueue.length + 1}.pdf`,
      size: 3400000,
      type: 'pdf',
      title: `Giáo trình Học phần - Phần ${fileQueue.length + 1}`,
      lessonId: courseLessons.length > 0 ? courseLessons[0].id : '',
      tags: 'giao-trinh, ly-thuyet',
      progress: 0,
      status: 'idle'
    };
    setFileQueue(prev => [...prev, newItem]);
  };

  const handleRemoveItem = (id: string) => {
    setFileQueue(prev => prev.filter(item => item.id !== id));
  };

  const handleUpdateItem = (id: string, updates: Partial<FileUploadItem>) => {
    setFileQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  // Upload and scan simulator
  const handleStartUpload = () => {
    if (fileQueue.length === 0) {
      showNotification('error', 'Vui lòng chọn ít nhất một tệp để tải lên.');
      return;
    }

    if (uploadMode === 'new_version' && !targetMaterialId) {
      showNotification('error', 'Vui lòng chọn học liệu cần cập nhật phiên bản mới.');
      return;
    }

    setIsProcessing(true);

    // Update statuses to uploading
    setFileQueue(prev => prev.map(item => ({ ...item, status: 'uploading', progress: 40 })));

    setTimeout(() => {
      // Step: Scanning
      setFileQueue(prev => prev.map(item => ({ ...item, status: 'scanning', progress: 85 })));

      setTimeout(() => {
        // Step: Done & Commit
        fileQueue.forEach((item, idx) => {
          if (uploadMode === 'new_version' && selectedExistingMaterial) {
            // New version
            const existingVers = materialVersions?.filter((v) => v.materialId === selectedExistingMaterial.id) || [];
            const newVerNumber = existingVers.length + 1;
            addMaterialVersion({
              id: `mv-${Date.now()}-${idx}`,
              materialId: selectedExistingMaterial.id,
              versionNumber: newVerNumber,
              fileUrl: `/uploads/${item.name}`,
              fileSize: item.size,
              uploadedAt: new Date().toISOString(),
              sampleContent: `Nội dung cập nhật của phiên bản mới v${newVerNumber}.\nTài liệu bao gồm các sửa đổi chi tiết theo phản hồi thực tế của sinh viên và đề cương mới nhất.`
            });
          } else {
            // New material
            const newMatId = `mat-${Date.now()}-${idx}`;
            createMaterial({
              id: newMatId,
              courseId: course.id,
              lessonId: item.lessonId || (courseLessons.length > 0 ? courseLessons[0].id : 'les-1'),
              title: item.title.trim() || item.name,
              fileType: item.type,
              currentVersion: 1,
              scanStatus: 'clean',
              aiIndexStatus: 'indexed',
              visibility: 'draft', // Default is draft
              tags: item.tags.split(',').map(t => t.trim()).filter(Boolean),
              updatedAt: new Date().toISOString()
            });

            addMaterialVersion({
              id: `mv-${Date.now()}-${idx}`,
              materialId: newMatId,
              versionNumber: 1,
              fileUrl: `/uploads/${item.name}`,
              fileSize: item.size,
              uploadedAt: new Date().toISOString(),
              sampleContent: `Nội dung trích đoạn của tài liệu ${item.title}.\nGiảng viên có thể kiểm tra trực tiếp bản xem trước và yêu cầu trợ lý AI tóm tắt.`
            });
          }
        });

        setIsProcessing(false);
        showNotification('success', `Đã tải lên và quét an ninh thành công ${fileQueue.length} tệp tài liệu.`);
        navigate(`/gv/mon-hoc/${course.id}/hoc-lieu`);
      }, 700);
    }, 600);
  };

  return (
    <div className="upload-material-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/gv' },
            { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
            { label: 'Học liệu', path: `/gv/mon-hoc/${course.id}/hoc-lieu` },
            { label: 'Tải lên học liệu' }
          ]}
        />
        <h1 className="page-heading">Tải lên học liệu giảng dạy</h1>
        <p className="page-subheading">
          Hệ thống tự động thực hiện quét mã độc an ninh và lập chỉ mục nội dung cho trợ lý học tập AI.
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="upload-mode-card">
        <div className="mode-toggle-group">
          <button
            type="button"
            className={`mode-btn ${uploadMode === 'new_material' ? 'active' : ''}`}
            onClick={() => setUploadMode('new_material')}
          >
            <FileText size={18} />
            <span>Tạo học liệu mới</span>
          </button>
          <button
            type="button"
            className={`mode-btn ${uploadMode === 'new_version' ? 'active' : ''}`}
            onClick={() => setUploadMode('new_version')}
          >
            <Layers size={18} />
            <span>Tải phiên bản mới cho học liệu có sẵn</span>
          </button>
        </div>

        {uploadMode === 'new_version' && (
          <div className="existing-material-picker">
            <SelectField
              label="Chọn học liệu cần nâng cấp phiên bản"
              required
              value={targetMaterialId}
              onChange={e => setTargetMaterialId(e.target.value)}
              options={[
                { value: '', label: '-- Chọn học liệu trong danh sách --' },
                ...existingMaterials.map((m) => {
                  const ver = materialVersions?.find((v) => v.id === m.currentVersionId);
                  return {
                    value: m.id,
                    label: `${m.title} (Hiện tại: v${ver?.versionNumber || 1})`
                  };
                })
              ]}
              helperText="Bài học và môn học sẽ tự động khóa theo học liệu gốc đã chọn."
            />
          </div>
        )}
      </div>

      {/* Drop Zone Box */}
      <div className="dropzone-card">
        <Upload size={36} className="dropzone-icon" />
        <h2 className="dropzone-title">Kéo thả tệp vào đây hoặc chọn từ máy tính</h2>
        <p className="dropzone-hint">
          Hỗ trợ các định dạng PDF, DOCX, PPTX, MP4. Quyền hiển thị mặc định là <strong>Bản nháp</strong> (an toàn cho giảng viên).
        </p>

        <div className="dropzone-actions">
          <label className="npc-btn npc-btn-secondary">
            <span>Chọn tệp tin...</span>
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={handleSimulateAddFiles}
            />
          </label>
          <Button type="button" variant="ghost" onClick={handleAddDemoFile}>
            + Thêm tệp mẫu minh họa
          </Button>
        </div>
      </div>

      {/* File Queue List */}
      {fileQueue.length > 0 && (
        <div className="file-queue-section">
          <div className="queue-header">
            <h3 className="queue-title">Danh sách tệp chờ tải lên ({fileQueue.length})</h3>
            <span className="queue-badge">Tất cả tệp sẽ được quét an ninh</span>
          </div>

          <div className="queue-items-stack">
            {fileQueue.map(item => (
              <div key={item.id} className="queue-item-card">
                <div className="queue-item-top">
                  <div className="queue-item-fileinfo">
                    <FileText size={20} className="file-icon" />
                    <div>
                      <strong className="queue-file-name">{item.name}</strong>
                      <span className="queue-file-size">{(item.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                  </div>

                  <div className="queue-item-status">
                    {item.status === 'idle' && (
                      <span className="status-idle">Chờ tải lên</span>
                    )}
                    {item.status === 'uploading' && (
                      <span className="status-loading">Đang tải lên... {item.progress}%</span>
                    )}
                    {item.status === 'scanning' && (
                      <span className="status-scanning">
                        <ShieldCheck size={16} /> Đang quét an ninh...
                      </span>
                    )}
                    {item.status === 'success' && (
                      <span className="status-success">
                        <CheckCircle2 size={16} /> Sạch & Hoàn tất
                      </span>
                    )}

                    <button
                      type="button"
                      className="icon-remove-btn"
                      onClick={() => handleRemoveItem(item.id)}
                      disabled={isProcessing}
                      title="Xóa tệp khỏi danh sách"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Metadata Fields for New Material */}
                {uploadMode === 'new_material' && (
                  <div className="queue-item-metadata-row">
                    <div className="meta-field">
                      <TextField
                        label="Tiêu đề hiển thị"
                        value={item.title}
                        onChange={e => handleUpdateItem(item.id, { title: e.target.value })}
                      />
                    </div>
                    <div className="meta-field">
                      <SelectField
                        label="Gắn vào bài học"
                        value={item.lessonId}
                        onChange={e => handleUpdateItem(item.id, { lessonId: e.target.value })}
                        options={courseLessons.map(l => ({ value: l.id, label: l.title }))}
                      />
                    </div>
                    <div className="meta-field">
                      <TextField
                        label="Thẻ phân loại (phân tách bởi dấu phẩy)"
                        value={item.tags}
                        onChange={e => handleUpdateItem(item.id, { tags: e.target.value })}
                        placeholder="giao-trinh, bai-tap..."
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="queue-submit-bar">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(`/gv/mon-hoc/${course.id}/hoc-lieu`)}
              disabled={isProcessing}
            >
              Hủy bỏ
            </Button>
            <Button
              type="button"
              variant="primary"
              isLoading={isProcessing}
              onClick={handleStartUpload}
            >
              <Upload size={18} />
              <span>Tiến hành tải lên và Quét an ninh</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
