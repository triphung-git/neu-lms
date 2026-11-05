import {uiText} from "../../shared/i18n/translate";
import { LibraryBig, ClipboardList, UserPlus } from 'lucide-react';
import { LanguageSwitch, useLanguage } from '../../blueprints/learning/i18n';
import '../../blueprints/learning/learning.css';
import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useSession } from '../providers/SessionContext';
import { useUnreadGradeCount } from '../../blueprints/announcements/useUnreadGradeCount';
import {
  CheckSquare,
  BookOpen,
  Search,
  Award,
  Bell,
  User,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import './DashboardLayout.css';

export const StudentLayout: React.FC = () => {
  const { currentUser, logout } = useSession();
  const { t } = useLanguage();
  const gradeUnread = useUnreadGradeCount(currentUser?.id);
  const navigate = useNavigate();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Calculate unread announcements for current student
    const unreadCount = useUnreadGradeCount(
    currentUser?.id,
    '/api/v1/me/course-announcements/unread',
  );

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
    { to: '/sv', label: t('Việc cần làm', 'To do'), icon: <CheckSquare size={18} />, end: true },
    { to: '/sv/thu-vien', label: t('Thư viện số', 'Digital library'), icon: <LibraryBig size={18} /> },
    { to: '/sv/hoc-tap', label: t('Không gian học tập', 'Learning workspace'), icon: <ClipboardList size={18} /> },
    { to: '/sv/ghi-danh', label: t('Ghi danh vào lớp', 'Join course'), icon: <UserPlus size={18} /> },
    { to: '/sv/mon-hoc', label: t('Môn học của tôi', 'My courses'), icon: <BookOpen size={18} /> },
    { to: '/sv/tim-kiem', label: t('Tìm học liệu', 'Find materials'), icon: <Search size={18} /> },
    { to: '/sv/diem', label: t('Điểm của tôi', 'My grades'), icon: <Award size={18} /> },
    { to: '/sv/thong-bao', label: t('Thông báo', 'Notifications'), icon: <Bell size={18} />, badge: unreadCount + gradeUnread },
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
            <Link to="/sv" className="dash-brand" aria-label={uiText("Bàn làm việc Sinh viên NEU")}>
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
              <span className="user-badge-role">SV</span>
            </Link>
            <button className="dash-logout-btn" onClick={handleLogout} title={uiText("Đăng xuất")}>
              <LogOut size={16} />
              <span className="logout-text">{t('Đăng xuất', 'Log out')}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="dash-body">
        <aside className={`dash-sidebar ${isMobileOpen ? 'open' : ''}`} role="navigation" aria-label={uiText("Menu sinh viên")}>
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
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="nav-badge" aria-label={uiText("{0} chưa đọc",[item.badge])}>
                    {item.badge}
                  </span>
                )}
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
