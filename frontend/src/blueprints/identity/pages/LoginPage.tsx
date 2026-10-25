import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Eye, EyeOff, LogIn, ShieldAlert, KeyRound } from 'lucide-react';
import { getSafeReturnTo, getRoleDashboardPath } from '../../../shared/lib/safeNavigation';
import './LoginPage.css';

export const LoginPage: React.FC = () => {
  const { login } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const errorParam = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [errorMessage, setErrorMessage] = useState(
    errorParam === 'locked'
      ? 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.'
      : errorParam === 'expired'
      ? 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.'
      : ''
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setEmailError('');
    setPasswordError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError('Vui lòng nhập địa chỉ email.');
      return;
    }
    if (!password) {
      setPasswordError('Vui lòng nhập mật khẩu.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await login(trimmedEmail, password);
      setIsLoading(false);

      if (res.success) {
        // Safe returnTo check: strictly validated against open-redirect vectors
        // Never double-decode to prevent %252f bypasses
        const safeTarget = getSafeReturnTo(returnTo);
        if (safeTarget) {
          navigate(safeTarget);
        } else if (res.role) {
          // Strictly route to dashboard based on server-granted role, not client email heuristics
          navigate(getRoleDashboardPath(res.role));
        } else {
          // If account has no active role yet (e.g. pending teacher approval), go to profile status page
          navigate('/ho-so');
        }
      } else {
        setErrorMessage(res.message || 'Đăng nhập không thành công.');
      }
    } catch {
      setIsLoading(false);
      setErrorMessage('Không thể kết nối đến máy chủ xác thực. Vui lòng kiểm tra lại kết nối mạng.');
    }
  };

  return (
    <div className="login-page">
      <div className="login-header">
        <h1 className="login-title">Đăng nhập tài khoản</h1>
        <p className="login-subtitle">Hệ thống Quản lý Môn học & Học liệu số Đại học</p>
      </div>

      {errorMessage && (
        <div className="login-error-alert" role="alert" aria-live="assertive">
          <ShieldAlert size={18} aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="login-form" noValidate>
        <TextField
          id="login-email"
          label="Địa chỉ email trường cấp"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError('');
            if (errorMessage) setErrorMessage('');
          }}
          placeholder="vd: sinh-vien@example.edu.vn"
          error={emailError}
          required
          disabled={isLoading}
        />

        <div className="password-field-wrapper">
          <TextField
            id="login-password"
            label="Mật khẩu"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordError) setPasswordError('');
              if (errorMessage) setErrorMessage('');
            }}
            placeholder="Nhập mật khẩu của bạn"
            error={passwordError}
            required
            disabled={isLoading}
          />
          <button
            type="button"
            className="toggle-password-btn"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            tabIndex={0}
          >
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>

        <div className="login-form-options">
          <Link to="/quen-mat-khau" className="forgot-password-link">
            <KeyRound size={14} aria-hidden="true" />
            <span>Quên mật khẩu?</span>
          </Link>
        </div>

        <Button
          id="login-submit-btn"
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isLoading}
          disabled={isLoading}
          icon={<LogIn size={18} />}
          className="login-submit-btn"
        >
          {isLoading ? 'Đang xác thực...' : 'Đăng nhập'}
        </Button>
      </form>

      <div className="login-extra-links">
        <span>Chưa có tài khoản?</span>{' '}
        <Link to="/dang-ky" className="register-link">
          Thông tin đăng ký tài khoản
        </Link>
      </div>
    </div>
  );
};
