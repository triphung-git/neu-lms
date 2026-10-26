import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { coursesService, type Course } from '../../../api/coursesService';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { ArrowRight, Plus, Users } from 'lucide-react';
import './TeacherCoursesPage.css';

type CourseStatus = 'open' | 'archived';

interface CoursePage {
  page: number;
  total_pages: number;
  total_items: number;
}

export const TeacherCoursesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<CourseStatus>('open');
  const [courses, setCourses] = useState<Course[]>([]);
  const [pageInfo, setPageInfo] = useState<CoursePage>({
    page: 1,
    total_pages: 1,
    total_items: 0,
  });
  const [counts, setCounts] = useState<Record<CourseStatus, number>>({ open: 0, archived: 0 });
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadSequence = useRef(0);

  const loadCourses = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setIsLoading(true);
    setError(null);
    try {
      const [result, openCount, archivedCount] = await Promise.all([
        coursesService.list({ status: activeTab, page, page_size: 20 }),
        coursesService.list({ status: 'open', page: 1, page_size: 1 }),
        coursesService.list({ status: 'archived', page: 1, page_size: 1 }),
      ]);
      if (sequence !== loadSequence.current) return;
      setCourses(result.items);
      setPageInfo({
        page: result.pagination.page,
        total_pages: result.pagination.total_pages,
        total_items: result.pagination.total_items,
      });
      setCounts({
        open: openCount.pagination.total_items,
        archived: archivedCount.pagination.total_items,
      });
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách môn học.');
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [activeTab, page]);

  useEffect(() => {
    void loadCourses();
    return () => { loadSequence.current += 1; };
  }, [loadCourses]);

  const chooseTab = (tab: CourseStatus) => {
    setActiveTab(tab);
    setPage(1);
  };

  return (
    <div className="teacher-courses-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: 'Môn học của tôi' },
            ]}
          />
          <h1 className="page-main-heading">Môn học phụ trách</h1>
          <p className="page-subtitle">Quản lý cấu trúc học phần và theo dõi sinh viên.</p>
        </div>
        <Link to="/gv/mon-hoc/tao" className="npc-btn npc-btn-primary">
          <Plus size={18} />
          <span>Tạo môn học mới</span>
        </Link>
      </div>

      <div className="courses-tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'open'}
          className={`tab-item-btn ${activeTab === 'open' ? 'active' : ''}`}
          onClick={() => chooseTab('open')}
        >
          <span>Đang giảng dạy</span>
          <span className="tab-count-chip">{counts.open}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'archived'}
          className={`tab-item-btn ${activeTab === 'archived' ? 'active' : ''}`}
          onClick={() => chooseTab('archived')}
        >
          <span>Đã lưu trữ</span>
          <span className="tab-count-chip">{counts.archived}</span>
        </button>
      </div>

      {error && (
        <ErrorBanner
          title="Không thể tải môn học"
          message={error}
          onRetry={() => void loadCourses()}
        />
      )}

      {isLoading ? (
        <LoadingSkeleton lines={5} />
      ) : error ? null : courses.length === 0 ? (
        activeTab === 'open' ? (
          <EmptyState
            title="Chưa có môn học nào đang mở"
            description="Bạn chưa khởi tạo hoặc đang không phụ trách môn học nào trong học kỳ này."
            action={
              <Button variant="primary" onClick={() => navigate('/gv/mon-hoc/tao')}>
                Tạo môn học đầu tiên
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Chưa có môn học nào được lưu trữ"
            description="Các môn học đã lưu trữ sẽ xuất hiện tại đây ở trạng thái chỉ đọc."
          />
        )
      ) : (
        <>
          <div className="courses-cards-grid">
            {courses.map((course) => (
              <div key={course.id} className="teacher-course-card">
                <div className="course-card-top">
                  <span className="course-code-pill">{course.code}</span>
                  <Badge
                    variant={course.status === 'open' ? 'published' : 'archived'}
                    label={course.status === 'open' ? 'Đang mở' : 'Đã lưu trữ'}
                  />
                </div>

                <h2 className="course-card-name">
                  <Link to={`/gv/mon-hoc/${course.id}`} className="course-title-link">
                    {course.name}
                  </Link>
                </h2>
                <p className="course-card-term">Học kỳ: {course.term}</p>
                <p className="course-card-desc">{course.description || 'Chưa có mô tả môn học.'}</p>

                <div className="course-card-metrics">
                  <div className="metric-item">
                    <Users size={16} />
                    <span>{course.active_member_count} sinh viên</span>
                  </div>
                </div>

                <div className="course-card-actions">
                  <Link
                    to={`/gv/mon-hoc/${course.id}`}
                    className="npc-btn npc-btn-secondary npc-btn-sm w-full"
                  >
                    <span>Vào quản lý môn</span>
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
          {pageInfo.total_pages > 1 && (
            <div className="course-pagination" aria-label="Phân trang môn học">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Trang trước
              </Button>
              <span>
                Trang {pageInfo.page} / {pageInfo.total_pages} · {pageInfo.total_items} môn
              </span>
              <Button
                variant="secondary"
                disabled={page >= pageInfo.total_pages}
                onClick={() => setPage((current) => current + 1)}
              >
                Trang sau
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
