import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { removeVietnameseAccents } from '../../../shared/lib/search';
import { AlertCircle, ArrowRight } from 'lucide-react';
import './AdminCoursesPage.css';

export const AdminCoursesPage: React.FC = () => {
  const { courses, memberships, materials, users } = useDatabase();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'archived'>('all');
  const [termFilter, setTermFilter] = useState('all');

  // Terms list
  const termsList = useMemo(() => {
    return Array.from(new Set(courses.map(c => c.term)));
  }, [courses]);

  // Filtered courses
  const filteredCourses = useMemo(() => {
    return courses.filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (termFilter !== 'all' && c.term !== termFilter) return false;

      if (searchQuery.trim()) {
        const qNorm = removeVietnameseAccents(searchQuery.toLowerCase());
        const nameNorm = removeVietnameseAccents(c.name.toLowerCase());
        const codeNorm = c.code.toLowerCase();
        const teacher = users.find(u => u.id === c.teacherId);
        const teacherNorm = removeVietnameseAccents((teacher?.fullName || '').toLowerCase());

        return (
          nameNorm.includes(qNorm) ||
          codeNorm.includes(qNorm) ||
          teacherNorm.includes(qNorm)
        );
      }
      return true;
    });
  }, [courses, users, statusFilter, termFilter, searchQuery]);

  return (
    <div className="admin-courses-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Danh mục môn học toàn trường' }
          ]}
        />
        <h1 className="page-heading">Quản lý môn học toàn trường</h1>
        <p className="page-subheading">
          Theo dõi tổng thể các lớp học phần, tình trạng giảng dạy và thực hiện các nghiệp vụ vận hành ngoại lệ.
        </p>
      </div>

      <div className="admin-notice-box" role="note">
        <AlertCircle size={18} />
        <span>
          <strong>Lưu ý nghiệp vụ:</strong> Quản trị viên không có quyền trực tiếp khởi tạo môn học. Chức năng tạo môn do Giảng viên thực hiện. Quản trị viên chỉ can thiệp điều chuyển giảng viên hoặc cưỡng chế lưu trữ khi cần thiết.
        </span>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-search-card">
        <div className="search-col">
          <TextField
            label="Tìm kiếm môn học"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên môn, mã môn, hoặc giảng viên..."
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Trạng thái"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            options={[
              { value: 'all', label: 'Tất cả trạng thái' },
              { value: 'open', label: 'Đang mở (Open)' },
              { value: 'archived', label: 'Đã lưu trữ (Archived)' }
            ]}
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Học kỳ"
            value={termFilter}
            onChange={e => setTermFilter(e.target.value)}
            options={[
              { value: 'all', label: 'Tất cả học kỳ' },
              ...termsList.map(t => ({ value: t, label: t }))
            ]}
          />
        </div>
      </div>

      {/* Courses Table */}
      {filteredCourses.length === 0 ? (
        <EmptyState
          title="Không tìm thấy môn học phù hợp"
          description="Không có môn học nào khớp với bộ lọc tìm kiếm hiện tại."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setTermFilter('all');
              }}
            >
              Xóa bộ lọc
            </Button>
          }
        />
      ) : (
        <div className="admin-table-container">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Mã môn</th>
                <th>Tên môn học</th>
                <th>Học kỳ</th>
                <th>Giảng viên</th>
                <th>Sinh viên</th>
                <th>Học liệu</th>
                <th>Trạng thái</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {filteredCourses.map(course => {
                const svCount = memberships.filter(
                  m => m.courseId === course.id && m.status === 'active'
                ).length;
                const matCount = materials.filter(m => m.courseId === course.id).length;
                const teacher = users.find(u => u.id === course.teacherId);

                return (
                  <tr key={course.id}>
                    <td>
                      <span className="code-pill">{course.code}</span>
                    </td>
                    <td>
                      <strong>{course.name}</strong>
                    </td>
                    <td>{course.term}</td>
                    <td>{teacher?.fullName || 'Giảng viên'}</td>
                    <td>
                      <span className="metric-pill">{svCount} sinh viên</span>
                    </td>
                    <td>
                      <span className="metric-pill">{matCount} học liệu</span>
                    </td>
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
                        <span>Chi tiết & Vận hành</span>
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
