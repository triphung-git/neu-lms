import React, { useState } from 'react';
import { Outlet, NavLink, useParams, useNavigate } from 'react-router-dom';
import { useDatabase } from '../providers/DatabaseContext';
import { useSession } from '../providers/SessionContext';
import { useNotification } from '../providers/NotificationContext';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { Modal } from '../../shared/ui/Modal';
import { Archive, ArrowLeft } from 'lucide-react';
import './CourseTeacherLayout.css';

export const CourseTeacherLayout: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const { db, updateDb } = useDatabase();
  const { currentUser } = useSession();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);

  const course = db.courses.find((c) => c.id === monId || c.code.toLowerCase() === monId?.toLowerCase());
  const isOwner = course ? course.teacherId === currentUser?.id : false;
  const isAuthorized = isOwner || currentUser?.role === 'admin';

  if (!course || !isAuthorized) {
    return (
      <div className="course-not-found" role="alert">
        <h2>Không tìm thấy môn học</h2>
        <p>Môn học không tồn tại hoặc bạn không có quyền truy cập.</p>
        <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
          Về danh sách môn của tôi
        </Button>
      </div>
    );
  }

  const isArchived = course.status === 'archived';

  const handleConfirmArchive = () => {
    if (!isOwner && currentUser?.role !== 'admin') {
      notifyError('Bạn không có quyền lưu trữ môn học này.');
      return;
    }
    updateDb(
      (draft) => {
        const c = draft.courses.find((item) => item.id === course.id);
        if (c) {
          c.status = 'archived';
          c.archivedAt = new Date().toISOString();
        }
      },
      { action: 'ARCHIVE_COURSE', entityType: 'Course', entityId: course.id }
    );
    notifySuccess(`Đã chuyển môn ${course.code} sang trạng thái lưu trữ.`);
    setIsArchiveModalOpen(false);
  };

  const navItems = [
    { to: `/gv/mon-hoc/${course.id}`, label: 'Tổng quan', end: true },
    { to: `/gv/mon-hoc/${course.id}/cau-truc`, label: 'Cấu trúc' },
    { to: `/gv/mon-hoc/${course.id}/thanh-vien`, label: 'Thành viên' },
    { to: `/gv/mon-hoc/${course.id}/hoc-lieu`, label: 'Học liệu' },
    { to: `/gv/mon-hoc/${course.id}/bai-tap`, label: 'Bài tập' },
    { to: `/gv/mon-hoc/${course.id}/diem`, label: 'Bảng điểm' },
  ];

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
            <Badge variant={isArchived ? 'archived' : 'published'} label={isArchived ? 'Đã lưu trữ' : 'Đang mở'} />
          </div>
        </div>

        <div className="course-header-main">
          <div>
            <h1 className="course-title">{course.name}</h1>
            <p className="course-desc">{course.description}</p>
          </div>

          {!isArchived && isOwner && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Archive size={15} />}
              onClick={() => setIsArchiveModalOpen(true)}
            >
              Lưu trữ môn
            </Button>
          )}
        </div>

        {isArchived && (
          <div className="course-archived-banner" role="alert">
            <Archive size={16} />
            <span>
              Môn học đã lưu trữ vào {new Date(course.archivedAt || '').toLocaleDateString('vi-VN')}. Mọi thao tác thêm sửa xóa đều bị khóa chỉ đọc.
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
        <Outlet context={{ course, isArchived }} />
      </div>

      <Modal
        isOpen={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        title={`Xác nhận lưu trữ môn ${course.code}`}
        description="Môn học sau khi lưu trữ sẽ chuyển sang chế độ chỉ đọc vĩnh viễn (không khôi phục trong phạm vi này). Giảng viên và sinh viên vẫn xem được nội dung nhưng không thể nộp bài, chấm bài hoặc chỉnh sửa."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsArchiveModalOpen(false)}>
              Hủy
            </Button>
            <Button variant="danger" onClick={handleConfirmArchive}>
              Xác nhận Lưu trữ
            </Button>
          </>
        }
      >
        <p style={{ color: 'var(--ink-soft)' }}>
          Bạn có chắc chắn muốn lưu trữ lớp học phần <strong>{course.name} ({course.code})</strong>?
        </p>
      </Modal>
    </div>
  );
};
