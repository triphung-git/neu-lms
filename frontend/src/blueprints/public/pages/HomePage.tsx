import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import './HomePage.css';

export const HomePage: React.FC = () => {
  const { currentUser, role } = useSession();
  const navigate = useNavigate();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  const getDashboardPath = useCallback(() => {
    if (role === 'admin') return '/ad';
    if (role === 'teacher') return '/gv';
    return '/sv';
  }, [role]);

  const handleNavLogin = () => {
    navigate('/dang-nhap');
  };

  const handleHeroRegister = () => {
    navigate('/dang-ky');
  };

  const toggleBurger = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMobileMenuOpen((prev) => !prev);
  };

  const closeBurger = () => {
    setIsMobileMenuOpen(false);
  };

  // 1. Title & Metadata
  useEffect(() => {
    const originalTitle = document.title;
    document.title = 'NEU LMS — Hệ thống quản lý học tập';
    return () => {
      document.title = originalTitle;
    };
  }, []);

  // 2. Desktop Fit JS (>= 940px)
  useEffect(() => {
    const DW = 1290;
    const DH = 860;
    const CARD_TOP = 549;
    const CARD_H = 340;
    const NAV_W = 880;
    const MINW = 960;
    const HERO_SHARE = 0.55;

    const updateFit = () => {
      const stage = stageRef.current;
      if (!stage) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (vw < 940) {
        stage.style.width = '';
        stage.style.height = '';
        stage.style.transform = '';
        stage.style.removeProperty('--dsk-card-s');
        stage.style.removeProperty('--dsk-band-dy');
        stage.style.removeProperty('--dsk-hero-dy');
        return;
      }

      // Close mobile menu on desktop
      setIsMobileMenuOpen(false);

      const s = Math.min(vh / DH, vw / MINW);
      const W = vw / s;
      const H = vh / s;
      const csMax = Math.min(NAV_W, 0.8 * W) / 548;
      const cs = Math.max(1, Math.min((H - CARD_TOP) / CARD_H, csMax));
      const dy = Math.max(0, H - CARD_TOP - CARD_H * cs);
      const heroDy = HERO_SHARE * dy;

      stage.style.width = `${W}px`;
      stage.style.height = `${H}px`;
      stage.style.transform = `scale(${s})`;
      stage.style.setProperty('--dsk-card-s', String(cs));
      stage.style.setProperty('--dsk-band-dy', `${dy}px`);
      stage.style.setProperty('--dsk-hero-dy', `${heroDy}px`);
    };

    updateFit();

    window.addEventListener('resize', updateFit);
    window.addEventListener('orientationchange', updateFit);
    window.addEventListener('pageshow', updateFit);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateFit);
    }
    if (document.fonts) {
      document.fonts.ready.then(updateFit);
    }

    return () => {
      window.removeEventListener('resize', updateFit);
      window.removeEventListener('orientationchange', updateFit);
      window.removeEventListener('pageshow', updateFit);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateFit);
      }
    };
  }, []);

  // 3. Entrance Animations
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rootEl = document.documentElement;

    if (prefersReducedMotion) {
      rootEl.setAttribute('data-enter', 'done');
      return;
    }

    rootEl.setAttribute('data-enter', 'pending');

    let started = false;
    let done = false;

    const startAnimation = () => {
      if (started) return;
      started = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          rootEl.setAttribute('data-enter', 'run');
        });
      });
    };

    const finishAnimation = () => {
      if (done) return;
      done = true;
      rootEl.setAttribute('data-enter', 'done');
    };

    // Wait for fonts ready then start, fallback after 1200ms
    if (document.fonts) {
      document.fonts.ready.then(startAnimation);
    } else {
      startAnimation();
    }
    const fallbackStartTimer = window.setTimeout(startAnimation, 1200);

    // End on card animationend or 3000ms timeout
    const cardEl = cardRef.current;
    if (cardEl) {
      cardEl.addEventListener('animationend', finishAnimation, { once: true });
    }
    const endTimer = window.setTimeout(finishAnimation, 3000);

    return () => {
      window.clearTimeout(fallbackStartTimer);
      window.clearTimeout(endTimer);
      if (cardEl) {
        cardEl.removeEventListener('animationend', finishAnimation);
      }
      rootEl.removeAttribute('data-enter');
    };
  }, []);

  // 4. Click outside & Escape to close mobile menu
  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileMenuOpen(false);
        burgerRef.current?.focus();
      }
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  return (
    <div id="viewport">
      <div id="stage" ref={stageRef}>
        {/* 1. Black Pill Navigation */}
        <nav
          ref={navRef}
          className={`nav ${isMobileMenuOpen ? 'is-open' : ''}`}
          aria-label="Điều hướng chính"
        >
          <div className="nav__brand">
            <div className="logo">
              <img
                src="/neu-logo.webp"
                alt="Biểu trưng Đại học Kinh tế Quốc dân"
                className="logo__img"
                width={40}
                height={40}
              />
            </div>
            <div className="wordmark">
              <span className="wordmark__lockup">ĐẠI HỌC KINH TẾ QUỐC DÂN</span>
            </div>
          </div>

          <div className="nav__links">
            <Link to="/tinh-nang" className="link l1">
              Tính năng
            </Link>
            <Link to="/huong-dan" className="link l2">
              Hướng dẫn
            </Link>
            <a
              href="https://neu.edu.vn/he-thong-nhan-dien/"
              className="link l3"
              target="_self"
              rel="noopener noreferrer"
            >
              Về NEU
            </a>
            <Link to="/huong-dan" className="link l4">
              FAQ
            </Link>
          </div>

          <button
            type="button"
            className="btn btn--nav"
            onClick={handleNavLogin}
          >
            Đăng nhập
          </button>

          {/* Mobile Burger Button */}
          <button
            ref={burgerRef}
            type="button"
            className="burger"
            onClick={toggleBurger}
            aria-label={isMobileMenuOpen ? 'Đóng menu' : 'Mở menu'}
            aria-expanded={isMobileMenuOpen}
            aria-controls="nav-menu"
          >
            <span className="burger__bar" />
            <span className="burger__bar" />
          </button>

          {/* Mobile Dropdown Menu */}
          <div
            id="nav-menu"
            className="navmenu"
            hidden={!isMobileMenuOpen}
          >
            <Link
              to="/tinh-nang"
              className="navmenu__link"
              onClick={closeBurger}
            >
              Tính năng
            </Link>
            <Link
              to="/huong-dan"
              className="navmenu__link"
              onClick={closeBurger}
            >
              Hướng dẫn
            </Link>
            <a
              href="https://neu.edu.vn/he-thong-nhan-dien/"
              className="navmenu__link"
              target="_self"
              rel="noopener noreferrer"
              onClick={closeBurger}
            >
              Về NEU
            </a>
            <Link
              to="/huong-dan"
              className="navmenu__link"
              onClick={closeBurger}
            >
              FAQ
            </Link>
            <button
              type="button"
              className="navmenu__cta"
              onClick={() => {
                closeBurger();
                handleNavLogin();
              }}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              className="navmenu__cta navmenu__cta--register"
              onClick={() => {
                closeBurger();
                handleHeroRegister();
              }}
            >
              Đăng ký
            </button>
          </div>
        </nav>

        {/* 2. Hero Headline */}
        <h1 className="hero-h1 t-display">
          {`Kết nối tri thức,\nchủ động học tập cùng NEU`}
        </h1>

        {/* 3. Hero Subtitle */}
        <p className="hero-sub t-body">
          {`Không gian học tập trực tuyến dành cho giảng viên và sinh viên NEU.\nTheo dõi học phần, tài liệu và nhiệm vụ học tập tại một nơi.`}
        </p>

        {/* 4. Hero CTA Button */}
        <button
          type="button"
          className="btn btn--hero"
          onClick={handleHeroRegister}
        >
          Đăng ký
        </button>

        {/* 5. Full-bleed Cyan Video Band */}
        <div className="band" role="presentation">
          <video
            className="band__video"
            autoPlay
            muted
            loop
            playsInline
            poster="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_125039_45a71f04-36dd-4620-99d8-7526316d439e.png"
          >
            <source
              src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_125119_4963ddd4-c287-4044-b014-b68943cdd8bd.mp4"
              type="video/mp4"
            />
          </video>
        </div>

        {/* 6. Fixed-Proportion Product Mockup Card */}
        <div className="card" ref={cardRef}>
          <div className="eyebrow t-eyebrow">
            # NEU LMS / Không gian học tập
          </div>
          <div className="cardtitle t-title">Tổng quan học tập</div>

          <div className="meta t-meta">
            <div className="avatars" aria-hidden="true">
              <div className="av av1" />
              <div className="av av2" />
              <div className="av av3" />
            </div>
            <svg
              className="clockicon"
              viewBox="0 0 14 14"
              width="14"
              height="14"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="7" fill="#d9d9d9" />
              <path
                d="M7 3.6V7.2l2.3 1.4"
                stroke="#f2f2f2"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <div className="metatext">
              Hôm nay <span className="sep">&bull;</span> Học kỳ hiện tại{' '}
              <span className="sep">&bull;</span> Đang học
            </div>
          </div>

          <div className="tabs" role="tablist">
            <div className="tab is-active t-tab" role="tab" aria-selected="true">
              Tổng quan
            </div>
            <div className="tab t2 t-tab" role="tab" aria-selected="false">
              Học phần
            </div>
            <div className="tab t3 t-tab" role="tab" aria-selected="false">
              Bài tập
            </div>
            <div className="tab t4 t-tab" role="tab" aria-selected="false">
              Thông báo
            </div>
          </div>

          <div className="panel" role="region" aria-label="Nhiệm vụ học tập">
            <div className="panel__heading t-heading">Nhiệm vụ học tập</div>

            <div className="row row1">
              <div className="dot dot--check" aria-hidden="true">
                <svg
                  viewBox="0 0 15 15"
                  width="15"
                  height="15"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle cx="7.5" cy="7.5" r="7.5" fill="#2a9a30" />
                  <path
                    d="M4.1 7.15 6.05 9.05 9.9 5.2"
                    stroke="#fff"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="rowtitle t-item">
                Hoàn thành bài học mở đầu
              </div>
              <div className="rowowner t-caption">
                Trạng thái: Đã hoàn thành
              </div>
            </div>

            <div className="row row2">
              <div className="dot dot--question" aria-hidden="true">
                <svg
                  viewBox="0 0 15 15"
                  width="15"
                  height="15"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle cx="7.5" cy="7.5" r="7.5" fill="#f6a825" />
                  <path
                    d="M7.5 4.5c-.8 0-1.4.5-1.4 1.2 0 .8.7 1.1 1.1 1.4.4.3.4.6.4.9"
                    stroke="#fff"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                  <circle cx="7.5" cy="9.8" r="0.78" fill="#fff" />
                </svg>
              </div>
              <div className="rowtitle t-item">
                Chuẩn bị nội dung cho buổi học tiếp theo
              </div>
              <div className="rowowner t-caption">
                Trạng thái: Cần thực hiện
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
