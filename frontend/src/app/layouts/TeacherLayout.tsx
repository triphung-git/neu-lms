import {uiText} from "../../shared/i18n/translate";
import { LibraryBig, ClipboardList } from 'lucide-react';
import { LanguageSwitch, useLanguage } from '../../blueprints/learning/i18n';
import '../../blueprints/learning/learning.css';
import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useSession } from '../providers/SessionContext';
import {
  LayoutDashboard,
  BookOpen,
  Bell,
  Sparkles,
  User,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import './DashboardLayout.css';

export const TeacherLayout: React.FC = () => {
  const { currentUser, logout } = useSession();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const handleLogout = async () => {
  try {
    await logout();
    navigate('/dang-nhap', { replace: true });
  } catch (error) {
    window.alert(
      error instanceof Error
        ? error.message
        : uiText("Đăng xuất thất bại. Vui lòng thử lại.")
    );
  }
};

  const navLinks = [
    { to: '/gv', label: t('Tổng quan công việc', 'Overview'), icon: <LayoutDashboard size={18} />, end: true },
    { to: '/gv/thu-vien', label: t('Thư viện số', 'Digital library'), icon: <LibraryBig size={18} /> },
    { to: '/gv/hoc-tap', label: t('Không gian học tập', 'Learning workspace'), icon: <ClipboardList size={18} /> },
    { to: '/gv/mon-hoc', label: t('Môn của tôi', 'My courses'), icon: <BookOpen size={18} /> },
    { to: '/gv/thong-bao', label: t('Thông báo môn', 'Announcements'), icon: <Bell size={18} /> },
    { to: '/gv/ban-nhap-ai', label: t('Bản nháp AI', 'AI drafts'), icon: <Sparkles size={18} /> },
  ];

  return (
    <div className="dash-shell">
      <header className="dash-topbar" role="banner">
        <div className="dash-topbar-inner">
          <div className="dash-topbar-left">
            <button
              className="dash-mobile-toggle"
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              aria-label={uiText("Chuyển đổi menu")}
              aria-expanded={isMobileOpen}
            >
              {isMobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <Link to="/gv" className="dash-brand" aria-label={uiText("Bàn làm việc Giảng viên NEU")}>
              <div className="dash-brand-icon" aria-hidden="true">
                <img
                  src="/neu-logo.webp"
                  alt={uiText("Biểu trưng Đại học Kinh tế Quốc dân")}
                  className="dash-brand-img"
                />
              </div>
              <div className="dash-brand-text">
                <span className="dash-brand-name">NEU</span>
                <span className="dash-brand-sub">NEU - LEARNING MANAGEMENT SYSTEM</span>
              </div>
            </Link>
          </div>

          <div className="dash-topbar-right"><LanguageSwitch />
            <Link to="/ho-so" className="dash-user-chip">
              <User size={16} />
              <span className="user-name">{currentUser?.fullName}</span>
              <span className="user-badge-role">GV</span>
            </Link>
            <button className="dash-logout-btn" onClick={handleLogout} title={uiText("Đăng xuất")}>
              <LogOut size={16} />
              <span className="logout-text">{t('Đăng xuất', 'Log out')}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="dash-body">
        <aside className={`dash-sidebar ${isMobileOpen ? 'open' : ''}`} role="navigation" aria-label={uiText("Menu giảng viên")}>
          <nav className="dash-nav">
            {navLinks.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `dash-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setIsMobileOpen(false)}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="dash-sidebar-footer">
            <Link to="/ho-so" className="sidebar-profile-link" onClick={() => setIsMobileOpen(false)}>
              <User size={16} />
              <span>{t('Hồ sơ cá nhân', 'Profile')}</span>
            </Link>
          </div>
        </aside>

        <main className="dash-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
