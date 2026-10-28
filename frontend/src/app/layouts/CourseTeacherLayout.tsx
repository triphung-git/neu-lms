import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useParams, useNavigate, useLocation } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { coursesService, type Course } from '../../api/coursesService';
import { useNotification } from '../providers/NotificationContext';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../shared/ui/LoadingSkeleton';
import { Modal } from '../../shared/ui/Modal';
import { TextAreaField, TextField } from '../../shared/ui/TextField';
import { Archive, ArrowLeft, Edit2 } from 'lucide-react';
import './CourseTeacherLayout.css';

export const CourseTeacherLayout: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();
  const location = useLocation();
  const [course, setCourse] = useState<Course | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [courseTerm, setCourseTerm] = useState('');
  const [courseDescription, setCourseDescription] = useState('');

  const loadSequence = useRef(0);

  const loadCourse = useCallback(async () => {
    if (!monId) {
      setLoadError('Thiếu mã môn học.');
      setIsLoading(false);
      return;
    }

    const sequence = ++loadSequence.current;
    setIsLoading(true);
    setLoadError(null);
    setIsNotFound(false);
    try {
      const result = await coursesService.get(monId);
      if (sequence !== loadSequence.current) return;
      setCourse(result);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setCourse(null);
      if (error instanceof ApiError && error.status === 404) {
        setIsNotFound(true);
      } else {
        setLoadError(error instanceof Error ? error.message : 'Không thể tải thông tin môn học.');
      }
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [monId]);

  useEffect(() => {
    void loadCourse();
    return () => { loadSequence.current += 1; };
  }, [loadCourse]);

  const handleConfirmArchive = async () => {
    if (!course) return;

    setIsSaving(true);
    try {
      setCourse(await coursesService.archive(course.id));
      notifySuccess(`Đã chuyển môn ${course.code} sang trạng thái lưu trữ.`);
      setIsArchiveModalOpen(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Không thể lưu trữ môn học.');
    } finally {
      setIsSaving(false);
    }
  };

  const openEditModal = () => {
    setCourseName(course?.name || '');
    setCourseTerm(course?.term || '');
    setCourseDescription(course?.description || '');
    setIsEditModalOpen(true);
  };

  const handleSaveCourse = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!course || !courseName.trim() || !courseTerm.trim()) return;

    setIsSaving(true);
    try {
      const updated = await coursesService.update(course.id, {
        name: courseName.trim(),
        term: courseTerm.trim(),
        description: courseDescription.trim(),
      });
      setCourse(updated);
      notifySuccess('Đã cập nhật thông tin môn học.');
      setIsEditModalOpen(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Không thể cập nhật môn học.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <LoadingSkeleton lines={5} />;
  }

  if (isNotFound) {
    return (
      <div className="course-not-found">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại hoặc bạn không có quyền truy cập."
          action={
            <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  if (loadError || !course) {
    return (
      <div className="course-not-found">
        <ErrorBanner
          title="Không thể tải môn học"
          message={loadError || 'Môn học không tồn tại hoặc bạn không có quyền truy cập.'}
          onRetry={() => void loadCourse()}
        />
        <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
          Về danh sách môn học
        </Button>
      </div>
    );
  }

  const isArchived = course.status === 'archived';
  const navItems = [
    { to: `/gv/mon-hoc/${course.id}`, label: 'Tổng quan', end: true },
    { to: `/gv/mon-hoc/${course.id}/cau-truc`, label: 'Cấu trúc' },
    { to: `/gv/mon-hoc/${course.id}/thanh-vien`, label: 'Thành viên' },
    { to: `/gv/mon-hoc/${course.id}/hoc-lieu`, label: 'Học liệu' },
    { to: `/gv/mon-hoc/${course.id}/bai-tap`, label: 'Bài tập' },
    { to: `/gv/mon-hoc/${course.id}/diem`, label: 'Bảng điểm' },
  ].filter((item) => {
    if (!isArchived) return true;
    return (
      item.to === `/gv/mon-hoc/${course.id}` ||
      item.to.endsWith('/cau-truc') ||
      item.to.endsWith('/thanh-vien') ||
      item.to.endsWith('/hoc-lieu') ||
      item.to.endsWith('/bai-tap')
    );
  });
  const coursePath = `/gv/mon-hoc/${course.id}`;
  const archivedSubroute =
    isArchived &&
    location.pathname !== coursePath &&
    location.pathname !== `${coursePath}/cau-truc` &&
    location.pathname !== `${coursePath}/thanh-vien` &&
    location.pathname !== `${coursePath}/hoc-lieu` &&
    location.pathname !== `${coursePath}/tep-tin` &&
    location.pathname !== `${coursePath}/chinh-sach-tep` &&
    location.pathname !== `${coursePath}/bai-tap` &&
    location.pathname !== `${coursePath}/bai-tap/soan`;

  return (
    <div className="course-layout-shell">
      <div className="course-header-bar">
        <div className="course-header-top">
          <button className="back-link-btn" onClick={() => navigate('/gv/mon-hoc')}>
            <ArrowLeft size={16} />
            <span>Môn của tôi</span>
          </button>
          <div className="course-meta-badges">
            <span className="course-code-pill">{course.code}</span>
            <span className="course-term-pill">{course.term}</span>
            <Badge
              variant={isArchived ? 'archived' : 'published'}
              label={isArchived ? 'Đã lưu trữ' : 'Đang mở'}
            />
          </div>
        </div>

        <div className="course-header-main">
          <div>
            <h1 className="course-title">{course.name}</h1>
            <p className="course-desc">{course.description}</p>
          </div>

          {!isArchived && (
            <div className="course-header-actions">
              <Button
                variant="secondary"
                size="sm"
                icon={<Edit2 size={15} />}
                onClick={openEditModal}
              >
                Sửa thông tin
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Archive size={15} />}
                onClick={() => setIsArchiveModalOpen(true)}
              >
                Lưu trữ môn
              </Button>
            </div>
          )}
        </div>

        {isArchived && (
          <div className="course-archived-banner" role="alert">
            <Archive size={16} />
            <span>
              Môn học đã lưu trữ
              {course.archived_at
                ? ` vào ${new Date(course.archived_at).toLocaleDateString('vi-VN')}`
                : ''}
              . Mọi thao tác thay đổi đã bị khóa.
            </span>
          </div>
        )}

        <nav className="course-subnav" aria-label="Phân hệ môn học">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `course-subnav-link ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="course-content-outlet">
        {archivedSubroute ? (
          <div className="course-archived-banner" role="alert">
            Môn học đã lưu trữ. Khu vực này chưa có chế độ xem lưu trữ khả dụng.
          </div>
        ) : (
          <Outlet key={`${course.id}:${course.updated_at}`} context={{ course, isArchived }} />
        )}
      </div>

      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Sửa thông tin môn học"
      >
        <form onSubmit={(event) => void handleSaveCourse(event)} className="modal-form-stack">
          <TextField
            label="Tên môn học"
            required
            value={courseName}
            onChange={(event) => setCourseName(event.target.value)}
          />
          <TextField
            label="Học kỳ"
            required
            value={courseTerm}
            onChange={(event) => setCourseTerm(event.target.value)}
          />
          <TextAreaField
            label="Mô tả"
            value={courseDescription}
            onChange={(event) => setCourseDescription(event.target.value)}
            rows={4}
          />
          <div className="modal-actions-bar">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsEditModalOpen(false)}
              disabled={isSaving}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" isLoading={isSaving}>
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        title={`Xác nhận lưu trữ môn ${course.code}`}
        description="Môn học sau khi lưu trữ sẽ chuyển sang chế độ chỉ đọc vĩnh viễn và không thể khôi phục."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsArchiveModalOpen(false)}
              disabled={isSaving}
            >
              Hủy
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleConfirmArchive()}
              isLoading={isSaving}
            >
              Xác nhận Lưu trữ
            </Button>
          </>
        }
      >
        <p style={{ color: 'var(--ink-soft)' }}>
          Bạn có chắc chắn muốn lưu trữ lớp học phần{' '}
          <strong>{course.name} ({course.code})</strong>?
        </p>
      </Modal>
    </div>
  );
};
