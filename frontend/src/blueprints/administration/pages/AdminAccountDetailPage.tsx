import {uiText} from "../../../shared/i18n/translate";
import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  adminService,
  type AdminService,
  type AdminAccountDetail,
  type AdminAccountRoleItem,
  type AdminAccountRoleRequestItem,
} from '../../../api/adminService';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { ApiError } from '../../../api/client';
import {
  ShieldAlert,
  Lock,
  Unlock,
  ShieldCheck,
  AlertTriangle,
  KeyRound,
  Trash2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import './AdminAccountDetailPage.css';

interface AdminAccountDetailPageProps {
  service?: AdminService;
}

export const AdminAccountDetailPage: React.FC<AdminAccountDetailPageProps> = ({
  service = adminService,
}) => {
  const params = useParams<{ taiKhoanId?: string; id?: string }>();
  const taiKhoanId = params.taiKhoanId || params.id;
  const { currentUser } = useSession();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const [account, setAccount] = useState<AdminAccountDetail | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals state
  const [showLockModal, setShowLockModal] = useState<boolean>(false);
  const [lockPassword, setLockPassword] = useState<string>('');
  const [isSubmittingLock, setIsSubmittingLock] = useState<boolean>(false);

  const [showGrantAdminModal, setShowGrantAdminModal] = useState<boolean>(false);
  const [grantPassword, setGrantPassword] = useState<string>('');
  const [isSubmittingGrant, setIsSubmittingGrant] = useState<boolean>(false);

  const [showRevokeModal, setShowRevokeModal] = useState<boolean>(false);
  const [revokeTargetGrant, setRevokeTargetGrant] = useState<AdminAccountRoleItem | null>(null);
  const [revokePassword, setRevokePassword] = useState<string>('');
  const [isSubmittingRevoke, setIsSubmittingRevoke] = useState<boolean>(false);

  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [isSubmittingReset, setIsSubmittingReset] = useState<boolean>(false);

  const [showApproveRequestModal, setShowApproveRequestModal] = useState<boolean>(false);
  const [selectedRequest, setSelectedRequest] = useState<AdminAccountRoleRequestItem | null>(null);
  const [isSubmittingRequestAction, setIsSubmittingRequestAction] = useState<boolean>(false);

  const [showRejectRequestModal, setShowRejectRequestModal] = useState<boolean>(false);

  // Field IDs
  const lockPasswordId = useId();
  const grantPasswordId = useId();
  const revokePasswordId = useId();

  // Self guard
  const isSelf = Boolean(account && currentUser && account.id === currentUser.id);

  // Target has active admin role?
  const hasActiveAdminRole = Boolean(
    account?.roles.some((r) => r.role === 'admin' && !r.revoked_at)
  );

  const loadSequence = useRef(0);

  const fetchAccount = useCallback(async () => {
    if (!taiKhoanId) return;
    const sequence = ++loadSequence.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await service.getAccount(taiKhoanId);
      if (sequence !== loadSequence.current) return;
      setAccount(data);
    } catch (err: unknown) {
      if (sequence !== loadSequence.current) return;
      if (err instanceof ApiError && err.status === 404) {
        setAccount(null);
        setErrorMessage(uiText("Tài khoản không tồn tại trên hệ thống."));
      } else {
        const msg = err instanceof Error ? err.message : uiText("Không thể tải thông tin tài khoản.");
        setErrorMessage(msg);
      }
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [service, taiKhoanId]);

  useEffect(() => {
    void fetchAccount();
    return () => { loadSequence.current += 1; };
  }, [fetchAccount]);

  const handleApiError = (err: unknown, defaultMessage: string) => {
    if (err instanceof ApiError) {
      if (err.code === 'last_active_admin') {
        showNotification(
          'error',
          uiText("Thao tác bị từ chối: Đây là Quản trị viên hoạt động duy nhất còn lại của hệ thống.")
        );
        return;
      }
      if (err.code === 'reauth_required') {
        showNotification(
          'error',
          uiText("Yêu cầu xác thực: Vui lòng nhập mật khẩu hiện tại của bạn để thực hiện thao tác nhạy cảm này.")
        );
        return;
      }
      if (err.code === 'invalid_credentials') {
        showNotification('error', uiText("Mật khẩu xác thực hiện tại không chính xác."));
        return;
      }
      showNotification('error', err.message || defaultMessage);
      return;
    }
    showNotification('error', err instanceof Error ? err.message : defaultMessage);
  };

  // LOCK / UNLOCK
  const handleToggleLockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;

    if (isSelf) {
      showNotification('error', uiText("Không thể tự khóa tài khoản của chính mình."));
      return;
    }

    setIsSubmittingLock(true);
    try {
      if (account.is_active) {
        await service.setAccountState(account.id, false, lockPassword || undefined);
        showNotification('success', uiText("Đã khóa tài khoản {0}. Các phiên làm việc cũ đã bị thu hồi.",[account.display_name]));
      } else {
        await service.unlockAccount(account.id);
        showNotification('success', uiText("Đã mở khóa tài khoản {0}.",[account.display_name]));
      }
      setShowLockModal(false);
      setLockPassword('');
      await fetchAccount();
    } catch (err) {
      handleApiError(err, uiText("Lỗi khi cập nhật trạng thái tài khoản."));
    } finally {
      setIsSubmittingLock(false);
    }
  };

  // GRANT ADMIN ROLE
  const handleGrantAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;

    if (!grantPassword) {
      showNotification('error', uiText("Vui lòng nhập mật khẩu hiện tại của bạn để xác thực."));
      return;
    }

    setIsSubmittingGrant(true);
    try {
      await service.grantAdminRole(account.id, grantPassword);
      showNotification('success', uiText("Đã cấp vai trò Quản trị viên cho tài khoản {0}.",[account.display_name]));
      setShowGrantAdminModal(false);
      setGrantPassword('');
      await fetchAccount();
    } catch (err) {
      handleApiError(err, uiText("Lỗi khi cấp vai trò quản trị viên."));
    } finally {
      setIsSubmittingGrant(false);
    }
  };

  // REVOKE ROLE
  const handleRevokeRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account || !revokeTargetGrant) return;

    setIsSubmittingRevoke(true);
    try {
      await service.revokeRole(account.id, revokeTargetGrant.id, revokePassword || undefined);
      showNotification(
        'success',
        uiText("Đã thu hồi vai trò {0} của tài khoản {1}. Phiên cũ đã bị chấm dứt.",[revokeTargetGrant.role,account.display_name])
      );
      setShowRevokeModal(false);
      setRevokeTargetGrant(null);
      setRevokePassword('');
      await fetchAccount();
    } catch (err) {
      handleApiError(err, uiText("Lỗi khi thu hồi vai trò."));
    } finally {
      setIsSubmittingRevoke(false);
    }
  };

  // REQUEST PASSWORD RESET
  const handleResetSubmit = async () => {
    if (!account) return;
    setIsSubmittingReset(true);
    try {
      const res = await service.requestPasswordReset(account.id);
      showNotification(
        'success',
        res.message || uiText("Đã gửi liên kết đặt lại mật khẩu đến email chính thức của người dùng.")
      );
      setShowResetModal(false);
    } catch (err) {
      handleApiError(err, uiText("Lỗi khi gửi yêu cầu đặt lại mật khẩu."));
    } finally {
      setIsSubmittingReset(false);
    }
  };

  // APPROVE TEACHER REQUEST
  const handleApproveTeacherRequest = async () => {
    if (!selectedRequest) return;
    setIsSubmittingRequestAction(true);
    try {
      await service.approveTeacherRequest(selectedRequest.id);
      showNotification('success', uiText("Đã phê duyệt yêu cầu giảng viên và cấp vai trò thành công."));
      setShowApproveRequestModal(false);
      setSelectedRequest(null);
      await fetchAccount();
    } catch (err) {
      handleApiError(err, uiText("Lỗi khi phê duyệt yêu cầu giảng viên."));
    } finally {
      setIsSubmittingRequestAction(false);
    }
  };

  // REJECT TEACHER REQUEST
  const handleRejectTeacherRequest = async () => {
    if (!selectedRequest) return;
    setIsSubmittingRequestAction(true);
    try {
      await service.rejectTeacherRequest(selectedRequest.id);
      showNotification('success', uiText("Đã từ chối yêu cầu vai trò giảng viên."));
      setShowRejectRequestModal(false);
      setSelectedRequest(null);
      await fetchAccount();
    } catch (err) {
      handleApiError(err, uiText("Lỗi khi từ chối yêu cầu."));
    } finally {
      setIsSubmittingRequestAction(false);
    }
  };

  if (isLoading) {
    return (
      <div className="admin-acc-detail-page">
        <Breadcrumb
          items={[
            { label: uiText("Bàn làm việc"), path: '/ad' },
            { label: uiText("Tài khoản người dùng"), path: '/ad/tai-khoan' },
            { label: uiText("Đang tải...") },
          ]}
        />
        <div style={{ padding: 'var(--space-6)' }}>
          <LoadingSkeleton lines={8} height="32px" />
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="admin-acc-detail-container">
        <EmptyState
          title={uiText("Không tìm thấy tài khoản")}
          description={errorMessage || uiText("Tài khoản không tồn tại trên hệ thống máy chủ.")}
          action={<Button onClick={() => navigate('/ad/tai-khoan')}>{uiText("Về danh sách tài khoản")}</Button>}
        />
      </div>
    );
  }

  const activeGrants = account.roles.filter((r) => !r.revoked_at);

  return (
    <div className="admin-acc-detail-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: uiText("Bàn làm việc"), path: '/ad' },
            { label: uiText("Tài khoản người dùng"), path: '/ad/tai-khoan' },
            { label: account.display_name },
          ]}
        />
        <div className="title-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h1 className="acc-main-title">{account.display_name}</h1>
          <div style={{ display: 'flex', gap: '6px' }}>
            {activeGrants.map((g) => (
              <span key={g.id} className={`role-pill role-pill-${g.role}`}>
                {g.role === 'admin' ? uiText("Quản trị viên") : g.role === 'teacher' ? uiText("Giảng viên") : uiText("Sinh viên")}
              </span>
            ))}
          </div>
          <Badge
            variant={account.is_active ? 'published' : 'archived'}
            label={account.is_active ? uiText("Đang hoạt động") : uiText("Tài khoản bị khóa")}
          />
          <Badge
            variant={account.email_verified ? 'published' : 'draft'}
            label={account.email_verified ? uiText("Email đã xác minh") : uiText("Chưa xác minh email")}
          />
        </div>
      </div>

      {/* Self Guard Alert */}
      {isSelf && (
        <div className="self-guard-notice" role="alert">
          <ShieldAlert size={20} />
          <span>
            <strong>{uiText("Tài khoản cá nhân:")}</strong> {uiText(" Bạn đang thao tác trên tài khoản của chính mình. Tính năng khóa tài khoản và thu hồi vai trò quản trị bị vô hiệu hóa để bảo vệ quyền truy cập quản trị hệ thống.")}</span>
        </div>
      )}

      {/* Main Grid */}
      <div className="acc-detail-grid">
        {/* Left Card: Account Info */}
        <section className="acc-info-card" aria-labelledby="sec-account-info">
          <h2 id="sec-account-info" className="card-section-title">
            {uiText("Thông tin tài khoản máy chủ")}</h2>
          <div className="info-meta-list">
            <div className="info-row">
              <span className="info-lbl">{uiText("Họ và tên:")}</span>
              <strong className="info-val">{account.display_name}</strong>
            </div>
            <div className="info-row">
              <span className="info-lbl">{uiText("Địa chỉ Email:")}</span>
              <span className="info-val">{account.email}</span>
            </div>
            <div className="info-row">
              <span className="info-lbl">{uiText("Xác minh email:")}</span>
              <span className="info-val">
                {account.email_verified
                  ? uiText("Đã xác minh {0}",[account.verified_at ? `(${formatDateVN(account.verified_at)})` : ''])
                  : uiText("Chưa xác minh")}
              </span>
            </div>
            <div className="info-row">
              <span className="info-lbl">{uiText("Mã định danh (ID):")}</span>
              <span className="info-val font-mono">{account.id}</span>
            </div>
            <div className="info-row">
              <span className="info-lbl">{uiText("Thời điểm khởi tạo:")}</span>
              <span className="info-val">{formatDateVN(account.created_at)}</span>
            </div>
            <div className="info-row">
              <span className="info-lbl">{uiText("Cập nhật gần nhất:")}</span>
              <span className="info-val">{formatDateVN(account.updated_at)}</span>
            </div>
          </div>
        </section>

        {/* Right Card: Administrative Operations */}
        <section className="acc-info-card" aria-labelledby="sec-admin-ops">
          <h2 id="sec-admin-ops" className="card-section-title">
            {uiText("Thao tác quản trị & An ninh")}</h2>
          <p className="text-sm text-muted">
            {uiText("Mọi thao tác quản trị được kiểm toán máy chủ và làm mất hiệu lực các phiên làm việc cũ khi có thay đổi quyền hạn.")}</p>

          <div className="acc-ops-stack" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Lock / Unlock button */}
            {!isSelf && (
              <Button
                type="button"
                variant={account.is_active ? 'danger' : 'primary'}
                onClick={() => {
                  setLockPassword('');
                  setShowLockModal(true);
                }}
                icon={account.is_active ? <Lock size={16} /> : <Unlock size={16} />}
              >
                <span>{account.is_active ? uiText("Khóa tài khoản") : uiText("Mở khóa tài khoản")}</span>
              </Button>
            )}

            {/* Grant Admin button */}
            {!hasActiveAdminRole && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setGrantPassword('');
                  setShowGrantAdminModal(true);
                }}
                icon={<ShieldCheck size={16} />}
              >
                <span>{uiText("Cấp quyền Quản trị viên (Admin)")}</span>
              </Button>
            )}

            {/* Password Reset Dispatch */}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowResetModal(true)}
              icon={<KeyRound size={16} />}
            >
              <span>{uiText("Gửi liên kết đặt lại mật khẩu")}</span>
            </Button>
          </div>
        </section>
      </div>

      {/* Role Grants History Table */}
      <section className="acc-audit-section" aria-labelledby="sec-roles-history">
        <h2 id="sec-roles-history" className="section-title">
          {uiText("Lịch sử cấp & thu hồi vai trò (")}{account.roles.length} {uiText(" bản ghi)")}</h2>
        {account.roles.length === 0 ? (
          <p className="empty-notice-text">{uiText("Tài khoản này chưa được cấp vai trò nào.")}</p>
        ) : (
          <div className="audit-table-wrap">
            <table className="npc-table" aria-label={uiText("Danh sách vai trò")}>
              <thead>
                <tr>
                  <th scope="col">{uiText("Vai trò")}</th>
                  <th scope="col">{uiText("Nguồn cấp")}</th>
                  <th scope="col">{uiText("Ngày cấp")}</th>
                  <th scope="col">{uiText("Trạng thái")}</th>
                  <th scope="col">{uiText("Lý do thu hồi")}</th>
                  <th scope="col">{uiText("Thao tác")}</th>
                </tr>
              </thead>
              <tbody>
                {account.roles.map((grant) => {
                  const isGrantActive = !grant.revoked_at;
                  const isRoleAdmin = grant.role === 'admin';
                  return (
                    <tr key={grant.id}>
                      <td>
                        <strong className={`role-pill role-pill-${grant.role}`}>
                          {grant.role === 'admin'
                            ? uiText("Quản trị viên")
                            : grant.role === 'teacher'
                            ? uiText("Giảng viên")
                            : uiText("Sinh viên")}
                        </strong>
                      </td>
                      <td>
                        <span className="font-mono text-xs">{grant.grant_source}</span>
                      </td>
                      <td>{formatDateVN(grant.granted_at)}</td>
                      <td>
                        <Badge
                          variant={isGrantActive ? 'published' : 'archived'}
                          label={isGrantActive ? uiText("Đang hiệu lực") : uiText("Đã thu hồi")}
                        />
                      </td>
                      <td>
                        {grant.revoked_at ? (
                          <span className="text-xs text-muted">
                            {formatDateVN(grant.revoked_at)} ({grant.revoke_reason || uiText("Không rõ")})
                          </span>
                        ) : (
                          <span className="text-muted text-xs">—</span>
                        )}
                      </td>
                      <td>
                        {isGrantActive && (!isSelf || !isRoleAdmin) && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setRevokeTargetGrant(grant);
                              setRevokePassword('');
                              setShowRevokeModal(true);
                            }}
                            icon={<Trash2 size={14} />}
                          >
                            <span>{uiText("Thu hồi")}</span>
                          </Button>
                        )}
                        {isGrantActive && isSelf && isRoleAdmin && (
                          <span className="text-xs text-muted" title={uiText("Không thể tự thu hồi quyền admin của chính mình")}>
                            {uiText("(Bảo vệ tự thân)")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Role Requests History Table */}
      <section className="acc-audit-section" aria-labelledby="sec-requests-history">
        <h2 id="sec-requests-history" className="section-title">
          {uiText("Hàng đợi & Lịch sử yêu cầu vai trò (")}{account.role_requests.length} {uiText(" yêu cầu)")}</h2>
        {account.role_requests.length === 0 ? (
          <p className="empty-notice-text">{uiText("Tài khoản chưa từng gửi yêu cầu vai trò nào.")}</p>
        ) : (
          <div className="audit-table-wrap">
            <table className="npc-table" aria-label={uiText("Danh sách yêu cầu vai trò")}>
              <thead>
                <tr>
                  <th scope="col">{uiText("Vai trò yêu cầu")}</th>
                  <th scope="col">{uiText("Ngày gửi")}</th>
                  <th scope="col">{uiText("Trạng thái")}</th>
                  <th scope="col">{uiText("Ngày xét duyệt")}</th>
                  <th scope="col">{uiText("Ghi chú duyệt")}</th>
                  <th scope="col">{uiText("Thao tác")}</th>
                </tr>
              </thead>
              <tbody>
                {account.role_requests.map((req) => (
                  <tr key={req.id}>
                    <td>
                      <strong>
                        {req.role === 'teacher'
                          ? uiText("Giảng viên")
                          : req.role === 'student'
                          ? uiText("Sinh viên")
                          : req.role}
                      </strong>
                    </td>
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
                            ? uiText("Đã duyệt")
                            : req.status === 'pending'
                            ? uiText("Chờ duyệt")
                            : req.status === 'rejected'
                            ? uiText("Đã từ chối")
                            : uiText("Đã hủy")
                        }
                      />
                    </td>
                    <td>{req.reviewed_at ? formatDateVN(req.reviewed_at) : '—'}</td>
                    <td>
                      <span className="text-xs">{req.review_reason || '—'}</span>
                    </td>
                    <td>
                      {req.status === 'pending' && req.role === 'teacher' && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setSelectedRequest(req);
                              setShowApproveRequestModal(true);
                            }}
                            icon={<CheckCircle size={14} />}
                          >
                            <span>{uiText("Duyệt")}</span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSelectedRequest(req);
                              setShowRejectRequestModal(true);
                            }}
                            icon={<XCircle size={14} />}
                          >
                            <span>{uiText("Từ chối")}</span>
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL 1: LOCK / UNLOCK */}
      {showLockModal && (
        <Modal
          title={account.is_active ? uiText("Xác nhận khóa tài khoản") : uiText("Xác nhận mở khóa tài khoản")}
          isOpen={showLockModal}
          onClose={() => setShowLockModal(false)}
        >
          <form onSubmit={handleToggleLockSubmit} className="modal-content-stack">
            <p>
              {uiText("Bạn chuẩn bị ")}{account.is_active ? uiText("khóa") : uiText("mở khóa")} {uiText(" tài khoản người dùng")}{' '}
              <strong>{account.display_name}</strong> ({account.email}).
            </p>

            {account.is_active && (
              <div className="alert-warning-card">
                <AlertTriangle size={18} />
                <span>
                  <strong>{uiText("Lưu ý:")}</strong> {uiText(" Khi tài khoản bị khóa, tất cả các phiên đăng nhập đang hoạt động của người dùng sẽ lập tức bị thu hồi trên máy chủ.")}</span>
              </div>
            )}

            {account.is_active && hasActiveAdminRole && (
              <div className="alert-danger-card">
                <ShieldAlert size={18} />
                <span>
                  <strong>{uiText("Yêu cầu xác thực lại (D02):")}</strong> {uiText(" Tài khoản này có vai trò Quản trị viên. Khóa tài khoản admin yêu cầu xác thực bằng mật khẩu hiện tại của bạn.")}</span>
              </div>
            )}

            {account.is_active && hasActiveAdminRole && (
              <TextField
                id={lockPasswordId}
                label={uiText("Mật khẩu của bạn")}
                type="password"
                required
                value={lockPassword}
                onChange={(e) => setLockPassword(e.target.value)}
                placeholder={uiText("Nhập mật khẩu quản trị viên để xác thực...")}
              />
            )}

            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowLockModal(false)}>
                {uiText("Hủy bỏ")}</Button>
              <Button
                type="submit"
                variant={account.is_active ? 'danger' : 'primary'}
                isLoading={isSubmittingLock}
              >
                {account.is_active ? uiText("Xác nhận khóa tài khoản") : uiText("Xác nhận mở khóa")}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 2: GRANT ADMIN ROLE */}
      {showGrantAdminModal && (
        <Modal
          title={uiText("Cấp vai trò Quản trị viên")}
          isOpen={showGrantAdminModal}
          onClose={() => setShowGrantAdminModal(false)}
        >
          <form onSubmit={handleGrantAdminSubmit} className="modal-content-stack">
            <p>
              {uiText("Bạn chuẩn bị cấp quyền ")}<strong>{uiText("Quản trị viên (Admin)")}</strong> {uiText(" cho tài khoản")}{' '}
              <strong>{account.display_name}</strong> ({account.email}).
            </p>

            <div className="alert-danger-card">
              <ShieldAlert size={18} />
              <span>
                <strong>{uiText("Cảnh báo an ninh:")}</strong> {uiText(" Quản trị viên có toàn quyền cấu hình hệ thống, quản lý tài khoản và duyệt vai trò. Thao tác này yêu cầu xác thực bằng mật khẩu của bạn theo chính sách an ninh D02.")}</span>
            </div>

            <TextField
              id={grantPasswordId}
              label={uiText("Mật khẩu của bạn để xác thực")}
              type="password"
              required
              value={grantPassword}
              onChange={(e) => setGrantPassword(e.target.value)}
              placeholder={uiText("Nhập mật khẩu hiện tại của bạn...")}
            />

            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowGrantAdminModal(false)}>
                {uiText("Hủy bỏ")}</Button>
              <Button type="submit" variant="primary" isLoading={isSubmittingGrant}>
                {uiText("Xác nhận cấp quyền Quản trị viên")}</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 3: REVOKE ROLE */}
      {showRevokeModal && revokeTargetGrant && (
        <Modal
          title={uiText("Xác nhận thu hồi vai trò")}
          isOpen={showRevokeModal}
          onClose={() => setShowRevokeModal(false)}
        >
          <form onSubmit={handleRevokeRoleSubmit} className="modal-content-stack">
            <p>
              {uiText("Bạn chuẩn bị thu hồi vai trò")}{' '}
              <strong>
                {revokeTargetGrant.role === 'admin'
                  ? uiText("Quản trị viên")
                  : revokeTargetGrant.role === 'teacher'
                  ? uiText("Giảng viên")
                  : uiText("Sinh viên")}
              </strong>{' '}
              {uiText("của tài khoản ")}<strong>{account.display_name}</strong>.
            </p>

            <div className="alert-warning-card">
              <AlertTriangle size={18} />
              <span>
                <strong>{uiText("Thu hồi phiên tức thì:")}</strong> {uiText(" Sau khi thu hồi vai trò, phiên làm việc của người dùng này sẽ lập tức mất hiệu lực để bảo đảm phân quyền mới.")}</span>
            </div>

            {revokeTargetGrant.role === 'admin' && (
              <div className="alert-danger-card">
                <ShieldAlert size={18} />
                <span>
                  <strong>{uiText("Chính sách Admin cuối cùng:")}</strong> {uiText(" Không thể thu hồi Quản trị viên hoạt động duy nhất của hệ thống. Thao tác yêu cầu xác thực bằng mật khẩu của bạn.")}</span>
              </div>
            )}

            {revokeTargetGrant.role === 'admin' && (
              <TextField
                id={revokePasswordId}
                label={uiText("Mật khẩu của bạn")}
                type="password"
                required
                value={revokePassword}
                onChange={(e) => setRevokePassword(e.target.value)}
                placeholder={uiText("Nhập mật khẩu hiện tại của bạn...")}
              />
            )}

            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowRevokeModal(false)}>
                {uiText("Hủy bỏ")}</Button>
              <Button type="submit" variant="danger" isLoading={isSubmittingRevoke}>
                {uiText("Xác nhận thu hồi vai trò")}</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 4: ADMIN PASSWORD RESET */}
      {showResetModal && (
        <Modal
          title={uiText("Khởi tạo đặt lại mật khẩu người dùng")}
          isOpen={showResetModal}
          onClose={() => setShowResetModal(false)}
        >
          <div className="modal-content-stack">
            <p>
              {uiText("Gửi yêu cầu đặt lại mật khẩu cho tài khoản ")}<strong>{account.display_name}</strong> ({account.email}).
            </p>

            <div className="alert-warning-card">
              <KeyRound size={18} />
              <span>
                <strong>{uiText("Bảo mật mật mã:")}</strong> {uiText(" Hệ thống sẽ tự động khởi tạo token một lần dùng và chuyển cho hàng đợi phân phát email. Tuyệt đối không có mật khẩu tạm thời hoặc token nào được hiển thị hay lưu trữ trên giao diện quản trị.")}</span>
            </div>

            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowResetModal(false)}>
                {uiText("Hủy bỏ")}</Button>
              <Button
                type="button"
                variant="primary"
                isLoading={isSubmittingReset}
                onClick={handleResetSubmit}
              >
                {uiText("Gửi liên kết qua Email")}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 5: APPROVE TEACHER REQUEST */}
      {showApproveRequestModal && selectedRequest && (
        <Modal
          title={uiText("Phê duyệt vai trò Giảng viên")}
          isOpen={showApproveRequestModal}
          onClose={() => setShowApproveRequestModal(false)}
        >
          <div className="modal-content-stack">
            <p>
              {uiText("Phê duyệt yêu cầu vai trò Giảng viên cho tài khoản ")}<strong>{account.display_name}</strong> ({account.email}).
            </p>
            <p className="text-sm text-muted">
              {uiText("Hệ thống sẽ cấp vai trò Giảng viên (`teacher`) và cập nhật yêu cầu thành `approved`. Các phiên đăng nhập cũ sẽ được làm mới để nhận quyền giảng viên ngay lập tức.")}</p>
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowApproveRequestModal(false)}
              >
                {uiText("Hủy bỏ")}</Button>
              <Button
                type="button"
                variant="primary"
                isLoading={isSubmittingRequestAction}
                onClick={handleApproveTeacherRequest}
              >
                {uiText("Xác nhận phê duyệt")}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 6: REJECT TEACHER REQUEST */}
      {showRejectRequestModal && selectedRequest && (
        <Modal
          title={uiText("Từ chối yêu cầu vai trò Giảng viên")}
          isOpen={showRejectRequestModal}
          onClose={() => setShowRejectRequestModal(false)}
        >
          <div className="modal-content-stack">
            <p>
              {uiText("Từ chối yêu cầu vai trò Giảng viên của tài khoản ")}<strong>{account.display_name}</strong> ({account.email}).
            </p>
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowRejectRequestModal(false)}
              >
                {uiText("Hủy bỏ")}</Button>
              <Button
                type="button"
                variant="danger"
                isLoading={isSubmittingRequestAction}
                onClick={handleRejectTeacherRequest}
              >
                {uiText("Xác nhận từ chối")}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
