import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, TextAreaField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import {
  Plus,
  ArrowUp,
  ArrowDown,
  Edit2,
  Trash2,
  FileText,
  AlertTriangle,
  BookOpen
} from 'lucide-react';
import './CourseStructurePage.css';

export const CourseStructurePage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const {
    courses,
    chapters,
    lessons,
    materials,
    createChapter,
    updateChapter,
    deleteChapter,
    createLesson,
    updateLesson,
    deleteLesson
  } = useDatabase();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const course = courses.find(c => c.id === monId);
  const isArchived = course?.status === 'archived';

  // Modal states
  const [showChapterModal, setShowChapterModal] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState('');

  const [showLessonModal, setShowLessonModal] = useState(false);
  const [targetChapterId, setTargetChapterId] = useState<string | null>(null);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonDesc, setLessonDesc] = useState('');

  if (!course) {
    return (
      <div className="course-structure-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại trên hệ thống."
          action={<Button onClick={() => navigate('/gv/mon-hoc')}>Về danh sách môn học</Button>}
        />
      </div>
    );
  }

  const courseChapters = chapters
    .filter(ch => ch.courseId === monId)
    .sort((a, b) => a.order - b.order);

  // CHAPTER HANDLERS
  const openAddChapter = () => {
    setEditingChapterId(null);
    setChapterTitle('');
    setShowChapterModal(true);
  };

  const openEditChapter = (ch: typeof chapters[0]) => {
    setEditingChapterId(ch.id);
    setChapterTitle(ch.title);
    setShowChapterModal(true);
  };

  const handleSaveChapter = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chapterTitle.trim();
    if (!trimmed) {
      showNotification('error', 'Vui lòng nhập tiêu đề chương.');
      return;
    }

    if (editingChapterId) {
      const res = updateChapter(editingChapterId, { title: trimmed });
      if (res.ok) {
        showNotification('success', 'Đã cập nhật tiêu đề chương.');
        setShowChapterModal(false);
      } else {
        showNotification('error', res.error?.message || 'Lỗi cập nhật chương');
      }
    } else {
      const newOrder = courseChapters.length + 1;
      const res = createChapter({
        id: `chap-${Date.now()}`,
        courseId: course.id,
        title: trimmed,
        order: newOrder
      });
      if (res.ok) {
        showNotification('success', 'Đã thêm chương mới thành công.');
        setShowChapterModal(false);
      } else {
        showNotification('error', res.error?.message || 'Lỗi thêm chương');
      }
    }
  };

  const handleDeleteChapter = (chId: string) => {
    const hasLessons = lessons.some(l => l.chapterId === chId);
    if (hasLessons) {
      showNotification('error', 'Không thể xóa chương đang chứa bài học. Vui lòng chuyển hoặc xóa các bài học trước.');
      return;
    }

    if (window.confirm('Bạn có chắc chắn muốn xóa chương này?')) {
      const res = deleteChapter(chId);
      if (res.ok) {
        showNotification('success', 'Đã xóa chương thành công.');
      } else {
        showNotification('error', res.error?.message || 'Lỗi xóa chương');
      }
    }
  };

  const handleMoveChapter = (chIndex: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? chIndex - 1 : chIndex + 1;
    if (targetIndex < 0 || targetIndex >= courseChapters.length) return;

    const currentCh = courseChapters[chIndex];
    const targetCh = courseChapters[targetIndex];

    updateChapter(currentCh.id, { order: targetCh.order });
    updateChapter(targetCh.id, { order: currentCh.order });
    showNotification('info', 'Đã thay đổi thứ tự chương.');
  };

  // LESSON HANDLERS
  const openAddLesson = (chapterId: string) => {
    setTargetChapterId(chapterId);
    setEditingLessonId(null);
    setLessonTitle('');
    setLessonDesc('');
    setShowLessonModal(true);
  };

  const openEditLesson = (lesson: typeof lessons[0]) => {
    setTargetChapterId(lesson.chapterId);
    setEditingLessonId(lesson.id);
    setLessonTitle(lesson.title);
    setLessonDesc(lesson.description);
    setShowLessonModal(true);
  };

  const handleSaveLesson = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = lessonTitle.trim();
    if (!trimmedTitle) {
      showNotification('error', 'Vui lòng nhập tiêu đề bài học.');
      return;
    }
    if (!targetChapterId) return;

    if (editingLessonId) {
      const res = updateLesson(editingLessonId, {
        title: trimmedTitle,
        description: lessonDesc.trim()
      });
      if (res.ok) {
        showNotification('success', 'Đã cập nhật thông tin bài học.');
        setShowLessonModal(false);
      } else {
        showNotification('error', res.error?.message || 'Lỗi cập nhật bài học');
      }
    } else {
      const chLessons = lessons.filter(l => l.chapterId === targetChapterId);
      const newOrder = chLessons.length + 1;
      const res = createLesson({
        id: `les-${Date.now()}`,
        chapterId: targetChapterId,
        title: trimmedTitle,
        description: lessonDesc.trim(),
        order: newOrder
      });
      if (res.ok) {
        showNotification('success', 'Đã thêm bài học mới thành công.');
        setShowLessonModal(false);
      } else {
        showNotification('error', res.error?.message || 'Lỗi thêm bài học');
      }
    }
  };

  const handleDeleteLesson = (lessonId: string) => {
    const hasMaterials = materials.some(m => m.lessonId === lessonId);
    if (hasMaterials) {
      showNotification('error', 'Không thể xóa bài học đang có học liệu. Vui lòng di chuyển hoặc xóa các học liệu trước.');
      return;
    }

    if (window.confirm('Bạn có chắc chắn muốn xóa bài học này?')) {
      const res = deleteLesson(lessonId);
      if (res.ok) {
        showNotification('success', 'Đã xóa bài học thành công.');
      } else {
        showNotification('error', res.error?.message || 'Lỗi xóa bài học');
      }
    }
  };

  const handleMoveLesson = (chapterId: string, lIndex: number, direction: 'up' | 'down') => {
    const chLessons = lessons
      .filter(l => l.chapterId === chapterId)
      .sort((a, b) => a.order - b.order);

    const targetIndex = direction === 'up' ? lIndex - 1 : lIndex + 1;
    if (targetIndex < 0 || targetIndex >= chLessons.length) return;

    const currentL = chLessons[lIndex];
    const targetL = chLessons[targetIndex];

    updateLesson(currentL.id, { order: targetL.order });
    updateLesson(targetL.id, { order: currentL.order });
    showNotification('info', 'Đã thay đổi thứ tự bài học.');
  };

  return (
    <div className="course-structure-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: 'Cấu trúc môn học' }
            ]}
          />
          <h1 className="page-main-heading">Cấu trúc môn học</h1>
          <p className="page-subtitle">
            Thiết lập danh mục chương và bài học. Học liệu và bài giảng sẽ được gắn tương ứng theo từng bài học.
          </p>
        </div>

        {!isArchived && (
          <Button type="button" variant="primary" onClick={openAddChapter}>
            <Plus size={18} />
            <span>Thêm chương mới</span>
          </Button>
        )}
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>
            Môn học đã lưu trữ: Chế độ chỉ đọc. Không thể thêm, sửa, xóa hoặc thay đổi thứ tự bài học.
          </span>
        </div>
      )}

      {courseChapters.length === 0 ? (
        <EmptyState
          title="Chưa có chương học nào"
          description="Khởi tạo chương học đầu tiên để bắt đầu xây dựng đề cương chi tiết cho môn học."
          action={!isArchived ? (
            <Button variant="primary" onClick={openAddChapter}>
              Thêm chương đầu tiên
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="structure-tree-list">
          {courseChapters.map((ch, chIdx) => {
            const chLessons = lessons
              .filter(l => l.chapterId === ch.id)
              .sort((a, b) => a.order - b.order);

            return (
              <section key={ch.id} className="chapter-card">
                <header className="chapter-card-header">
                  <div className="chapter-title-group">
                    <span className="chapter-order-badge">Chương {chIdx + 1}</span>
                    <h2 className="chapter-title-text">{ch.title}</h2>
                  </div>

                  {!isArchived && (
                    <div className="chapter-actions-group">
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => handleMoveChapter(chIdx, 'up')}
                        disabled={chIdx === 0}
                        aria-label="Di chuyển chương lên trên"
                        title="Di chuyển lên"
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => handleMoveChapter(chIdx, 'down')}
                        disabled={chIdx === courseChapters.length - 1}
                        aria-label="Di chuyển chương xuống dưới"
                        title="Di chuyển xuống"
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => openEditChapter(ch)}
                        aria-label="Đổi tên chương"
                        title="Sửa tên chương"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn danger"
                        onClick={() => handleDeleteChapter(ch.id)}
                        aria-label="Xóa chương"
                        title="Xóa chương"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </header>

                <div className="chapter-body">
                  {chLessons.length === 0 ? (
                    <p className="no-lessons-text">Chưa có bài học nào trong chương này.</p>
                  ) : (
                    <ul className="lessons-sublist">
                      {chLessons.map((lesson, lIdx) => {
                        const matCount = materials.filter(m => m.lessonId === lesson.id).length;
                        return (
                          <li key={lesson.id} className="lesson-row-item">
                            <div className="lesson-left">
                              <BookOpen size={18} className="lesson-icon" />
                              <div className="lesson-info">
                                <strong className="lesson-item-title">
                                  Bài {lIdx + 1}: {lesson.title}
                                </strong>
                                {lesson.description && (
                                  <p className="lesson-item-desc">{lesson.description}</p>
                                )}
                                <div className="lesson-badges-row">
                                  <Link
                                    to={`/gv/mon-hoc/${course.id}/hoc-lieu?bai=${lesson.id}`}
                                    className="lesson-mat-link"
                                  >
                                    <FileText size={14} />
                                    <span>{matCount} học liệu</span>
                                  </Link>
                                </div>
                              </div>
                            </div>

                            {!isArchived && (
                              <div className="lesson-actions-group">
                                <button
                                  type="button"
                                  className="icon-action-btn"
                                  onClick={() => handleMoveLesson(ch.id, lIdx, 'up')}
                                  disabled={lIdx === 0}
                                  aria-label="Di chuyển bài lên"
                                  title="Di chuyển lên"
                                >
                                  <ArrowUp size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-action-btn"
                                  onClick={() => handleMoveLesson(ch.id, lIdx, 'down')}
                                  disabled={lIdx === chLessons.length - 1}
                                  aria-label="Di chuyển bài xuống"
                                  title="Di chuyển xuống"
                                >
                                  <ArrowDown size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-action-btn"
                                  onClick={() => openEditLesson(lesson)}
                                  aria-label="Chỉnh sửa bài học"
                                  title="Sửa bài học"
                                >
                                  <Edit2 size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-action-btn danger"
                                  onClick={() => handleDeleteLesson(lesson.id)}
                                  aria-label="Xóa bài học"
                                  title="Xóa bài học"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {!isArchived && (
                    <div className="add-lesson-row">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => openAddLesson(ch.id)}
                      >
                        <Plus size={16} />
                        <span>Thêm bài học vào chương này</span>
                      </Button>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Chapter Modal */}
      {showChapterModal && (
        <Modal
          title={editingChapterId ? 'Sửa tên chương' : 'Thêm chương mới'}
          isOpen={showChapterModal}
          onClose={() => setShowChapterModal(false)}
        >
          <form onSubmit={handleSaveChapter} className="modal-form-body">
            <TextField
              label="Tiêu đề chương"
              required
              value={chapterTitle}
              onChange={e => setChapterTitle(e.target.value)}
              placeholder="Ví dụ: Chương 1: Tổng quan về hệ thống"
            />
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowChapterModal(false)}>
                Hủy bỏ
              </Button>
              <Button type="submit" variant="primary">
                {editingChapterId ? 'Lưu thay đổi' : 'Thêm chương'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Lesson Modal */}
      {showLessonModal && (
        <Modal
          title={editingLessonId ? 'Sửa bài học' : 'Thêm bài học mới'}
          isOpen={showLessonModal}
          onClose={() => setShowLessonModal(false)}
        >
          <form onSubmit={handleSaveLesson} className="modal-form-body">
            <TextField
              label="Tiêu đề bài học"
              required
              value={lessonTitle}
              onChange={e => setLessonTitle(e.target.value)}
              placeholder="Ví dụ: Bài 1: Khái niệm cơ bản"
            />
            <TextAreaField
              label="Mô tả bài học"
              value={lessonDesc}
              onChange={e => setLessonDesc(e.target.value)}
              placeholder="Tóm tắt nội dung chính hoặc yêu cầu chuẩn bị..."
              rows={3}
            />
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowLessonModal(false)}>
                Hủy bỏ
              </Button>
              <Button type="submit" variant="primary">
                {editingLessonId ? 'Lưu thay đổi' : 'Thêm bài học'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
