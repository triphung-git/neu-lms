import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  adminService,
  type AdminService,
  type AdminTeacherRequestItem,
} from '../../../api/adminService';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { TextField } from '../../../shared/ui/TextField';
import { Modal } from '../../../shared/ui/Modal';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { ApiError } from '../../../api/client';
import {
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  UserCheck,
} from 'lucide-react';
import './AdminTeacherApprovalPage.css';

const PAGE_SIZE = 10;

interface AdminTeacherApprovalPageProps {
  service?: AdminService;
}

export const AdminTeacherApprovalPage: React.FC<AdminTeacherApprovalPageProps> = ({
  service = adminService,
}) => {
  const searchInputId = useId();
  const { showNotification } = useNotifications();

  const [requests, setRequests] = useState<AdminTeacherRequestItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [searchInput, setSearchInput] = useState<string>('');
  const [activeSearch, setActiveSearch] = useState<string>('');

  // Loading & error
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Action Modals
  const [approveModalItem, setApproveModalItem] = useState<AdminTeacherRequestItem | null>(null);
  const [isSubmittingApprove, setIsSubmittingApprove] = useState<boolean>(false);

  const [rejectModalItem, setRejectModalItem] = useState<AdminTeacherRequestItem | null>(null);
  const [isSubmittingReject, setIsSubmittingReject] = useState<boolean>(false);

  const loadSequence = useRef(0);

  const fetchRequests = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await service.listTeacherRequests({
        status: statusFilter,
        search: activeSearch || undefined,
        page: currentPage,
        page_size: PAGE_SIZE,
      });

      if (sequence !== loadSequence.current) return;
      setRequests(res.items || []);
      setTotalCount(res.pagination?.total_items ?? (res.items ? res.items.length : 0));
    } catch (err: unknown) {
      if (sequence !== loadSequence.current) return;
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách yêu cầu giảng viên.';
      setErrorMessage(msg);
      setRequests([]);
      setTotalCount(0);
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [service, statusFilter, activeSearch, currentPage]);

  useEffect(() => {
    void fetchRequests();
    return () => { loadSequence.current += 1; };
  }, [fetchRequests]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(searchInput.trim());
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setSearchInput('');
    setActiveSearch('');
    setStatusFilter('pending');
    setCurrentPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages && newPage !== currentPage) {
      setCurrentPage(newPage);
    }
  };

  // APPROVE
  const handleApproveConfirm = async () => {
    if (!approveModalItem || isSubmittingApprove) return;
    setIsSubmittingApprove(true);
    try {
      await service.approveTeacherRequest(approveModalItem.id);
      showNotification(
        'success',
        `Đã phê duyệt vai trò Giảng viên cho tài khoản ${approveModalItem.user_display_name}.`
      );
      setApproveModalItem(null);
      await fetchRequests();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'email_not_verified') {
        showNotification('error', 'Không thể duyệt: Tài khoản người dùng chưa xác minh địa chỉ email.');
      } else {
        showNotification(
          'error',
          err instanceof Error ? err.message : 'Lỗi khi phê duyệt yêu cầu giảng viên.'
        );
      }
    } finally {
      setIsSubmittingApprove(false);
    }
  };

  // REJECT
  const handleRejectConfirm = async () => {
    if (!rejectModalItem || isSubmittingReject) return;
    setIsSubmittingReject(true);
    try {
      await service.rejectTeacherRequest(rejectModalItem.id);
      showNotification(
        'success',
        `Đã từ chối yêu cầu vai trò Giảng viên của ${rejectModalItem.user_display_name}.`
      );
      setRejectModalItem(null);
      await fetchRequests();
    } catch (err: unknown) {
      showNotification(
        'error',
        err instanceof Error ? err.message : 'Lỗi khi từ chối yêu cầu giảng viên.'
      );
    } finally {
      setIsSubmittingReject(false);
    }
  };

  return (
    <div className="admin-teacher-approval-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Duyệt giảng viên' },
          ]}
        />
        <h1 className="page-heading">Hàng đợi xét duyệt vai trò Giảng viên</h1>
        <p className="page-subheading">
          Danh sách yêu cầu vai trò Giảng viên. Chỉ tài khoản đã xác minh email mới được phê duyệt.
        </p>
      </div>

      {/* Status Filter Tabs */}
      <div className="approval-tabs-bar" role="tablist" aria-label="Bộ lọc trạng thái yêu cầu">
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'pending'}
          className={`approval-tab-btn ${statusFilter === 'pending' ? 'active' : ''}`}
          onClick={() => {
            setStatusFilter('pending');
            setCurrentPage(1);
          }}
        >
          <Clock size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
          <span>Chờ xét duyệt</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'approved'}
          className={`approval-tab-btn ${statusFilter === 'approved' ? 'active' : ''}`}
          onClick={() => {
            setStatusFilter('approved');
            setCurrentPage(1);
          }}
        >
          <CheckCircle size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
          <span>Đã phê duyệt</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'rejected'}
          className={`approval-tab-btn ${statusFilter === 'rejected' ? 'active' : ''}`}
          onClick={() => {
            setStatusFilter('rejected');
            setCurrentPage(1);
          }}
        >
          <XCircle size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
          <span>Đã từ chối</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'all'}
          className={`approval-tab-btn ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => {
            setStatusFilter('all');
            setCurrentPage(1);
          }}
        >
          <span>Tất cả yêu cầu</span>
        </button>
      </div>

      {/* Search and Filters */}
      <form onSubmit={handleSearchSubmit} className="filter-search-card">
        <div className="search-col" style={{ flex: 1 }}>
          <TextField
            id={searchInputId}
            label="Tìm kiếm yêu cầu"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo họ tên hoặc email người gửi yêu cầu..."
          />
        </div>

        <div className="filter-actions-col" style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <Button type="submit" variant="primary">
            Tìm kiếm
          </Button>
          {(activeSearch || statusFilter !== 'pending') && (
            <Button type="button" variant="secondary" onClick={handleClearFilters} icon={<RotateCcw size={14} />}>
              Đặt lại
            </Button>
          )}
        </div>
      </form>

      {/* Error state */}
      {errorMessage && (
        <ErrorBanner
          title="Không thể tải danh sách xét duyệt"
          message={errorMessage}
          onRetry={fetchRequests}
        />
      )}

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="approval-table-wrapper" style={{ padding: 'var(--space-6)' }}>
          <LoadingSkeleton lines={6} height="36px" />
        </div>
      ) : errorMessage ? null : requests.length === 0 ? (
        /* Empty State */
        <EmptyState
          title="Không có yêu cầu giảng viên nào"
          description={
            statusFilter === 'pending'
              ? 'Hiện không có giảng viên nào đang chờ phê duyệt trong hệ thống.'
              : 'Không có bản ghi yêu cầu nào phù hợp với bộ lọc hiện tại.'
          }
          action={
            (activeSearch || statusFilter !== 'pending') ? (
              <Button variant="secondary" onClick={handleClearFilters}>
                Xem yêu cầu chờ duyệt
              </Button>
            ) : undefined
          }
        />
      ) : (
        /* Table of Requests */
        <div className="approval-table-wrapper">
          <table className="npc-table" aria-label="Bảng yêu cầu vai trò giảng viên">
            <thead>
              <tr>
                <th scope="col">Họ và tên</th>
                <th scope="col">Địa chỉ Email</th>
                <th scope="col">Thời điểm gửi</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Thời điểm duyệt</th>
                <th scope="col">Ghi chú</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id}>
                  <td>
                    <Link to={`/ad/tai-khoan/${req.user_id}`} className="teacher-name-link">
                      <strong>{req.user_display_name}</strong>
                    </Link>
                  </td>
                  <td>{req.user_email}</td>
                  <td>{formatDateVN(req.requested_at)}</td>
                  <td>
                    <Badge
                      variant={
                        req.status === 'approved'
                          ? 'published'
                          : req.status === 'pending'
                          ? 'draft'
                          : 'archived'
                      }
                      label={
                        req.status === 'approved'
                          ? 'Đã duyệt'
                          : req.status === 'pending'
                          ? 'Chờ duyệt'
                          : req.status === 'rejected'
                          ? 'Đã từ chối'
                          : 'Đã hủy'
                      }
                    />
                  </td>
                  <td>{req.reviewed_at ? formatDateVN(req.reviewed_at) : '—'}</td>
                  <td>
                    <span className="text-xs text-muted">{req.review_reason || '—'}</span>
                  </td>
                  <td>
                    <div className="actions-cell-wrap">
                      {req.status === 'pending' ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setApproveModalItem(req)}
                            icon={<CheckCircle size={14} />}
                            aria-label={`Duyệt yêu cầu của ${req.user_display_name}`}
                          >
                            <span>Duyệt</span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setRejectModalItem(req)}
                            icon={<XCircle size={14} />}
                            aria-label={`Từ chối yêu cầu của ${req.user_display_name}`}
                          >
                            <span>Từ chối</span>
                          </Button>
                        </>
                      ) : (
                        <Link
                          to={`/ad/tai-khoan/${req.user_id}`}
                          className="npc-btn npc-btn-secondary npc-btn-sm"
                          aria-label={`Xem tài khoản ${req.user_display_name}`}
                        >
                          <span>Xem tài khoản</span>
                          <ArrowRight size={14} />
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          <div className="table-pagination-bar">
            <span className="page-info-text">
              Hiển thị {(currentPage - 1) * PAGE_SIZE + 1} -{' '}
              {Math.min(currentPage * PAGE_SIZE, totalCount)} trên tổng số {totalCount} yêu cầu
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

      {/* APPROVE MODAL */}
      {approveModalItem && (
        <Modal
          title="Xác nhận phê duyệt Giảng viên"
          isOpen={Boolean(approveModalItem)}
          onClose={() => setApproveModalItem(null)}
        >
          <div className="modal-content-stack">
            <p>
              Bạn chuẩn bị phê duyệt yêu cầu vai trò Giảng viên cho người dùng{' '}
              <strong>{approveModalItem.user_display_name}</strong> ({approveModalItem.user_email}).
            </p>
            <div className="alert-warning-card">
              <UserCheck size={18} />
              <span>
                <strong>Cấp quyền & Làm mới phiên:</strong> Sau khi phê duyệt, tài khoản sẽ được cấp vai trò Giảng viên (`teacher`) chính thức trong hệ thống. Phiên làm việc hiện tại của người dùng sẽ được thu hồi để nhận quyền hạn mới ngay khi đăng nhập lại hoặc làm mới trang.
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setApproveModalItem(null)}>
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="primary"
                isLoading={isSubmittingApprove}
                onClick={handleApproveConfirm}
              >
                Xác nhận phê duyệt
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* REJECT MODAL */}
      {rejectModalItem && (
        <Modal
          title="Xác nhận từ chối yêu cầu"
          isOpen={Boolean(rejectModalItem)}
          onClose={() => setRejectModalItem(null)}
        >
          <div className="modal-content-stack">
            <p>
              Bạn chuẩn bị từ chối yêu cầu vai trò Giảng viên của người dùng{' '}
              <strong>{rejectModalItem.user_display_name}</strong> ({rejectModalItem.user_email}).
            </p>
            <p className="text-sm text-muted">
              Yêu cầu sẽ được chuyển sang trạng thái <strong>Đã từ chối (rejected)</strong>. Người dùng vẫn giữ các vai trò học tập hiện tại.
            </p>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setRejectModalItem(null)}>
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="danger"
                isLoading={isSubmittingReject}
                onClick={handleRejectConfirm}
              >
                Xác nhận từ chối
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
