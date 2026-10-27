import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { coursesService, type CourseSummaryResponse } from '../../../api/coursesService';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import {
  BookOpen,
  Clock,
  Award,
  Bell,
  GraduationCap,
  FileText,
  Compass,
} from 'lucide-react';
import './DashboardPages.css';

export const StudentDashboardPage: React.FC = () => {
  const { currentUser } = useSession();
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
              : 'Không thể tải dữ liệu tổng quan sinh viên từ máy chủ.';
          setError(message);
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [retryCount, currentUser?.id]);

  if (error) return <ErrorBanner title="Không thể tải dữ liệu tổng quan" message={error} onRetry={handleRetry} />;

  const recentCourses = summary?.recent_courses ?? [];
  const openEnrolledCount = summary?.open_enrolled_courses ?? 0;

  return (
    <div className="dash-page-container">
      <div className="dash-page-header">
        <div>
          <h1 className="dash-page-title">Việc cần làm của tôi</h1>
          <p className="dash-page-subtitle">
            Xin chào {currentUser?.fullName || 'Sinh viên'}, theo dõi môn học đang tham gia và tiến độ bài giảng.
          </p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <ErrorBanner
          title="Không thể tải dữ liệu tổng quan"
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
            <span className="metric-title">Môn đang theo học</span>
            <GraduationCap size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : openEnrolledCount}
          </span>
          <span className="metric-sub">
            {summary?.archived_enrolled_courses
              ? `${summary.archived_enrolled_courses} môn đã kết thúc`
              : 'Môn học đang mở'}
          </span>
        </div>

        <div className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">Bài học có thể xem</span>
            <FileText size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : (summary?.total_lessons ?? 0)}
          </span>
          <span className="metric-sub">
            Trong tổng số {summary?.total_chapters ?? 0} chương học
          </span>
        </div>

        <div className="stat-metric-card stat-metric-unavailable">
          <div className="metric-header">
            <span className="metric-title">Hạn nộp bài tập</span>
            <Clock size={20} className="text-muted" />
          </div>
          <div className="metric-unavailable-row">
            <span className="metric-number text-muted">—</span>
            <Badge variant="draft" label="Chưa khả dụng" />
          </div>
          <span className="metric-sub">Phân hệ nộp bài tập đang hoàn thiện</span>
        </div>

        <div className="stat-metric-card stat-metric-unavailable">
          <div className="metric-header">
            <span className="metric-title">Điểm mới công bố</span>
            <Award size={20} className="text-muted" />
          </div>
          <div className="metric-unavailable-row">
            <span className="metric-number text-muted">—</span>
            <Badge variant="draft" label="Chưa khả dụng" />
          </div>
          <span className="metric-sub">Phân hệ chấm điểm đang hoàn thiện</span>
        </div>
      </div>

      <div className="dash-grid-sections">
        {/* Left Column: Deadlines notice & Enrolled Courses */}
        <div className="dash-col-main">
          {/* Deadlines notice */}
          <section className="dash-card" aria-labelledby="deadlines-heading">
            <div className="dash-card-header">
              <Clock className="card-title-icon text-accent" />
              <h2 id="deadlines-heading">Hạn nộp bài tập sắp tới</h2>
              <Badge variant="draft" label="Chưa khả dụng" />
            </div>
            <div className="dash-notice-box">
              <p className="side-empty-text">
                Phân hệ quản lý bài tập và nộp bài trực tuyến đang được hoàn thiện theo lộ trình. Các hạn nộp bài tập của môn học sẽ tự động hiển thị tại đây khi phân hệ được kích hoạt.
              </p>
            </div>
          </section>

          {/* Enrolled Courses */}
          <section className="dash-card" aria-labelledby="courses-heading">
            <div className="dash-card-header">
              <BookOpen className="card-title-icon" />
              <h2 id="courses-heading">
                Môn học đang theo học ({loading ? '...' : recentCourses.length})
              </h2>
              <Link to="/sv/mon-hoc" className="card-view-all">
                Xem tất cả →
              </Link>
            </div>

            {loading ? (
              <LoadingSkeleton lines={3} height="80px" />
            ) : error ? (
              <p className="side-empty-text text-danger">
                Không thể tải danh sách môn học đang theo học.
              </p>
            ) : recentCourses.length === 0 ? (
              <div className="dash-card-empty">
                <p>Bạn chưa tham gia môn học nào trong học kỳ này.</p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/sv/mon-hoc')}
                  icon={<Compass size={15} />}
                >
                  Khám phá môn học
                </Button>
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
                      {crs.lesson_count} bài học ({crs.chapter_count} chương)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Grades and Announcements */}
        <div className="dash-col-side">
          {/* Recent Grades */}
          <section className="dash-card" aria-labelledby="grades-heading">
            <div className="dash-card-header">
              <Award className="card-title-icon text-accent" />
              <h2 id="grades-heading">Điểm mới công bố</h2>
              <Badge variant="draft" label="Chưa khả dụng" />
            </div>
            <div className="dash-notice-box">
              <p className="side-empty-text">
                Bảng điểm môn học và phản hồi từ giảng viên sẽ được đồng bộ khi phân hệ chấm điểm trực tuyến triển khai.
              </p>
            </div>
          </section>

          {/* Announcements */}
          <section className="dash-card" aria-labelledby="announcements-heading">
            <div className="dash-card-header">
              <Bell className="card-title-icon" />
              <h2 id="announcements-heading">Thông báo môn học</h2>
              <Badge variant="draft" label="Chưa khả dụng" />
            </div>
            <div className="dash-notice-box">
              <p className="side-empty-text">
                Kênh thông báo từ giảng viên và khoa đào tạo đang được tích hợp.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
