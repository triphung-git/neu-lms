import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import {
  Users,
  FolderTree,
  FileText,
  ClipboardList,
  Award,
  Bell,
  Archive,
  AlertTriangle,
  Clock
} from 'lucide-react';
import './TeacherCourseOverviewPage.css';

export const TeacherCourseOverviewPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const { courses, chapters, lessons, materials, assignments, submissions, memberships, users, archiveCourse } = useDatabase();
  const { currentUser } = useSession();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const course = courses.find(c => c.id === monId);

  if (!course) {
    return (
      <div className="teacher-overview-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại hoặc đã bị xóa."
          action={
            <Button variant="primary" onClick={() => navigate('/gv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  const isTeacher = course.teacherId === currentUser?.id;
  const isArchived = course.status === 'archived';
  const teacherUser = users.find(u => u.id === course.teacherId);

  const studentCount = memberships.filter(
    m => m.courseId === monId && m.status === 'active'
  ).length;

  const courseChapters = chapters.filter(ch => ch.courseId === monId);
  const chIds = new Set(courseChapters.map(ch => ch.id));
  const courseLessons = lessons.filter(l => chIds.has(l.chapterId));

  const courseMaterials = materials.filter(m => m.courseId === monId);
  const courseAssignments = assignments.filter(a => a.courseId === monId);
  const courseAssIds = new Set(courseAssignments.map(a => a.id));

  const pendingSubmissions = submissions.filter(
    s => courseAssIds.has(s.assignmentId) && (s.gradingStatus === 'ungraded' || s.gradingStatus === 'in_progress')
  ).length;

  const handleArchive = () => {
    setIsArchiving(true);
    const res = archiveCourse(course.id);
    setIsArchiving(false);
    setShowArchiveModal(false);

    if (res.ok) {
      showNotification('success', `Đã lưu trữ môn học "${course.name}".`);
    } else {
      showNotification('error', res.error?.message || 'Không thể lưu trữ môn học.');
    }
  };

  return (
    <div className="teacher-overview-page">
      <div className="overview-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: 'Môn học', path: '/gv/mon-hoc' },
              { label: `${course.code} — ${course.name}` }
            ]}
          />
          <div className="title-with-badge">
            <span className="course-code-pill">{course.code}</span>
            <h1 className="course-main-title">{course.name}</h1>
            <Badge
              variant={isArchived ? 'archived' : 'published'}
              label={isArchived ? 'Đã lưu trữ' : 'Đang mở'}
            />
          </div>
          <p className="course-meta-text">
            <span>Học kỳ: <strong>{course.term}</strong></span>
            <span className="dot">•</span>
            <span>Giảng viên: <strong>{teacherUser?.fullName || 'Giảng viên'}</strong></span>
          </p>
        </div>

        {!isArchived && isTeacher && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowArchiveModal(true)}
          >
            <Archive size={16} />
            <span>Lưu trữ môn học</span>
          </Button>
        )}
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={22} />
          <div>
            <strong>Môn học này đã được lưu trữ (Chỉ đọc)</strong>
            <p>
              Toàn bộ đề cương, học liệu, bài tập và bảng điểm đang ở chế độ lưu trữ. Mọi hành động thêm mới hoặc sửa đổi đều bị khóa.
            </p>
          </div>
        </div>
      )}

      {/* Metrics Row */}
      <div className="metrics-summary-grid">
        <div className="metric-box">
          <div className="metric-icon blue"><Users size={20} /></div>
          <div className="metric-data">
            <span className="metric-val">{studentCount}</span>
            <span className="metric-lbl">Sinh viên ghi danh</span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon cyan"><FolderTree size={20} /></div>
          <div className="metric-data">
            <span className="metric-val">{courseChapters.length} / {courseLessons.length}</span>
            <span className="metric-lbl">Chương / Bài học</span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon purple"><FileText size={20} /></div>
          <div className="metric-data">
            <span className="metric-val">{courseMaterials.length}</span>
            <span className="metric-lbl">Học liệu đã tải lên</span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon orange"><ClipboardList size={20} /></div>
          <div className="metric-data">
            <span className="metric-val">{courseAssignments.length}</span>
            <span className="metric-lbl">Bài tập học phần</span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon red"><Clock size={20} /></div>
          <div className="metric-data">
            <span className="metric-val">{pendingSubmissions}</span>
            <span className="metric-lbl">Bài nộp chờ chấm</span>
          </div>
        </div>
      </div>

      {/* Hub Modules Navigation */}
      <section className="hub-section">
        <h2 className="section-title">Lối vào các phân hệ quản lý</h2>
        <div className="hub-cards-grid">
          <Link to={`/gv/mon-hoc/${course.id}/cau-truc`} className="hub-nav-card">
            <div className="hub-card-icon"><FolderTree size={24} /></div>
            <div className="hub-card-body">
              <h3 className="hub-card-title">Cấu trúc môn học</h3>
              <p className="hub-card-desc">Thiết lập cây chương mục, các bài giảng và sắp xếp trình tự học.</p>
            </div>
            <span className="hub-card-arrow">Truy cập →</span>
          </Link>

          <Link to={`/gv/mon-hoc/${course.id}/thanh-vien`} className="hub-nav-card">
            <div className="hub-card-icon"><Users size={24} /></div>
            <div className="hub-card-body">
              <h3 className="hub-card-title">Danh sách sinh viên</h3>
              <p className="hub-card-desc">Thêm sinh viên theo danh sách email, quản lý danh sách lớp.</p>
            </div>
            <span className="hub-card-arrow">Truy cập →</span>
          </Link>

          <Link to={`/gv/mon-hoc/${course.id}/hoc-lieu`} className="hub-nav-card">
            <div className="hub-card-icon"><FileText size={24} /></div>
            <div className="hub-card-body">
              <h3 className="hub-card-title">Quản lý học liệu</h3>
              <p className="hub-card-desc">Tải lên slide, tài liệu PDF, kiểm tra quét mã độc và lập chỉ mục AI.</p>
            </div>
            <span className="hub-card-arrow">Truy cập →</span>
          </Link>

          <Link to={`/gv/mon-hoc/${course.id}/bai-tap`} className="hub-nav-card">
            <div className="hub-card-icon"><ClipboardList size={24} /></div>
            <div className="hub-card-body">
              <h3 className="hub-card-title">Bài tập & Bài nộp</h3>
              <p className="hub-card-desc">Soạn bài tập, thiết lập tiêu chí chấm rubric và chấm điểm bài nộp.</p>
            </div>
            <span className="hub-card-arrow">Truy cập →</span>
          </Link>

          <Link to={`/gv/mon-hoc/${course.id}/diem`} className="hub-nav-card">
            <div className="hub-card-icon"><Award size={24} /></div>
            <div className="hub-card-body">
              <h3 className="hub-card-title">Bảng điểm tổng hợp</h3>
              <p className="hub-card-desc">Ma trận điểm chi tiết của toàn bộ sinh viên qua các bài tập.</p>
            </div>
            <span className="hub-card-arrow">Truy cập →</span>
          </Link>

          <Link to={`/gv/thong-bao?mon=${course.id}`} className="hub-nav-card">
            <div className="hub-card-icon"><Bell size={24} /></div>
            <div className="hub-card-body">
              <h3 className="hub-card-title">Thông báo môn học</h3>
              <p className="hub-card-desc">Đăng tải thông báo quan trọng đến sinh viên trong lớp học phần.</p>
            </div>
            <span className="hub-card-arrow">Truy cập →</span>
          </Link>
        </div>
      </section>

      {/* Confirmation Modal for Archiving */}
      {showArchiveModal && (
        <Modal
          title="Xác nhận lưu trữ môn học"
          isOpen={showArchiveModal}
          onClose={() => setShowArchiveModal(false)}
        >
          <div className="archive-modal-content">
            <p>
              Bạn có chắc chắn muốn lưu trữ môn học <strong>{course.code} — {course.name}</strong>?
            </p>
            <div className="archive-notice-box">
              <AlertTriangle size={18} />
              <span>
                Sau khi lưu trữ, môn học sẽ chuyển sang chế độ <strong>chỉ đọc vĩnh viễn</strong>. Giảng viên và sinh viên sẽ không thể nộp bài, chỉnh sửa điểm số hoặc tải thêm học liệu mới.
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button
                variant="secondary"
                onClick={() => setShowArchiveModal(false)}
                disabled={isArchiving}
              >
                Hủy bỏ
              </Button>
              <Button
                variant="danger"
                isLoading={isArchiving}
                onClick={handleArchive}
              >
                Xác nhận lưu trữ
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
