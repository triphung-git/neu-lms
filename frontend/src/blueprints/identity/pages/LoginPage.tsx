import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Eye, EyeOff, LogIn, ShieldAlert, Sparkles } from 'lucide-react';
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
  const [errorMessage, setErrorMessage] = useState(
    errorParam === 'locked' ? 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.' : ''
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setIsLoading(true);

    const res = await login(email, password);
    setIsLoading(false);

    if (res.success) {
      if (returnTo && returnTo.startsWith('/')) {
        navigate(decodeURIComponent(returnTo));
      } else {
        const norm = email.trim().toLowerCase();
        if (norm.includes('quan-tri') || norm.includes('admin')) {
          navigate('/ad');
        } else if (norm.includes('giang-vien') || norm.includes('teacher')) {
          navigate('/gv');
        } else {
          navigate('/sv');
        }
      }
    } else {
      setErrorMessage(res.message || 'Đăng nhập không thành công.');
    }
  };

  const handleFillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Demo@1234');
    setErrorMessage('');
  };

  return (
    <div className="login-page">
      <div className="login-header">
        <h1 className="login-title">Đăng nhập tài khoản</h1>
        <p className="login-subtitle">Hệ thống Quản lý Môn học & Học liệu số NPC</p>
      </div>

      {errorMessage && (
        <div className="login-error-alert" role="alert">
          <ShieldAlert size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="login-form">
        <TextField
          label="Địa chỉ email đại học"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vd: sinh-vien@example.edu.vn"
          required
        />

        <div className="password-field-wrapper">
          <TextField
            label="Mật khẩu"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nhập mật khẩu"
            required
          />
          <button
            type="button"
            className="toggle-password-btn"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isLoading}
          icon={<LogIn size={18} />}
          className="login-submit-btn"
        >
          Đăng nhập
        </Button>
      </form>

      {/* Demo Credentials Box */}
      <div className="demo-credentials-box">
        <div className="demo-box-header">
          <Sparkles size={16} />
          <span>Tài khoản minh họa sẵn có (Mật khẩu: Demo@1234)</span>
        </div>
        <div className="demo-quick-buttons">
          <button
            type="button"
            className="demo-btn-chip"
            onClick={() => handleFillDemo('sinh-vien@example.edu.vn')}
          >
            <strong>Sinh viên:</strong> sinh-vien@example.edu.vn
          </button>
          <button
            type="button"
            className="demo-btn-chip"
            onClick={() => handleFillDemo('giang-vien@example.edu.vn')}
          >
            <strong>Giảng viên:</strong> giang-vien@example.edu.vn
          </button>
          <button
            type="button"
            className="demo-btn-chip"
            onClick={() => handleFillDemo('quan-tri@example.edu.vn')}
          >
            <strong>Quản trị:</strong> quan-tri@example.edu.vn
          </button>
          <button
            type="button"
            className="demo-btn-chip chip-locked"
            onClick={() => handleFillDemo('khoa@example.edu.vn')}
          >
            <strong>Tài khoản bị khóa:</strong> khoa@example.edu.vn
          </button>
        </div>
      </div>

      <div className="login-extra-links">
        <span>Chưa có tài khoản?</span>{' '}
        <Link to="/dang-ky" className="register-link">
          Kiểm tra email & Đăng ký tài khoản
        </Link>
      </div>
    </div>
  );
};
