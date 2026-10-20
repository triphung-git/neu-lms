import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { removeVietnameseAccents } from '../../../shared/lib/search';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import './AdminAccountsPage.css';

const PAGE_SIZE = 10;

export const AdminAccountsPage: React.FC = () => {
  const { users } = useDatabase();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'teacher' | 'admin'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'locked'>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Filter accounts
  const filteredAccounts = useMemo(() => {
    return users.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const qNorm = removeVietnameseAccents(searchQuery.toLowerCase());
        const nameNorm = removeVietnameseAccents(u.fullName.toLowerCase());
        const emailNorm = u.emailNormalized.toLowerCase();
        return nameNorm.includes(qNorm) || emailNorm.includes(qNorm);
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, searchQuery]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  const paginatedAccounts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredAccounts.slice(start, start + PAGE_SIZE);
  }, [filteredAccounts, currentPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  return (
    <div className="admin-accounts-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Tài khoản người dùng' }
          ]}
        />
        <h1 className="page-heading">Quản lý tài khoản hệ thống</h1>
        <p className="page-subheading">
          Danh sách toàn bộ tài khoản Sinh viên, Giảng viên và Quản trị viên trong cơ sở dữ liệu.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-search-card">
        <div className="search-col">
          <TextField
            label="Tìm kiếm người dùng"
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Tìm theo tên hoặc email người dùng..."
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Vai trò"
            value={roleFilter}
            onChange={e => {
              setRoleFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            options={[
              { value: 'all', label: 'Tất cả vai trò' },
              { value: 'student', label: 'Sinh viên' },
              { value: 'teacher', label: 'Giảng viên' },
              { value: 'admin', label: 'Quản trị viên' }
            ]}
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Trạng thái"
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            options={[
              { value: 'all', label: 'Tất cả trạng thái' },
              { value: 'active', label: 'Đang hoạt động' },
              { value: 'locked', label: 'Đã bị khóa' }
            ]}
          />
        </div>
      </div>

      {/* Table */}
      {filteredAccounts.length === 0 ? (
        <EmptyState
          title="Không tìm thấy tài khoản"
          description="Không có tài khoản nào phù hợp với bộ lọc tìm kiếm hiện tại."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearchQuery('');
                setRoleFilter('all');
                setStatusFilter('all');
                setCurrentPage(1);
              }}
            >
              Xóa bộ lọc
            </Button>
          }
        />
      ) : (
        <div className="accounts-table-wrapper">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Họ và tên</th>
                <th>Email tài khoản</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Đăng nhập gần nhất</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {paginatedAccounts.map(acc => (
                <tr key={acc.id}>
                  <td>
                    <Link to={`/ad/tai-khoan/${acc.id}`} className="acc-name-link">
                      <strong>{acc.fullName}</strong>
                    </Link>
                  </td>
                  <td>{acc.emailNormalized}</td>
                  <td>
                    <span className="role-pill">
                      {acc.role === 'admin' ? 'Quản trị viên' : acc.role === 'teacher' ? 'Giảng viên' : 'Sinh viên'}
                    </span>
                  </td>
                  <td>
                    <Badge
                      variant={acc.status === 'active' ? 'published' : 'archived'}
                      label={acc.status === 'active' ? 'Hoạt động' : 'Đã khóa'}
                    />
                  </td>
                  <td>{formatDateVN(acc.lastLoginAt)}</td>
                  <td>
                    <Link to={`/ad/tai-khoan/${acc.id}`} className="npc-btn npc-btn-secondary npc-btn-sm">
                      <span>Chi tiết</span>
                      <ArrowRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls (page10) */}
          <div className="table-pagination-bar">
            <span className="page-info-text">
              Hiển thị {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(currentPage * PAGE_SIZE, filteredAccounts.length)} trên tổng số {filteredAccounts.length} tài khoản
            </span>

            <div className="pagination-buttons">
              <button
                type="button"
                className="page-btn"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Trang trước"
              >
                <ChevronLeft size={16} />
                <span>Trước</span>
              </button>

              <span className="current-page-pill">{currentPage} / {totalPages}</span>

              <button
                type="button"
                className="page-btn"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                aria-label="Trang sau"
              >
                <span>Sau</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
