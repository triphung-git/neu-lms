import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { authService, type VerifyEmailResponse } from '../../../api/authService';
import { ApiError } from '../../../api/client';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import {
  MailCheck,
  CheckCircle2,
  ShieldAlert,
  Loader2,
  RotateCw,
  ArrowRight,
  Mail,
  School,
  GraduationCap,
} from 'lucide-react';
import './VerifyEmailPage.css';

export const VerifyEmailPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();

  // Extract token from hash (#token=xyz) or query (?token=xyz)
  const getTokenFromUrl = useCallback((): string => {
    if (location.hash && location.hash.includes('token=')) {
      const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
      const token = hashParams.get('token');
      if (token) return token.trim();
    }
    const queryToken = searchParams.get('token');
    return queryToken ? queryToken.trim() : '';
  }, [location.hash, searchParams]);

  // Keep the secret in component memory only; remove it from browser history.
  const [token] = useState(getTokenFromUrl);
  const navigate = useNavigate();
  const started = useRef(false);
  useEffect(() => {
    if (location.search || location.hash) {
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, navigate]);

  type ViewState = 'verifying' | 'success' | 'error' | 'guidance';
  const [viewState, setViewState] = useState<ViewState>(token ? 'verifying' : 'guidance');
  const [verifiedResult, setVerifiedResult] = useState<VerifyEmailResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorCode, setErrorCode] = useState('');

  // Resend form state
  const [resendEmail, setResendEmail] = useState(searchParams.get('email') || '');
  const [resendEmailError, setResendEmailError] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendError, setResendError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (resendCooldown > 0) {
      timer = setTimeout(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const verifyToken = useCallback(async (tokenToVerify: string) => {
    setViewState('verifying');
    setErrorMessage('');
    setErrorCode('');

    try {
      await authService.getCsrf();

      const result = await authService.verifyEmail({ token: tokenToVerify });
      setVerifiedResult(result);
      setViewState('success');
    } catch (err: unknown) {
      setViewState('error');
      if (err instanceof ApiError) {
        setErrorCode(err.code || 'verification_failed');
        if (err.code === 'token_invalid_or_expired') {
          setErrorMessage('Liên kết xác minh không hợp lệ, đã hết hạn (sau 24 giờ), hoặc đã được sử dụng trước đó.');
        } else if (err.code === 'account_inactive') {
          setErrorMessage('Tài khoản này đã bị khóa hoặc vô hiệu hóa. Vui lòng liên hệ Quản trị viên để được hỗ trợ.');
        } else {
          setErrorMessage(err.message || 'Xác minh email không thành công.');
        }
      } else {
        setErrorCode('network_error');
        setErrorMessage('Không thể kết nối đến máy chủ xác thực. Vui lòng kiểm tra lại kết nối mạng của bạn.');
      }
    }
  }, []);

  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      void verifyToken(token);
    }
  }, [token, verifyToken]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isResending || resendCooldown > 0) return;
    setResendEmailError('');
    setResendError('');
    setResendSuccess(false);

    const trimmed = resendEmail.trim().toLowerCase();
    if (!trimmed) {
      setResendEmailError('Vui lòng nhập địa chỉ email của bạn.');
      return;
    }
    if (!trimmed.includes('@') || !trimmed.includes('.')) {
      setResendEmailError('Địa chỉ email không đúng định dạng.');
      return;
    }

    setIsResending(true);

    try {
      await authService.getCsrf();
      await authService.resendVerification({ email: trimmed });
      setResendSuccess(true);
      setResendCooldown(60);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setResendError('Bạn đã gửi quá nhiều yêu cầu. Vui lòng chờ giây lát trước khi gửi lại.');
        } else {
          setResendError(err.message || 'Không thể gửi lại thư xác minh.');
        }
      } else {
        setResendError('Lỗi kết nối mạng khi gửi lại thư xác minh.');
      }
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="verify-email-page" role="region" aria-labelledby="verify-page-title">
      {/* 1. Verifying State */}
      {viewState === 'verifying' && (
        <div className="verify-card verify-loading-card" role="status" aria-live="polite">
          <Loader2 size={44} className="verify-spinner" aria-hidden="true" />
          <h1 id="verify-page-title" className="verify-title">
            Đang xác minh địa chỉ email...
          </h1>
          <p className="verify-subtitle">
            Hệ thống đang tiến hành kiểm tra tính hợp lệ của mã xác minh an toàn. Quá trình này sẽ hoàn tất trong giây lát.
          </p>
        </div>
      )}

      {/* 2. Success State */}
      {viewState === 'success' && verifiedResult && (
        <div className="verify-card verify-success-card" role="status" aria-live="polite">
          <CheckCircle2 size={48} className="verify-icon-success" aria-hidden="true" />
          <h1 id="verify-page-title" className="verify-title">
            Xác minh email thành công!
          </h1>
          <div className="verify-email-badge">
            <MailCheck size={18} aria-hidden="true" />
            <span>{verifiedResult.email}</span>
          </div>

          {verifiedResult.granted_roles.includes('student') ? (
            <div className="verify-status-box student-granted">
              <div className="status-box-header">
                <School size={20} className="status-box-icon" aria-hidden="true" />
                <strong>Đã kích hoạt quyền Sinh viên</strong>
              </div>
              <p className="status-box-desc">
                Chúc mừng bạn! Tài khoản đã được kích hoạt thành công. Bạn có thể đăng nhập ngay để truy cập môn học, bài tập và học liệu số.
              </p>
            </div>
          ) : (
            <div className="verify-status-box teacher-pending">
              <div className="status-box-header">
                <GraduationCap size={20} className="status-box-icon" aria-hidden="true" />
                <strong>Email đã xác minh; quyền truy cập theo trạng thái tài khoản</strong>
              </div>
              <p className="status-box-desc">
                Đăng nhập để xem trạng thái yêu cầu và vai trò đã được cấp. Nếu bạn đã yêu cầu vai trò Giảng viên, cần chờ Quản trị viên phê duyệt trước khi truy cập không gian Giảng dạy.
              </p>
            </div>
          )}

          <div className="verify-actions">
            <Link to="/dang-nhap" className="btn btn-primary verify-cta-btn">
              <span>Đăng nhập vào hệ thống</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      {/* 3. Error State */}
      {viewState === 'error' && (
        <div className="verify-card verify-error-card" role="alert" aria-live="assertive">
          <ShieldAlert size={48} className="verify-icon-error" aria-hidden="true" />
          <h1 id="verify-page-title" className="verify-title">
            {errorCode === 'network_error' ? 'Lỗi kết nối mạng' : 'Xác minh email không thành công'}
          </h1>
          <p className="verify-error-text">{errorMessage}</p>

          {errorCode === 'network_error' ? (
            <div className="verify-actions">
              <Button
                variant="primary"
                onClick={() => verifyToken(token)}
                icon={<RotateCw size={16} />}
              >
                Thử lại xác minh
              </Button>
            </div>
          ) : (
            <div className="verify-resend-section">
              <h2 className="verify-resend-heading">Yêu cầu gửi lại liên kết xác minh mới</h2>
              <p className="verify-resend-sub">
                Nhập địa chỉ email tài khoản đã đăng ký để nhận thư xác minh mới có hiệu lực trong 24 giờ.
              </p>

              {resendSuccess && (
                <div className="verify-resend-alert success" role="status">
                  Nếu tài khoản đủ điều kiện, thư xác minh sẽ được gửi trong ít phút. Vui lòng kiểm tra hộp thư.
                </div>
              )}

              {resendError && (
                <div className="verify-resend-alert error" role="alert">
                  {resendError}
                </div>
              )}

              <form onSubmit={handleResend} className="verify-resend-form" noValidate>
                <TextField
                  id="resend-email-input"
                  label="Địa chỉ email đã đăng ký"
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={resendEmail}
                  onChange={(e) => {
                    setResendEmail(e.target.value);
                    if (resendEmailError) setResendEmailError('');
                    if (resendError) setResendError('');
                  }}
                  placeholder="vd: 11241234@st.neu.edu.vn"
                  error={resendEmailError}
                  required
                  disabled={isResending}
                />

                <Button
                  id="resend-submit-btn"
                  type="submit"
                  variant="primary"
                  isLoading={isResending}
                  disabled={resendCooldown > 0 || isResending}
                  icon={<RotateCw size={16} />}
                >
                  {resendCooldown > 0
                    ? `Gửi lại sau ${resendCooldown}s`
                    : isResending
                    ? 'Đang gửi...'
                    : 'Gửi lại thư xác minh'}
                </Button>
              </form>
            </div>
          )}

          <div className="verify-footer-links">
            <Link to="/dang-nhap" className="verify-secondary-link">
              Quay lại trang Đăng nhập
            </Link>
            <span aria-hidden="true">•</span>
            <Link to="/dang-ky" className="verify-secondary-link">
              Tạo tài khoản mới
            </Link>
          </div>
        </div>
      )}

      {/* 4. Guidance State (No Token in URL) */}
      {viewState === 'guidance' && (
        <div className="verify-card verify-guidance-card">
          <Mail size={44} className="verify-icon-mail" aria-hidden="true" />
          <h1 id="verify-page-title" className="verify-title">
            Kích hoạt tài khoản NEU LMS
          </h1>
          <p className="verify-subtitle">
            Hệ thống yêu cầu xác minh địa chỉ email chính chủ trước khi kích hoạt quyền truy cập các không gian học tập.
          </p>

          <div className="verify-steps-box">
            <div className="verify-step-item">
              <span className="step-num">1</span>
              <div>
                <strong>Kiểm tra hòm thư điện tử:</strong> Mở hộp thư đến (hoặc thư mục Spam/Rác) của địa chỉ email bạn đã dùng để đăng ký.
              </div>
            </div>
            <div className="verify-step-item">
              <span className="step-num">2</span>
              <div>
                <strong>Bấm vào liên kết kích hoạt:</strong> Thư từ NEU LMS chứa liên kết xác minh an toàn có hiệu lực trong vòng 24 giờ.
              </div>
            </div>
            <div className="verify-step-item">
              <span className="step-num">3</span>
              <div>
                <strong>Bắt đầu sử dụng:</strong> Sau khi xác minh, tài khoản Sinh viên sẽ sẵn sàng đăng nhập ngay; tài khoản Giảng viên sẽ chờ Quản trị viên phê duyệt.
              </div>
            </div>
          </div>

          <div className="verify-resend-section">
            <h2 className="verify-resend-heading">Chưa nhận được thư hoặc liên kết đã hết hạn?</h2>
            <p className="verify-resend-sub">
              Nhập địa chỉ email đăng ký để nhận lại thư kích hoạt mới:
            </p>

            {resendSuccess && (
              <div className="verify-resend-alert success" role="status">
                Nếu tài khoản đủ điều kiện, thư xác minh sẽ được gửi trong ít phút. Vui lòng kiểm tra hộp thư.
              </div>
            )}

            {resendError && (
              <div className="verify-resend-alert error" role="alert">
                {resendError}
              </div>
            )}

            <form onSubmit={handleResend} className="verify-resend-form" noValidate>
              <TextField
                id="guidance-resend-email"
                label="Địa chỉ email đã đăng ký"
                type="email"
                name="email"
                autoComplete="email"
                value={resendEmail}
                onChange={(e) => {
                  setResendEmail(e.target.value);
                  if (resendEmailError) setResendEmailError('');
                  if (resendError) setResendError('');
                }}
                placeholder="vd: 11241234@st.neu.edu.vn"
                error={resendEmailError}
                required
                disabled={isResending}
              />

              <Button
                id="guidance-resend-submit-btn"
                type="submit"
                variant="primary"
                isLoading={isResending}
                disabled={resendCooldown > 0 || isResending}
                icon={<RotateCw size={16} />}
              >
                {resendCooldown > 0
                  ? `Gửi lại sau ${resendCooldown}s`
                  : isResending
                  ? 'Đang gửi...'
                  : 'Gửi lại thư xác minh'}
              </Button>
            </form>
          </div>

          <div className="verify-footer-links">
            <Link to="/dang-nhap" className="verify-secondary-link">
              Đã kích hoạt? Đăng nhập ngay
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
