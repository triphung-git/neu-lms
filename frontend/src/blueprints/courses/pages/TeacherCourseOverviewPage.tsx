import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { coursesService, type Course } from '../../../api/coursesService';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { FolderTree, Users } from 'lucide-react';
import './TeacherCourseOverviewPage.css';

export const TeacherCourseOverviewPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  const [lessonCount, setLessonCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCourse = useCallback(async () => {
    if (!monId) {
      setError('Thiếu mã môn học.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [courseData, chapterData] = await Promise.all([
        coursesService.get(monId),
        coursesService.listChapters(monId),
      ]);
      const lessonLists = await Promise.all(
        chapterData.map((chapter) => coursesService.listLessons(monId, chapter.id)),
      );
      setCourse(courseData);
      setChapterCount(chapterData.length);
      setLessonCount(lessonLists.reduce((total, lessons) => total + lessons.length, 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải thông tin môn học.');
    } finally {
      setIsLoading(false);
    }
  }, [monId]);

  useEffect(() => {
    void loadCourse();
  }, [loadCourse]);

  if (isLoading) return <LoadingSkeleton lines={6} />;
  if (error) {
    return (
      <ErrorBanner
        title="Không thể tải tổng quan môn học"
        message={error}
        onRetry={() => void loadCourse()}
      />
    );
  }
  if (!course) {
    return (
      <EmptyState title="Không tìm thấy môn học" description="Môn học không tồn tại hoặc bạn không có quyền truy cập." />
    );
  }

  return (
    <div className="teacher-overview-page">
      <div className="overview-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: 'Môn học', path: '/gv/mon-hoc' },
              { label: `${course.code} — ${course.name}` },
            ]}
          />
          <div className="title-with-badge">
            <span className="course-code-pill">{course.code}</span>
            <h1 className="course-main-title">{course.name}</h1>
            <Badge
              variant={course.status === 'open' ? 'published' : 'archived'}
              label={course.status === 'open' ? 'Đang mở' : 'Đã lưu trữ'}
            />
          </div>
          <p className="course-meta-text">
            <span>Học kỳ: <strong>{course.term}</strong></span>
            <span className="dot">•</span>
            <span>Giảng viên: <strong>{course.teacher_name || 'Giảng viên phụ trách'}</strong></span>
          </p>
        </div>
      </div>

      {course.status === 'archived' && (
        <div className="archived-warning-alert" role="alert">
          <strong>Môn học đã được lưu trữ — chế độ chỉ đọc.</strong>
        </div>
      )}

      <div className="metrics-summary-grid">
        <div className="metric-box">
          <div className="metric-icon blue"><Users size={20} /></div>
          <div className="metric-data">
            <span className="metric-val">{course.active_member_count}</span>
            <span className="metric-lbl">Sinh viên đang tham gia</span>
          </div>
        </div>
        <div className="metric-box">
          <div className="metric-icon cyan"><FolderTree size={20} /></div>
          <div className="metric-data">
            <span className="metric-val">{chapterCount} / {lessonCount}</span>
            <span className="metric-lbl">Chương / bài học</span>
          </div>
        </div>
      </div>

      <section className="hub-section">
        <h2 className="section-title">Quản lý môn học</h2>
        <div className="hub-cards-grid">
          <Link to={`/gv/mon-hoc/${course.id}/cau-truc`} className="hub-nav-card">
            <div className="hub-card-icon"><FolderTree size={24} /></div>
            <div className="hub-card-body">
              <h3 className="hub-card-title">Cấu trúc môn học</h3>
              <p className="hub-card-desc">Quản lý chương, bài học và thứ tự nội dung.</p>
            </div>
            <span className="hub-card-arrow">Truy cập →</span>
          </Link>
        </div>
      </section>

      <section className="info-section-card">
        <h2 className="section-title">Mô tả học phần</h2>
        <p className="desc-text">{course.description || 'Chưa có mô tả môn học.'}</p>
      </section>

      {course.status === 'archived' && (
        <Button variant="secondary" onClick={() => void loadCourse()}>
          Làm mới trạng thái
        </Button>
      )}
    </div>
  );
};
