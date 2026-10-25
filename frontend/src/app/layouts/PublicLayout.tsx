import React, { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useSession } from '../providers/SessionContext';
import { Menu, X, ArrowRight } from 'lucide-react';
import { Button } from '../../shared/ui/Button';
import './PublicLayout.css';

export const PublicLayout: React.FC = () => {
  const { currentUser, role } = useSession();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const isHomePage = location.pathname === '/';

  const getDashboardPath = () => {
    if (role === 'admin') return '/ad';
    if (role === 'teacher') return '/gv';
    if (role === 'student') return '/sv';
    return '/ho-so';
  };

  if (isHomePage) {
    return (
      <div className="public-shell public-shell--homepage">
        <main className="public-main public-main--homepage" id="main-content">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="public-shell">
      <header className="public-header" role="banner">
        <div className="public-header-inner">
          <Link to="/" className="public-brand" aria-label="Trang chủ NEU LMS">
            <div className="brand-logo" aria-hidden="true">
              <img
                src="/neu-logo.webp"
                alt="Biểu trưng Đại học Kinh tế Quốc dân"
                className="brand-logo-img"
              />
            </div>
            <div className="brand-text">
              <span className="brand-name">NEU</span>
              <span className="brand-sub">NEU - LEARNING MANAGEMENT SYSTEM</span>
            </div>
          </Link>

          <nav className="public-nav-desktop" aria-label="Điều hướng công khai">
            <Link to="/tinh-nang" className="public-nav-link">
              Tính năng
            </Link>
            <Link to="/huong-dan" className="public-nav-link">
              Hướng dẫn
            </Link>
          </nav>

          <div className="public-auth-desktop">
            {currentUser ? (
              <Button
                variant="primary"
                onClick={() => navigate(getDashboardPath())}
                icon={<ArrowRight size={16} />}
              >
                Vào không gian của tôi
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => navigate('/dang-nhap')}>
                  Đăng nhập
                </Button>
                <Button variant="primary" onClick={() => navigate('/dang-ky')}>
                  Đăng ký
                </Button>
              </>
            )}
          </div>

          <button
            className="public-mobile-toggle"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? 'Đóng menu' : 'Mở menu'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile dropdown */}
        {isMobileMenuOpen && (
          <div className="public-mobile-menu" role="dialog" aria-modal="true">
            <nav className="public-mobile-nav">
              <Link
                to="/tinh-nang"
                className="mobile-nav-link"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Tính năng
              </Link>
              <Link
                to="/huong-dan"
                className="mobile-nav-link"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Hướng dẫn
              </Link>
              <div className="mobile-auth-actions">
                {currentUser ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      navigate(getDashboardPath());
                    }}
                  >
                    Vào không gian của tôi
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        navigate('/dang-nhap');
                      }}
                    >
                      Đăng nhập
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        navigate('/dang-ky');
                      }}
                    >
                      Đăng ký
                    </Button>
                  </>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="public-main" id="main-content">
        <Outlet />
      </main>

      <footer className="public-footer" role="contentinfo">
        <div className="public-footer-inner">
          <div className="footer-left">
            <p className="footer-brand">NEU LMS / LCMS Đại học</p>
            <p className="footer-desc">
              Không gian quản lý môn học, phân phối học liệu số và tương tác học tập rõ việc.
            </p>
          </div>
          <div className="footer-right">
            <p className="footer-disclaimer">Dữ liệu minh họa</p>
            <p className="footer-copy">© 2026 NEU. Giữ toàn quyền kiến trúc Blueprints.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
