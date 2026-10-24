import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../../../api/authService';
import { ApiError } from '../../../api/client';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Mail, ArrowLeft, ShieldAlert, CheckCircle2 } from 'lucide-react';
import './ForgotPasswordPage.css';

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setEmailError('');

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setEmailError('Vui lòng nhập địa chỉ email của bạn.');
      return;
    }

    // Basic format check
    if (!trimmed.includes('@') || !trimmed.includes('.')) {
      setEmailError('Định dạng email không hợp lệ. Vui lòng nhập đúng email trường cấp.');
      return;
    }

    setIsLoading(true);

    try {
      // Calls POST /api/v1/auth/password/request-reset
      await authService.requestPasswordReset({ email: trimmed });
      setIsSubmitted(true);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setErrorMessage('Bạn đã gửi quá nhiều yêu cầu. Vui lòng đợi trong giây lát trước khi thử lại.');
        } else {
          setErrorMessage(err.message || 'Không thể xử lý yêu cầu đặt lại mật khẩu.');
        }
      } else {
        setErrorMessage('Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại kết nối mạng.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="forgot-password-page">
      <div className="forgot-password-header">
        <h1 className="forgot-password-title">Quên mật khẩu</h1>
        <p className="forgot-password-subtitle">
          Nhập địa chỉ email trường cấp để nhận liên kết xác thực đặt lại mật khẩu an toàn.
        </p>
      </div>

      {isSubmitted ? (
        <div className="forgot-password-success" role="status" aria-live="polite">
          <CheckCircle2 size={40} className="forgot-password-success-icon" aria-hidden="true" />
          <h2 className="forgot-password-success-title">Yêu cầu đã được ghi nhận</h2>
          <p className="forgot-password-success-text">
            Nếu địa chỉ email <strong>{email.trim().toLowerCase()}</strong> tồn tại trong hệ thống và tài khoản đang
            hoạt động, máy chủ đã gửi hướng dẫn đặt lại mật khẩu đến hòm thư của bạn.
          </p>
          <p className="forgot-password-success-text">
            Liên kết bảo mật có hiệu lực trong vòng <strong>30 phút</strong>. Vui lòng kiểm tra cả hòm thư đến và thư mục thư rác (Spam).
          </p>
          <Link to="/dang-nhap" className="btn btn-primary forgot-password-submit-btn">
            Quay lại trang Đăng nhập
          </Link>
        </div>
      ) : (
        <>
          {errorMessage && (
            <div className="forgot-password-alert" role="alert" aria-live="assertive">
              <ShieldAlert size={18} aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="forgot-password-form" noValidate>
            <TextField
              id="forgot-email"
              label="Địa chỉ email tài khoản"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError('');
                if (errorMessage) setErrorMessage('');
              }}
              placeholder="vd: sinh-vien@example.edu.vn"
              error={emailError}
              helperText="Hệ thống sẽ gửi liên kết xác thực một lần duy nhất đến địa chỉ email này."
              required
              disabled={isLoading}
            />

            <Button
              id="forgot-submit-btn"
              type="submit"
              variant="primary"
              size="lg"
              isLoading={isLoading}
              disabled={isLoading}
              icon={<Mail size={18} />}
              className="forgot-password-submit-btn"
            >
              {isLoading ? 'Đang gửi yêu cầu...' : 'Gửi liên kết đặt lại mật khẩu'}
            </Button>
          </form>

          <div className="forgot-password-footer">
            <Link to="/dang-nhap" className="forgot-password-back-link">
              <ArrowLeft size={16} aria-hidden="true" />
              <span>Quay lại trang Đăng nhập</span>
            </Link>
          </div>
        </>
      )}
    </div>
  );
};
