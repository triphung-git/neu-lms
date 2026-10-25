import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { coursesService, type Course } from '../../../api/coursesService';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { SelectField, TextField } from '../../../shared/ui/TextField';
import { AlertCircle, ArrowRight } from 'lucide-react';
import './AdminCoursesPage.css';

type CourseStatusFilter = 'all' | 'open' | 'archived';

export const AdminCoursesPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<CourseStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCourses, setTotalCourses] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCourses = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await coursesService.list({
        search: search.trim() || undefined,
        term: term.trim() || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        page,
        page_size: 20,
      });
      setCourses(result.items);
      setTotalPages(result.pagination.total_pages);
      setTotalCourses(result.pagination.total_items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải danh mục môn học.');
    } finally {
      setIsLoading(false);
    }
  }, [page, search, statusFilter, term]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  const clearFilters = () => {
    setSearch('');
    setTerm('');
    setStatusFilter('all');
    setPage(1);
  };

  return (
    <div className="admin-courses-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Danh mục môn học toàn trường' },
          ]}
        />
        <h1 className="page-heading">Quản lý môn học toàn trường</h1>
        <p className="page-subheading">
          Theo dõi học phần, điều chuyển giảng viên và lưu trữ môn học.
        </p>
      </div>

      <div className="admin-notice-box" role="note">
        <AlertCircle size={18} />
        <span>
          <strong>Lưu ý:</strong> Quản trị viên không biên soạn môn học hoặc truy cập học liệu và bài nộp.
          Chỉ giảng viên phụ trách mới được quản lý nội dung.
        </span>
      </div>

      <div className="filter-search-card">
        <div className="search-col">
          <TextField
            label="Tìm kiếm"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Tên môn, mã môn hoặc giảng viên"
          />
        </div>
        <div className="filter-col">
          <TextField
            label="Học kỳ"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            placeholder="Ví dụ: HK1-2026"
          />
        </div>
        <div className="filter-col">
          <SelectField
            label="Trạng thái"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as CourseStatusFilter);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'Tất cả trạng thái' },
              { value: 'open', label: 'Đang mở' },
              { value: 'archived', label: 'Đã lưu trữ' },
            ]}
          />
        </div>
      </div>

      {error && (
        <ErrorBanner
          title="Không thể tải danh mục môn học"
          message={error}
          onRetry={() => void loadCourses()}
        />
      )}

      {isLoading ? (
        <LoadingSkeleton lines={6} />
      ) : courses.length === 0 ? (
        <EmptyState
          title="Không tìm thấy môn học phù hợp"
          description="Không có môn học nào khớp với bộ lọc hiện tại."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Xóa bộ lọc
            </Button>
          }
        />
      ) : (
        <>
          <div className="admin-table-container">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Mã môn</th>
                  <th>Tên môn học</th>
                  <th>Học kỳ</th>
                  <th>Giảng viên</th>
                  <th>Sinh viên</th>
                  <th>Trạng thái</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td><span className="code-pill">{course.code}</span></td>
                    <td><strong>{course.name}</strong></td>
                    <td>{course.term}</td>
                    <td>{course.teacher_name || 'Giảng viên'}</td>
                    <td><span className="metric-pill">{course.active_member_count} sinh viên</span></td>
                    <td>
                      <Badge
                        variant={course.status === 'open' ? 'published' : 'archived'}
                        label={course.status === 'open' ? 'Đang mở' : 'Đã lưu trữ'}
                      />
                    </td>
                    <td>
                      <Link
                        to={`/ad/mon-hoc/${course.id}`}
                        className="npc-btn npc-btn-secondary npc-btn-sm"
                      >
                        <span>Chi tiết & vận hành</span>
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="course-pagination" aria-label="Phân trang danh mục môn học">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Trang trước
              </Button>
              <span>Trang {page} / {totalPages} · {totalCourses} môn học</span>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
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
