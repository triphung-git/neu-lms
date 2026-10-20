import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import './AuthLayout.css';

export const AuthLayout: React.FC = () => {
  return (
    <div className="auth-shell">
      <div className="auth-container">
        <div className="auth-header">
          <Link to="/" className="auth-brand" aria-label="Trang chủ NEU LMS">
            <div className="auth-logo" aria-hidden="true">
              <img
                src="/neu-logo.webp"
                alt="Biểu trưng Đại học Kinh tế Quốc dân"
                className="auth-logo-img"
              />
            </div>
            <div className="auth-brand-text">
              <span className="auth-title">NEU</span>
              <span className="auth-desc">NEU - LEARNING MANAGEMENT SYSTEM</span>
            </div>
          </Link>
        </div>
        <main className="auth-card" id="main-content">
          <Outlet />
        </main>
        <footer className="auth-footer">
          <p>Dữ liệu minh họa phiên bản 2.0</p>
          <Link to="/" className="auth-back-link">
            ← Quay lại trang chủ
          </Link>
        </footer>
      </div>
    </div>
  );
};
