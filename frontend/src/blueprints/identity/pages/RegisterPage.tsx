import React from 'react';
import { Link } from 'react-router-dom';
import { Info, LogIn, ShieldAlert, School, MailCheck } from 'lucide-react';
import './RegisterPage.css';

export const RegisterPage: React.FC = () => {
  return (
    <div className="register-page">
      <div className="register-header">
        <h1 className="register-title">Thông tin Đăng ký tài khoản</h1>
        <p className="register-subtitle">
          Quy trình quản lý danh tính và cấp quyền truy cập hệ thống LMS Đại học
        </p>
      </div>

      <div className="register-status-card" role="region" aria-labelledby="register-status-heading">
        <div className="register-status-header">
          <Info className="register-status-icon" size={24} aria-hidden="true" />
          <h2 id="register-status-heading" className="register-status-title">
            Tính năng tự đăng ký trực tuyến đang phát triển (B04/B13)
          </h2>
        </div>
        <p className="register-status-body">
          Theo quy chế bảo mật danh tính của Nhà trường và lộ trình tích hợp kỹ thuật, cổng tự đăng ký trực tuyến
          đang được liên kết với máy chủ xác thực tập trung. Trong giai đoạn hiện tại, hệ thống <strong>không cho phép tạo tài khoản thử nghiệm cục bộ</strong> để làm tài khoản sử dụng chính thức.
        </p>
      </div>

      <div className="register-guidance-card">
        <h3 className="guidance-title">Phương thức nhận tài khoản truy cập:</h3>
        <ul className="guidance-list">
          <li className="guidance-item">
            <School size={18} className="guidance-icon" aria-hidden="true" />
            <div>
              <strong>Sinh viên chính quy:</strong> Tài khoản được tạo tự động khi hoàn tất thủ tục nhập học.
              Địa chỉ email có định dạng <code>[ma_sinh_vien]@st.neu.edu.vn</code>.
            </div>
          </li>
          <li className="guidance-item">
            <MailCheck size={18} className="guidance-icon" aria-hidden="true" />
            <div>
              <strong>Cán bộ giảng viên:</strong> Tài khoản được Phòng Tổ chức Cán bộ & Quản lý Đào tạo phê duyệt
              theo định dạng email <code>[ten]@neu.edu.vn</code>.
            </div>
          </li>
          <li className="guidance-item">
            <ShieldAlert size={18} className="guidance-icon" aria-hidden="true" />
            <div>
              <strong>Quản trị viên & Trợ giảng:</strong> Quyền truy cập được cấp trực tiếp từ máy chủ xác thực quản trị.
            </div>
          </li>
        </ul>
      </div>

      <div className="register-actions">
        <Link to="/dang-nhap" className="btn btn-primary register-cta-btn">
          <LogIn size={18} aria-hidden="true" />
          <span>Đã có tài khoản được cấp — Đăng nhập ngay</span>
        </Link>
        <Link to="/quen-mat-khau" className="btn btn-secondary register-cta-btn">
          Quên mật khẩu hoặc cần kích hoạt lại?
        </Link>
      </div>

      <div className="register-footer-link">
        <span>Cần hỗ trợ thông tin tài khoản? Liên hệ Phòng Quản lý Đào tạo qua hòm thư hỗ trợ trường.</span>
      </div>
    </div>
  );
};
