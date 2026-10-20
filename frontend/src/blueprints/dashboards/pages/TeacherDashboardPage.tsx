import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useClock } from '../../../app/providers/ClockContext';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import {
  BookOpen,
  PlusCircle,
  FileCheck,
  Clock,
  AlertTriangle,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import './DashboardPages.css';

export const TeacherDashboardPage: React.FC = () => {
  const { db } = useDatabase();
  const { currentUser } = useSession();
  const { currentTimeIso } = useClock();
  const navigate = useNavigate();

  // Courses taught by this teacher
  const myCourses = db.courses.filter((c) => c.teacherId === currentUser?.id);
  const openCourses = myCourses.filter((c) => c.status === 'open');
  const openCourseIds = openCourses.map((c) => c.id);

  // Assignments in open courses
  const myAssignments = db.assignments.filter((a) => openCourseIds.includes(a.courseId));
  const myAssignmentIds = myAssignments.map((a) => a.id);

  // Submissions for my assignments
  const pendingSubmissions = db.submissions.filter(
    (s) => myAssignmentIds.includes(s.assignmentId) && s.gradingStatus !== 'graded'
  );

  // Assignments due in next 7 days
  const nowMs = new Date(currentTimeIso).getTime();
  const sevenDaysMs = nowMs + 7 * 24 * 60 * 60 * 1000;
  const upcomingAssignments = myAssignments.filter((a) => {
    const dueMs = new Date(a.dueAt).getTime();
    return dueMs >= nowMs && dueMs <= sevenDaysMs && a.status === 'published';
  });

  // Materials with extraction errors or no text
  const problemMaterials = db.materials.filter((m) => {
    if (!openCourseIds.includes(m.courseId)) return false;
    const version = db.materialVersions.find((v) => v.id === m.currentVersionId);
    return (
      version?.scanStatus === 'infected' ||
      version?.scanStatus === 'error' ||
      version?.extractionStatus === 'error' ||
      version?.extractionStatus === 'no_text'
    );
  });

  // Recent AI drafts for this teacher
  const myAIDrafts = db.aiDrafts.filter(
    (d) => openCourseIds.includes(d.courseId) && d.status === 'pending'
  );

  return (
    <div className="dash-page-container">
      <div className="dash-page-header">
        <div>
          <h1 className="dash-page-title">Bàn làm việc Giảng viên</h1>
          <p className="dash-page-subtitle">
            Tổng quan công việc chấm bài, theo dõi hạn nộp và rà soát trạng thái học liệu số.
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

      {/* 4 Stat Metric Cards */}
      <div className="stat-cards-row">
        <div className="stat-metric-card" onClick={() => navigate(openCourses[0] ? `/gv/mon-hoc/${openCourses[0].id}/bai-tap` : '/gv/mon-hoc')}>
          <div className="metric-header">
            <span className="metric-title">Bài chờ chấm</span>
            <FileCheck size={20} className="text-warning" />
          </div>
          <span className="metric-number">{pendingSubmissions.length}</span>
          <span className="metric-sub">Cần rà soát và cho điểm</span>
        </div>

        <div className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">Hạn nộp 7 ngày tới</span>
            <Clock size={20} className="text-accent" />
          </div>
          <span className="metric-number">{upcomingAssignments.length}</span>
          <span className="metric-sub">Bài tập sắp đến hạn</span>
        </div>

        <div className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">Học liệu cần chú ý</span>
            <AlertTriangle size={20} className="text-danger" />
          </div>
          <span className="metric-number">{problemMaterials.length}</span>
          <span className="metric-sub">Nhiễm mã độc / lỗi text</span>
        </div>

        <div className="stat-metric-card" onClick={() => navigate('/gv/ban-nhap-ai')}>
          <div className="metric-header">
            <span className="metric-title">Bản nháp AI chờ duyệt</span>
            <Sparkles size={20} className="text-accent" />
          </div>
          <span className="metric-number">{myAIDrafts.length}</span>
          <span className="metric-sub">Tóm tắt & Đề xuất bài tập</span>
        </div>
      </div>

      <div className="dash-grid-sections">
        {/* Main Column: Teaching Courses */}
        <div className="dash-col-main">
          <section className="dash-card" aria-labelledby="teaching-courses-heading">
            <div className="dash-card-header">
              <BookOpen className="card-title-icon" />
              <h2 id="teaching-courses-heading">Môn học đang phụ trách ({openCourses.length})</h2>
              <Link to="/gv/mon-hoc" className="card-view-all">
                Tất cả môn →
              </Link>
            </div>

            {openCourses.length === 0 ? (
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
                {openCourses.map((crs) => {
                  const studentCount = db.memberships.filter(
                    (m) => m.courseId === crs.id && m.status === 'active'
                  ).length;
                  const asgCount = db.assignments.filter((a) => a.courseId === crs.id).length;

                  return (
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
                        <span className="stat-pill">{studentCount} sinh viên</span>
                        <span className="stat-pill">{asgCount} bài tập</span>
                        <ArrowRight size={16} className="arrow-icon" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Side Column: Attention items */}
        <div className="dash-col-side">
          <section className="dash-card" aria-labelledby="problem-materials-heading">
            <div className="dash-card-header">
              <AlertTriangle className="card-title-icon text-danger" />
              <h2 id="problem-materials-heading">Học liệu cần kiểm tra</h2>
            </div>

            {problemMaterials.length === 0 ? (
              <p className="side-empty-text">Toàn bộ học liệu đều ở trạng thái xử lý an toàn.</p>
            ) : (
              <div className="problem-materials-list">
                {problemMaterials.map((mat) => {
                  const ver = db.materialVersions.find((v) => v.id === mat.currentVersionId);
                  return (
                    <div
                      key={mat.id}
                      className="problem-material-item"
                      onClick={() => navigate(`/gv/hoc-lieu/${mat.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') navigate(`/gv/hoc-lieu/${mat.id}`);
                      }}
                    >
                      <div className="mat-problem-info">
                        <h4>{mat.title}</h4>
                        <span className="mat-problem-status">
                          {ver?.scanStatus === 'infected' && 'Nhiễm mã độc'}
                          {ver?.extractionStatus === 'no_text' && 'Ảnh scan / Không có text'}
                          {ver?.extractionStatus === 'error' && 'Lỗi trích xuất'}
                        </span>
                      </div>
                      <Badge variant={ver?.scanStatus === 'infected' ? 'error' : 'no-text'} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
