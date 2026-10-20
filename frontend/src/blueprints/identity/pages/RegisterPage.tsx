import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { CheckCircle2, AlertCircle, ArrowRight, UserPlus, Info } from 'lucide-react';
import './RegisterPage.css';

export const RegisterPage: React.FC = () => {
  const { db, updateDb } = useDatabase();
  const { login, setDemoPassword } = useSession();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [emailInput, setEmailInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [matchedRecord, setMatchedRecord] = useState<{
    fullName: string;
    assignedRole: 'teacher' | 'student';
    emailNormalized: string;
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  // Step 1: Check eligibility
  const handleCheckEmail = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const norm = emailInput.trim().toLowerCase();
    if (!norm) {
      setErrorMessage('Vui lòng nhập địa chỉ email.');
      return;
    }

    // Check if already registered
    const existingUser = db.users.find((u) => u.emailNormalized === norm);
    if (existingUser) {
      setErrorMessage('Email này đã được đăng ký tài khoản trong hệ thống. Vui lòng đăng nhập.');
      return;
    }

    // Check valid emails
    const valid = db.validEmails.find((v) => v.emailNormalized === norm);
    if (!valid) {
      setErrorMessage(
        'Email của bạn không nằm trong danh sách được cấp phép bởi Nhà trường. Vui lòng liên hệ Phòng Đào tạo.'
      );
      return;
    }

    setMatchedRecord({
      fullName: valid.fullName,
      assignedRole: valid.assignedRole,
      emailNormalized: valid.emailNormalized,
    });
    setStep(2);
  };

  // Step 2: Complete registration
  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (password.length < 8) {
      setErrorMessage('Mật khẩu phải có ít nhất 8 ký tự.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Mật khẩu nhập lại không khớp.');
      return;
    }

    if (!matchedRecord) return;

    // Create user in database state
    const newUserId = `usr-${Date.now()}`;
    const roleCode = matchedRecord.assignedRole === 'teacher' ? 'GV' : 'SV';
    const codeNum = String(db.users.length + 1).padStart(3, '0');

    updateDb(
      (draft) => {
        draft.users.push({
          id: newUserId,
          fullName: matchedRecord.fullName,
          emailNormalized: matchedRecord.emailNormalized,
          role: matchedRecord.assignedRole,
          status: 'active',
          code: `${roleCode}${codeNum}`,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        });

        // Update validEmail registration pointer
        const vEmail = draft.validEmails.find(
          (v) => v.emailNormalized === matchedRecord.emailNormalized
        );
        if (vEmail) {
          vEmail.registeredUserId = newUserId;
        }

        // Link pending memberships
        draft.memberships.forEach((m) => {
          if (m.emailNormalized === matchedRecord.emailNormalized && m.status === 'pending') {
            m.userId = newUserId;
            m.status = 'active';
          }
        });
      },
      { action: 'REGISTER_USER', entityType: 'User', entityId: newUserId }
    );

    setDemoPassword(matchedRecord.emailNormalized, password);
    setIsSuccess(true);

    // Auto login
    setTimeout(async () => {
      await login(matchedRecord.emailNormalized, password);
      if (matchedRecord.assignedRole === 'teacher') {
        navigate('/gv');
      } else {
        navigate('/sv');
      }
    }, 1500);
  };

  return (
    <div className="register-page">
      <div className="register-header">
        <h1 className="register-title">Đăng ký tài khoản</h1>
        <p className="register-subtitle">
          {step === 1
            ? 'Bước 1: Kiểm tra quyền truy cập theo danh sách Nhà trường'
            : 'Bước 2: Thiết lập thông tin mật khẩu bảo mật'}
        </p>
      </div>

      {/* Stepper Indicator */}
      <div className="register-stepper" aria-label="Tiến trình đăng ký">
        <div className={`step-dot ${step >= 1 ? 'active' : ''}`}>1</div>
        <div className={`step-line ${step >= 2 ? 'active' : ''}`} />
        <div className={`step-dot ${step >= 2 ? 'active' : ''}`}>2</div>
      </div>

      {errorMessage && (
        <div className="register-error-alert" role="alert">
          <AlertCircle size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {isSuccess && (
        <div className="register-success-alert" role="status">
          <CheckCircle2 size={18} />
          <span>Đăng ký thành công! Đang chuyển hướng vào không gian học tập...</span>
        </div>
      )}

      {step === 1 && !isSuccess && (
        <form onSubmit={handleCheckEmail} className="register-form">
          <TextField
            label="Địa chỉ email trường cấp"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="vd: sinh-vien-cho-1@example.edu.vn"
            helperText="Nhập địa chỉ email đã được cán bộ quản lý phê duyệt trong danh sách hợp lệ."
            required
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            icon={<ArrowRight size={18} />}
            className="register-submit-btn"
          >
            Kiểm tra email
          </Button>

          <div className="sample-eligible-box">
            <Info size={16} />
            <div className="sample-text">
              <span>Gợi ý email hợp lệ chưa đăng ký để thử nghiệm:</span>
              <code>sinh-vien-cho-1@example.edu.vn</code>
              <code>giang-vien-cho-1@example.edu.vn</code>
            </div>
          </div>
        </form>
      )}

      {step === 2 && !isSuccess && matchedRecord && (
        <form onSubmit={handleRegister} className="register-form">
          <div className="matched-info-card">
            <div className="info-row">
              <span className="row-label">Họ và tên:</span>
              <strong className="row-value">{matchedRecord.fullName}</strong>
            </div>
            <div className="info-row">
              <span className="row-label">Email:</span>
              <span className="row-value">{matchedRecord.emailNormalized}</span>
            </div>
            <div className="info-row">
              <span className="row-label">Vai trò được chỉ định:</span>
              <span className="role-tag">
                {matchedRecord.assignedRole === 'teacher' ? 'Giảng viên' : 'Sinh viên'}
              </span>
            </div>
          </div>

          <TextField
            label="Đặt mật khẩu mới"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Ít nhất 8 ký tự"
            helperText="Mật khẩu tạo mới có hiệu lực trong phiên bộ nhớ demo."
            required
          />

          <TextField
            label="Xác nhận lại mật khẩu"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Nhập lại mật khẩu"
            required
          />

          <div className="register-step2-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStep(1);
                setErrorMessage('');
              }}
            >
              Quay lại bước 1
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon={<UserPlus size={18} />}
            >
              Hoàn tất đăng ký
            </Button>
          </div>
        </form>
      )}

      <div className="register-footer-link">
        <span>Đã có tài khoản?</span>{' '}
        <Link to="/dang-nhap" className="login-link">
          Đăng nhập ngay
        </Link>
      </div>
    </div>
  );
};
