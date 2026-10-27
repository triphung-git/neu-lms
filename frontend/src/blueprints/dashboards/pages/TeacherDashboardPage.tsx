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
  PlusCircle,
  Users,
  FileText,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import './DashboardPages.css';

export const TeacherDashboardPage: React.FC = () => {
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
      .getSummary('teacher')
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
              : 'Không thể tải dữ liệu tổng quan giảng viên từ máy chủ.';
          setError(message);
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [retryCount, currentUser?.id]);

  if (error) return <ErrorBanner title="Không thể tải dữ liệu tổng quan" message={error} onRetry={handleRetry} />;

  const openCoursesCount = summary?.open_courses ?? 0;
  const recentCourses = summary?.recent_courses ?? [];

  return (
    <div className="dash-page-container">
      <div className="dash-page-header">
        <div>
          <h1 className="dash-page-title">Bàn làm việc Giảng viên</h1>
          <p className="dash-page-subtitle">
            Xin chào {currentUser?.fullName || 'Thầy/Cô'}, theo dõi tổng quan các môn học và hoạt động giảng dạy.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<PlusCircle size={16} />}
          onClick={() => navigate('/gv/mon-hoc/tao')}
        >
          Tạo môn học mới
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <ErrorBanner
          title="Không thể tải dữ liệu tổng quan"
          message={error}
          onRetry={handleRetry}
        />
      )}

      {/* 4 Stat Metric Cards */}
      <div className="stat-cards-row">
        <div
          className="stat-metric-card"
          onClick={() => navigate('/gv/mon-hoc')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate('/gv/mon-hoc');
          }}
        >
          <div className="metric-header">
            <span className="metric-title">Môn đang phụ trách</span>
            <BookOpen size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : openCoursesCount}
          </span>
          <span className="metric-sub">
            {summary?.archived_courses
              ? `${summary.archived_courses} môn đã lưu trữ`
              : 'Môn học đang mở'}
          </span>
        </div>

        <div className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">Sinh viên tham gia</span>
            <Users size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : (summary?.distinct_students ?? 0)}
          </span>
          <span className="metric-sub">
            {summary?.total_memberships ?? 0} lượt ghi danh hoạt động
          </span>
        </div>

        <div className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">Chương & Bài học</span>
            <FileText size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : (summary?.total_lessons ?? 0)}
          </span>
          <span className="metric-sub">
            Thuộc {summary?.total_chapters ?? 0} chương bài giảng
          </span>
        </div>

        <div className="stat-metric-card stat-metric-unavailable">
          <div className="metric-header">
            <span className="metric-title">Bài chờ chấm & Hạn nộp</span>
            <Clock size={20} className="text-muted" />
          </div>
          <div className="metric-unavailable-row">
            <span className="metric-number text-muted">—</span>
            <Badge variant="draft" label="Chưa khả dụng" />
          </div>
          <span className="metric-sub">Phân hệ bài tập & chấm điểm đang hoàn thiện</span>
        </div>
      </div>

      <div className="dash-grid-sections">
        {/* Main Column: Teaching Courses */}
        <div className="dash-col-main">
          <section className="dash-card" aria-labelledby="teaching-courses-heading">
            <div className="dash-card-header">
              <BookOpen className="card-title-icon" />
              <h2 id="teaching-courses-heading">
                Môn học đang phụ trách ({loading ? '...' : recentCourses.length})
              </h2>
              <Link to="/gv/mon-hoc" className="card-view-all">
                Tất cả môn →
              </Link>
            </div>

            {loading ? (
              <LoadingSkeleton lines={4} height="56px" />
            ) : error ? (
              <p className="side-empty-text text-danger">
                Không thể tải danh sách môn học. Vui lòng bấm &ldquo;Thử lại&rdquo; ở phía trên.
              </p>
            ) : recentCourses.length === 0 ? (
              <div className="dash-card-empty">
                <p>Bạn chưa phụ trách môn học nào trong học kỳ này.</p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/gv/mon-hoc/tao')}
                  icon={<PlusCircle size={15} />}
                >
                  Khởi tạo môn học đầu tiên
                </Button>
              </div>
            ) : (
              <div className="teacher-courses-list">
                {recentCourses.map((crs) => (
                  <div
                    key={crs.id}
                    className="teacher-course-row"
                    onClick={() => navigate(`/gv/mon-hoc/${crs.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/gv/mon-hoc/${crs.id}`);
                    }}
                  >
                    <div className="teacher-course-info">
                      <div className="course-code-tag">{crs.code}</div>
                      <h3 className="teacher-course-name">{crs.name}</h3>
                      <span className="teacher-course-sub">{crs.term}</span>
                    </div>
                    <div className="teacher-course-stats">
                      <span className="stat-pill">
                        {crs.active_member_count ?? 0} sinh viên
                      </span>
                      <span className="stat-pill">{crs.lesson_count} bài học</span>
                      <span className="stat-pill">{crs.chapter_count} chương</span>
                      <ArrowRight size={16} className="arrow-icon" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Side Column: Additional modules status */}
        <div className="dash-col-side">
          <section className="dash-card" aria-labelledby="materials-status-heading">
            <div className="dash-card-header">
              <ShieldCheck className="card-title-icon text-accent" />
              <h2 id="materials-status-heading">Học liệu & An toàn</h2>
            </div>
            <div className="dash-notice-box">
              <div className="dash-notice-header">
                <Badge variant="draft" label="Chưa khả dụng" />
              </div>
              <p className="side-empty-text">
                Phân hệ học liệu số, quét an toàn mã độc và trích xuất nội dung văn bản sẽ được tích hợp trong giai đoạn B09.
              </p>
            </div>
          </section>

          <section className="dash-card" aria-labelledby="ai-assistant-heading">
            <div className="dash-card-header">
              <Sparkles className="card-title-icon text-accent" />
              <h2 id="ai-assistant-heading">Trợ lý AI & Bản nháp</h2>
            </div>
            <div className="dash-notice-box">
              <div className="dash-notice-header">
                <Badge variant="draft" label="Chưa khả dụng" />
              </div>
              <p className="side-empty-text">
                Phân hệ tự động tóm tắt bài giảng và gợi ý bài tập bằng mô hình AI đang được chuẩn bị hạ tầng.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
