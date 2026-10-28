import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Modal } from '../../../shared/ui/Modal';
import { coursesService, type Course, type Chapter, type Lesson } from '../../../api/coursesService';
import { materialsService, type MaterialListItem } from '../../../api/materialsService';
import {
  BookOpen,
  FileText,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bell,
  Award,
  LogOut,
  RefreshCw,
  Search,
  Info,
} from 'lucide-react';
import './StudentCourseDetailPage.css';

interface LoadError {
  message: string;
  statusCode?: number;
}

export const StudentCourseDetailPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser } = useSession();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);

  const [materialsTotal, setMaterialsTotal] = useState(0);
  const [materialsError, setMaterialsError] = useState(false);

  // Withdraw state
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Stale response guard sequence
  const loadSequence = useRef(0);

  const activeTab = searchParams.get('tab') || 'noi-dung';
  const selectedLessonId = searchParams.get('bai');

  const fetchCourseData = useCallback(async () => {
    if (!monId) return;
    const currentSeq = ++loadSequence.current;
    setLoading(true);
    setError(null);

    try {
      const courseData = await coursesService.get(monId);
      if (currentSeq !== loadSequence.current) return;
      setCourse(courseData);

      // Load chapters
      const chapterList = await coursesService.listChapters(monId);
      if (currentSeq !== loadSequence.current) return;

      const sortedChapters = [...chapterList].sort((a, b) => a.position - b.position);
      setChapters(sortedChapters);

      // Load lessons for all chapters
      const lessonPromises = sortedChapters.map((ch) =>
        coursesService.listLessons(monId, ch.id)
      );
      const lessonResults = await Promise.all(lessonPromises);
      if (currentSeq !== loadSequence.current) return;

      const allLessons = Array.from(
        new Map(lessonResults.flatMap(items => [...items].sort((a, b) => a.position - b.position)).map((l) => [l.id, l])).values()
      );
      setLessons(allLessons);

      // Load published materials for this course
      try {
        const matRes = await materialsService.listMaterials(monId);
        if (currentSeq === loadSequence.current) {
          setMaterials(matRes.items || []);
          setMaterialsTotal(matRes.pagination?.total_items ?? matRes.items.length);
          setMaterialsError(false);
        }
      } catch {
        if (currentSeq === loadSequence.current) { setMaterials([]); setMaterialsError(true); }
      }
    } catch (err: unknown) {
      if (currentSeq !== loadSequence.current) return;
      const apiErr = err as { status?: number; message?: string };
      const statusCode = apiErr.status;
      const message =
        statusCode === 404
          ? 'Môn học không tồn tại hoặc bạn chưa được ghi danh vào môn học này.'
          : statusCode === 403
          ? 'Bạn không có quyền truy cập vào nội dung môn học này.'
          : apiErr.message || 'Không thể tải thông tin môn học. Vui lòng thử lại.';
      setError({ message, statusCode });
    } finally {
      if (currentSeq === loadSequence.current) {
        setLoading(false);
      }
    }
  }, [monId]);

  useEffect(() => {
    void fetchCourseData();
    return () => { loadSequence.current += 1; };
  }, [fetchCourseData]);

  // Lessons list sorted
  const sortedLessons = useMemo(() => {
    return lessons;
  }, [lessons]);

  // Current lesson
  const currentLesson = useMemo(() => {
    if (selectedLessonId) {
      return sortedLessons.find((l) => l.id === selectedLessonId) || null;
    }
    return sortedLessons.length > 0 ? sortedLessons[0] : null;
  }, [sortedLessons, selectedLessonId]);

  // Materials for current lesson
  const lessonMaterials = useMemo(() => {
    if (!currentLesson) return [];
    return materials.filter(
      (m) =>
        m.lesson === currentLesson.id ||
        (m.chapter === currentLesson.chapter && !m.lesson)
    );
  }, [materials, currentLesson]);

  // Current lesson index for prev/next
  const currentLessonIndex = currentLesson
    ? sortedLessons.findIndex((l) => l.id === currentLesson.id)
    : -1;
  const prevLesson = currentLessonIndex > 0 ? sortedLessons[currentLessonIndex - 1] : null;
  const nextLesson =
    currentLessonIndex >= 0 && currentLessonIndex < sortedLessons.length - 1
      ? sortedLessons[currentLessonIndex + 1]
      : null;

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

  const handleWithdraw = async () => {
    if (!course || !currentUser) return;
    setIsWithdrawing(true);
    try {
      await coursesService.withdrawMember(course.id, currentUser.id);
      showNotification('success', `Bạn đã rút khỏi môn học ${course.code} thành công.`);
      setIsWithdrawModalOpen(false);
      navigate('/sv/mon-hoc');
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      showNotification('error', apiErr.message || 'Không thể rút khỏi môn học. Vui lòng thử lại.');
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="course-detail-page">
        <div className="course-detail-header-nav">
          <Breadcrumb
            items={[
              { label: 'Trang chủ', path: '/sv' },
              { label: 'Môn học', path: '/sv/mon-hoc' },
              { label: 'Đang tải...' },
            ]}
          />
        </div>
        <div className="course-detail-loading" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', fontSize: 'var(--text-base)' }}>Đang tải nội dung môn học từ máy chủ...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !course) {
    return (
      <div className="course-detail-container">
        <EmptyState
          title={error?.statusCode === 404 ? 'Chưa được ghi danh' : 'Không thể tải môn học'}
          description={
            error?.message ||
            'Mã môn học không tồn tại trên hệ thống hoặc bạn chưa có quyền truy cập.'
          }
          action={
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <Button variant="secondary" onClick={fetchCourseData} icon={<RefreshCw size={16} />}>
                Thử lại
              </Button>
              <Button variant="primary" onClick={() => navigate('/sv/mon-hoc')}>
                Về danh sách môn học
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="course-detail-page">
      <div className="course-detail-header-nav">
        <Breadcrumb
          items={[
            { label: 'Trang chủ', path: '/sv' },
            { label: 'Môn học', path: '/sv/mon-hoc' },
            { label: `${course.code} — ${course.name}` },
          ]}
        />
      </div>

      {course.status === 'archived' && (
        <div className="archived-banner" role="alert">
          <AlertCircle size={20} />
          <div>
            <strong>Môn học này đã được lưu trữ</strong>
            <p>Toàn bộ nội dung ở trạng thái chỉ đọc. Không thể chỉnh sửa hoặc thao tác ghi danh.</p>
          </div>
        </div>
      )}

      <header className="course-header">
        <div className="course-header-row">
          <div className="course-title-block">
            <div className="course-code-badge">{course.code}</div>
            <h1 className="course-title">{course.name}</h1>
            <p className="course-meta">
              <span>Học kỳ: <strong>{course.term}</strong></span>
              <span className="dot-divider">•</span>
              <span>Giảng viên: <strong>{course.teacher_name || 'Chưa phân công'}</strong></span>
              <span className="dot-divider">•</span>
              <span>
                Trạng thái:{' '}
                <Badge
                  variant={course.status === 'open' ? 'published' : 'archived'}
                  label={course.status === 'open' ? 'Đang học' : 'Đã lưu trữ'}
                />
              </span>
            </p>
          </div>

          <div className="course-header-actions">
            {course.status === 'open' && (
              <button
                type="button"
                className="withdraw-btn"
                onClick={() => setIsWithdrawModalOpen(true)}
                title="Rút khỏi môn học"
              >
                <LogOut size={16} />
                <span>Rút khỏi môn học</span>
              </button>
            )}
          </div>
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
          className={`course-tab-btn ${activeTab === 'hoc-lieu' ? 'active' : ''}`}
          onClick={() => handleSelectTab('hoc-lieu')}
          aria-selected={activeTab === 'hoc-lieu'}
        >
          <FileText size={18} />
          <span>Học liệu ({materialsTotal})</span>
        </button>
        <button
          className={`course-tab-btn ${activeTab === 'bai-tap' ? 'active' : ''}`}
          onClick={() => handleSelectTab('bai-tap')}
          aria-selected={activeTab === 'bai-tap'}
        >
          <FileText size={18} />
          <span>Bài tập</span>
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
          <span>Thông báo</span>
        </button>
      </nav>

      {/* Tab: NỘI DUNG BÀI HỌC */}
      {activeTab === 'noi-dung' && (
        <div className="course-content-layout">
          {/* Sidebar Chapter Tree */}
          <aside className="chapter-tree-sidebar" aria-label="Cây chương và bài học">
            <h2 className="sidebar-heading">Mục lục khóa học</h2>
            {chapters.length === 0 ? (
              <p className="sidebar-empty">Chưa có chương học nào được tạo.</p>
            ) : (
              <div className="chapters-list">
                {chapters.map((ch, chIdx) => {
                  const chLessons = lessons
                    .filter((l) => l.chapter === ch.id)
                    .sort((a, b) => a.position - b.position);
                  return (
                    <section key={ch.id} className="chapter-node">
                      <h3 className="chapter-title">
                        Chương {chIdx + 1}: {ch.title}
                      </h3>
                      {chLessons.length === 0 ? (
                        <p className="lesson-empty">Chưa có bài học</p>
                      ) : (
                        <ul className="lessons-list">
                          {chLessons.map((lesson) => {
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

          {/* Lesson Detail Panel */}
          <main className="lesson-detail-panel">
            {currentLesson ? (
              <article className="lesson-article">
                <header className="lesson-header">
                  <div className="lesson-breadcrumb-tag">
                    {chapters.find((ch) => ch.id === currentLesson.chapter)?.title || 'Bài học'}
                  </div>
                  <h2 className="lesson-main-title">{currentLesson.title}</h2>
                  <p className="lesson-description">
                    {currentLesson.description || 'Chưa có mô tả chi tiết cho bài học này.'}
                  </p>
                </header>

                <section className="lesson-materials-section">
                  <h3 className="materials-heading">
                    <FileText size={18} />
                    <span>Học liệu bài học ({lessonMaterials.length})</span>
                  </h3>
                  {lessonMaterials.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', margin: 'var(--space-2) 0' }}>
                      Chưa có học liệu nào được đính kèm cho bài học này.
                    </p>
                  ) : (
                    <div className="lesson-materials-grid">
                      {lessonMaterials.map((mat) => (
                        <div key={mat.id} className="lesson-material-card">
                          <div className="mat-card-icon">
                            <FileText size={20} />
                          </div>
                          <div className="mat-card-body">
                            <h4 className="mat-card-title">{mat.title}</h4>
                            <div className="mat-card-meta">
                              <span className="mat-type">{mat.material_type.toUpperCase()}</span>
                              <span className="mat-version">
                                v{mat.published_version_number || 1}
                              </span>
                              <span className="mat-files">{mat.file_count || 1} tệp</span>
                            </div>
                          </div>
                          <Button
                            variant="secondary"
                            onClick={() => navigate(`/sv/mon-hoc/${monId}/hoc-lieu/${mat.id}`)}
                          >
                            Xem học liệu
                          </Button>
                        </div>
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
                  ) : (
                    <div />
                  )}

                  {nextLesson && (
                    <button
                      type="button"
                      className="lesson-next-btn"
                      onClick={() => handleSelectLesson(nextLesson.id)}
                    >
                      <div className="text-right" style={{ textAlign: 'right' }}>
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
                  title="Chưa có bài học"
                  description="Môn học này hiện chưa có bài học nào được công bố."
                />
              </div>
            )}
          </main>
        </div>
      )}

      {/* Tab: HỌC LIỆU MÔN HỌC */}
      {activeTab === 'hoc-lieu' && (
        <section className="course-tab-panel">
          <div className="panel-header-row">
            <div>
              <h2 className="panel-title">Tài liệu học tập môn học</h2>
              <p className="panel-subtitle">
                Toàn bộ tài liệu bài giảng, giáo trình và tài liệu tham khảo chính thức của môn {course.code}.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => navigate(`/sv/tim-kiem?mon=${course.id}`)}
              icon={<Search size={16} />}
            >
              Tìm kiếm toàn văn môn này
            </Button>
          </div>

          {materialsError && <p role="alert">Không thể tải học liệu. <Button onClick={() => void fetchCourseData()}>Thử lại</Button></p>}
          {materialsTotal > materials.length && <p>Hiển thị {materials.length}/{materialsTotal} học liệu mới nhất. Dùng Tìm kiếm để xem đầy đủ.</p>}
          {!materialsError && materials.length === 0 ? (
            <div style={{ marginTop: 'var(--space-6)' }}>
              <EmptyState
                title="Chưa có học liệu"
                description="Giảng viên chưa công bố học liệu nào cho môn học này."
              />
            </div>
          ) : (
            <div className="course-materials-hub-grid" style={{ marginTop: 'var(--space-6)' }}>
              {materials.map((mat) => (
                <article key={mat.id} className="course-material-hub-card">
                  <div className="mat-hub-icon">
                    <FileText size={24} />
                  </div>
                  <div className="mat-hub-info">
                    <div className="mat-hub-top">
                      <span className="mat-type-pill">{mat.material_type.toUpperCase()}</span>
                      <span className="mat-version-pill">
                        v{mat.published_version_number || 1}
                      </span>
                      {mat.chapter_title && (
                        <span className="mat-chapter-pill">{mat.chapter_title}</span>
                      )}
                    </div>
                    <h3 className="mat-hub-title">{mat.title}</h3>
                    <div className="mat-hub-meta">
                      <span>{mat.file_count || 1} tệp đính kèm</span>
                      {Array.isArray(mat.tags) && mat.tags.length > 0 && (
                        <span className="mat-hub-tags">
                          {(mat.tags as string[]).map((t: string) => `#${t}`).join(' ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/sv/mon-hoc/${monId}/hoc-lieu/${mat.id}`)}
                  >
                    Xem chi tiết
                  </Button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Tab: BÀI TẬP */}
      {activeTab === 'bai-tap' && (
        <section className="course-tab-panel">
          <div className="panel-header-row">
            <div>
              <h2 className="panel-title">Danh sách bài tập môn học</h2>
              <p className="panel-subtitle">Theo dõi các bài tập và hạn nộp được giao.</p>
            </div>
          </div>
          <div className="feature-notice-box" role="status" style={{ marginTop: 'var(--space-4)' }}>
            <Info size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div>
              <strong>Phân hệ Bài tập & Đánh giá (B10-B12)</strong>
              <span>
                Phân hệ Bài tập đang được phát triển theo lộ trình B10-B12. Dữ liệu bài tập và nộp bài
                sẽ được kết nối trực tiếp với máy chủ tại các mốc tiếp theo.
              </span>
            </div>
          </div>
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
          </div>
          <div className="feature-notice-box" role="status" style={{ marginTop: 'var(--space-4)' }}>
            <Info size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div>
              <strong>Phân hệ Chấm điểm & Bảng điểm (B12)</strong>
              <span>
                Bảng điểm tổng hợp đang được phát triển tại phân hệ B12. Kết quả học tập và phản hồi
                chấm điểm sẽ được hiển thị khi phân hệ B12 được tích hợp.
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Tab: THÔNG BÁO */}
      {activeTab === 'thong-bao' && (
        <section className="course-tab-panel">
          <div className="panel-header-row">
            <div>
              <h2 className="panel-title">Thông báo từ giảng viên</h2>
              <p className="panel-subtitle">Các tin tức và cập nhật quan trọng từ giảng viên phụ trách môn học.</p>
            </div>
          </div>
          <div className="feature-notice-box" role="status" style={{ marginTop: 'var(--space-4)' }}>
            <Info size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div>
              <strong>Kênh thông báo lớp học</strong>
              <span>
                Kênh thông báo đang được nâng cấp đồng bộ theo thời gian thực với máy chủ.
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Modal xác nhận rút khỏi môn học */}
      <Modal
        isOpen={isWithdrawModalOpen}
        onClose={() => !isWithdrawing && setIsWithdrawModalOpen(false)}
        title="Xác nhận rút khỏi môn học"
        description={`Bạn có chắc chắn muốn rút khỏi môn học "${course.code} — ${course.name}"?`}
        size="sm"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <Button
              variant="secondary"
              onClick={() => setIsWithdrawModalOpen(false)}
              disabled={isWithdrawing}
            >
              Hủy bỏ
            </Button>
            <Button
              variant="danger"
              onClick={handleWithdraw}
              disabled={isWithdrawing}
              icon={<LogOut size={16} />}
            >
              {isWithdrawing ? 'Đang xử lý...' : 'Xác nhận rút môn'}
            </Button>
          </div>
        }
      >
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 var(--space-2) 0' }}>
            Sau khi rút khỏi môn học, bạn sẽ không còn quyền truy cập vào danh sách bài học và tài liệu của môn học này.
          </p>
          <p style={{ margin: 0, color: 'var(--danger, #dc2626)' }}>
            Lưu ý: Để tham gia lại môn học, bạn sẽ cần gửi yêu cầu ghi danh mới và chờ giảng viên phê duyệt.
          </p>
        </div>
      </Modal>
    </div>
  );
};
