import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { coursesService, type CourseSummaryResponse } from '../../../api/coursesService';
import { Button } from '../../../shared/ui/Button';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { RecentCourseNotices } from './RecentCourseNotices';
import { useRecentGrades, useUpcomingAssignments } from './useRecentGrades';
import {
  BookOpen,
  Clock,
  Award,
  GraduationCap,
  FileText,
  Compass,
} from 'lucide-react';
import './DashboardPages.css';

export const StudentDashboardPage: React.FC = () => {
  const { currentUser } = useSession();
  const grades = useRecentGrades(currentUser?.id);
  const upcoming = useUpcomingAssignments(currentUser?.id);
  const navigate = useNavigate();

  const [summary, setSummary] = useState<CourseSummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);

  const handleRetry = useCallback(() => {
    setRetryCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let isCurrent = true;
    setLoading(true);
    setError(null);

    coursesService
      .getSummary('student')
      .then((data) => {
        if (isCurrent) {
          setSummary(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          const message =
            err instanceof Error
              ? err.message
              : uiText("Không thể tải dữ liệu tổng quan sinh viên từ máy chủ.");
          setError(message);
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [retryCount, currentUser?.id]);

  if (error) return <ErrorBanner title={uiText("Không thể tải dữ liệu tổng quan")} message={error} onRetry={handleRetry} />;

  const recentCourses = summary?.recent_courses ?? [];
  const openEnrolledCount = summary?.open_enrolled_courses ?? 0;

  return (
    <div className="dash-page-container">
      <div className="dash-page-header">
        <div>
          <h1 className="dash-page-title">{uiText("Việc cần làm của tôi")}</h1>
          <p className="dash-page-subtitle">
            {uiText("Xin chào ")}{currentUser?.fullName || uiText("Sinh viên")}{uiText(", theo dõi môn học đang tham gia và tiến độ bài giảng.")}</p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <ErrorBanner
          title={uiText("Không thể tải dữ liệu tổng quan")}
          message={error}
          onRetry={handleRetry}
        />
      )}

      {/* Stat Metric Cards */}
      <div className="stat-cards-row">
        <div
          className="stat-metric-card"
          onClick={() => navigate('/sv/mon-hoc')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate('/sv/mon-hoc');
          }}
        >
          <div className="metric-header">
            <span className="metric-title">{uiText("Môn đang theo học")}</span>
            <GraduationCap size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : openEnrolledCount}
          </span>
          <span className="metric-sub">
            {summary?.archived_enrolled_courses
              ? uiText("{0} môn đã kết thúc",[summary.archived_enrolled_courses])
              : uiText("Môn học đang mở")}
          </span>
        </div>

        <div className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">{uiText("Bài học có thể xem")}</span>
            <FileText size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : (summary?.total_lessons ?? 0)}
          </span>
          <span className="metric-sub">
            {uiText("Trong tổng số ")}{summary?.total_chapters ?? 0} {uiText(" chương học")}</span>
        </div>

        <a className="stat-metric-card" href="#deadlines-heading">
          <div className="metric-header">
            <span className="metric-title">{uiText("Bài chưa nộp trong 7 ngày tới")}</span>
            <Clock size={20} className="text-accent" />
          </div>

          <span className="metric-number">
            {upcoming.data?.total ?? (upcoming.error ? '—' : '…')}
          </span>

          <span className="metric-sub">{uiText("Xem các hạn gần nhất")}</span>
        </a>
        <Link to="/sv/diem" className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">{uiText("Lượt công bố điểm")}</span>
            <Award size={20} className="text-accent" />
          </div>

          <span className="metric-number">
            {grades.data?.pagination.total_items ?? (grades.error ? '—' : '…')}
          </span>

          <span className="metric-sub">{uiText("Mở bảng điểm của tôi")}</span>
        </Link>
          <span className="metric-sub">{uiText("Phân hệ chấm điểm đang hoàn thiện")}</span>
        </div>

      <div className="dash-grid-sections">
        {/* Left Column: Deadlines notice & Enrolled Courses */}
        <div className="dash-col-main">
          {/* Deadlines notice */}
          <section className="dash-card dash-upcoming" aria-labelledby="deadlines-heading">
            <div className="dash-card-header">
              <Clock className="card-title-icon text-accent" />
              <h2 id="deadlines-heading">{uiText("Hạn nộp trong 7 ngày tới")}</h2>
            </div>

            {upcoming.error && (
              <div role="alert">
                <p>{upcoming.error}</p>
                <button type="button" onClick={upcoming.retry}>
                  {uiText("Tải lại hạn nộp")}</button>
              </div>
            )}

            {!upcoming.data && !upcoming.error && (
              <p role="status">{uiText("Đang tải hạn nộp…")}</p>
            )}

            {upcoming.data?.total === 0 && (
              <p>{uiText("Bạn không có bài chưa nộp đến hạn trong 7 ngày tới.")}</p>
            )}

            {upcoming.data && upcoming.data.total > 0 && (
              <>
                <p>{uiText("Hiển thị ")}{upcoming.data.items.length} {uiText(" trên ")}{upcoming.data.total} {uiText(" bài.")}</p>
                <ul>
                  {upcoming.data.items.map(item => (
                    <li key={item.id}>
                      <Link to={`/sv/mon-hoc/${item.course_id}/bai-tap/${item.id}`}>
                        {item.title}
                      </Link>
                      <span>{item.course_name}</span>
                      <time dateTime={item.deadline}>
                        {uiText("Hạn: ")}{new Date(item.deadline).toLocaleString(currentLocale())}
                      </time>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Enrolled Courses */}
          <section className="dash-card" aria-labelledby="courses-heading">
            <div className="dash-card-header">
              <BookOpen className="card-title-icon" />
              <h2 id="courses-heading">
                {uiText("Môn học đang theo học (")}{loading ? '...' : recentCourses.length})
              </h2>
              <Link to="/sv/mon-hoc" className="card-view-all">
                {uiText("Xem tất cả →")}</Link>
            </div>

            {loading ? (
              <LoadingSkeleton lines={3} height="80px" />
            ) : error ? (
              <p className="side-empty-text text-danger">
                {uiText("Không thể tải danh sách môn học đang theo học.")}</p>
            ) : recentCourses.length === 0 ? (
              <div className="dash-card-empty">
                <p>{uiText("Bạn chưa tham gia môn học nào trong học kỳ này.")}</p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/sv/mon-hoc')}
                  icon={<Compass size={15} />}
                >
                  {uiText("Khám phá môn học")}</Button>
              </div>
            ) : (
              <div className="courses-simple-grid">
                {recentCourses.map((crs) => (
                  <div
                    key={crs.id}
                    className="course-mini-card"
                    onClick={() => navigate(`/sv/mon-hoc/${crs.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/sv/mon-hoc/${crs.id}`);
                    }}
                  >
                    <span className="mini-card-code">{crs.code}</span>
                    <h4 className="mini-card-name">{crs.name}</h4>
                    <span className="mini-card-term">
                      {crs.term} {crs.teacher_name ? `• ${crs.teacher_name}` : ''}
                    </span>
                    <span className="teacher-course-sub">
                      {crs.lesson_count} {uiText(" bài học (")}{crs.chapter_count} {uiText(" chương)")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Grades and Announcements */}
        <div className="dash-col-side">
          {/* Recent Grades */}
                    <section
            className="dash-card dash-recent-grades"
            aria-labelledby="grades-heading"
          >
            <div className="dash-card-header">
              <Award className="card-title-icon text-accent" aria-hidden="true" />
              <h2 id="grades-heading">{uiText("Điểm mới công bố")}</h2>
            </div>

            {grades.error && (
              <div role="alert">
                <p>{grades.error}</p>
                <button type="button" onClick={grades.retry}>
                  {uiText("Tải lại điểm")}</button>
              </div>
            )}

            {!grades.data && !grades.error && (
              <p role="status">{uiText("Đang tải điểm…")}</p>
            )}

            {grades.data?.items.length === 0 && (
              <p>{uiText("Chưa có điểm được công bố.")}</p>
            )}

            {grades.data && grades.data.items.length > 0 && (
              <ul>
                {grades.data.items.map(item => (
                  <li key={item.id}>
                    <Link
                      to={`/sv/mon-hoc/${item.course_id}/bai-tap/${item.assignment_id}`}
                    >
                      {item.title}
                    </Link>

                    <strong>{item.score} {uiText(" điểm")}</strong>

                    <small>
                      {item.course_name} {uiText(" · Lần nộp ")}{item.revision} ·{' '}
                      {new Date(item.published_at).toLocaleString(currentLocale())}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {currentUser && (
            <RecentCourseNotices key={currentUser.id} />
          )}
        </div>
      </div>
    </div>
  );
};
