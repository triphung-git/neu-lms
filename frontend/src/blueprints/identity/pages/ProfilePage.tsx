import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotification } from '../../../app/providers/NotificationContext';
import {
  authService,
  type RoleGrantItem,
  type RoleRequestItem,
} from '../../../api/authService';
import { ApiError } from '../../../api/client';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import {
  User,
  KeyRound,
  ArrowLeft,
  ShieldCheck,
  Check,
  LogOut,
  ShieldAlert,
  Clock,
  RotateCw,
  Send,
  XCircle,
  GraduationCap,
  School,
  AlertCircle,
  UserCheck,
} from 'lucide-react';
import { getRoleDashboardPath } from '../../../shared/lib/safeNavigation';
import './ProfilePage.css';

export const ProfilePage: React.FC = () => {
  const { currentUser, role, roles, switchRole, refreshSession, logout, logoutAll } = useSession();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();

  // Grants and Role Requests state
  const [grants, setGrants] = useState<RoleGrantItem[]>([]);
  const [roleRequests, setRoleRequests] = useState<RoleRequestItem[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);
  const [roleLoadError, setRoleLoadError] = useState('');

  // Request new role state
  const [newRoleSelection, setNewRoleSelection] = useState<'student' | 'teacher'>('student');
  const [isSubmittingRoleRequest, setIsSubmittingRoleRequest] = useState(false);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);

  // Email resend state
  const [isResendingEmail, setIsResendingEmail] = useState(false);
  const [emailResendCooldown, setEmailResendCooldown] = useState(0);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);

  const [currentPasswordError, setCurrentPasswordError] = useState('');
  const [newPasswordError, setNewPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [formError, setFormError] = useState('');

  // Resend cooldown timer
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (emailResendCooldown > 0) {
      timer = setTimeout(() => {
        setEmailResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearTimeout(timer);
  }, [emailResendCooldown]);

  const loadRoleData = useCallback(async () => {
    if (!currentUser) return;
    setIsLoadingRoles(true);
    setRoleLoadError('');
    try {
      const [grantsData, requestsData] = await Promise.all([
        authService.getGrants(),
        authService.getRoleRequests(),
      ]);
      setGrants(Array.isArray(grantsData) ? grantsData : []);
      setRoleRequests(Array.isArray(requestsData) ? requestsData : []);
    } catch (err: unknown) {
      setRoleLoadError('Không thể tải trạng thái vai trò. Vui lòng thử lại.');
      if (err instanceof ApiError && err.status === 401) await refreshSession();
      // Do not present a failed response as an empty successful response.
      setGrants([]);
      setRoleRequests([]);
    } finally {
      setIsLoadingRoles(false);
    }
  }, [currentUser, refreshSession]);

  useEffect(() => {
    // Fetch server state when the authenticated account changes.
    void loadRoleData();
  }, [loadRoleData]);

  const handleResendVerification = async () => {
    if (!currentUser || emailResendCooldown > 0 || isResendingEmail) return;

    setIsResendingEmail(true);
    try {
      await authService.getCsrf();
      await authService.resendVerification({ email: currentUser.emailNormalized });
      notifySuccess('Đã tiếp nhận yêu cầu. Nếu tài khoản đủ điều kiện, thư xác minh sẽ được gửi trong ít phút.');
      setEmailResendCooldown(60);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 429) {
        notifyError('Bạn đã gửi quá nhiều yêu cầu. Vui lòng chờ giây lát.');
      } else {
        notifyError(err instanceof ApiError ? err.message : 'Lỗi khi gửi lại thư xác minh.');
      }
    } finally {
      setIsResendingEmail(false);
    }
  };

  const handleCreateRoleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRoleRequest || isLoadingRoles || roleLoadError) return;

    setIsSubmittingRoleRequest(true);
    try {
      await authService.getCsrf();
      const request = await authService.createRoleRequest({ role: newRoleSelection });

      if (request.status === 'approved') {
        notifySuccess('Yêu cầu vai trò Sinh viên đã được duyệt và cấp quyền thành công!');
      } else if (newRoleSelection === 'teacher') {
        notifySuccess('Yêu cầu vai trò Giảng viên đã được gửi và đang chờ Quản trị viên xét duyệt.');
      } else {
        notifySuccess('Yêu cầu vai trò đã được ghi nhận. Vui lòng xác minh email để kích hoạt quyền.');
      }

      await loadRoleData();
      await refreshSession();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'role_already_granted') {
          notifyError('Tài khoản của bạn đã được cấp vai trò này.');
        } else if (err.code === 'one_pending_role_request') {
          notifyError('Bạn đã có một yêu cầu đang chờ xử lý cho vai trò này.');
        } else {
          notifyError(err.message || 'Không thể gửi yêu cầu vai trò.');
        }
      } else {
        notifyError('Lỗi kết nối máy chủ khi gửi yêu cầu vai trò.');
      }
    } finally {
      setIsSubmittingRoleRequest(false);
    }
  };

  const handleCancelRoleRequest = async (requestId: string) => {
    if (cancellingRequestId) return;

    setCancellingRequestId(requestId);
    try {
      await authService.getCsrf();
      await authService.cancelRoleRequest(requestId);
      notifySuccess('Đã hủy yêu cầu vai trò thành công.');
      await loadRoleData();
      await refreshSession();
    } catch (err: unknown) {
      notifyError(err instanceof ApiError ? err.message : 'Không thể hủy yêu cầu vai trò.');
    } finally {
      setCancellingRequestId(null);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || isSubmittingPassword) return;

    setCurrentPasswordError('');
    setNewPasswordError('');
    setConfirmPasswordError('');
    setFormError('');

    if (!currentPassword) {
      setCurrentPasswordError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }

    if (newPassword.length < 12) {
      setNewPasswordError('Mật khẩu mới phải có ít nhất 12 ký tự.');
      return;
    }

    if (newPassword === currentPassword) {
      setNewPasswordError('Mật khẩu mới không được trùng với mật khẩu hiện tại.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setConfirmPasswordError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setIsSubmittingPassword(true);

    try {
      await authService.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });

      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');

      notifySuccess(
        'Đổi mật khẩu thành công. Theo chính sách bảo mật, toàn bộ phiên đăng nhập đã được kết thúc. Vui lòng đăng nhập lại.'
      );

      await logout();
      navigate('/dang-nhap');
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const message = err.message || 'Đổi mật khẩu thất bại.';
        setFormError(message);
        notifyError(message);
      } else {
        const networkMsg = 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại kết nối mạng.';
        setFormError(networkMsg);
        notifyError(networkMsg);
      }
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const handleLogoutAll = async () => {
    if (isLoggingOutAll) return;
    setIsLoggingOutAll(true);

    try {
      await logoutAll();
      notifySuccess('Đã đăng xuất khỏi tất cả các thiết bị và phiên làm việc.');
      navigate('/dang-nhap');
    } catch {
      notifyError('Chưa thể xác nhận thu hồi các phiên. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      setIsLoggingOutAll(false);
    }
  };

  if (!currentUser) return null;

  const roleLabel =
    currentUser.role === 'admin'
      ? 'Quản trị viên'
      : currentUser.role === 'teacher'
      ? 'Giảng viên'
      : currentUser.role === 'student'
      ? 'Sinh viên'
      : 'Chưa có vai trò';

  const formatSource = (src: string): string => {
    if (src === 'verified_student_email') return 'Tự động kích hoạt (Email SV đã xác minh)';
    if (src === 'teacher_approval') return 'Quản trị viên phê duyệt';
    if (src === 'admin_initial') return 'Khởi tạo hệ thống';
    return src;
  };

  const formatRoleName = (r: string): string => {
    if (r === 'student') return 'Sinh viên';
    if (r === 'teacher') return 'Giảng viên';
    if (r === 'admin') return 'Quản trị viên';
    return r;
  };

  const hasPendingTeacher = currentUser.pendingRoles.includes('teacher');
  const hasNoRoles = currentUser.roles.length === 0;

  return (
    <div className="profile-container">
      {/* Top Navigation */}
      <div className="profile-top-nav">
        {role ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(getRoleDashboardPath(role))}
            icon={<ArrowLeft size={16} />}
          >
            Quay lại không gian làm việc
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/')}
            icon={<ArrowLeft size={16} />}
          >
            Về Trang chủ
          </Button>
        )}
      </div>

      {/* 1. Informational Alerts for Pending / No Roles */}
      {hasPendingTeacher && (
        <div className="profile-banner-alert warning" role="status">
          <Clock className="banner-icon" size={20} aria-hidden="true" />
          <div className="banner-text">
            <strong>Yêu cầu vai trò Giảng viên đang chờ Quản trị viên xét duyệt</strong>
            <p>
              {currentUser.emailVerified ? 'Email đã được xác minh. ' : 'Bạn cần xác minh email trước. '}Quản trị viên sẽ kiểm tra và phê duyệt yêu cầu trước khi bạn có thể truy cập không gian Giảng dạy.
            </p>
          </div>
        </div>
      )}

      {hasNoRoles && !hasPendingTeacher && (
        <div className="profile-banner-alert info" role="status">
          <AlertCircle className="banner-icon" size={20} aria-hidden="true" />
          <div className="banner-text">
            <strong>Tài khoản chưa có vai trò không gian học tập</strong>
            <p>
              Bạn chưa có vai trò Sinh viên hoặc Giảng viên đang hoạt động. Vui lòng gửi yêu cầu vai trò phù hợp ở mục &quot;Yêu cầu vai trò&quot; bên dưới.
            </p>
          </div>
        </div>
      )}

      <div className="profile-grid">
        {/* Left Column: Account Information & Role Grants */}
        <div className="profile-column">
          {/* Card: Thông tin tài khoản */}
          <section className="profile-card" aria-labelledby="account-info-title">
            <div className="profile-card-header">
              <User className="card-header-icon" aria-hidden="true" />
              <h2 id="account-info-title">Thông tin tài khoản</h2>
            </div>

            <div className="profile-info-list">
              <div className="profile-info-item">
                <span className="item-label">Họ và tên</span>
                <span className="item-value font-bold">{currentUser.fullName}</span>
              </div>

              <div className="profile-info-item vertical">
                <div className="item-sub-row">
                  <span className="item-label">Địa chỉ email (duy nhất)</span>
                  <span className="item-value font-mono">{currentUser.emailNormalized}</span>
                </div>
                <span className="item-helper-note">
                  Một tài khoản gắn với đúng một địa chỉ email đăng ký. Không hỗ trợ liên kết thêm email.
                </span>
              </div>

              <div className="profile-info-item">
                <span className="item-label">Xác minh email</span>
                <div className="item-value-inline">
                  {currentUser.emailVerified ? (
                    <Badge variant="published" label="Đã xác minh" />
                  ) : (
                    <>
                      <Badge variant="pending" label="Chưa xác minh" />
                      <button
                        type="button"
                        className="btn-profile-resend"
                        onClick={handleResendVerification}
                        disabled={emailResendCooldown > 0 || isResendingEmail}
                      >
                        <RotateCw size={13} className={isResendingEmail ? 'spin' : ''} aria-hidden="true" />
                        <span>
                          {emailResendCooldown > 0 ? `${emailResendCooldown}s` : 'Gửi lại thư xác minh'}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="profile-info-item">
                <span className="item-label">Mã định danh</span>
                <span className="item-value font-mono">{currentUser.code || currentUser.id.slice(0, 8)}</span>
              </div>

              <div className="profile-info-item">
                <span className="item-label">Vai trò đang dùng</span>
                <span className="item-value">
                  <Badge variant={currentUser.role ? 'published' : 'archived'} label={roleLabel} />
                </span>
              </div>

              <div className="profile-info-item">
                <span className="item-label">Trạng thái tài khoản</span>
                <span className="item-value">
                  <Badge variant={currentUser.status === 'active' ? 'active' : 'locked'} />
                </span>
              </div>
            </div>
          </section>

          {/* Card: Role Switcher (if user has multi-roles) */}
          {roles.length > 1 && (
            <section className="profile-card" aria-labelledby="role-switcher-title">
              <div className="profile-card-header">
                <UserCheck className="card-header-icon" aria-hidden="true" />
                <h2 id="role-switcher-title">Chuyển đổi vai trò làm việc</h2>
              </div>
              <p className="session-card-description">
                Tài khoản của bạn được cấp nhiều vai trò. Bạn có thể chọn vai trò muốn kích hoạt:
              </p>
              <div className="profile-role-switcher-buttons">
                {roles.includes('student') && (
                  <Button
                    variant={role === 'student' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => switchRole('student')}
                    icon={<School size={16} />}
                  >
                    Sinh viên {role === 'student' ? '(Đang kích hoạt)' : ''}
                  </Button>
                )}
                {roles.includes('teacher') && (
                  <Button
                    variant={role === 'teacher' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => switchRole('teacher')}
                    icon={<GraduationCap size={16} />}
                  >
                    Giảng viên {role === 'teacher' ? '(Đang kích hoạt)' : ''}
                  </Button>
                )}
              </div>
            </section>
          )}

          {/* Card: Quản lý vai trò (Role Grants & Role Requests) */}
          <section className="profile-card" aria-labelledby="role-management-title">
            <div className="profile-card-header">
              <ShieldCheck className="card-header-icon" aria-hidden="true" />
              <h2 id="role-management-title">Vai trò & Phân quyền</h2>
            </div>

            {roleLoadError && (
              <div role="alert">
                <p>{roleLoadError}</p>
                <Button variant="secondary" onClick={() => void loadRoleData()}>Thử tải lại vai trò</Button>
              </div>
            )}
            {/* Sub-section: Active Grants */}
            <div className="profile-sub-section">
              <h3 className="sub-section-title">Vai trò đã được cấp</h3>
              {isLoadingRoles ? (
                <p className="sub-section-loading">Đang tải danh sách vai trò...</p>
              ) : roleLoadError ? null : grants.length === 0 ? (
                <p className="sub-section-empty">Chưa có vai trò nào được cấp quyền.</p>
              ) : (
                <ul className="grants-list" aria-label="Danh sách vai trò đã cấp">
                  {grants.map((g) => (
                    <li key={g.id} className="grant-item">
                      <div className="grant-header">
                        <span className="grant-role-badge">
                          {g.role === 'student' && <School size={16} aria-hidden="true" />}
                          {g.role === 'teacher' && <GraduationCap size={16} aria-hidden="true" />}
                          <strong>{formatRoleName(g.role)}</strong>
                        </span>
                        <Badge variant="published" label="Đang hoạt động" />
                      </div>
                      <div className="grant-meta">
                        <span>Nguồn cấp: {formatSource(g.grant_source)}</span>
                        <span>Ngày cấp: {new Date(g.granted_at).toLocaleDateString('vi-VN')}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Sub-section: Role Requests */}
            <div className="profile-sub-section">
              <h3 className="sub-section-title">Yêu cầu vai trò</h3>
              {isLoadingRoles ? (
                <p className="sub-section-loading">Đang tải yêu cầu...</p>
              ) : roleLoadError ? null : roleRequests.length === 0 ? (
                <p className="sub-section-empty">Chưa có yêu cầu vai trò nào.</p>
              ) : (
                <ul className="requests-list" aria-label="Danh sách yêu cầu vai trò">
                  {roleRequests.map((req) => (
                    <li key={req.id} className="request-item">
                      <div className="request-header">
                        <span className="request-role">
                          <strong>{formatRoleName(req.role)}</strong>
                        </span>
                        <div className="request-status-wrap">
                          {req.status === 'pending' && <Badge variant="pending" label="Đang chờ duyệt" />}
                          {req.status === 'approved' && <Badge variant="published" label="Đã phê duyệt" />}
                          {req.status === 'rejected' && <Badge variant="locked" label="Bị từ chối" />}
                          {req.status === 'cancelled' && <Badge variant="archived" label="Đã hủy" />}
                        </div>
                      </div>

                      <div className="request-meta">
                        <span>Yêu cầu lúc: {new Date(req.requested_at).toLocaleString('vi-VN')}</span>
                        {req.review_reason && (
                          <span className="request-reason">Lý do/Nguồn: {req.review_reason}</span>
                        )}
                      </div>

                      {req.status === 'pending' && (
                        <div className="request-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleCancelRoleRequest(req.id)}
                            isLoading={cancellingRequestId === req.id}
                            disabled={Boolean(cancellingRequestId)}
                            icon={<XCircle size={14} />}
                            className="btn-cancel-request"
                          >
                            Hủy yêu cầu
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Sub-section: Request New Role Form */}
            <div className="profile-sub-section new-request-box">
              <h3 className="sub-section-title">Yêu cầu cấp thêm vai trò</h3>
              <form onSubmit={handleCreateRoleRequest} className="profile-new-request-form">
                <div className="role-request-select-group">
                  <label htmlFor="new-role-select" className="field-label">
                    Chọn vai trò muốn yêu cầu:
                  </label>
                  <select
                    id="new-role-select"
                    className="field-input role-select-input"
                    value={newRoleSelection}
                    onChange={(e) => setNewRoleSelection(e.target.value as 'student' | 'teacher')}
                    disabled={isSubmittingRoleRequest || isLoadingRoles || Boolean(roleLoadError)}
                  >
                    <option value="student">Sinh viên (Yêu cầu email @st.neu.edu.vn)</option>
                    <option value="teacher">Giảng viên (Chờ Quản trị viên phê duyệt)</option>
                  </select>
                </div>

                <Button
                  id="submit-role-request-btn"
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSubmittingRoleRequest}
                  disabled={isSubmittingRoleRequest || isLoadingRoles || Boolean(roleLoadError)}
                  icon={<Send size={14} />}
                >
                  Gửi yêu cầu
                </Button>
              </form>
            </div>
          </section>

          {/* Session Management Card */}
          <section className="profile-card session-card" aria-labelledby="session-management-title">
            <div className="profile-card-header">
              <LogOut className="card-header-icon danger-icon" aria-hidden="true" />
              <h2 id="session-management-title">Quản lý phiên làm việc</h2>
            </div>
            <p className="session-card-description">
              Nếu bạn nghi ngờ tài khoản bị truy cập trái phép hoặc đăng nhập trên thiết bị lạ, bạn có thể thu hồi
              ngay lập tức toàn bộ các phiên làm việc trên mọi thiết bị.
            </p>
            <Button
              id="logout-all-btn"
              type="button"
              variant="danger"
              size="md"
              isLoading={isLoggingOutAll}
              disabled={isLoggingOutAll}
              onClick={handleLogoutAll}
              icon={<LogOut size={16} />}
              className="logout-all-btn"
            >
              {isLoggingOutAll ? 'Đang thu hồi tất cả phiên...' : 'Đăng xuất khỏi tất cả thiết bị'}
            </Button>
          </section>
        </div>

        {/* Right Column: Change Password */}
        <div className="profile-column">
          <section className="profile-card" aria-labelledby="password-change-title">
            <div className="profile-card-header">
              <KeyRound className="card-header-icon" aria-hidden="true" />
              <h2 id="password-change-title">Đổi mật khẩu tài khoản</h2>
            </div>

            {formError && (
              <div className="profile-error-alert" role="alert" aria-live="assertive">
                <ShieldAlert size={16} aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="profile-form" noValidate>
              <TextField
                id="current-password"
                label="Mật khẩu hiện tại"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  if (currentPasswordError) setCurrentPasswordError('');
                  if (formError) setFormError('');
                }}
                placeholder="Nhập mật khẩu hiện tại"
                error={currentPasswordError}
                required
                disabled={isSubmittingPassword}
              />

              <TextField
                id="new-password"
                label="Mật khẩu mới"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (newPasswordError) setNewPasswordError('');
                  if (formError) setFormError('');
                }}
                placeholder="Tối thiểu 12 ký tự"
                helperText="Mật khẩu phải có độ dài tối thiểu 12 ký tự, khuyến khích chứa chữ hoa, số và ký tự đặc biệt."
                error={newPasswordError}
                required
                disabled={isSubmittingPassword}
              />

              <TextField
                id="confirm-new-password"
                label="Nhập lại mật khẩu mới"
                type="password"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => {
                  setConfirmNewPassword(e.target.value);
                  if (confirmPasswordError) setConfirmPasswordError('');
                  if (formError) setFormError('');
                }}
                placeholder="Xác nhận lại mật khẩu mới"
                error={confirmPasswordError}
                required
                disabled={isSubmittingPassword}
              />

              <div className="profile-password-notice">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>
                  Chính sách bảo mật: Khi đổi mật khẩu thành công, máy chủ xác thực sẽ ngay lập tức vô hiệu hóa tất cả
                  các phiên làm việc hiện có để bảo vệ tài khoản. Bạn sẽ cần đăng nhập lại bằng mật khẩu mới.
                </span>
              </div>

              <Button
                id="change-password-submit-btn"
                type="submit"
                variant="primary"
                isLoading={isSubmittingPassword}
                disabled={isSubmittingPassword}
                icon={<Check size={16} />}
              >
                {isSubmittingPassword ? 'Đang cập nhật mật khẩu...' : 'Lưu đổi mật khẩu'}
              </Button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};
