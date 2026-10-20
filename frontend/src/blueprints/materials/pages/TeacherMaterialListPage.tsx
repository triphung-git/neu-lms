import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotification } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import type { Material, MaterialVersion, Course, Lesson } from '../../../shared/kernel/types';
import {
  Upload,
  Eye,
  AlertTriangle,
  ArrowRight
} from 'lucide-react';
import './TeacherMaterialListPage.css';

export const TeacherMaterialListPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { courses, lessons, materials, materialVersions, updateMaterial } = useDatabase();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();

  const course = courses.find((c: Course) => c.id === monId || c.code.toLowerCase() === monId?.toLowerCase());
  const isArchived = course?.status === 'archived';

  const filterLesson = searchParams.get('bai') || 'all';
  const filterType = searchParams.get('loai') || 'all';
  const filterVis = searchParams.get('quyen') || 'all';

  // Publish to class confirmation modal
  const [pendingVisibilityChange, setPendingVisibilityChange] = useState<{
    materialId: string;
    newVis: 'draft' | 'class' | 'hidden';
    materialTitle: string;
  } | null>(null);

  const courseLessons = useMemo(() => {
    return lessons;
  }, [lessons]);

  const courseMaterials = useMemo(() => {
    if (!course) return [];
    return materials.filter((m: Material) => m.courseId === course.id);
  }, [materials, course]);

  const enrichedMaterials = useMemo(() => {
    return courseMaterials.map((m: Material) => {
      const ver = materialVersions.find((v: MaterialVersion) => v.id === m.currentVersionId);
      const ext = ver?.filename ? ver.filename.split('.').pop()?.toUpperCase() || 'PDF' : 'PDF';
      return {
        material: m,
        currentVersion: ver,
        fileType: ext,
        versionNumber: ver?.versionNumber || 1,
        scanStatus: ver?.scanStatus || 'clean',
        indexStatus: ver?.indexStatus || 'success',
        updatedAt: ver?.uploadedAt || new Date().toISOString(),
      };
    });
  }, [courseMaterials, materialVersions]);

  const filteredMaterials = useMemo(() => {
    return enrichedMaterials.filter((item) => {
      const m = item.material;
      if (filterLesson !== 'all' && m.lessonId !== filterLesson) return false;
      if (filterType !== 'all' && item.fileType.toUpperCase() !== filterType.toUpperCase()) return false;
      if (filterVis !== 'all' && m.visibility !== filterVis) return false;
      return true;
    });
  }, [enrichedMaterials, filterLesson, filterType, filterVis]);

  if (!course) {
    return (
      <div className="materials-list-container">
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

  const handleLessonFilter = (lId: string) => {
    const next = new URLSearchParams(searchParams);
    if (lId === 'all') next.delete('bai');
    else next.set('bai', lId);
    setSearchParams(next);
  };

  const handleTypeFilter = (t: string) => {
    const next = new URLSearchParams(searchParams);
    if (t === 'all') next.delete('loai');
    else next.set('loai', t);
    setSearchParams(next);
  };

  const handleVisFilter = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v === 'all') next.delete('quyen');
    else next.set('quyen', v);
    setSearchParams(next);
  };

  const handleTriggerVisibility = (mat: Material, newVis: 'draft' | 'class' | 'hidden') => {
    if (newVis === 'class') {
      setPendingVisibilityChange({
        materialId: mat.id,
        newVis: 'class',
        materialTitle: mat.title
      });
      return;
    }

    const res = updateMaterial(mat.id, { visibility: newVis });
    if (res.ok) {
      notifySuccess(`Đã chuyển quyền hiển thị học liệu sang "${newVis === 'draft' ? 'Bản nháp' : 'Tạm ẩn'}".`);
    } else {
      notifyError(res.error?.message || 'Có lỗi xảy ra');
    }
  };

  const handleConfirmPublishToClass = () => {
    if (!pendingVisibilityChange) return;

    const targetMat = materials.find((m) => m.id === pendingVisibilityChange.materialId);
    const publishedIds = targetMat?.publishedVersionIds ? [...targetMat.publishedVersionIds] : [];
    if (targetMat?.currentVersionId && !publishedIds.includes(targetMat.currentVersionId)) {
      publishedIds.push(targetMat.currentVersionId);
    }

    const res = updateMaterial(pendingVisibilityChange.materialId, {
      visibility: 'class',
      publishedVersionIds: publishedIds,
    });
    if (res.ok) {
      notifySuccess(`Đã công bố học liệu "${pendingVisibilityChange.materialTitle}" cho toàn bộ sinh viên trong lớp.`);
      setPendingVisibilityChange(null);
    } else {
      notifyError(res.error?.message || 'Có lỗi xảy ra');
    }
  };

  return (
    <div className="teacher-materials-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: 'Quản lý học liệu' }
            ]}
          />
          <h1 className="page-main-heading">Học liệu môn học</h1>
          <p className="page-subtitle">
            Tải lên tài liệu giảng dạy, theo dõi quét mã độc an ninh và quản lý quyền hiển thị cho sinh viên.
          </p>
        </div>

        {!isArchived && (
          <Link to={`/gv/mon-hoc/${course.id}/hoc-lieu/tai-len`} className="npc-btn npc-btn-primary">
            <Upload size={18} />
            <span>Tải lên học liệu</span>
          </Link>
        )}
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>
            Môn học đã lưu trữ: Toàn bộ học liệu ở trạng thái chỉ đọc. Không thể tải lên phiên bản mới hoặc thay đổi quyền hiển thị.
          </span>
        </div>
      )}

      {/* Filters Bar */}
      <div className="materials-filter-bar">
        <div className="filter-item">
          <SelectField
            label="Lọc theo bài học"
            value={filterLesson}
            onChange={(e) => handleLessonFilter(e.target.value)}
            options={[
              { value: 'all', label: 'Tất cả bài học' },
              ...courseLessons.map((l: Lesson) => ({ value: l.id, label: l.title }))
            ]}
          />
        </div>

        <div className="filter-item">
          <SelectField
            label="Loại tệp"
            value={filterType}
            onChange={(e) => handleTypeFilter(e.target.value)}
            options={[
              { value: 'all', label: 'Tất cả định dạng' },
              { value: 'pdf', label: 'PDF' },
              { value: 'docx', label: 'DOCX / Word' },
              { value: 'pptx', label: 'PPTX / Slide' },
              { value: 'zip', label: 'ZIP' }
            ]}
          />
        </div>

        <div className="filter-item">
          <SelectField
            label="Quyền hiển thị"
            value={filterVis}
            onChange={(e) => handleVisFilter(e.target.value)}
            options={[
              { value: 'all', label: 'Tất cả quyền' },
              { value: 'class', label: 'Công khai cả lớp' },
              { value: 'draft', label: 'Bản nháp riêng tư' },
              { value: 'hidden', label: 'Tạm ẩn' }
            ]}
          />
        </div>
      </div>

      {/* Table */}
      {filteredMaterials.length === 0 ? (
        <EmptyState
          title="Chưa có học liệu"
          description="Chưa có tài liệu nào trong môn học này hoặc không có tài liệu khớp với bộ lọc."
          action={
            !isArchived ? (
              <Button variant="primary" onClick={() => navigate(`/gv/mon-hoc/${course.id}/hoc-lieu/tai-len`)}>
                Tải lên học liệu đầu tiên
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="materials-table-wrapper">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Tên học liệu</th>
                <th>Bài học</th>
                <th>Loại tệp</th>
                <th>Phiên bản</th>
                <th>Quét an ninh</th>
                <th>Chỉ mục AI</th>
                <th>Quyền hiển thị</th>
                <th>Cập nhật</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredMaterials.map(({ material: mat, fileType, versionNumber, scanStatus, indexStatus, updatedAt }) => {
                const l = lessons.find((lsn: Lesson) => lsn.id === mat.lessonId);
                return (
                  <tr key={mat.id}>
                    <td>
                      <Link to={`/gv/hoc-lieu/${mat.id}`} className="mat-title-link">
                        <strong>{mat.title}</strong>
                      </Link>
                    </td>
                    <td>{l ? l.title : '—'}</td>
                    <td>
                      <span className="file-badge">{fileType}</span>
                    </td>
                    <td>v{versionNumber}</td>
                    <td>
                      <Badge
                        variant={scanStatus === 'clean' ? 'ready' : scanStatus === 'infected' ? 'error' : 'processing'}
                        label={scanStatus === 'clean' ? 'Sạch' : scanStatus === 'infected' ? 'Mã độc' : 'Đang quét'}
                      />
                    </td>
                    <td>
                      <Badge
                        variant={indexStatus === 'success' ? 'ready' : indexStatus === 'error' ? 'error' : 'processing'}
                        label={indexStatus === 'success' ? 'Đã index' : indexStatus === 'error' ? 'Lỗi index' : 'Chờ xử lý'}
                      />
                    </td>
                    <td>
                      {!isArchived ? (
                        <select
                          className="vis-select-dropdown"
                          value={mat.visibility}
                          onChange={(e) => handleTriggerVisibility(mat, e.target.value as any)}
                        >
                          <option value="draft">Bản nháp</option>
                          <option value="class">Cả lớp</option>
                          <option value="hidden">Tạm ẩn</option>
                        </select>
                      ) : (
                        <Badge
                          variant={mat.visibility === 'class' ? 'published' : 'draft'}
                          label={mat.visibility === 'class' ? 'Cả lớp' : 'Bản nháp'}
                        />
                      )}
                    </td>
                    <td>{formatDateVN(updatedAt)}</td>
                    <td>
                      <Link to={`/gv/hoc-lieu/${mat.id}`} className="npc-btn npc-btn-secondary npc-btn-sm">
                        <span>Chi tiết</span>
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Confirm Publish to Class */}
      {pendingVisibilityChange && (
        <Modal
          title="Xác nhận công bố học liệu cho cả lớp"
          isOpen={Boolean(pendingVisibilityChange)}
          onClose={() => setPendingVisibilityChange(null)}
        >
          <div className="publish-modal-content">
            <p>
              Bạn sắp công bố tài liệu <strong>"{pendingVisibilityChange.materialTitle}"</strong> cho toàn bộ sinh viên đang học môn <strong>{course.name} ({course.code})</strong>.
            </p>
            <div className="alert-notice-box">
              <Eye size={18} />
              <span>
                Sinh viên trong lớp sẽ có thể xem, tải xuống và tương tác hỏi đáp với Trợ lý AI dựa trên nội dung tài liệu này.
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setPendingVisibilityChange(null)}>
                Hủy bỏ
              </Button>
              <Button type="button" variant="primary" onClick={handleConfirmPublishToClass}>
                Xác nhận công bố
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
