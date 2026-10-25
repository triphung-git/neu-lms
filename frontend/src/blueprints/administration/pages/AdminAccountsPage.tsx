import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { adminService, type AdminService, type AdminAccountListItem } from '../../../api/adminService';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { ArrowRight, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import './AdminAccountsPage.css';

const PAGE_SIZE = 10;

interface AdminAccountsPageProps {
  service?: AdminService;
}

export const AdminAccountsPage: React.FC<AdminAccountsPageProps> = ({
  service = adminService,
}) => {
  const searchInputId = useId();
  const [accounts, setAccounts] = useState<AdminAccountListItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Filters
  const [searchInput, setSearchInput] = useState<string>('');
  const [activeSearch, setActiveSearch] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'teacher' | 'admin'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'locked'>('all');
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all');

  // Loading & error
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSequence = useRef(0);

  const fetchAccounts = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await service.listAccounts({
        page: currentPage,
        page_size: PAGE_SIZE,
        search: activeSearch || undefined,
        role: roleFilter !== 'all' ? roleFilter : undefined,
        is_active: statusFilter === 'active' ? true : statusFilter === 'locked' ? false : undefined,
        email_verified:
          verifiedFilter === 'verified' ? true : verifiedFilter === 'unverified' ? false : undefined,
      });

      if (sequence !== loadSequence.current) return;
      setAccounts(res.items || []);
      setTotalCount(res.pagination?.total_items ?? (res.items ? res.items.length : 0));
    } catch (err: unknown) {
      if (sequence !== loadSequence.current) return;
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách tài khoản từ máy chủ.';
      setErrorMessage(msg);
      setAccounts([]);
      setTotalCount(0);
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [service, currentPage, activeSearch, roleFilter, statusFilter, verifiedFilter]);

  useEffect(() => {
    void fetchAccounts();
    return () => { loadSequence.current += 1; };
  }, [fetchAccounts]);

  // Handle Search Submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(searchInput.trim());
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setSearchInput('');
    setActiveSearch('');
    setRoleFilter('all');
    setStatusFilter('all');
    setVerifiedFilter('all');
    setCurrentPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages && newPage !== currentPage) {
      setCurrentPage(newPage);
    }
  };

  const renderRolePills = (roles: string[]) => {
    if (!roles || roles.length === 0) {
      return <span className="text-muted text-sm">(Chưa có vai trò)</span>;
    }
    return (
      <div className="role-pills-wrap" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {roles.map((r) => {
          let label = r;
          if (r === 'admin') label = 'Quản trị viên';
          else if (r === 'teacher') label = 'Giảng viên';
          else if (r === 'student') label = 'Sinh viên';
          return (
            <span key={r} className={`role-pill role-pill-${r}`}>
              {label}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="admin-accounts-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Tài khoản người dùng' },
          ]}
        />
        <h1 className="page-heading">Quản lý tài khoản hệ thống</h1>
        <p className="page-subheading">
          Danh sách toàn bộ tài khoản Sinh viên, Giảng viên và Quản trị viên lấy trực tiếp từ máy chủ.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <form onSubmit={handleSearchSubmit} className="filter-search-card">
        <div className="search-col">
          <TextField
            id={searchInputId}
            label="Tìm kiếm người dùng"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tên hoặc email người dùng..."
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Vai trò"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            options={[
              { value: 'all', label: 'Tất cả vai trò' },
              { value: 'student', label: 'Sinh viên' },
              { value: 'teacher', label: 'Giảng viên' },
              { value: 'admin', label: 'Quản trị viên' },
            ]}
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Trạng thái tài khoản"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            options={[
              { value: 'all', label: 'Tất cả trạng thái' },
              { value: 'active', label: 'Đang hoạt động' },
              { value: 'locked', label: 'Đã bị khóa' },
            ]}
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Xác minh email"
            value={verifiedFilter}
            onChange={(e) => {
              setVerifiedFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            options={[
              { value: 'all', label: 'Tất cả email' },
              { value: 'verified', label: 'Đã xác minh' },
              { value: 'unverified', label: 'Chưa xác minh' },
            ]}
          />
        </div>

        <div className="filter-actions-col" style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <Button type="submit" variant="primary">
            Tìm kiếm
          </Button>
          {(activeSearch || roleFilter !== 'all' || statusFilter !== 'all' || verifiedFilter !== 'all') && (
            <Button type="button" variant="secondary" onClick={handleClearFilters} icon={<RotateCcw size={14} />}>
              Đặt lại
            </Button>
          )}
        </div>
      </form>

      {/* Error state */}
      {errorMessage && (
        <ErrorBanner
          title="Không thể tải dữ liệu tài khoản"
          message={errorMessage}
          onRetry={fetchAccounts}
        />
      )}

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="accounts-table-wrapper" style={{ padding: 'var(--space-6)' }}>
          <LoadingSkeleton lines={6} height="36px" />
        </div>
      ) : errorMessage ? null : accounts.length === 0 ? (
        /* Empty State */
        <EmptyState
          title="Không tìm thấy tài khoản"
          description={
            activeSearch || roleFilter !== 'all' || statusFilter !== 'all' || verifiedFilter !== 'all'
              ? 'Không có tài khoản nào phù hợp với bộ lọc tìm kiếm hiện tại.'
              : 'Hiện chưa có tài khoản nào trong hệ thống.'
          }
          action={
            (activeSearch || roleFilter !== 'all' || statusFilter !== 'all' || verifiedFilter !== 'all') ? (
              <Button variant="secondary" onClick={handleClearFilters}>
                Xóa bộ lọc
              </Button>
            ) : undefined
          }
        />
      ) : (
        /* Data Table */
        <div className="accounts-table-wrapper">
          <table className="npc-table" aria-label="Bảng tài khoản người dùng">
            <thead>
              <tr>
                <th scope="col">Họ và tên</th>
                <th scope="col">Email tài khoản</th>
                <th scope="col">Vai trò đã cấp</th>
                <th scope="col">Email xác minh</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Ngày tạo</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => (
                <tr key={acc.id}>
                  <td>
                    <Link to={`/ad/tai-khoan/${acc.id}`} className="acc-name-link">
                      <strong>{acc.display_name}</strong>
                    </Link>
                  </td>
                  <td>{acc.email}</td>
                  <td>{renderRolePills(acc.roles)}</td>
                  <td>
                    <Badge
                      variant={acc.email_verified ? 'published' : 'draft'}
                      label={acc.email_verified ? 'Đã xác minh' : 'Chưa xác minh'}
                    />
                  </td>
                  <td>
                    <Badge
                      variant={acc.is_active ? 'published' : 'archived'}
                      label={acc.is_active ? 'Hoạt động' : 'Đã khóa'}
                    />
                  </td>
                  <td>{formatDateVN(acc.created_at)}</td>
                  <td>
                    <Link
                      to={`/ad/tai-khoan/${acc.id}`}
                      className="npc-btn npc-btn-secondary npc-btn-sm"
                      aria-label={`Chi tiết tài khoản ${acc.display_name}`}
                    >
                      <span>Chi tiết</span>
                      <ArrowRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          <div className="table-pagination-bar">
            <span className="page-info-text">
              Hiển thị {(currentPage - 1) * PAGE_SIZE + 1} -{' '}
              {Math.min(currentPage * PAGE_SIZE, totalCount)} trên tổng số {totalCount} tài khoản
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

              <span className="current-page-pill" aria-current="page">
                {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                className="page-btn"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
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
