import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotification } from '../../../app/providers/NotificationContext';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { User, KeyRound, ArrowLeft, ShieldCheck, Check } from 'lucide-react';
import './ProfilePage.css';
import { authApi } from '../../../infrastructure/api/authApi';

export const ProfilePage: React.FC = () => {
  const { currentUser, role, setDemoPassword } = useSession();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getDashboardPath = () => {
    if (role === 'admin') return '/ad';
    if (role === 'teacher') return '/gv';
    return '/sv';
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!currentUser || isSubmitting) return;

  if (newPassword.length < 8) {
    notifyError('Mật khẩu mới phải có ít nhất 8 ký tự.');
    return;
  }

  if (newPassword !== confirmNewPassword) {
    notifyError('Mật khẩu xác nhận không khớp.');
    return;
  }

  setIsSubmitting(true);

  try {
    if (import.meta.env.VITE_DATA_MODE === 'api') {
      await authApi.changePassword(
        currentPassword,
        newPassword
      );
    } else {
      setDemoPassword(
        currentUser.emailNormalized,
        newPassword
      );
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');

    notifySuccess('Đổi mật khẩu thành công.');
  } catch (error) {
    notifyError(
      error instanceof Error
        ? error.message
        : 'Đổi mật khẩu thất bại.'
    );
  } finally {
    setIsSubmitting(false);
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
          onClick={() => navigate(getDashboardPath())}
          icon={<ArrowLeft size={16} />}
        >
          Quay lại không gian làm việc
        </Button>
      </div>

      <div className="profile-grid">
        {/* Account Info Box */}
        <section className="profile-card" aria-labelledby="account-info-title">
          <div className="profile-card-header">
            <User className="card-header-icon" />
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
              <span className="item-value font-mono">{currentUser.code}</span>
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

        {/* Change Password Form */}
        <section className="profile-card" aria-labelledby="password-change-title">
          <div className="profile-card-header">
            <KeyRound className="card-header-icon" />
            <h2 id="password-change-title">Đổi mật khẩu</h2>
          </div>

          <form onSubmit={handlePasswordChange} className="profile-form">
            <TextField
              label="Mật khẩu hiện tại"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Nhập mật khẩu hiện tại"
              required
            />

            <TextField
              label="Mật khẩu mới"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Tối thiểu 8 ký tự"
              required
            />

            <TextField
              label="Nhập lại mật khẩu mới"
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder="Xác nhận lại mật khẩu mới"
              required
            />

            <div className="profile-password-notice">
              <ShieldCheck size={16} />
              <span>
                {import.meta.env.VITE_DATA_MODE === 'api'
                ? 'Mật khẩu được cập nhật trên máy chủ sau khi xác minh mật khẩu hiện tại.'
                : 'Mật khẩu demo chỉ được giữ trong bộ nhớ phiên làm việc.'}
                </span>
            </div>

            <Button
              type="submit"
              variant="primary"
              isLoading={isSubmitting}
              icon={<Check size={16} />}
            >
              Lưu đổi mật khẩu
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
};
