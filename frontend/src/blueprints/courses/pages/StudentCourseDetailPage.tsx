import React, { useMemo } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useClock } from '../../../app/providers/ClockContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN, formatScoreVN } from '../../../shared/kernel/formatting';
import { BookOpen, FileText, AlertCircle, ArrowLeft, ArrowRight, Bell, Award, Calendar } from 'lucide-react';
import './StudentCourseDetailPage.css';

export const StudentCourseDetailPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { courses, chapters, lessons, materials, materialVersions, assignments, submissions, gradeRevisions, announcements, memberships, users } = useDatabase();
  const { currentUser } = useSession();
  const { now } = useClock();
  const navigate = useNavigate();

  const course = courses.find(c => c.id === monId);

  // Check enrollment
  const isEnrolled = memberships.some(
    m => m.courseId === monId && m.userId === currentUser?.id && m.status === 'active'
  );

  const activeTab = searchParams.get('tab') || 'noi-dung';
  const selectedLessonId = searchParams.get('bai');

  const courseChapters = useMemo(() => {
    return chapters
      .filter(ch => ch.courseId === monId)
      .sort((a, b) => a.order - b.order);
  }, [chapters, monId]);

  const courseLessons = useMemo(() => {
    const chIds = new Set(courseChapters.map(ch => ch.id));
    return lessons
      .filter(l => chIds.has(l.chapterId))
      .sort((a, b) => a.order - b.order);
  }, [lessons, courseChapters]);

  // Current lesson
  const currentLesson = useMemo(() => {
    if (selectedLessonId) {
      return courseLessons.find(l => l.id === selectedLessonId) || null;
    }
    return courseLessons.length > 0 ? courseLessons[0] : null;
  }, [courseLessons, selectedLessonId]);

  // Current lesson index for prev/next
  const currentLessonIndex = currentLesson ? courseLessons.findIndex(l => l.id === currentLesson.id) : -1;
  const prevLesson = currentLessonIndex > 0 ? courseLessons[currentLessonIndex - 1] : null;
  const nextLesson = currentLessonIndex >= 0 && currentLessonIndex < courseLessons.length - 1 ? courseLessons[currentLessonIndex + 1] : null;

  // Published materials for current lesson
  const currentMaterials = useMemo(() => {
    if (!currentLesson) return [];
    return materials
      .filter(m => m.lessonId === currentLesson.id && m.visibility === 'class')
      .map(m => {
        const ver = materialVersions.find(v => v.id === m.currentVersionId) || materialVersions.find(v => v.materialId === m.id);
        const fileType = ver?.filename.split('.').pop()?.toUpperCase() || 'PDF';
        return {
          ...m,
          fileType,
          versionNumber: ver?.versionNumber || 1,
          updatedAt: ver?.uploadedAt || ''
        };
      });
  }, [materials, materialVersions, currentLesson]);

  // Assignments for course
  const courseAssignments = useMemo(() => {
    return assignments.filter(a => a.courseId === monId && a.status === 'published');
  }, [assignments, monId]);

  // Announcements for course
  const courseAnnouncements = useMemo(() => {
    return announcements
      .filter(a => a.courseId === monId)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }, [announcements, monId]);

  if (!course) {
    return (
      <div className="course-detail-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Mã môn học không tồn tại trên hệ thống hoặc bạn không có quyền truy cập."
          action={
            <Button variant="primary" onClick={() => navigate('/sv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  if (!isEnrolled) {
    return (
      <div className="course-detail-container">
        <EmptyState
          title="Chưa được ghi danh"
          description={`Bạn chưa được ghi danh vào môn học ${course.code} — ${course.name}. Vui lòng liên hệ giảng viên hoặc phòng đào tạo.`}
          action={
            <Button variant="primary" onClick={() => navigate('/sv/mon-hoc')}>
              Về môn học của tôi
            </Button>
          }
        />
      </div>
    );
  }

  const handleSelectTab = (tab: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    setSearchParams(nextParams);
  };

  const handleSelectLesson = (lessonId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'noi-dung');
    nextParams.set('bai', lessonId);
    setSearchParams(nextParams);
  };

  const teacher = users.find(u => u.id === course.teacherId);

  return (
    <div className="course-detail-page">
      <div className="course-detail-header-nav">
        <Breadcrumb
          items={[
            { label: 'Trang chủ', path: '/sv' },
            { label: 'Môn học', path: '/sv/mon-hoc' },
            { label: `${course.code} — ${course.name}` }
          ]}
        />
      </div>

      {course.status === 'archived' && (
        <div className="archived-banner" role="alert">
          <AlertCircle size={20} />
          <div>
            <strong>Môn học này đã được lưu trữ</strong>
            <p>Toàn bộ nội dung ở trạng thái chỉ đọc. Không thể nộp bài tập hoặc chỉnh sửa dữ liệu.</p>
          </div>
        </div>
      )}

      <header className="course-header">
        <div className="course-title-block">
          <div className="course-code-badge">{course.code}</div>
          <h1 className="course-title">{course.name}</h1>
          <p className="course-meta">
            <span>Học kỳ: <strong>{course.term}</strong></span>
            <span className="dot-divider">•</span>
            <span>Giảng viên: <strong>{teacher?.fullName || 'Giảng viên'}</strong></span>
            <span className="dot-divider">•</span>
            <span>Trạng thái: <Badge variant={course.status === 'open' ? 'published' : 'archived'} label={course.status === 'open' ? 'Đang học' : 'Đã lưu trữ'} /></span>
          </p>
        </div>
      </header>

      {/* Course Subnav Tabs */}
      <nav className="course-tabs" aria-label="Phân hệ môn học">
        <button
          className={`course-tab-btn ${activeTab === 'noi-dung' ? 'active' : ''}`}
          onClick={() => handleSelectTab('noi-dung')}
          aria-selected={activeTab === 'noi-dung'}
        >
          <BookOpen size={18} />
          <span>Nội dung bài học</span>
        </button>
        <button
          className={`course-tab-btn ${activeTab === 'bai-tap' ? 'active' : ''}`}
          onClick={() => handleSelectTab('bai-tap')}
          aria-selected={activeTab === 'bai-tap'}
        >
          <FileText size={18} />
          <span>Bài tập ({courseAssignments.length})</span>
        </button>
        <button
          className={`course-tab-btn ${activeTab === 'diem' ? 'active' : ''}`}
          onClick={() => handleSelectTab('diem')}
          aria-selected={activeTab === 'diem'}
        >
          <Award size={18} />
          <span>Bảng điểm</span>
        </button>
        <button
          className={`course-tab-btn ${activeTab === 'thong-bao' ? 'active' : ''}`}
          onClick={() => handleSelectTab('thong-bao')}
          aria-selected={activeTab === 'thong-bao'}
        >
          <Bell size={18} />
          <span>Thông báo ({courseAnnouncements.length})</span>
        </button>
      </nav>

      {/* Tab: NỘI DUNG BÀI HỌC */}
      {activeTab === 'noi-dung' && (
        <div className="course-content-layout">
          {/* 28% Sidebar Chapter Tree */}
          <aside className="chapter-tree-sidebar" aria-label="Cây chương và bài học">
            <h2 className="sidebar-heading">Mục lục khóa học</h2>
            {courseChapters.length === 0 ? (
              <p className="sidebar-empty">Chưa có chương học nào được tạo.</p>
            ) : (
              <div className="chapters-list">
                {courseChapters.map((ch, chIdx) => {
                  const chLessons = courseLessons.filter(l => l.chapterId === ch.id);
                  return (
                    <section key={ch.id} className="chapter-node">
                      <h3 className="chapter-title">
                        Chương {chIdx + 1}: {ch.title}
                      </h3>
                      {chLessons.length === 0 ? (
                        <p className="lesson-empty">Chưa có bài học</p>
                      ) : (
                        <ul className="lessons-list">
                          {chLessons.map(lesson => {
                            const isCurrent = currentLesson?.id === lesson.id;
                            return (
                              <li key={lesson.id}>
                                <button
                                  type="button"
                                  className={`lesson-nav-btn ${isCurrent ? 'active' : ''}`}
                                  onClick={() => handleSelectLesson(lesson.id)}
                                  aria-current={isCurrent ? 'true' : undefined}
                                >
                                  <BookOpen size={16} />
                                  <span className="lesson-nav-title">{lesson.title}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </aside>

          {/* 72% Lesson Detail Panel */}
          <main className="lesson-detail-panel">
            {currentLesson ? (
              <article className="lesson-article">
                <header className="lesson-header">
                  <div className="lesson-breadcrumb-tag">
                    {courseChapters.find(ch => ch.id === currentLesson.chapterId)?.title}
                  </div>
                  <h2 className="lesson-main-title">{currentLesson.title}</h2>
                  <p className="lesson-description">{currentLesson.description || 'Chưa có mô tả chi tiết cho bài học này.'}</p>
                </header>

                <section className="lesson-materials-section">
                  <h3 className="materials-heading">
                    <FileText size={18} />
                    <span>Học liệu bài học ({currentMaterials.length})</span>
                  </h3>

                  {currentMaterials.length === 0 ? (
                    <div className="materials-empty-box">
                      <p>Chưa có học liệu công bố trong bài học này.</p>
                    </div>
                  ) : (
                    <div className="materials-grid">
                      {currentMaterials.map(mat => (
                        <Link
                          key={mat.id}
                          to={`/sv/hoc-lieu/${mat.id}`}
                          className="material-card-item"
                        >
                          <div className="material-icon-wrap">
                            <FileText size={22} />
                          </div>
                          <div className="material-info-wrap">
                            <h4 className="material-item-title">{mat.title}</h4>
                            <div className="material-meta-row">
                              <span className="material-type-pill">{mat.fileType.toUpperCase()}</span>
                              <span className="material-version">Phiên bản {mat.versionNumber}</span>
                              <span className="material-date">{formatDateVN(mat.updatedAt)}</span>
                            </div>
                            {mat.tags.length > 0 && (
                              <div className="material-tags-row">
                                {mat.tags.map(t => (
                                  <span key={t} className="tag-chip">#{t}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="material-link-action">Xem học liệu →</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                <footer className="lesson-pagination-nav">
                  {prevLesson ? (
                    <button
                      type="button"
                      className="lesson-prev-btn"
                      onClick={() => handleSelectLesson(prevLesson.id)}
                    >
                      <ArrowLeft size={16} />
                      <div>
                        <span className="nav-label">Bài trước</span>
                        <strong className="nav-title">{prevLesson.title}</strong>
                      </div>
                    </button>
                  ) : <div />}

                  {nextLesson && (
                    <button
                      type="button"
                      className="lesson-next-btn"
                      onClick={() => handleSelectLesson(nextLesson.id)}
                    >
                      <div className="text-right">
                        <span className="nav-label">Bài tiếp theo</span>
                        <strong className="nav-title">{nextLesson.title}</strong>
                      </div>
                      <ArrowRight size={16} />
                    </button>
                  )}
                </footer>
              </article>
            ) : (
              <div className="lesson-not-selected">
                <EmptyState
                  title="Chọn một bài học"
                  description="Chọn bài học từ cây mục lục bên trái để xem nội dung và học liệu tương ứng."
                />
              </div>
            )}
          </main>
        </div>
      )}

      {/* Tab: BÀI TẬP */}
      {activeTab === 'bai-tap' && (
        <section className="course-tab-panel">
          <div className="panel-header-row">
            <h2 className="panel-title">Danh sách bài tập môn học</h2>
            <p className="panel-subtitle">Theo dõi hạn nộp và nộp bài trước thời hạn quy định.</p>
          </div>

          {courseAssignments.length === 0 ? (
            <EmptyState
              title="Chưa có bài tập"
              description="Giảng viên chưa công bố bài tập nào cho môn học này."
            />
          ) : (
            <div className="assignments-table-wrap">
              <table className="npc-table">
                <thead>
                  <tr>
                    <th>Bài tập</th>
                    <th>Hạn nộp</th>
                    <th>Trạng thái nộp</th>
                    <th>Điểm số</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {courseAssignments.map(ass => {
                    const sub = submissions.find(
                      s => s.assignmentId === ass.id && s.studentId === currentUser?.id
                    );
                    const grade = sub ? gradeRevisions.find(gr => gr.submissionId === sub.id && gr.status === 'published') : null;
                    const isPassed = new Date(ass.dueAt).getTime() < new Date(now).getTime();

                    return (
                      <tr key={ass.id}>
                        <td>
                          <strong>{ass.title}</strong>
                          <div className="table-subtext">Tổng thang điểm: {ass.maxScore} điểm</div>
                        </td>
                        <td>
                          <div className="date-cell">
                            <Calendar size={14} />
                            <span>{formatDateVN(ass.dueAt)}</span>
                          </div>
                          {isPassed && (
                            <span className="badge-late-warning">Đã quá hạn</span>
                          )}
                        </td>
                        <td>
                          {grade ? (
                            <Badge variant="graded" label="Đã chấm điểm" />
                          ) : sub ? (
                            <Badge variant="submitted" label="Đã nộp bài" />
                          ) : (
                            <Badge variant="pending" label="Chưa nộp" />
                          )}
                        </td>
                        <td>
                          {grade ? (
                            <strong className="score-highlight">{formatScoreVN(grade.total)} / {ass.maxScore}</strong>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <Link to={`/sv/bai-tap/${ass.id}`} className="npc-btn npc-btn-secondary npc-btn-sm">
                            {sub ? 'Xem bài nộp' : 'Nộp bài'}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab: BẢNG ĐIỂM */}
      {activeTab === 'diem' && (
        <section className="course-tab-panel">
          <div className="panel-header-row">
            <div>
              <h2 className="panel-title">Bảng điểm môn học</h2>
              <p className="panel-subtitle">Điểm số chính thức sau khi giảng viên công bố.</p>
            </div>
            <Link to={`/sv/diem?mon=${course.id}`} className="npc-btn npc-btn-secondary npc-btn-sm">
              Xem toàn bộ bảng điểm của tôi →
            </Link>
          </div>

          <div className="assignments-table-wrap">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Bài tập</th>
                  <th>Hạn nộp</th>
                  <th>Điểm công bố</th>
                  <th>Trạng thái</th>
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {courseAssignments.map(ass => {
                  const sub = submissions.find(
                    s => s.assignmentId === ass.id && s.studentId === currentUser?.id
                  );
                  const grade = sub ? gradeRevisions.find(gr => gr.submissionId === sub.id && gr.status === 'published') : null;
                  return (
                    <tr key={ass.id}>
                      <td><strong>{ass.title}</strong></td>
                      <td>{formatDateVN(ass.dueAt)}</td>
                      <td>
                        {grade ? (
                          <strong className="score-highlight">{formatScoreVN(grade.total)} / {ass.maxScore}</strong>
                        ) : (
                          <span className="text-muted">Chưa có điểm</span>
                        )}
                      </td>
                      <td>
                        {grade ? (
                          <Badge variant="published" label="Đã công bố" />
                        ) : sub ? (
                          <Badge variant="submitted" label="Đang chờ chấm" />
                        ) : (
                          <Badge variant="pending" label="Chưa nộp" />
                        )}
                      </td>
                      <td>
                        <Link to={`/sv/bai-tap/${ass.id}`} className="npc-link-action">
                          Xem bài làm
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tab: THÔNG BÁO */}
      {activeTab === 'thong-bao' && (
        <section className="course-tab-panel">
          <div className="panel-header-row">
            <h2 className="panel-title">Thông báo từ giảng viên</h2>
            <Link to={`/sv/thong-bao?mon=${course.id}`} className="npc-btn npc-btn-secondary npc-btn-sm">
              Tất cả thông báo →
            </Link>
          </div>

          {courseAnnouncements.length === 0 ? (
            <EmptyState
              title="Không có thông báo"
              description="Giảng viên chưa đăng thông báo nào trong môn học này."
            />
          ) : (
            <div className="announcements-stack">
              {courseAnnouncements.map(ann => {
                const author = users.find(u => u.id === ann.authorId);
                return (
                  <article key={ann.id} className="announcement-item-card">
                    <header className="ann-card-header">
                      <h3 className="ann-card-title">{ann.title}</h3>
                      <span className="ann-card-date">{formatDateVN(ann.publishedAt)}</span>
                    </header>
                    <p className="ann-card-content">{ann.body}</p>
                    <footer className="ann-card-footer">
                      <span className="ann-author">Người đăng: {author?.fullName || 'Giảng viên'}</span>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
