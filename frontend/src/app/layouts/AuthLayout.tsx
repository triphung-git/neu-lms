import {uiText} from "../../shared/i18n/translate";
import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import './AuthLayout.css';
import { LanguageSwitch, useLanguage } from '../../blueprints/learning/i18n';
import '../../blueprints/learning/learning.css';

export const AuthLayout: React.FC = () => {
  const { t } = useLanguage();
  return (
    <div className="auth-shell">
      <div className="auth-container">
        <div className="auth-header">
          <LanguageSwitch />
          <Link to="/" className="auth-brand" aria-label={uiText("Trang chủ NEU LMS")}>
            <div className="auth-logo" aria-hidden="true">
              <img
                src="/neu-logo.webp"
                alt={uiText("Biểu trưng Đại học Kinh tế Quốc dân")}
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
          <p>{t('NEU LMS — Tài khoản học tập', 'NEU LMS — Learning account')}</p>
          <Link to="/" className="auth-back-link">
            {t('← Quay lại trang chủ', '← Back to home')}
          </Link>
        </footer>
      </div>
    </div>
  );
};
