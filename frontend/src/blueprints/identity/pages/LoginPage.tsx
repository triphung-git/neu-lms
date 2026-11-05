import {uiText} from "../../../shared/i18n/translate";
import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Eye, EyeOff, LogIn, ShieldAlert, KeyRound } from 'lucide-react';
import { getSafeReturnTo, getRoleDashboardPath } from '../../../shared/lib/safeNavigation';
import './LoginPage.css';
import { useLanguage } from '../../learning/i18n';

export const LoginPage: React.FC = () => {
  const { t } = useLanguage();
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
      ? uiText("Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.")
      : errorParam === 'expired'
      ? uiText("Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.")
      : ''
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setEmailError('');
    setPasswordError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError(t('Vui lòng nhập địa chỉ email.', 'Please enter your email address.'));
      return;
    }
    if (!password) {
      setPasswordError(t('Vui lòng nhập mật khẩu.', 'Please enter your password.'));
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
        setErrorMessage(res.message || uiText("Đăng nhập không thành công."));
      }
    } catch {
      setIsLoading(false);
      setErrorMessage(uiText("Không thể kết nối đến máy chủ xác thực. Vui lòng kiểm tra lại kết nối mạng."));
    }
  };

  return (
    <div className="login-page">
      <div className="login-header">
        <h1 className="login-title">{t('Đăng nhập tài khoản', 'Sign in')}</h1>
        <p className="login-subtitle">{t('Hệ thống Quản lý Môn học & Học liệu số Đại học', 'University learning management system')}</p>
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
          label={t('Địa chỉ email trường cấp', 'University email address')}
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
            label={t('Mật khẩu', 'Password')}
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordError) setPasswordError('');
              if (errorMessage) setErrorMessage('');
            }}
            placeholder={t('Nhập mật khẩu của bạn', 'Enter your password')}
            error={passwordError}
            required
            disabled={isLoading}
          />
          <button
            type="button"
            className="toggle-password-btn"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? t('Ẩn mật khẩu', 'Hide password') : t('Hiện mật khẩu', 'Show password')}
            tabIndex={0}
          >
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>

        <div className="login-form-options">
          <Link to="/quen-mat-khau" className="forgot-password-link">
            <KeyRound size={14} aria-hidden="true" />
            <span>{t('Quên mật khẩu?', 'Forgot password?')}</span>
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
          {isLoading ? t('Đang xác thực...', 'Signing in…') : t('Đăng nhập', 'Sign in')}
        </Button>
      </form>

      <div className="login-extra-links">
        <span>{t('Chưa có tài khoản?', 'New here?')}</span>{' '}
        <Link to="/dang-ky" className="register-link">
          {t('Thông tin đăng ký tài khoản', 'Account registration')}
        </Link>
      </div>
    </div>
  );
};
