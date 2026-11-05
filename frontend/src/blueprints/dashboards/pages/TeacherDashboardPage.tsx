import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { coursesService, type CourseSummaryResponse } from '../../../api/coursesService';
import { Button } from '../../../shared/ui/Button';
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
              : uiText("Không thể tải dữ liệu tổng quan giảng viên từ máy chủ.");
          setError(message);
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [retryCount, currentUser?.id]);

  if (error) return <ErrorBanner title={uiText("Không thể tải dữ liệu tổng quan")} message={error} onRetry={handleRetry} />;

  const openCoursesCount = summary?.open_courses ?? 0;
  const recentCourses = summary?.recent_courses ?? [];

  return (
    <div className="dash-page-container">
      <div className="dash-page-header">
        <div>
          <h1 className="dash-page-title">{uiText("Bàn làm việc Giảng viên")}</h1>
          <p className="dash-page-subtitle">
            {uiText("Xin chào ")}{currentUser?.fullName || uiText("Thầy/Cô")}{uiText(", theo dõi tổng quan các môn học và hoạt động giảng dạy.")}</p>
        </div>
        <Button
          variant="primary"
          icon={<PlusCircle size={16} />}
          onClick={() => navigate('/gv/mon-hoc/tao')}
        >
          {uiText("Tạo môn học mới")}</Button>
      </div>

      {/* Error state */}
      {error && (
        <ErrorBanner
          title={uiText("Không thể tải dữ liệu tổng quan")}
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
            <span className="metric-title">{uiText("Môn đang phụ trách")}</span>
            <BookOpen size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : openCoursesCount}
          </span>
          <span className="metric-sub">
            {summary?.archived_courses
              ? uiText("{0} môn đã lưu trữ",[summary.archived_courses])
              : uiText("Môn học đang mở")}
          </span>
        </div>

        <div className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">{uiText("Sinh viên tham gia")}</span>
            <Users size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : (summary?.distinct_students ?? 0)}
          </span>
          <span className="metric-sub">
            {summary?.total_memberships ?? 0} {uiText(" lượt ghi danh hoạt động")}</span>
        </div>

        <div className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">{uiText("Chương & Bài học")}</span>
            <FileText size={20} className="text-accent" />
          </div>
          <span className="metric-number">
            {loading ? '...' : (summary?.total_lessons ?? 0)}
          </span>
          <span className="metric-sub">
            {uiText("Thuộc ")}{summary?.total_chapters ?? 0} {uiText(" chương bài giảng")}</span>
        </div>

        <div className="stat-metric-card teacher-pending-grades">
          <div className="metric-header">
            <span className="metric-title">{uiText("Bài nộp chờ công bố điểm")}</span>
            <Clock size={20} className="text-accent" />
          </div>

          <span className="metric-number">
            {loading ? '…' : summary?.pending_submissions ?? '—'}
          </span>

          <span className="metric-sub">
            {uiText("Tính theo lần nộp mới nhất trong các môn đang mở")}</span>
        </div>
        </div>

      <div className="dash-grid-sections">
        {/* Main Column: Teaching Courses */}
        <div className="dash-col-main">
          <section className="dash-card" aria-labelledby="teaching-courses-heading">
            <div className="dash-card-header">
              <BookOpen className="card-title-icon" />
              <h2 id="teaching-courses-heading">
                {uiText("Môn học đang phụ trách (")}{loading ? '...' : recentCourses.length})
              </h2>
              <Link to="/gv/mon-hoc" className="card-view-all">
                {uiText("Tất cả môn →")}</Link>
            </div>

            {loading ? (
              <LoadingSkeleton lines={4} height="56px" />
            ) : error ? (
              <p className="side-empty-text text-danger">
                {uiText("Không thể tải danh sách môn học. Vui lòng bấm &ldquo;Thử lại&rdquo; ở phía trên.")}</p>
            ) : recentCourses.length === 0 ? (
              <div className="dash-card-empty">
                <p>{uiText("Bạn chưa phụ trách môn học nào trong học kỳ này.")}</p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/gv/mon-hoc/tao')}
                  icon={<PlusCircle size={15} />}
                >
                  {uiText("Khởi tạo môn học đầu tiên")}</Button>
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
                        {crs.active_member_count ?? 0} {uiText(" sinh viên")}</span>
                      <span className="stat-pill">{crs.lesson_count} {uiText(" bài học")}</span>
                      <span className="stat-pill">{crs.chapter_count} {uiText(" chương")}</span>
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
                    <section
            className="dash-card teacher-grading-queue"
            aria-labelledby="grading-queue-heading"
          >
            <div className="dash-card-header">
              <Clock className="card-title-icon text-accent" aria-hidden="true" />
              <h2 id="grading-queue-heading">{uiText("Bài tập chờ công bố điểm")}</h2>
            </div>

            {loading ? (
              <p role="status">{uiText("Đang tải danh sách…")}</p>
            ) : summary?.pending_assignments?.length ? (
              <>
                <p>{uiText("Tối đa 5 bài tập, ưu tiên lần nộp chờ lâu nhất.")}</p>
                <ul>
                  {summary.pending_assignments.map(item => (
                    <li key={item.assignment_id}>
                      <Link to={`/gv/bai-tap/${item.assignment_id}/bai-nop`}>
                        {item.title}
                      </Link>
                      <span>
                        {item.course_name} · {item.waiting} {uiText(" bài nộp chờ công bố")}</span>
                      <small>
                        {uiText("Chờ từ ")}{new Date(item.oldest).toLocaleString(currentLocale())}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                {summary?.pending_submissions === 0
                  ? uiText("Đã xử lý hết bài nộp.")
                  : uiText("Chưa có dữ liệu danh sách.")}
              </p>
            )}
          </section>
          <section className="dash-card" aria-labelledby="materials-status-heading">
            <div className="dash-card-header">
              <ShieldCheck className="card-title-icon text-accent" />
              <h2 id="materials-status-heading">{uiText("Học liệu & An toàn")}</h2>
            </div>
                        <p>{uiText("Trạng thái tệp học liệu trong các môn đang mở của bạn.")}</p>

            <dl className="teacher-material-stats">
              <div>
                <dt>{uiText("Đang quét")}</dt>
                <dd>
                  {loading ? '…' : summary?.scanning_materials ?? '—'}
                </dd>
              </div>

              <div>
                <dt>{uiText("Bị chặn sau quét")}</dt>
                <dd>
                  {loading ? '…' : summary?.problem_materials ?? '—'}
                </dd>
              </div>
            </dl>
          </section>

          <section className="dash-card" aria-labelledby="ai-assistant-heading">
            <div className="dash-card-header">
              <Sparkles className="card-title-icon text-accent" />
              <h2 id="ai-assistant-heading">{uiText("Trợ lý AI & Bản nháp")}</h2>
            </div>
            <p>{loading ? uiText("Đang tải…") : uiText("{0} bản nháp chờ duyệt trong các môn đang mở.",[summary?.pending_ai_drafts ?? 0])}</p>
            <Link className="card-view-all" to="/gv/ban-nhap-ai">{uiText("Xem và duyệt bản nháp →")}</Link>
          </section>
          <section className="dash-card" aria-labelledby="teacher-deadlines-heading">
            <h2 id="teacher-deadlines-heading">{uiText("Hạn nộp trong 7 ngày tới")}</h2>
            <p>{loading ? uiText("Đang tải…") : uiText("{0} bài tập đang công bố sắp đến hạn nộp gốc.",[summary?.upcoming_deadlines ?? 0])}</p>
            <Link className="card-view-all" to="/gv/mon-hoc">{uiText("Xem các môn phụ trách →")}</Link>
          </section>
        </div>
      </div>
    </div>
  );
};
