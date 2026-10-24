import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotification } from '../../../app/providers/NotificationContext';
import { authService } from '../../../api/authService';
import { ApiError } from '../../../api/client';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { User, KeyRound, ArrowLeft, ShieldCheck, Check, LogOut, ShieldAlert } from 'lucide-react';
import { getRoleDashboardPath } from '../../../shared/lib/safeNavigation';
import './ProfilePage.css';

export const ProfilePage: React.FC = () => {
  const { currentUser, role, logout, logoutAll } = useSession();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);

  const [currentPasswordError, setCurrentPasswordError] = useState('');
  const [newPasswordError, setNewPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [formError, setFormError] = useState('');

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || isSubmitting) return;

    setCurrentPasswordError('');
    setNewPasswordError('');
    setConfirmPasswordError('');
    setFormError('');

    if (!currentPassword) {
      setCurrentPasswordError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }

    if (newPassword.length < 8) {
      setNewPasswordError('Mật khẩu mới phải có ít nhất 8 ký tự.');
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

    setIsSubmitting(true);

    try {
      // Real backend API call to change password
      await authService.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });

      // Clear input fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');

      notifySuccess(
        'Đổi mật khẩu thành công. Theo chính sách bảo mật, toàn bộ phiên đăng nhập đã được kết thúc. Vui lòng đăng nhập lại.'
      );

      // Invalidate local session state and route to login
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
      setIsSubmitting(false);
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
      notifyError('Có lỗi xảy ra khi yêu cầu đăng xuất khỏi các thiết bị.');
      navigate('/dang-nhap');
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
      : 'Sinh viên';

  return (
    <div className="profile-container">
      <div className="profile-top-nav">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate(getRoleDashboardPath(role))}
          icon={<ArrowLeft size={16} />}
        >
          Quay lại không gian làm việc
        </Button>
      </div>

      <div className="profile-grid">
        {/* Account Info Box */}
        <div className="profile-column">
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
              <div className="profile-info-item">
                <span className="item-label">Địa chỉ email</span>
                <span className="item-value">{currentUser.emailNormalized}</span>
              </div>
              <div className="profile-info-item">
                <span className="item-label">Mã định danh</span>
                <span className="item-value font-mono">{currentUser.code || currentUser.id.slice(0, 8)}</span>
              </div>
              <div className="profile-info-item">
                <span className="item-label">Vai trò hệ thống</span>
                <span className="item-value">
                  <Badge variant="published" label={roleLabel} />
                </span>
              </div>
              <div className="profile-info-item">
                <span className="item-label">Trạng thái</span>
                <span className="item-value">
                  <Badge variant={currentUser.status === 'active' ? 'active' : 'locked'} />
                </span>
              </div>
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

        {/* Change Password Form */}
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
              disabled={isSubmitting}
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
              placeholder="Tối thiểu 8 ký tự"
              helperText="Mật khẩu phải có độ dài tối thiểu 8 ký tự, khuyến khích chứa chữ hoa, số và ký tự đặc biệt."
              error={newPasswordError}
              required
              disabled={isSubmitting}
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
              disabled={isSubmitting}
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
              isLoading={isSubmitting}
              disabled={isSubmitting}
              icon={<Check size={16} />}
            >
              {isSubmitting ? 'Đang cập nhật mật khẩu...' : 'Lưu đổi mật khẩu'}
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
};
