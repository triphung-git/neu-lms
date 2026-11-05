import {uiText} from "../../../shared/i18n/translate";
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

  const loadSequence = useRef(0);

  const loadCourses = useCallback(async () => {
    const sequence = ++loadSequence.current;
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
      if (sequence !== loadSequence.current) return;
      setCourses(result.items);
      setTotalPages(result.pagination.total_pages);
      setTotalCourses(result.pagination.total_items);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(cause instanceof Error ? cause.message : uiText("Không thể tải danh mục môn học."));
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [page, search, statusFilter, term]);

  useEffect(() => {
    void loadCourses();
    return () => { loadSequence.current += 1; };
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
            { label: uiText("Bàn làm việc"), path: '/ad' },
            { label: uiText("Danh mục môn học toàn trường") },
          ]}
        />
        <h1 className="page-heading">{uiText("Quản lý môn học toàn trường")}</h1>
        <p className="page-subheading">
          {uiText("Theo dõi học phần, điều chuyển giảng viên và lưu trữ môn học.")}</p>
      </div>

      <div className="admin-notice-box" role="note">
        <AlertCircle size={18} />
        <span>
          <strong>{uiText("Lưu ý:")}</strong> {uiText(" Quản trị viên không biên soạn môn học hoặc truy cập học liệu và bài nộp. Chỉ giảng viên phụ trách mới được quản lý nội dung.")}</span>
      </div>

      <div className="filter-search-card">
        <div className="search-col">
          <TextField
            label={uiText("Tìm kiếm")}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={uiText("Tên môn, mã môn hoặc giảng viên")}
          />
        </div>
        <div className="filter-col">
          <TextField
            label={uiText("Học kỳ")}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            placeholder={uiText("Ví dụ: HK1-2026")}
          />
        </div>
        <div className="filter-col">
          <SelectField
            label={uiText("Trạng thái")}
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as CourseStatusFilter);
              setPage(1);
            }}
            options={[
              { value: 'all', label: uiText("Tất cả trạng thái") },
              { value: 'open', label: uiText("Đang mở") },
              { value: 'archived', label: uiText("Đã lưu trữ") },
            ]}
          />
        </div>
      </div>

      {error && (
        <ErrorBanner
          title={uiText("Không thể tải danh mục môn học")}
          message={error}
          onRetry={() => void loadCourses()}
        />
      )}

      {isLoading ? (
        <LoadingSkeleton lines={6} />
      ) : error ? null : courses.length === 0 ? (
        <EmptyState
          title={uiText("Không tìm thấy môn học phù hợp")}
          description={uiText("Không có môn học nào khớp với bộ lọc hiện tại.")}
          action={
            <Button variant="secondary" onClick={clearFilters}>
              {uiText("Xóa bộ lọc")}</Button>
          }
        />
      ) : (
        <>
          <div className="admin-table-container">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>{uiText("Mã môn")}</th>
                  <th>{uiText("Tên môn học")}</th>
                  <th>{uiText("Học kỳ")}</th>
                  <th>{uiText("Giảng viên")}</th>
                  <th>{uiText("Sinh viên")}</th>
                  <th>{uiText("Trạng thái")}</th>
                  <th>{uiText("Hành động")}</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td><span className="code-pill">{course.code}</span></td>
                    <td><strong>{course.name}</strong></td>
                    <td>{course.term}</td>
                    <td>{course.teacher_name || uiText("Giảng viên")}</td>
                    <td><span className="metric-pill">{course.active_member_count} {uiText(" sinh viên")}</span></td>
                    <td>
                      <Badge
                        variant={course.status === 'open' ? 'published' : 'archived'}
                        label={course.status === 'open' ? uiText("Đang mở") : uiText("Đã lưu trữ")}
                      />
                    </td>
                    <td>
                      <Link
                        to={`/ad/mon-hoc/${course.id}`}
                        className="npc-btn npc-btn-secondary npc-btn-sm"
                      >
                        <span>{uiText("Chi tiết & vận hành")}</span>
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="course-pagination" aria-label={uiText("Phân trang danh mục môn học")}>
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {uiText("Trang trước")}</Button>
              <span>Trang {page} / {totalPages} · {totalCourses} {uiText(" môn học")}</span>
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
