import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useClock } from '../../../app/providers/ClockContext';
import { formatDateTimeVN, formatScoreVN } from '../../../shared/kernel/formatting';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Clock, Award, Bell, BookOpen, CheckCircle2 } from 'lucide-react';
import './DashboardPages.css';

export const StudentDashboardPage: React.FC = () => {
  const { db } = useDatabase();
  const { currentUser } = useSession();
  const { currentTimeIso } = useClock();
  const navigate = useNavigate();

  // Courses where student is active member
  const studentMemberships = db.memberships.filter(
    (m) => m.userId === currentUser?.id && m.status === 'active'
  );
  const enrolledCourseIds = studentMemberships.map((m) => m.courseId);
  const myCourses = db.courses.filter(
    (c) => enrolledCourseIds.includes(c.id) && c.status === 'open'
  );

  // Assignments in student's open courses
  const studentAssignments = db.assignments.filter(
    (a) => enrolledCourseIds.includes(a.courseId) && a.status === 'published'
  );

  // Submissions by this student
  const mySubmissions = db.submissions.filter((s) => s.studentId === currentUser?.id);

  // Todo assignments: not submitted, or allow replace before deadline
  const upcomingDeadlines = studentAssignments
    .filter((a) => !a.manuallyClosedAt)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .map((asg) => {
      const sub = mySubmissions.find((s) => s.assignmentId === asg.id);
      const isPastDue = new Date(currentTimeIso).getTime() > new Date(asg.dueAt).getTime();
      return {
        assignment: asg,
        submission: sub,
        isPastDue,
        course: db.courses.find((c) => c.id === asg.courseId),
      };
    });

  // Recent grades published for this student
  const recentGrades = mySubmissions
    .map((sub) => {
      const asg = db.assignments.find((a) => a.id === sub.assignmentId);
      const crs = asg ? db.courses.find((c) => c.id === asg.courseId) : undefined;
      const grade = db.gradeRevisions.find(
        (g) => g.submissionId === sub.id && g.status === 'published'
      );
      return { sub, asg, crs, grade };
    })
    .filter((item) => Boolean(item.grade && item.asg));

  // Announcements
  const recentAnnouncements = db.announcements
    .filter((a) => enrolledCourseIds.includes(a.courseId))
    .slice(0, 4);

  return (
    <div className="dash-page-container">
      <div className="dash-page-header">
        <div>
          <h1 className="dash-page-title">Việc cần làm của tôi</h1>
          <p className="dash-page-subtitle">
            Theo dõi hạn nộp bài tập, điểm số mới và thông báo quan trọng từ giảng viên.
          </p>
        </div>
      </div>

      <div className="dash-grid-sections">
        {/* Left Column: Deadlines & Assignments */}
        <div className="dash-col-main">
          <section className="dash-card" aria-labelledby="deadlines-heading">
            <div className="dash-card-header">
              <Clock className="card-title-icon text-accent" />
              <h2 id="deadlines-heading">Hạn nộp bài tập sắp tới</h2>
            </div>

            {upcomingDeadlines.length === 0 ? (
              <div className="dash-card-empty">
                <CheckCircle2 size={32} className="text-success" />
                <p>Bạn đã hoàn thành toàn bộ bài tập trong các môn học hiện tại!</p>
              </div>
            ) : (
              <div className="todo-items-list">
                {upcomingDeadlines.map(({ assignment, submission, isPastDue, course }) => {
                  const hasSubmitted = Boolean(submission);
                  return (
                    <div key={assignment.id} className="todo-item-row">
                      <div className="todo-item-info">
                        <div className="todo-item-meta">
                          <span className="course-code-tag">{course?.code}</span>
                          <span className="due-date-text">
                            Hạn nộp: {formatDateTimeVN(assignment.dueAt)}
                          </span>
                          {isPastDue && !hasSubmitted && (
                            <Badge variant="late" label="Đã quá hạn" />
                          )}
                          {hasSubmitted && (
                            <Badge
                              variant="submitted"
                              label={`Đã nộp (${submission?.revisions.length} bản)`}
                            />
                          )}
                        </div>
                        <h3 className="todo-item-title">{assignment.title}</h3>
                      </div>
                      <div className="todo-item-action">
                        <Button
                          variant={hasSubmitted ? 'secondary' : 'primary'}
                          size="sm"
                          onClick={() => navigate(`/sv/bai-tap/${assignment.id}`)}
                        >
                          {hasSubmitted ? 'Xem bài nộp' : 'Nộp bài ngay'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Enrolled Courses */}
          <section className="dash-card" aria-labelledby="courses-heading">
            <div className="dash-card-header">
              <BookOpen className="card-title-icon" />
              <h2 id="courses-heading">Môn học đang theo học ({myCourses.length})</h2>
              <Link to="/sv/mon-hoc" className="card-view-all">
                Xem tất cả →
              </Link>
            </div>

            <div className="courses-simple-grid">
              {myCourses.map((crs) => (
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
                  <span className="mini-card-term">{crs.term}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Grades and Announcements */}
        <div className="dash-col-side">
          {/* Recent Grades */}
          <section className="dash-card" aria-labelledby="grades-heading">
            <div className="dash-card-header">
              <Award className="card-title-icon text-accent" />
              <h2 id="grades-heading">Điểm mới công bố</h2>
              <Link to="/sv/diem" className="card-view-all">
                Bảng điểm →
              </Link>
            </div>

            {recentGrades.length === 0 ? (
              <p className="side-empty-text">Chưa có bài tập nào được công bố điểm.</p>
            ) : (
              <div className="recent-grades-list">
                {recentGrades.map(({ asg, crs, grade }) => (
                  <div
                    key={grade?.id}
                    className="grade-mini-item"
                    onClick={() => navigate(`/sv/diem?mon=${crs?.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/sv/diem?mon=${crs?.id}`);
                    }}
                  >
                    <div className="grade-score-box">
                      <span className="score-num">{formatScoreVN(grade?.total)}</span>
                      <span className="score-max">/ {asg?.maxScore}</span>
                    </div>
                    <div className="grade-info-box">
                      <h4 className="grade-asg-title">{asg?.title}</h4>
                      <span className="grade-course-code">{crs?.code}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Announcements */}
          <section className="dash-card" aria-labelledby="announcements-heading">
            <div className="dash-card-header">
              <Bell className="card-title-icon" />
              <h2 id="announcements-heading">Thông báo môn học</h2>
              <Link to="/sv/thong-bao" className="card-view-all">
                Tất cả →
              </Link>
            </div>

            {recentAnnouncements.length === 0 ? (
              <p className="side-empty-text">Hiện chưa có thông báo mới.</p>
            ) : (
              <div className="recent-anc-list">
                {recentAnnouncements.map((anc) => (
                  <div
                    key={anc.id}
                    className="anc-mini-item"
                    onClick={() => navigate(`/sv/thong-bao?thongBao=${anc.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/sv/thong-bao?thongBao=${anc.id}`);
                    }}
                  >
                    <h4 className="anc-mini-title">{anc.title}</h4>
                    <span className="anc-mini-date">{formatDateTimeVN(anc.publishedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
