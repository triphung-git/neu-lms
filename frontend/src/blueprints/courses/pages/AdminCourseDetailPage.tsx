import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { adminService, type AdminAccountListItem } from '../../../api/adminService';
import {
  coursesService,
  type Chapter,
  type Course,
  type Lesson,
} from '../../../api/coursesService';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { Archive, AlertTriangle, BookOpen, FolderTree, Info, UserCheck } from 'lucide-react';
import './AdminCourseDetailPage.css';

type ChapterWithLessons = Chapter & { lessons: Lesson[] };

export const AdminCourseDetailPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [chapters, setChapters] = useState<ChapterWithLessons[]>([]);
  const [teachers, setTeachers] = useState<AdminAccountListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const activeTab = searchParams.get('tab') === 'cau-truc' ? 'cau-truc' : 'tong-quan';

  const loadSequence = useRef(0);

  const loadData = useCallback(async () => {
    if (!monId) {
      setError('Thiếu mã môn học.');
      setIsLoading(false);
      return;
    }

    const sequence = ++loadSequence.current;
    setIsLoading(true);
    setError(null);
    try {
      const [courseData, chapterData, teacherPage] = await Promise.all([
        coursesService.get(monId),
        coursesService.listChapters(monId),
        adminService.listAccounts({
          role: 'teacher',
          is_active: true,
          email_verified: true,
          page: 1,
          page_size: 100,
        }),
      ]);
      const lessons = await Promise.all(
        chapterData.map((chapter) => coursesService.listLessons(monId, chapter.id)),
      );
      if (sequence !== loadSequence.current) return;
      setCourse(courseData);
      setChapters(
        chapterData.map((chapter, index) => ({ ...chapter, lessons: lessons[index] })),
      );

      const teacherAccounts = [...teacherPage.items];
      for (let page = 2; page <= teacherPage.pagination.total_pages; page += 1) {
        const nextPage = await adminService.listAccounts({
          role: 'teacher',
          is_active: true,
          email_verified: true,
          page,
          page_size: 100,
        });
        teacherAccounts.push(...nextPage.items);
      }
      if (sequence !== loadSequence.current) return;
      setTeachers(teacherAccounts);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Không thể tải thông tin môn học.');
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [monId]);

  useEffect(() => {
    void loadData();
    return () => { loadSequence.current += 1; };
  }, [loadData]);

  const handleTransfer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!course || !selectedTeacherId) return;
    setIsSaving(true);
    try {
      const updated = await coursesService.transferTeacher(course.id, selectedTeacherId);
      setCourse(updated);
      const newTeacher = teachers.find((teacher) => teacher.id === selectedTeacherId);
      showNotification(
        'success',
        `Đã chuyển môn học cho ${newTeacher?.display_name || newTeacher?.email || 'giảng viên mới'}.`,
      );
      setShowTransferModal(false);
    } catch (cause) {
      showNotification(
        'error',
        cause instanceof Error ? cause.message : 'Không thể chuyển giảng viên.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!course) return;
    setIsSaving(true);
    try {
      setCourse(await coursesService.archive(course.id));
      showNotification('success', `Đã lưu trữ môn học "${course.name}".`);
      setShowArchiveModal(false);
    } catch (cause) {
      showNotification(
        'error',
        cause instanceof Error ? cause.message : 'Không thể lưu trữ môn học.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const selectTab = (tab: 'tong-quan' | 'cau-truc') => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  if (isLoading) return <LoadingSkeleton lines={7} />;
  if (error) {
    return (
      <ErrorBanner
        title="Không thể tải môn học"
        message={error}
        onRetry={() => void loadData()}
      />
    );
  }
  if (!course) {
    return (
      <div className="admin-detail-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại hoặc bạn không có quyền truy cập."
          action={<Button onClick={() => navigate('/ad/mon-hoc')}>Về danh mục môn học</Button>}
        />
      </div>
    );
  }

  const isArchived = course.status === 'archived';
  const lessonCount = chapters.reduce((total, chapter) => total + chapter.lessons.length, 0);
  const currentTeacher = teachers.find((teacher) => teacher.id === course.teacher);

  return (
    <div className="admin-course-detail-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Môn học toàn trường', path: '/ad/mon-hoc' },
            { label: `${course.code} — ${course.name}` },
          ]}
        />
        <div className="title-row">
          <span className="code-badge">{course.code}</span>
          <h1 className="course-title">{course.name}</h1>
          <Badge
            variant={isArchived ? 'archived' : 'published'}
            label={isArchived ? 'Đã lưu trữ' : 'Đang mở'}
          />
        </div>
        <p className="course-meta">
          <span>Học kỳ: <strong>{course.term}</strong></span>
          <span className="dot">•</span>
          <span>Giảng viên: <strong>{currentTeacher?.display_name || course.teacher_name}</strong></span>
        </p>
      </div>

      <section className="admin-ops-card">
        <div className="ops-card-header">
          <div className="ops-title-wrap">
            <UserCheck size={20} className="ops-icon" />
            <div>
              <h2 className="ops-title">Thao tác quản trị môn học</h2>
              <p className="ops-desc">
                Nội dung học phần chỉ đọc. Quản trị viên không biên soạn môn hoặc truy cập học liệu.
              </p>
            </div>
          </div>
          <div className="ops-actions-group">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSelectedTeacherId(course.teacher);
                setShowTransferModal(true);
              }}
              disabled={isArchived}
            >
              <UserCheck size={16} />
              <span>Điều chuyển giảng viên</span>
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => setShowArchiveModal(true)}
              disabled={isArchived}
            >
              <Archive size={16} />
              <span>{isArchived ? 'Đã lưu trữ' : 'Cưỡng chế lưu trữ'}</span>
            </Button>
          </div>
        </div>
      </section>

      <nav className="admin-tabs-nav" aria-label="Thông tin môn học">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'tong-quan' ? 'active' : ''}`}
          onClick={() => selectTab('tong-quan')}
        >
          <BookOpen size={16} />
          <span>Tổng quan</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'cau-truc' ? 'active' : ''}`}
          onClick={() => selectTab('cau-truc')}
        >
          <FolderTree size={16} />
          <span>Cấu trúc ({chapters.length})</span>
        </button>
      </nav>

      {activeTab === 'tong-quan' ? (
        <div className="tab-pane">
          <div className="meta-stats-grid">
            <div className="stat-card">
              <span className="stat-val">{course.active_member_count}</span>
              <span className="stat-lbl">Sinh viên đang tham gia</span>
            </div>
            <div className="stat-card">
              <span className="stat-val">{chapters.length}</span>
              <span className="stat-lbl">Chương</span>
            </div>
            <div className="stat-card">
              <span className="stat-val">{lessonCount}</span>
              <span className="stat-lbl">Bài học</span>
            </div>
          </div>
          <div className="info-section-card">
            <h3 className="section-title">Mô tả học phần</h3>
            <p className="desc-text">{course.description || 'Chưa có mô tả môn học.'}</p>
          </div>
          {isArchived && <div className="readonly-banner"><Info size={18} />Môn học đang ở chế độ chỉ đọc.</div>}
        </div>
      ) : (
        <div className="tab-pane">
          <div className="readonly-banner">
            <Info size={18} />
            <span>Đề cương được hiển thị chỉ đọc cho Quản trị viên.</span>
          </div>
          {chapters.length === 0 ? (
            <EmptyState
              title="Chưa có cấu trúc đề cương"
              description="Giảng viên chưa tạo chương hoặc bài học."
            />
          ) : (
            <div className="structure-readonly-tree">
              {chapters.map((chapter, index) => (
                <div key={chapter.id} className="ch-readonly-card">
                  <h3 className="ch-title">Chương {index + 1}: {chapter.title}</h3>
                  {chapter.lessons.length === 0 ? (
                    <p className="empty-sub">Chưa có bài học.</p>
                  ) : (
                    <ul className="lessons-readonly-list">
                      {chapter.lessons.map((lesson, lessonIndex) => (
                        <li key={lesson.id} className="lesson-readonly-item">
                          <BookOpen size={16} />
                          <span>Bài {lessonIndex + 1}: {lesson.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showTransferModal && (
        <Modal
          title="Điều chuyển giảng viên phụ trách"
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
        >
          <form onSubmit={(event) => void handleTransfer(event)} className="modal-form-stack">
            <p className="modal-intro">
              Chọn giảng viên đã xác minh email và được cấp quyền giảng dạy.
            </p>
            <SelectField
              label="Giảng viên tiếp nhận"
              required
              value={selectedTeacherId}
              onChange={(event) => setSelectedTeacherId(event.target.value)}
              options={teachers.map((teacher) => ({
                value: teacher.id,
                label: `${teacher.display_name || teacher.email} (${teacher.email})`,
              }))}
            />
            {teachers.length === 0 && (
              <p role="status">Không có giảng viên hoạt động, đã xác minh phù hợp.</p>
            )}
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowTransferModal(false)}
                disabled={isSaving}
              >
                Hủy bỏ
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isSaving}
                disabled={teachers.length === 0}
              >
                Xác nhận chuyển giao
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showArchiveModal && (
        <Modal
          title="Xác nhận cưỡng chế lưu trữ"
          isOpen={showArchiveModal}
          onClose={() => setShowArchiveModal(false)}
        >
          <div className="modal-form-stack">
            <p>
              Môn học <strong>{course.code} — {course.name}</strong> sẽ chuyển sang chế độ chỉ đọc.
            </p>
            <div className="archive-alert-box">
              <AlertTriangle size={20} />
              <span>Thao tác này không thể hoàn tác trong phạm vi hiện tại.</span>
            </div>
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowArchiveModal(false)}
                disabled={isSaving}
              >
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="danger"
                isLoading={isSaving}
                onClick={() => void handleArchive()}
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
