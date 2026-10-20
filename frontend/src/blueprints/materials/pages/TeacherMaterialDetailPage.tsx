import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotification } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import type { Material, MaterialVersion, Course, Lesson } from '../../../shared/kernel/types';
import {
  FileText,
  Upload,
  Layers,
  ShieldCheck,
  Bot,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  ArrowLeft
} from 'lucide-react';
import './TeacherMaterialDetailPage.css';

export const TeacherMaterialDetailPage: React.FC = () => {
  const { hocLieuId } = useParams<{ hocLieuId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    materials,
    materialVersions,
    courses,
    lessons,
    updateMaterial,
    updateDb,
    createAIDraft,
    systemSettings
  } = useDatabase();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();

  const activeTab = searchParams.get('tab') || 'thong-tin';

  const material = materials.find((m: Material) => m.id === hocLieuId);
  const course = material ? courses.find((c: Course) => c.id === material.courseId) : null;
  const isArchived = course?.status === 'archived';

  // Versions for this material
  const versions = useMemo(() => {
    return materialVersions
      .filter((v: MaterialVersion) => v.materialId === hocLieuId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }, [materialVersions, hocLieuId]);

  const currVer = useMemo(() => {
    return versions.find((v) => v.id === material?.currentVersionId) || versions[0] || null;
  }, [versions, material]);

  // Form states for editing metadata
  const [title, setTitle] = useState(material?.title || '');
  const [lessonId, setLessonId] = useState(material?.lessonId || '');
  const [tags, setTags] = useState(material?.tags.join(', ') || '');
  const [visibility, setVisibility] = useState(material?.visibility || 'draft');
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  if (!material || !course) {
    return (
      <div className="teacher-mat-detail-container">
        <EmptyState
          title="Không tìm thấy học liệu"
          description="Tài liệu không tồn tại trên hệ thống hoặc đã bị gỡ."
          action={
            <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  const handleSelectTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  const handleSaveMetadata = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      notifyError('Vui lòng nhập tên học liệu.');
      return;
    }

    setIsSaving(true);
    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const res = updateMaterial(material.id, {
      title: title.trim(),
      lessonId,
      tags: parsedTags,
      visibility: visibility as any
    });

    setIsSaving(false);
    if (res.ok) {
      notifySuccess('Đã lưu thông tin học liệu thành công.');
    } else {
      notifyError(res.error?.message || 'Có lỗi xảy ra');
    }
  };

  const handleRetryScan = () => {
    if (!currVer) return;
    notifySuccess('Đang tiến hành gửi lại tệp sang dịch vụ quét an ninh...');
    setTimeout(() => {
      updateDb((draft) => {
        const v = draft.materialVersions.find((item) => item.id === currVer.id);
        if (v) {
          v.scanStatus = 'clean';
        }
      }, { action: 'RETRY_SCAN', entityType: 'MaterialVersion', entityId: currVer.id });
      notifySuccess('Quét an ninh thành công: Tệp an toàn, không có mã độc.');
    }, 1000);
  };

  const handleRetryIndex = () => {
    if (!currVer) return;
    notifySuccess('Đang trích xuất lại văn bản và lập chỉ mục Vector...');
    setTimeout(() => {
      updateDb((draft) => {
        const v = draft.materialVersions.find((item) => item.id === currVer.id);
        if (v) {
          v.indexStatus = 'success';
          v.extractionStatus = 'success';
        }
      }, { action: 'RETRY_INDEX', entityType: 'MaterialVersion', entityId: currVer.id });
      notifySuccess('Lập chỉ mục AI thành công: Trợ lý AI đã sẵn sàng trả lời dựa trên tệp này.');
    }, 1000);
  };

  const handleGenerateSummary = () => {
    setIsGeneratingSummary(true);
    setTimeout(() => {
      createAIDraft({
        type: 'summary',
        materialId: material.id,
        courseId: course.id,
        content: `Tóm tắt nội dung chính của tài liệu ${material.title}:\n- Chương 1: Giới thiệu tổng quan cấu trúc bài học và mục tiêu đầu ra.\n- Chương 2: Các khái niệm then chốt và sơ đồ luồng dữ liệu minh họa.\n- Chương 3: Bài tập áp dụng và các lỗi thường gặp trong quá trình làm bài.`,
      });
      setIsGeneratingSummary(false);
      notifySuccess('Đã tạo bản nháp tóm tắt bằng AI. Vui lòng chuyển sang tab "Bản nháp AI" để kiểm tra và phê duyệt.');
    }, 1200);
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '1.2 MB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="teacher-mat-detail-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: 'Học liệu', path: `/gv/mon-hoc/${course.id}/hoc-lieu` },
              { label: material.title }
            ]}
          />
          <h1 className="page-main-heading">{material.title}</h1>
          <p className="page-subtitle">
            Môn học: <strong>{course.code}</strong> • Phiên bản hiện hành: <strong>v{currVer?.versionNumber || 1}</strong>
          </p>
        </div>

        <div className="header-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/gv/mon-hoc/${course.id}/hoc-lieu`)}
          >
            <ArrowLeft size={16} />
            <span>Quay lại danh sách</span>
          </Button>
          {!isArchived && (
            <Link
              to={`/gv/mon-hoc/${course.id}/hoc-lieu/tai-len`}
              className="npc-btn npc-btn-primary"
            >
              <Upload size={16} />
              <span>Tải phiên bản mới</span>
            </Link>
          )}
        </div>
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>
            Môn học đã lưu trữ: Học liệu ở trạng thái chỉ đọc vĩnh viễn. Không thể lưu chỉnh sửa hoặc tải lên phiên bản mới.
          </span>
        </div>
      )}

      {/* Tabs Bar */}
      <div className="detail-tabs-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'thong-tin'}
          className={`tab-btn ${activeTab === 'thong-tin' ? 'active' : ''}`}
          onClick={() => handleSelectTab('thong-tin')}
        >
          <FileText size={16} />
          <span>Thông tin & Quyền hiển thị</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'phien-ban'}
          className={`tab-btn ${activeTab === 'phien-ban' ? 'active' : ''}`}
          onClick={() => handleSelectTab('phien-ban')}
        >
          <Layers size={16} />
          <span>Lịch sử phiên bản ({versions.length})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'xu-ly-ai'}
          className={`tab-btn ${activeTab === 'xu-ly-ai' ? 'active' : ''}`}
          onClick={() => handleSelectTab('xu-ly-ai')}
        >
          <Bot size={16} />
          <span>Tiến trình Quét & AI</span>
        </button>
      </div>

      {/* TAB 1: THÔNG TIN & QUYỀN */}
      {activeTab === 'thong-tin' && (
        <div className="tab-pane">
          <form onSubmit={handleSaveMetadata} className="metadata-edit-card">
            <h2 className="pane-section-title">Chỉnh sửa thông tin tài liệu</h2>

            <div className="form-fields-stack">
              <TextField
                label="Tiêu đề học liệu"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isArchived}
              />

              <SelectField
                label="Gắn với bài học"
                value={lessonId}
                onChange={(e) => setLessonId(e.target.value)}
                disabled={isArchived}
                options={[
                  { value: '', label: '-- Không thuộc bài học cụ thể --' },
                  ...lessons.map((l: Lesson) => ({ value: l.id, label: l.title }))
                ]}
              />

              <TextField
                label="Thẻ phân loại (ngăn cách bằng dấu phẩy)"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                disabled={isArchived}
                placeholder="ví dụ: slide, bài giảng, chương 1"
              />

              <SelectField
                label="Quyền hiển thị"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as any)}
                disabled={isArchived}
                options={[
                  { value: 'draft', label: 'Bản nháp (chỉ giảng viên thấy)' },
                  { value: 'class', label: 'Công khai cho cả lớp (sinh viên có thể xem và hỏi AI)' },
                  { value: 'hidden', label: 'Tạm ẩn' }
                ]}
                helperText="Khi chọn 'Công khai cho cả lớp', toàn bộ sinh viên đã ghi danh sẽ được quyền đọc và tương tác."
              />
            </div>

            {!isArchived && (
              <div className="form-submit-row">
                <Button type="submit" variant="primary" isLoading={isSaving}>
                  Lưu thay đổi
                </Button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* TAB 2: LỊCH SỬ PHIÊN BẢN */}
      {activeTab === 'phien-ban' && (
        <div className="tab-pane">
          <div className="versions-table-container">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Phiên bản</th>
                  <th>Thời gian tải lên</th>
                  <th>Dung lượng tệp</th>
                  <th>Trạng thái</th>
                  <th>Nội dung mẫu</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <span className="ver-pill">v{v.versionNumber}</span>
                      {v.id === material.currentVersionId && (
                        <span className="active-ver-badge">Hiện hành</span>
                      )}
                    </td>
                    <td>{formatDateVN(v.uploadedAt)}</td>
                    <td>{formatFileSize(v.sizeBytes)}</td>
                    <td>
                      <Badge variant="published" label="Sẵn sàng" />
                    </td>
                    <td>
                      <span className="sample-snippet-text">
                        {v.summary || v.contentExcerpt ? (v.summary || v.contentExcerpt)!.substring(0, 45) + '...' : 'Tệp nhị phân chuẩn'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: TIẾN TRÌNH QUÉT & AI */}
      {activeTab === 'xu-ly-ai' && (
        <div className="tab-pane">
          <div className="pipeline-stages-grid">
            {/* Stage 1: Security & Malware Scan */}
            <div className="pipeline-card">
              <div className="stage-top">
                <div className="stage-icon-wrap">
                  <ShieldCheck size={22} className="shield-icon" />
                </div>
                <div>
                  <h3 className="stage-title">1. Quét an ninh & Mã độc</h3>
                  <span className="stage-time">Thời điểm: {formatDateVN(currVer?.uploadedAt || new Date().toISOString())}</span>
                </div>
              </div>

              <div className="stage-status-body">
                <Badge
                  variant={currVer?.scanStatus === 'clean' ? 'ready' : currVer?.scanStatus === 'infected' ? 'error' : 'processing'}
                  label={currVer?.scanStatus === 'clean' ? 'An toàn (Clean)' : currVer?.scanStatus === 'infected' ? 'Phát hiện mã độc (Infected)' : 'Đang quét an ninh'}
                />
                <p className="stage-desc">
                  Kiểm tra toàn bộ chữ ký tệp, macro và liên kết độc hại tự động trước khi cho phép tải xuống.
                </p>
              </div>

              {!isArchived && (
                <div className="stage-action-row">
                  <Button type="button" variant="secondary" onClick={handleRetryScan}>
                    <RotateCcw size={14} />
                    <span>Thử quét lại</span>
                  </Button>
                </div>
              )}
            </div>

            {/* Stage 2: AI Vector Indexing */}
            <div className="pipeline-card">
              <div className="stage-top">
                <div className="stage-icon-wrap">
                  <Bot size={22} className="bot-icon" />
                </div>
                <div>
                  <h3 className="stage-title">2. Lập chỉ mục nội dung AI</h3>
                  <span className="stage-time">Thời điểm: {formatDateVN(currVer?.uploadedAt || new Date().toISOString())}</span>
                </div>
              </div>

              <div className="stage-status-body">
                <Badge
                  variant={currVer?.indexStatus === 'success' ? 'ready' : currVer?.indexStatus === 'error' ? 'error' : 'processing'}
                  label={currVer?.indexStatus === 'success' ? 'Đã lập chỉ mục (Ready)' : currVer?.indexStatus === 'error' ? 'Lỗi lập chỉ mục' : 'Đang trích xuất văn bản'}
                />
                <p className="stage-desc">
                  Trích xuất văn bản thuần và lập vector embeddings giúp sinh viên tra cứu tài liệu ngữ nghĩa.
                </p>
              </div>

              {!isArchived && (
                <div className="stage-action-row">
                  <Button type="button" variant="secondary" onClick={handleRetryIndex}>
                    <RotateCcw size={14} />
                    <span>Thử lập chỉ mục lại</span>
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* AI Draft Generator Box */}
          {!isArchived && (
            <div className="ai-summary-generator-card">
              <div className="gen-left">
                <Sparkles size={24} className="sparkles-icon" />
                <div>
                  <h3 className="gen-title">Tạo bản nháp tóm tắt bằng AI</h3>
                  <p className="gen-desc">
                    Mô hình AI sẽ tự động phân tích toàn bộ tài liệu v{currVer?.versionNumber || 1} và tạo ra bản nháp tóm tắt bài học để giảng viên biên tập, phê duyệt.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="primary"
                isLoading={isGeneratingSummary}
                onClick={handleGenerateSummary}
              >
                <Sparkles size={16} />
                <span>Tạo bản nháp tóm tắt</span>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
