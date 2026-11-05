import {uiText} from "../../../shared/i18n/translate";
import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { authService } from '../../../api/authService';
import { ApiError } from '../../../api/client';
import { useNotification } from '../../../app/providers/NotificationContext';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Eye, EyeOff, KeyRound, ShieldAlert, AlertOctagon, Check } from 'lucide-react';
import './ResetPasswordPage.css';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { notifySuccess, notifyError } = useNotification();

  // Token is held strictly in component state in memory.
  // Never stored in localStorage, sessionStorage, or logged to console.
  const [token, setToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [formError, setFormError] = useState('');
  const [tokenErrorType, setTokenErrorType] = useState<'missing' | 'invalid_or_expired' | null>(null);

  useEffect(() => {
    // Extract token strictly from URL fragment (#token=...)
    // URL fragments are never sent to the server over HTTP or stored in server access logs
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const tokenVal = params.get('token');

    if (tokenVal && tokenVal.trim()) {
      setToken(tokenVal.trim());
      setTokenErrorType(null);
    } else {
      setToken(null);
      setTokenErrorType('missing');
    }
  }, [location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || isSubmitting) return;

    setPasswordError('');
    setConfirmError('');
    setFormError('');

    if (newPassword.length < 12) {
      setPasswordError(uiText("Mật khẩu mới phải có ít nhất 12 ký tự."));
      return;
    }

    if (newPassword !== confirmPassword) {
      setConfirmError(uiText("Mật khẩu nhập lại không khớp."));
      return;
    }

    setIsSubmitting(true);

    try {
      // Calls POST /api/v1/auth/password/reset
      await authService.resetPassword({
        token,
        new_password: newPassword,
      });

      notifySuccess(
        uiText("Đặt lại mật khẩu thành công! Toàn bộ các phiên đăng nhập cũ đã được vô hiệu hóa. Vui lòng đăng nhập bằng mật khẩu mới.")
      );

      // Clean memory state and redirect to login
      setNewPassword('');
      setConfirmPassword('');
      setToken(null);
      navigate('/dang-nhap');
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        // Backend returns 400 for invalid, expired or already used tokens
        const msg = err.message || '';
        const isTokenInvalid =
          err.status === 400 &&
          (msg.toLowerCase().includes('token') ||
            msg.toLowerCase().includes('expired') ||
            msg.toLowerCase().includes('hết hạn') ||
            msg.toLowerCase().includes('không hợp lệ'));

        if (isTokenInvalid) {
          setTokenErrorType('invalid_or_expired');
          setFormError(uiText("Mã đặt lại mật khẩu không hợp lệ, đã hết hạn (quá 30 phút) hoặc đã được sử dụng."));
        } else if (err.status === 429) {
          setFormError(uiText("Quá nhiều lượt thử đặt lại mật khẩu. Vui lòng chờ ít phút rồi thử lại."));
        } else {
          setFormError(msg || uiText("Không thể đặt lại mật khẩu."));
        }
        notifyError(msg || uiText("Đặt lại mật khẩu thất bại."));
      } else {
        const netMsg = uiText("Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại kết nối mạng.");
        setFormError(netMsg);
        notifyError(netMsg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="reset-password-page">
      <div className="reset-password-header">
        <h1 className="reset-password-title">{uiText("Đặt lại mật khẩu")}</h1>
        <p className="reset-password-subtitle">
          {uiText("Thiết lập mật khẩu mới an toàn cho tài khoản của bạn.")}</p>
      </div>

      {tokenErrorType ? (
        <div className="reset-token-card" role="alert" aria-live="polite">
          <AlertOctagon size={40} className="reset-token-invalid-icon" aria-hidden="true" />
          <h2 className="reset-token-card-title">
            {tokenErrorType === 'missing'
              ? uiText("Thiếu mã xác thực đặt lại mật khẩu")
              : uiText("Mã xác thực không hợp lệ hoặc đã hết hạn")}
          </h2>
          <p className="reset-token-card-text">
            {tokenErrorType === 'missing'
              ? uiText("Không tìm thấy mã xác thực trong đường dẫn của bạn. Vui lòng bấm vào liên kết đầy đủ được gửi trong email hoặc yêu cầu liên kết mới.")
              : uiText("Mã xác thực này đã hết hạn hiệu lực (quá 30 phút), không đúng định dạng hoặc đã được sử dụng trước đó.")}
          </p>
          <Link to="/quen-mat-khau" className="btn btn-primary reset-password-submit-btn">
            {uiText("Yêu cầu liên kết đặt lại mật khẩu mới")}</Link>
        </div>
      ) : (
        <>
          {formError && (
            <div className="reset-password-alert" role="alert" aria-live="assertive">
              <ShieldAlert size={18} aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="reset-password-form" noValidate>
            <div className="password-field-wrapper">
              <TextField
                id="reset-new-password"
                label={uiText("Mật khẩu mới")}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (passwordError) setPasswordError('');
                  if (formError) setFormError('');
                }}
                placeholder={uiText("Tối thiểu 12 ký tự")}
                helperText="Mật khẩu phải có độ dài tối thiểu 12 ký tự."
                error={passwordError}
                required
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="toggle-password-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? uiText("Ẩn mật khẩu") : uiText("Hiện mật khẩu")}
                tabIndex={0}
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>

            <TextField
              id="reset-confirm-password"
              label={uiText("Xác nhận lại mật khẩu mới")}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (confirmError) setConfirmError('');
                if (formError) setFormError('');
              }}
              placeholder={uiText("Nhập lại mật khẩu mới")}
              error={confirmError}
              required
              disabled={isSubmitting}
            />

            <Button
              id="reset-submit-btn"
              type="submit"
              variant="primary"
              size="lg"
              isLoading={isSubmitting}
              disabled={isSubmitting}
              icon={<Check size={18} />}
              className="reset-password-submit-btn"
            >
              {isSubmitting ? uiText("Đang cập nhật mật khẩu...") : uiText("Xác nhận đặt lại mật khẩu")}
            </Button>
          </form>

          <div className="reset-password-footer">
            <span>{uiText("Nhớ mật khẩu của bạn?")}</span>{' '}
            <Link to="/dang-nhap" className="reset-password-login-link">
              {uiText("Đăng nhập ngay")}</Link>
          </div>
        </>
      )}
    </div>
  );
};
