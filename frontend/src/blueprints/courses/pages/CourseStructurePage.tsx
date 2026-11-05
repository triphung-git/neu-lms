import {uiText} from "../../../shared/i18n/translate";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { coursesService, type Chapter, type Course, type Lesson } from '../../../api/coursesService';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, TextAreaField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Edit2,
  Plus,
  Trash2,
} from 'lucide-react';
import './CourseStructurePage.css';

type LessonsByChapter = Record<string, Lesson[]>;

export const CourseStructurePage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();
  const [course, setCourse] = useState<Course | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lessonsByChapter, setLessonsByChapter] = useState<LessonsByChapter>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showChapterModal, setShowChapterModal] = useState(false);
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null);
  const [chapterTitle, setChapterTitle] = useState('');
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [targetChapterId, setTargetChapterId] = useState<string | null>(null);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonDescription, setLessonDescription] = useState('');

  const loadSequence = useRef(0);

  const loadStructure = useCallback(async (): Promise<boolean> => {
    if (!monId) {
      setError(uiText("Thiếu mã môn học."));
      setIsLoading(false);
      return false;
    }

    const sequence = ++loadSequence.current;
    setIsLoading(true);
    setError(null);
    try {
      const [courseData, chapterData] = await Promise.all([
        coursesService.get(monId),
        coursesService.listChapters(monId),
      ]);
      const lessonEntries = await Promise.all(
        chapterData.map(async (chapter) => [
          chapter.id,
          await coursesService.listLessons(monId, chapter.id),
        ] as const),
      );
      if (sequence !== loadSequence.current) return false;
      setCourse(courseData);
      setChapters(chapterData);
      setLessonsByChapter(Object.fromEntries(lessonEntries));
      return true;
    } catch (cause) {
      if (sequence !== loadSequence.current) return false;
      setError(cause instanceof Error ? cause.message : uiText("Không thể tải cấu trúc môn học."));
      return false;
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [monId]);

  useEffect(() => {
    void loadStructure();
    return () => { loadSequence.current += 1; };
  }, [loadStructure]);

  const orderedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    [chapters],
  );
  const isArchived = course?.status === 'archived';

  const runMutation = async (action: () => Promise<unknown>, successMessage: string) => {
    setIsSaving(true);
    try {
      await action();
      if (!(await loadStructure())) return false;
      showNotification('success', successMessage);
      return true;
    } catch (cause) {
      showNotification('error', cause instanceof Error ? cause.message : uiText("Không thể lưu thay đổi."));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const openAddChapter = () => {
    setEditingChapter(null);
    setChapterTitle('');
    setShowChapterModal(true);
  };

  const openEditChapter = (chapter: Chapter) => {
    setEditingChapter(chapter);
    setChapterTitle(chapter.title);
    setShowChapterModal(true);
  };

  const handleSaveChapter = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = chapterTitle.trim();
    if (!title || !course) return;

    const saved = editingChapter
      ? await runMutation(
          () => coursesService.updateChapter(course.id, editingChapter.id, { title }),
          uiText("Đã cập nhật chương."),
        )
      : await runMutation(
          () => coursesService.createChapter(course.id, { title }),
          uiText("Đã thêm chương mới."),
        );

    if (saved) setShowChapterModal(false);
  };

  const handleDeleteChapter = async (chapter: Chapter) => {
    if (!course || !window.confirm(uiText("Bạn có chắc chắn muốn xóa chương này?"))) return;
    await runMutation(
      () => coursesService.deleteChapter(course.id, chapter.id),
      uiText("Đã xóa chương."),
    );
  };

  const moveChapter = async (index: number, direction: 'up' | 'down') => {
    if (!course) return;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= orderedChapters.length) return;
    const next = [...orderedChapters];
    [next[index], next[target]] = [next[target], next[index]];
    await runMutation(
      () => coursesService.reorderChapters(course.id, next.map((chapter) => chapter.id)),
      uiText("Đã thay đổi thứ tự chương."),
    );
  };

  const openAddLesson = (chapterId: string) => {
    setTargetChapterId(chapterId);
    setEditingLesson(null);
    setLessonTitle('');
    setLessonDescription('');
    setShowLessonModal(true);
  };

  const openEditLesson = (lesson: Lesson) => {
    setTargetChapterId(lesson.chapter);
    setEditingLesson(lesson);
    setLessonTitle(lesson.title);
    setLessonDescription(lesson.description || '');
    setShowLessonModal(true);
  };

  const handleSaveLesson = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!course || !targetChapterId || !lessonTitle.trim()) return;

    const content = { title: lessonTitle.trim(), description: lessonDescription.trim() };
    const saved = editingLesson
      ? await runMutation(
          () =>
            coursesService.updateLesson(
              course.id,
              targetChapterId,
              editingLesson.id,
              content,
            ),
          uiText("Đã cập nhật bài học."),
        )
      : await runMutation(
          () => coursesService.createLesson(course.id, targetChapterId, content),
          uiText("Đã thêm bài học mới."),
        );

    if (saved) setShowLessonModal(false);
  };

  const handleDeleteLesson = async (chapterId: string, lesson: Lesson) => {
    if (!course || !window.confirm(uiText("Bạn có chắc chắn muốn xóa bài học này?"))) return;
    await runMutation(
      () => coursesService.deleteLesson(course.id, chapterId, lesson.id),
      uiText("Đã xóa bài học."),
    );
  };

  const moveLesson = async (
    chapterId: string,
    lessons: Lesson[],
    index: number,
    direction: 'up' | 'down',
  ) => {
    if (!course) return;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= lessons.length) return;
    const next = [...lessons];
    [next[index], next[target]] = [next[target], next[index]];
    await runMutation(
      () => coursesService.reorderLessons(course.id, chapterId, next.map((lesson) => lesson.id)),
      uiText("Đã thay đổi thứ tự bài học."),
    );
  };

  if (isLoading) return <LoadingSkeleton lines={6} />;
  if (error) {
    return (
      <ErrorBanner
        title={uiText("Không thể tải cấu trúc môn học")}
        message={error}
        onRetry={() => void loadStructure()}
      />
    );
  }
  if (!course) {
    return (
      <EmptyState
        title={uiText("Không tìm thấy môn học")}
        description={uiText("Môn học không tồn tại hoặc bạn không có quyền truy cập.")}
        action={<Button onClick={() => navigate('/gv/mon-hoc')}>{uiText("Về danh sách môn học")}</Button>}
      />
    );
  }

  return (
    <div className="course-structure-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: uiText("Bàn làm việc"), path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: uiText("Cấu trúc môn học") },
            ]}
          />
          <h1 className="page-main-heading">{uiText("Cấu trúc môn học")}</h1>
          <p className="page-subtitle">
            {uiText("Thiết lập chương, bài học và thứ tự nội dung của học phần.")}</p>
        </div>
        {!isArchived && (
          <Button type="button" variant="primary" onClick={openAddChapter} disabled={isSaving}>
            <Plus size={18} />
            <span>{uiText("Thêm chương mới")}</span>
          </Button>
        )}
      </div>

      {error && (
        <ErrorBanner title={uiText("Không thể cập nhật cấu trúc")} message={error} onRetry={() => void loadStructure()} />
      )}

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>{uiText("Môn học đã lưu trữ: chế độ chỉ đọc, không thể thay đổi cấu trúc.")}</span>
        </div>
      )}

      {orderedChapters.length === 0 ? (
        <EmptyState
          title={uiText("Chưa có chương học nào")}
          description={uiText("Thêm chương đầu tiên để bắt đầu xây dựng đề cương.")}
          action={!isArchived ? (
            <Button variant="primary" onClick={openAddChapter} disabled={isSaving}>
              {uiText("Thêm chương đầu tiên")}</Button>
          ) : undefined}
        />
      ) : (
        <div className="structure-tree-list">
          {orderedChapters.map((chapter, chapterIndex) => {
            const lessons = [...(lessonsByChapter[chapter.id] || [])].sort(
              (a, b) => a.position - b.position || a.id.localeCompare(b.id),
            );

            return (
              <section key={chapter.id} className="chapter-card">
                <header className="chapter-card-header">
                  <div className="chapter-title-group">
                    <span className="chapter-order-badge">{uiText("Chương ")}{chapterIndex + 1}</span>
                    <h2 className="chapter-title-text">{chapter.title}</h2>
                  </div>
                  {!isArchived && (
                    <div className="chapter-actions-group">
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => void moveChapter(chapterIndex, 'up')}
                        disabled={chapterIndex === 0 || isSaving}
                        aria-label={uiText("Di chuyển chương lên trên")}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => void moveChapter(chapterIndex, 'down')}
                        disabled={chapterIndex === orderedChapters.length - 1 || isSaving}
                        aria-label={uiText("Di chuyển chương xuống dưới")}
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => openEditChapter(chapter)}
                        disabled={isSaving}
                        aria-label={uiText("Đổi tên chương")}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn danger"
                        onClick={() => void handleDeleteChapter(chapter)}
                        disabled={isSaving}
                        aria-label={uiText("Xóa chương")}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </header>

                <div className="chapter-body">
                  {lessons.length === 0 ? (
                    <p className="no-lessons-text">{uiText("Chưa có bài học nào trong chương này.")}</p>
                  ) : (
                    <ul className="lessons-sublist">
                      {lessons.map((lesson, lessonIndex) => (
                        <li key={lesson.id} className="lesson-row-item">
                          <div className="lesson-left">
                            <BookOpen size={18} className="lesson-icon" />
                            <div className="lesson-info">
                              <strong className="lesson-item-title">
                                {uiText("Bài ")}{lessonIndex + 1}: {lesson.title}
                              </strong>
                              {lesson.description && (
                                <p className="lesson-item-desc">{lesson.description}</p>
                              )}
                            </div>
                          </div>
                          {!isArchived && (
                            <div className="lesson-actions-group">
                              <button
                                type="button"
                                className="icon-action-btn"
                                onClick={() => void moveLesson(chapter.id, lessons, lessonIndex, 'up')}
                                disabled={lessonIndex === 0 || isSaving}
                                aria-label={uiText("Di chuyển bài lên trên")}
                              >
                                <ArrowUp size={15} />
                              </button>
                              <button
                                type="button"
                                className="icon-action-btn"
                                onClick={() => void moveLesson(chapter.id, lessons, lessonIndex, 'down')}
                                disabled={lessonIndex === lessons.length - 1 || isSaving}
                                aria-label={uiText("Di chuyển bài xuống dưới")}
                              >
                                <ArrowDown size={15} />
                              </button>
                              <button
                                type="button"
                                className="icon-action-btn"
                                onClick={() => openEditLesson(lesson)}
                                disabled={isSaving}
                                aria-label={uiText("Chỉnh sửa bài học")}
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                type="button"
                                className="icon-action-btn danger"
                                onClick={() => void handleDeleteLesson(chapter.id, lesson)}
                                disabled={isSaving}
                                aria-label={uiText("Xóa bài học")}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!isArchived && (
                    <div className="add-lesson-row">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => openAddLesson(chapter.id)}
                        disabled={isSaving}
                      >
                        <Plus size={16} />
                        <span>{uiText("Thêm bài học vào chương này")}</span>
                      </Button>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {showChapterModal && (
        <Modal
          title={editingChapter ? uiText("Sửa tên chương") : uiText("Thêm chương mới")}
          isOpen={showChapterModal}
          onClose={() => setShowChapterModal(false)}
        >
          <form onSubmit={(event) => void handleSaveChapter(event)} className="modal-form-body">
            <TextField
              label={uiText("Tiêu đề chương")}
              required
              value={chapterTitle}
              onChange={(event) => setChapterTitle(event.target.value)}
              placeholder={uiText("Ví dụ: Chương 1: Tổng quan")}
            />
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowChapterModal(false)}
                disabled={isSaving}
              >
                {uiText("Hủy bỏ")}</Button>
              <Button type="submit" variant="primary" isLoading={isSaving}>
                {editingChapter ? uiText("Lưu thay đổi") : uiText("Thêm chương")}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showLessonModal && (
        <Modal
          title={editingLesson ? uiText("Sửa bài học") : uiText("Thêm bài học mới")}
          isOpen={showLessonModal}
          onClose={() => setShowLessonModal(false)}
        >
          <form onSubmit={(event) => void handleSaveLesson(event)} className="modal-form-body">
            <TextField
              label={uiText("Tiêu đề bài học")}
              required
              value={lessonTitle}
              onChange={(event) => setLessonTitle(event.target.value)}
              placeholder={uiText("Ví dụ: Bài 1: Khái niệm cơ bản")}
            />
            <TextAreaField
              label={uiText("Mô tả bài học")}
              value={lessonDescription}
              onChange={(event) => setLessonDescription(event.target.value)}
              placeholder={uiText("Tóm tắt nội dung chính hoặc yêu cầu chuẩn bị...")}
              rows={3}
            />
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowLessonModal(false)}
                disabled={isSaving}
              >
                {uiText("Hủy bỏ")}</Button>
              <Button type="submit" variant="primary" isLoading={isSaving}>
                {editingLesson ? uiText("Lưu thay đổi") : uiText("Thêm bài học")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
