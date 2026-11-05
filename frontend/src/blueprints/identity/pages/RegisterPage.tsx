import {uiText} from "../../../shared/i18n/translate";
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../../../api/authService';
import { ApiError } from '../../../api/client';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import {
  UserPlus,
  ShieldAlert,
  CheckCircle2,
  MailCheck,
  Eye,
  EyeOff,
  School,
  GraduationCap,
  ArrowRight,
  RotateCw,
} from 'lucide-react';
import './RegisterPage.css';

const STUDENT_EMAIL_REGEX = /^1124[0-9]{4}@st\.neu\.edu\.vn$/;

export const RegisterPage: React.FC = () => {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [requestedRole, setRequestedRole] = useState<'student' | 'teacher'>('student');
  const [showPassword, setShowPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [displayNameError, setDisplayNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Post-registration guidance state
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [registeredRole, setRegisteredRole] = useState<'student' | 'teacher'>('student');

  // Resend cooldown timer in seconds
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendError, setResendError] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (resendCooldown > 0) {
      timer = setTimeout(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const validate = (): boolean => {
    let isValid = true;
    setDisplayNameError('');
    setEmailError('');
    setPasswordError('');
    setConfirmPasswordError('');
    setErrorMessage('');

    if (displayName.trim().length > 150) {
      setDisplayNameError(uiText("Họ và tên không được vượt quá 150 ký tự."));
      isValid = false;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setEmailError(uiText("Vui lòng nhập địa chỉ email của bạn."));
      isValid = false;
    } else if (requestedRole === 'student' && !STUDENT_EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError(uiText("Email sinh viên NEU phải có định dạng số hiệu: 1124xxxx@st.neu.edu.vn (vd: 11241234@st.neu.edu.vn)."));
      isValid = false;
    } else if (requestedRole === 'teacher' && (!trimmedEmail.includes('@') || !trimmedEmail.includes('.'))) {
      setEmailError(uiText("Địa chỉ email giảng viên không hợp lệ."));
      isValid = false;
    }

    if (!password) {
      setPasswordError(uiText("Vui lòng nhập mật khẩu."));
      isValid = false;
    } else if (password.length < 12) {
      setPasswordError(uiText("Mật khẩu phải có độ dài tối thiểu 12 ký tự."));
      isValid = false;
    }

    if (!confirmPassword) {
      setConfirmPasswordError(uiText("Vui lòng nhập lại mật khẩu."));
      isValid = false;
    } else if (confirmPassword !== password) {
      setConfirmPasswordError(uiText("Mật khẩu xác nhận không khớp."));
      isValid = false;
    }

    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || !validate()) return;

    setIsLoading(true);
    setErrorMessage('');

    try {
      await authService.getCsrf();

      const trimmedEmail = email.trim().toLowerCase();
      await authService.register({
        email: trimmedEmail,
        password,
        requested_role: requestedRole,
        display_name: displayName.trim(),
      });

      setPassword('');
      setConfirmPassword('');
      setRegisteredEmail(trimmedEmail);
      setRegisteredRole(requestedRole);
      setResendCooldown(60); // 60s cooldown for resending
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setErrorMessage(uiText("Bạn đã thực hiện quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau."));
        } else {
          setErrorMessage(err.message || uiText("Đăng ký tài khoản không thành công. Vui lòng kiểm tra lại thông tin."));
        }
      } else {
        setErrorMessage(uiText("Không thể kết nối đến máy chủ xác thực. Vui lòng kiểm tra lại kết nối mạng."));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!registeredEmail || resendCooldown > 0 || isResending) return;

    setIsResending(true);
    setResendError('');
    setResendSuccess(false);

    try {
      await authService.resendVerification({ email: registeredEmail });
      setResendSuccess(true);
      setResendCooldown(60);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setResendError(uiText("Bạn đã gửi yêu cầu quá nhanh. Vui lòng đợi trong giây lát."));
        } else {
          setResendError(err.message || uiText("Không thể gửi lại thư xác minh."));
        }
      } else {
        setResendError(uiText("Lỗi kết nối mạng khi gửi lại thư xác minh."));
      }
    } finally {
      setIsResending(false);
    }
  };

  if (registeredEmail) {
    return (
      <div className="register-page" role="region" aria-labelledby="register-success-heading">
        <div className="register-success-card" role="status" aria-live="polite">
          <CheckCircle2 size={44} className="register-success-icon" aria-hidden="true" />
          <h1 id="register-success-heading" className="register-success-title">
            {uiText("Đăng ký tài khoản thành công!")}</h1>
          <p className="register-success-subtitle">
            {uiText("Thư xác minh sẽ được gửi trong ít phút đến địa chỉ:")}</p>
          <div className="register-success-email-badge">
            <MailCheck size={18} aria-hidden="true" />
            <strong>{registeredEmail}</strong>
          </div>

          <div className="register-guidance-box">
            <p className="guidance-box-item">
              <strong>{uiText("1. Kiểm tra hộp thư:")}</strong> {uiText(" Vui lòng kiểm tra hòm thư đến hoặc thư mục Spam/Rác của bạn.")}</p>
            <p className="guidance-box-item">
              <strong>{uiText("2. Thời hạn hiệu lực:")}</strong> {uiText(" Liên kết xác minh có hiệu lực trong vòng ")}<strong>{uiText("24 giờ")}</strong>.
            </p>
            <p className="guidance-box-item">
              <strong>{uiText("3. Phân quyền vai trò:")}</strong>{' '}
              {registeredRole === 'student'
                ? uiText("Sau khi nhấn xác minh email, tài khoản sẽ tự động được cấp quyền Sinh viên để đăng nhập và học tập.")
                : uiText("Sau khi xác minh email, yêu cầu vai trò Giảng viên sẽ được chuyển đến Quản trị viên Nhà trường xét duyệt trước khi truy cập không gian Giảng viên.")}
            </p>
          </div>

          {resendSuccess && (
            <div className="register-resend-alert success" role="status">
              {uiText("Đã tiếp nhận yêu cầu gửi lại thư xác minh. Vui lòng kiểm tra hộp thư trong ít phút.")}</div>
          )}

          {resendError && (
            <div className="register-resend-alert error" role="alert">
              {resendError}
            </div>
          )}

          <div className="register-success-actions">
            <Link to="/dang-nhap" className="btn btn-primary register-action-btn">
              <span>{uiText("Đến trang Đăng nhập")}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>

            <button
              type="button"
              className="btn btn-secondary register-resend-btn"
              onClick={handleResend}
              disabled={resendCooldown > 0 || isResending}
            >
              <RotateCw size={15} className={isResending ? 'spin' : ''} aria-hidden="true" />
              <span>
                {resendCooldown > 0
                  ? uiText("Gửi lại thư xác minh ({0}s)",[resendCooldown])
                  : isResending
                  ? uiText("Đang gửi lại...")
                  : uiText("Chưa nhận được? Gửi lại email xác minh")}
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="register-page">
      <div className="register-header">
        <h1 className="register-title">{uiText("Đăng ký tài khoản")}</h1>
        <p className="register-subtitle">
          {uiText("Hệ thống Quản lý Môn học & Học liệu số — Đại học Kinh tế Quốc dân")}</p>
      </div>

      {errorMessage && (
        <div className="register-error-alert" role="alert" aria-live="assertive">
          <ShieldAlert size={18} aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="register-form" noValidate>
        {/* Role Selection */}
        <fieldset className="register-role-fieldset">
          <legend className="field-label">
            {uiText("Vai trò đăng ký ")}<span className="field-required" aria-hidden="true">*</span>
          </legend>
          <div className="register-role-options" role="radiogroup" aria-label={uiText("Chọn vai trò đăng ký")}>
            <label
              className={`register-role-card ${requestedRole === 'student' ? 'selected' : ''}`}
              htmlFor="role-student"
            >
              <input
                type="radio"
                id="role-student"
                name="requested_role"
                value="student"
                checked={requestedRole === 'student'}
                onChange={() => {
                  setRequestedRole('student');
                  setEmailError('');
                }}
                disabled={isLoading}
              />
              <div className="role-card-content">
                <div className="role-card-header">
                  <School size={18} aria-hidden="true" />
                  <span className="role-title">{uiText("Sinh viên")}</span>
                </div>
                <span className="role-desc">{uiText("Tự động kích hoạt sau khi xác thực email NEU")}</span>
              </div>
            </label>

            <label
              className={`register-role-card ${requestedRole === 'teacher' ? 'selected' : ''}`}
              htmlFor="role-teacher"
            >
              <input
                type="radio"
                id="role-teacher"
                name="requested_role"
                value="teacher"
                checked={requestedRole === 'teacher'}
                onChange={() => {
                  setRequestedRole('teacher');
                  setEmailError('');
                }}
                disabled={isLoading}
              />
              <div className="role-card-content">
                <div className="role-card-header">
                  <GraduationCap size={18} aria-hidden="true" />
                  <span className="role-title">{uiText("Giảng viên")}</span>
                </div>
                <span className="role-desc">{uiText("Xác minh email và chờ Quản trị viên phê duyệt")}</span>
              </div>
            </label>
          </div>
        </fieldset>

        {/* Display Name */}
        <TextField
          id="register-display-name"
          label={uiText("Họ và tên / Tên hiển thị")}
          type="text"
          name="display_name"
          autoComplete="name"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            if (displayNameError) setDisplayNameError('');
            if (errorMessage) setErrorMessage('');
          }}
          placeholder={uiText("vd: Nguyễn Văn A")}
          error={displayNameError}
          disabled={isLoading}
        />

        {/* Email */}
        <TextField
          id="register-email"
          label={
            requestedRole === 'student'
              ? uiText("Địa chỉ email sinh viên (@st.neu.edu.vn)")
              : uiText("Địa chỉ email giảng viên")
          }
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError('');
            if (errorMessage) setErrorMessage('');
          }}
          placeholder={
            requestedRole === 'student' ? '11241234@st.neu.edu.vn' : 'giang-vien@neu.edu.vn'
          }
          helperText={
            requestedRole === 'student'
              ? uiText("Định dạng bắt buộc: 1124xxxx@st.neu.edu.vn (8 chữ số hiệu)")
              : uiText("Email công tác của giảng viên (@neu.edu.vn hoặc email hợp lệ)")
          }
          error={emailError}
          required
          disabled={isLoading}
        />

        {/* Password */}
        <div className="password-field-wrapper">
          <TextField
            id="register-password"
            label={uiText("Mật khẩu")}
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordError) setPasswordError('');
              if (errorMessage) setErrorMessage('');
            }}
            placeholder={uiText("Tối thiểu 12 ký tự")}
            helperText="Mật khẩu phải chứa ít nhất 12 ký tự"
            error={passwordError}
            required
            disabled={isLoading}
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

        {/* Confirm Password */}
        <TextField
          id="register-confirm-password"
          label={uiText("Xác nhận mật khẩu")}
          type={showPassword ? 'text' : 'password'}
          name="confirm_password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            if (confirmPasswordError) setConfirmPasswordError('');
            if (errorMessage) setErrorMessage('');
          }}
          placeholder={uiText("Nhập lại mật khẩu vừa đặt")}
          error={confirmPasswordError}
          required
          disabled={isLoading}
        />

        <div className="register-policy-note">
          <span>
            {uiText("Bằng việc nhấn Đăng ký, bạn đồng ý với Quy chế sử dụng và quản trị tài nguyên học tập số của Nhà trường. Mỗi tài khoản được liên kết duy nhất với một địa chỉ email đăng ký.")}</span>
        </div>

        <Button
          id="register-submit-btn"
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isLoading}
          disabled={isLoading}
          icon={<UserPlus size={18} />}
          className="register-submit-btn"
        >
          {isLoading ? uiText("Đang khởi tạo tài khoản...") : uiText("Tạo tài khoản")}
        </Button>
      </form>

      <div className="register-footer">
        <span>{uiText("Đã có tài khoản được cấp? ")}</span>
        <Link to="/dang-nhap" className="register-login-link">
          {uiText("Đăng nhập ngay")}</Link>
      </div>
    </div>
  );
};
