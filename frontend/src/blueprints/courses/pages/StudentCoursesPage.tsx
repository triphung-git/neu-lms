import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  coursesService,
  type Course,
  type CourseCatalogItem,
  type StudentEnrollmentRequest,
} from '../../../api/coursesService';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { Tabs } from '../../../shared/ui/Tabs';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { BookOpen, Calendar, Clock, Search, User, XCircle } from 'lucide-react';
import './StudentCoursesPage.css';

type TabKey = 'open' | 'archived' | 'catalog' | 'requests';

export const StudentCoursesPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showNotification } = useNotifications();

  const requestedTab = searchParams.get('tab');
  const activeTab: TabKey = requestedTab === 'archived' || requestedTab === 'catalog' || requestedTab === 'requests' ? requestedTab : 'open';

  // State: Enrolled Courses (Open / Archived)
  const [enrolledCourses, setEnrolledCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesPage, setCoursesPage] = useState(1);
  const [coursesTotalPages, setCoursesTotalPages] = useState(1);
  const [coursesError, setCoursesError] = useState<string | null>(null);

  // State: Catalog
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogTerm, setCatalogTerm] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogTotalPages, setCatalogTotalPages] = useState(1);
  const [catalogTotalItems, setCatalogTotalItems] = useState(0);

  // State: My Enrollment Requests
  const [requests, setRequests] = useState<StudentEnrollmentRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<string>('all');
  const [requestsPage, setRequestsPage] = useState(1);
  const [requestsTotalPages, setRequestsTotalPages] = useState(1);
  const [requestsTotalItems, setRequestsTotalItems] = useState(0);

  // Per-item action loading tracking
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const loadSequence = useRef(0);

  const handleTabChange = (key: string) => {
    const nextParams = new URLSearchParams(searchParams);
    setCoursesPage(1);
    nextParams.set('tab', key);
    setSearchParams(nextParams);
  };

  // Fetch Enrolled Courses
  const fetchEnrolledCourses = useCallback(async () => {
    const seq = ++loadSequence.current;
    setCoursesLoading(true);
    setCoursesError(null);
    try {
      const res = await coursesService.list({
        role: 'student', page: coursesPage, page_size: 12,
        status: activeTab === 'archived' ? 'archived' : 'open',
      });
      if (seq === loadSequence.current) {
        setEnrolledCourses(res.items);
        setCoursesTotalPages(res.pagination.total_pages);
      }
    } catch (err: any) {
      if (seq === loadSequence.current) {
        setCoursesError(err?.message || 'Không thể tải danh sách môn học.');
      }
    } finally {
      if (seq === loadSequence.current) {
        setCoursesLoading(false);
      }
    }
  }, [activeTab, coursesPage]);

  // Fetch Catalog
  const fetchCatalog = useCallback(async () => {
    const seq = ++loadSequence.current;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await coursesService.getCatalog({
        search: catalogSearch.trim() || undefined,
        term: catalogTerm.trim() || undefined,
        page: catalogPage,
        page_size: 12,
      });
      if (seq === loadSequence.current) {
        setCatalogItems(res.items);
        setCatalogTotalPages(res.pagination.total_pages);
        setCatalogTotalItems(res.pagination.total_items);
      }
    } catch (err: any) {
      if (seq === loadSequence.current) {
        setCatalogError(err?.message || 'Không thể tải danh mục môn học.');
      }
    } finally {
      if (seq === loadSequence.current) {
        setCatalogLoading(false);
      }
    }
  }, [catalogSearch, catalogTerm, catalogPage]);

  // Fetch My Requests
  const fetchMyRequests = useCallback(async () => {
    const seq = ++loadSequence.current;
    setRequestsLoading(true);
    setRequestsError(null);
    try {
      const res = await coursesService.getMyEnrollmentRequests({
        status:
          requestStatusFilter !== 'all'
            ? (requestStatusFilter as 'pending' | 'approved' | 'rejected' | 'cancelled')
            : undefined,
        page: requestsPage,
        page_size: 10,
      });
      if (seq === loadSequence.current) {
        setRequests(res.items);
        setRequestsTotalPages(res.pagination.total_pages);
        setRequestsTotalItems(res.pagination.total_items);
      }
    } catch (err: any) {
      if (seq === loadSequence.current) {
        setRequestsError(err?.message || 'Không thể tải danh sách yêu cầu ghi danh.');
      }
    } finally {
      if (seq === loadSequence.current) {
        setRequestsLoading(false);
      }
    }
  }, [requestStatusFilter, requestsPage]);

  // Trigger loads based on active tab
  useEffect(() => {
    if (activeTab === 'open' || activeTab === 'archived') {
      void fetchEnrolledCourses();
    } else if (activeTab === 'catalog') {
      void fetchCatalog();
    } else if (activeTab === 'requests') {
      void fetchMyRequests();
    }
    return () => { loadSequence.current += 1; };
  }, [activeTab, fetchEnrolledCourses, fetchCatalog, fetchMyRequests]);

  // Handler: Enroll in a course
  const handleEnroll = async (courseId: string, courseName: string) => {
    if (actionLoading[courseId]) return;
    setActionLoading((prev) => ({ ...prev, [courseId]: true }));
    try {
      await coursesService.enroll(courseId);
      showNotification('success', `Đã gửi yêu cầu ghi danh vào môn học "${courseName}".`);
      // Refresh current views
      if (activeTab === 'catalog') {
        void fetchCatalog();
      }
    } catch (err: any) {
      showNotification('error', err?.message || 'Gửi yêu cầu ghi danh thất bại. Vui lòng thử lại.');
    } finally {
      setActionLoading((prev) => ({ ...prev, [courseId]: false }));
    }
  };

  // Handler: Cancel an enrollment request
  const handleCancelRequest = async (requestId: string, courseId?: string) => {
    const key = courseId || requestId;
    if (actionLoading[key]) return;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await coursesService.cancelEnrollmentRequest(requestId);
      showNotification('success', 'Đã hủy yêu cầu ghi danh thành công.');
      if (activeTab === 'catalog') {
        void fetchCatalog();
      } else if (activeTab === 'requests') {
        void fetchMyRequests();
      }
    } catch (err: any) {
      showNotification('error', err?.message || 'Hủy yêu cầu ghi danh thất bại. Vui lòng thử lại.');
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const tabs = [
    { id: 'open', label: 'Đang học' },
    { id: 'archived', label: 'Đã lưu trữ' },
    { id: 'catalog', label: 'Đăng ký môn học' },
    { id: 'requests', label: 'Yêu cầu của tôi' },
  ];

  return (
    <div className="courses-page-container">
      <div className="courses-page-header">
        <div>
          <h1 className="courses-title">Môn học của tôi</h1>
          <p className="courses-subtitle">
            Quản lý các môn học phần đã ghi danh, tra cứu danh mục mở đăng ký và theo dõi yêu cầu xét duyệt.
          </p>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />

      {/* TAB 1 & 2: ENROLLED COURSES (OPEN / ARCHIVED) */}
      {(activeTab === 'open' || activeTab === 'archived') && (
        <>
          {coursesLoading && <LoadingSkeleton lines={4} />}

          {coursesError && (
            <ErrorBanner
              message={coursesError}
              onRetry={fetchEnrolledCourses}
            />
          )}

          {!coursesLoading && !coursesError && enrolledCourses.length === 0 && (
            <div className="courses-empty-card" role="alert">
              <BookOpen size={36} className="text-muted" />
              <h3>
                {activeTab === 'open'
                  ? 'Bạn chưa tham gia môn học nào'
                  : 'Không có môn học nào đã lưu trữ'}
              </h3>
              <p>
                {activeTab === 'open'
                  ? 'Hãy chuyển sang tab "Đăng ký môn học" để tra cứu và gửi yêu cầu ghi danh vào các lớp học phần mới.'
                  : 'Các môn học kết thúc học kỳ sẽ được lưu trữ và hiển thị tại đây.'}
              </p>
              {activeTab === 'open' && (
                <Button
                  variant="primary"
                  onClick={() => handleTabChange('catalog')}
                >
                  Tìm môn học để đăng ký
                </Button>
              )}
            </div>
          )}

          {!coursesLoading && !coursesError && enrolledCourses.length > 0 && (
            <div className="course-cards-grid">
              {enrolledCourses.map((crs) => (
                <div
                  key={crs.id}
                  className="student-course-card"
                  onClick={() => navigate(`/sv/mon-hoc/${crs.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/sv/mon-hoc/${crs.id}`);
                  }}
                >
                  <div className="course-card-top">
                    <span className="card-code-badge">{crs.code}</span>
                    <Badge
                      variant={crs.status === 'open' ? 'published' : 'archived'}
                      label={crs.status === 'open' ? 'Đang mở' : 'Đã lưu trữ'}
                    />
                  </div>

                  <h3 className="course-card-name">{crs.name}</h3>
                  <p className="course-card-desc">{crs.description}</p>

                  <div className="course-card-meta">
                    <div className="meta-item">
                      <User size={14} />
                      <span>{crs.teacher_name || 'Chưa phân công'}</span>
                    </div>
                    <div className="meta-item">
                      <Calendar size={14} />
                      <span>Học kỳ: {crs.term}</span>
                    </div>
                  </div>

                  <div className="course-card-footer">
                    <span className="meta-item">
                      {crs.enrollment_open ? 'Đang mở đăng ký' : 'Đóng đăng ký'}
                    </span>
                    <span className="view-arrow">Vào học &rarr;</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!coursesLoading && !coursesError && coursesTotalPages > 1 && (
            <div className="course-pagination" aria-label="Phân trang môn đang học">
              <Button variant="secondary" disabled={coursesPage <= 1} onClick={() => setCoursesPage(p => p - 1)}>Trang trước</Button>
              <span>Trang {coursesPage} / {coursesTotalPages}</span>
              <Button variant="secondary" disabled={coursesPage >= coursesTotalPages} onClick={() => setCoursesPage(p => p + 1)}>Trang sau</Button>
            </div>
          )}
        </>
      )}

      {/* TAB 3: COURSE CATALOG */}
      {activeTab === 'catalog' && (
        <>
          <form
            className="catalog-filter-bar"
            onSubmit={(e) => {
              e.preventDefault();
              setCatalogPage(1);
              void fetchCatalog();
            }}
          >
            <div className="catalog-search-input">
              <input
                type="text"
                placeholder="Tìm theo mã môn, tên môn học hoặc giảng viên..."
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                style={{
                  width: '100%',
                  height: '40px',
                  padding: '0 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-soft)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: 'var(--text-sm)',
                }}
              />
            </div>
            <input
              type="text"
              placeholder="Lọc theo học kỳ (VD: HK1-2026)"
              value={catalogTerm}
              onChange={(e) => setCatalogTerm(e.target.value)}
              className="catalog-term-select"
            />
            <Button variant="primary" type="submit">
              <Search size={16} /> Tìm kiếm
            </Button>
          </form>

          {catalogLoading && <LoadingSkeleton lines={4} />}

          {catalogError && (
            <ErrorBanner
              message={catalogError}
              onRetry={fetchCatalog}
            />
          )}

          {!catalogLoading && !catalogError && catalogItems.length === 0 && (
            <div className="courses-empty-card" role="alert">
              <Search size={36} className="text-muted" />
              <h3>Không tìm thấy môn học nào</h3>
              <p>
                Hiện tại không có môn học nào mở nhận ghi danh phù hợp với từ khóa tìm kiếm. Vui lòng thử lại với từ khóa khác.
              </p>
            </div>
          )}

          {!catalogLoading && !catalogError && catalogItems.length > 0 && (
            <>
              <div className="course-cards-grid">
                {catalogItems.map((c) => {
                  const isActioning = actionLoading[c.id] || false;
                  return (
                    <div key={c.id} className="student-course-card">
                      <div className="course-card-top">
                        <span className="card-code-badge">{c.code}</span>
                        <span
                          style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--muted)',
                          }}
                        >
                          {c.active_member_count} sinh viên
                        </span>
                      </div>

                      <h3 className="course-card-name">{c.name}</h3>
                      <p className="course-card-desc">{c.description || 'Không có mô tả môn học.'}</p>

                      <div className="course-card-meta">
                        <div className="meta-item">
                          <User size={14} />
                          <span>Giảng viên: {c.teacher_name || 'Chưa cập nhật'}</span>
                        </div>
                        <div className="meta-item">
                          <Calendar size={14} />
                          <span>Học kỳ: {c.term}</span>
                        </div>
                      </div>

                      <div className="catalog-card-actions">
                        {c.my_enrollment_status === 'enrolled' && (
                          <>
                            <Badge variant="published" label="Đang học" />
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => navigate(`/sv/mon-hoc/${c.id}`)}
                            >
                              Vào học
                            </Button>
                          </>
                        )}

                        {c.my_enrollment_status === 'pending' && (
                          <>
                            <Badge variant="pending" label="Chờ duyệt" />
                            {c.pending_request_id && (
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={isActioning}
                                onClick={() => handleCancelRequest(c.pending_request_id!, c.id)}
                              >
                                {isActioning ? 'Đang hủy...' : 'Hủy yêu cầu'}
                              </Button>
                            )}
                          </>
                        )}

                        {c.my_enrollment_status === 'withdrawn' && (
                          <>
                            <Badge variant="archived" label="Đã rút lui" />
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={isActioning}
                              onClick={() => handleEnroll(c.id, c.name)}
                            >
                              {isActioning ? 'Đang gửi...' : 'Đăng ký lại'}
                            </Button>
                          </>
                        )}

                        {c.my_enrollment_status === 'not_enrolled' && (
                          <>
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                              Chưa ghi danh
                            </span>
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={isActioning}
                              onClick={() => handleEnroll(c.id, c.name)}
                            >
                              {isActioning ? 'Đang gửi...' : 'Đăng ký học'}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination Bar */}
              {catalogTotalPages > 1 && (
                <div className="catalog-pagination-bar">
                  <span className="page-info-text">
                    Trang {catalogPage} / {catalogTotalPages} (Tổng cộng {catalogTotalItems} môn)
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={catalogPage <= 1 || catalogLoading}
                      onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                    >
                      &larr; Trang trước
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={catalogPage >= catalogTotalPages || catalogLoading}
                      onClick={() => setCatalogPage((p) => Math.min(catalogTotalPages, p + 1))}
                    >
                      Trang sau &rarr;
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* TAB 4: MY ENROLLMENT REQUESTS */}
      {activeTab === 'requests' && (
        <>
          <div className="requests-filter-tabs">
            {['all', 'pending', 'approved', 'rejected', 'cancelled'].map((st) => (
              <button
                key={st}
                className={`filter-chip ${requestStatusFilter === st ? 'active' : ''}`}
                onClick={() => {
                  setRequestStatusFilter(st);
                  setRequestsPage(1);
                }}
              >
                {st === 'all' && 'Tất cả'}
                {st === 'pending' && 'Đang chờ duyệt'}
                {st === 'approved' && 'Đã duyệt'}
                {st === 'rejected' && 'Đã từ chối'}
                {st === 'cancelled' && 'Đã hủy'}
              </button>
            ))}
          </div>

          {requestsLoading && <LoadingSkeleton lines={4} />}

          {requestsError && (
            <ErrorBanner
              message={requestsError}
              onRetry={fetchMyRequests}
            />
          )}

          {!requestsLoading && !requestsError && requests.length === 0 && (
            <EmptyState
              title="Chưa có yêu cầu ghi danh nào"
              description="Khi bạn gửi yêu cầu ghi danh vào các lớp học phần, tiến độ phê duyệt của giảng viên sẽ xuất hiện tại đây."
              action={
                <Button variant="primary" onClick={() => handleTabChange('catalog')}>
                  Tìm môn học để đăng ký
                </Button>
              }
            />
          )}

          {!requestsLoading && !requestsError && requests.length > 0 && (
            <div className="requests-grid">
              {requests.map((r) => {
                const isActioning = actionLoading[r.id] || false;
                return (
                  <div key={r.id} className="request-card">
                    <div className="request-card-header">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="card-code-badge">{r.course_code}</span>
                          <span style={{ fontWeight: 700, fontSize: 'var(--text-base)', color: 'var(--ink)' }}>
                            {r.course_name}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--muted)',
                            marginTop: '4px',
                            display: 'flex',
                            gap: '12px',
                          }}
                        >
                          <span>Học kỳ: {r.course_term}</span>
                          <span>Giảng viên: {r.teacher_name}</span>
                        </div>
                      </div>

                      <div>
                        {r.status === 'pending' && <Badge variant="pending" label="Đang chờ duyệt" />}
                        {r.status === 'approved' && <Badge variant="published" label="Đã duyệt" />}
                        {r.status === 'rejected' && <Badge variant="error" label="Đã từ chối" />}
                        {r.status === 'cancelled' && <Badge variant="archived" label="Đã hủy" />}
                      </div>
                    </div>

                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', display: 'flex', gap: '16px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12} /> Gửi lúc: {formatDateVN(r.requested_at)}
                      </span>
                      {r.reviewed_at && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          Xử lý lúc: {formatDateVN(r.reviewed_at)}
                        </span>
                      )}
                    </div>

                    {r.status === 'rejected' && r.rejection_reason && (
                      <div className="request-rejection-box">
                        <strong>Lý do từ chối:</strong> {r.rejection_reason}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                      {r.status === 'pending' && (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isActioning}
                          onClick={() => handleCancelRequest(r.id)}
                        >
                          <XCircle size={14} /> {isActioning ? 'Đang hủy...' : 'Hủy yêu cầu'}
                        </Button>
                      )}

                      {r.status === 'approved' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate(`/sv/mon-hoc/${r.course_id}`)}
                        >
                          Vào học &rarr;
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

              {requestsTotalPages > 1 && (
                <div className="catalog-pagination-bar">
                  <span className="page-info-text">
                    Trang {requestsPage} / {requestsTotalPages} (Tổng cộng {requestsTotalItems} yêu cầu)
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={requestsPage <= 1 || requestsLoading}
                      onClick={() => setRequestsPage((p) => Math.max(1, p - 1))}
                    >
                      &larr; Trang trước
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={requestsPage >= requestsTotalPages || requestsLoading}
                      onClick={() => setRequestsPage((p) => Math.min(requestsTotalPages, p + 1))}
                    >
                      Trang sau &rarr;
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
