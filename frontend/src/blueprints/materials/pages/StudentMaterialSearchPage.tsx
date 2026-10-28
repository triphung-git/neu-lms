import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { SelectField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { coursesService, type Course } from '../../../api/coursesService';
import {
  materialsService,
  type MaterialSearchResult,
  type PaginatedMaterialSearchResult,
} from '../../../api/materialsService';
import {
  Search,
  FileText,
  Tag,
  ArrowRight,
  BookOpen,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import './StudentMaterialSearchPage.css';

export const StudentMaterialSearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const queryQ = searchParams.get('q') || '';
  const filterCourse = searchParams.get('mon') || 'all';
  const filterType = searchParams.get('loai') || 'all';
  const sortBy = searchParams.get('sap-xep') || 'relevance';
  const selectedTag = searchParams.get('the') || '';
  const pageParam = parseInt(searchParams.get('trang') || '1', 10);
  const currentPage = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

  // Form input state
  const [searchInput, setSearchInput] = useState(queryQ);

  // Student Courses
  const [studentCourses, setStudentCourses] = useState<Course[]>([]);
  const [isCoursesLoading, setIsCoursesLoading] = useState(false);

  // Search Results
  const [results, setResults] = useState<MaterialSearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Stale request guard
  const reqSeq = useRef(0);

  // 1. Fetch Student Courses for dropdown filter
  useEffect(() => {
    let isMounted = true;
    const fetchCourses = async () => {
      setIsCoursesLoading(true);
      try {
        const res = await coursesService.list();
        if (isMounted) {
          setStudentCourses(res.items || []);
        }
      } catch {
        // Fallback silently if courses fail to list
      } finally {
        if (isMounted) {
          setIsCoursesLoading(false);
        }
      }
    };
    void fetchCourses();
    return () => {
      isMounted = false;
    };
  }, []);

  // Sync search input with URL params
  useEffect(() => {
    setSearchInput(queryQ);
  }, [queryQ]);

  // 2. Execute Server-Side Search
  const executeSearch = useCallback(async () => {
    const currentSeq = ++reqSeq.current;
    const hasSearchCriteria =
      Boolean(queryQ.trim()) ||
      filterCourse !== 'all' ||
      filterType !== 'all' ||
      Boolean(selectedTag);

    if (!hasSearchCriteria) {
      setResults([]);
      setTotalCount(0);
      setTotalPages(1);
      setIsLoading(false);
      setSearchError(null);
      return;
    }

    setIsLoading(true);
    setSearchError(null);

    try {
      let res: PaginatedMaterialSearchResult;

      if (filterCourse !== 'all') {
        res = await materialsService.searchCourseMaterials(filterCourse, {
          q: queryQ.trim() || undefined,
          type: filterType !== 'all' ? filterType : undefined,
          tag: selectedTag || undefined,
          sort_by: sortBy,
          page: currentPage,
          page_size: 10,
        });
      } else {
        res = await materialsService.searchGlobalMaterials({
          q: queryQ.trim() || undefined,
          type: filterType !== 'all' ? filterType : undefined,
          tag: selectedTag || undefined,
          sort_by: sortBy,
          page: currentPage,
          page_size: 10,
        });
      }

      if (currentSeq !== reqSeq.current) return;
      setResults(res.items || []);
      setTotalCount(res.pagination?.total_items || 0);
      setTotalPages(res.pagination?.total_pages || 1);
    } catch (err: unknown) {
      if (currentSeq !== reqSeq.current) return;
      const apiErr = err as { message?: string };
      setSearchError(apiErr.message || 'Lỗi tra cứu máy chủ. Vui lòng thử lại.');
    } finally {
      if (currentSeq === reqSeq.current) {
        setIsLoading(false);
      }
    }
  }, [queryQ, filterCourse, filterType, selectedTag, sortBy, currentPage]);

  useEffect(() => {
    void executeSearch();
    return () => {
      reqSeq.current += 1;
    };
  }, [executeSearch]);

  // Handlers for Filters
  const handleDoSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (searchInput.trim()) {
      next.set('q', searchInput.trim());
    } else {
      next.delete('q');
    }
    next.set('trang', '1');
    setSearchParams(next);
  };

  const handleCourseFilter = (cId: string) => {
    const next = new URLSearchParams(searchParams);
    if (cId === 'all') {
      next.delete('mon');
    } else {
      next.set('mon', cId);
    }
    next.set('trang', '1');
    setSearchParams(next);
  };

  const handleTypeFilter = (t: string) => {
    const next = new URLSearchParams(searchParams);
    if (t === 'all') {
      next.delete('loai');
    } else {
      next.set('loai', t);
    }
    next.set('trang', '1');
    setSearchParams(next);
  };

  const handleSortChange = (s: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('sap-xep', s);
    next.set('trang', '1');
    setSearchParams(next);
  };

  const handleSelectTag = (tag: string) => {
    const next = new URLSearchParams(searchParams);
    if (selectedTag === tag) {
      next.delete('the');
    } else {
      next.set('the', tag);
    }
    next.set('trang', '1');
    setSearchParams(next);
  };

  const handlePageChange = (newPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('trang', newPage.toString());
    setSearchParams(next);
  };

  const handleClearFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams());
  };

  const hasSearchCriteria =
    Boolean(queryQ.trim()) ||
    filterCourse !== 'all' ||
    filterType !== 'all' ||
    Boolean(selectedTag);

  return (
    <div className="student-mat-search-page">
      <div className="search-header-row">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/sv' },
            { label: 'Tìm kiếm học liệu' },
          ]}
        />
        <h1 className="search-main-heading">Tra cứu học liệu học tập</h1>
        <p className="search-subheading">
          Tìm kiếm toàn văn giáo trình, bài giảng và tài liệu đính kèm trong các môn học được phân quyền.
        </p>
      </div>

      {/* Main Search Input Form */}
      <form onSubmit={handleDoSearch} className="search-input-card">
        <div className="input-group-row">
          <div className="search-field-flex">
            <Search size={20} className="search-icon-deco" />
            <input
              type="text"
              className="main-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nhập từ khóa tìm kiếm (tiêu đề, nội dung tệp, mã chương)..."
            />
          </div>
          <Button type="submit" variant="primary">
            <span>Tìm kiếm</span>
          </Button>
        </div>
      </form>

      {/* Filter Toolbar */}
      <div className="filters-toolbar-card">
        <div className="filter-dropdowns-row">
          <div className="dropdown-col">
            <SelectField
              label="Môn học của tôi"
              value={filterCourse}
              disabled={isCoursesLoading}
              onChange={(e) => handleCourseFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Tất cả môn học đã ghi danh' },
                ...studentCourses.map((c) => ({
                  value: c.id,
                  label: `${c.code} — ${c.name}`,
                })),
              ]}
            />
          </div>

          <div className="dropdown-col">
            <SelectField
              label="Định dạng tệp"
              value={filterType}
              onChange={(e) => handleTypeFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Tất cả định dạng' },
                { value: 'pdf', label: 'Tài liệu PDF (.pdf)' },
                { value: 'docx', label: 'Tài liệu Word (.docx)' },
                { value: 'txt', label: 'Văn bản thuần (.txt)' },
              ]}
            />
          </div>

          <div className="dropdown-col">
            <SelectField
              label="Sắp xếp kết quả"
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value)}
              options={[
                { value: 'relevance', label: 'Mức độ phù hợp nhất' },
                { value: 'newest', label: 'Mới cập nhật nhất' },
                { value: 'title_asc', label: 'Tiêu đề A-Z' },
                { value: 'title_desc', label: 'Tiêu đề Z-A' },
              ]}
            />
          </div>
        </div>

        {/* Selected Tag Indicator */}
        {selectedTag && (
          <div className="active-tag-banner">
            <span>Đang lọc theo thẻ: <strong>#{selectedTag}</strong></span>
            <button
              type="button"
              className="clear-tag-btn"
              onClick={() => handleSelectTag(selectedTag)}
            >
              Bỏ lọc thẻ
            </button>
          </div>
        )}
      </div>

      {/* Results Section */}
      <div className="search-results-section">
        {isLoading ? (
          <div className="search-loading-card">
            <p>Đang tìm kiếm học liệu từ máy chủ...</p>
          </div>
        ) : searchError ? (
          <EmptyState
            title="Lỗi tra cứu"
            description={searchError}
            action={
              <Button variant="secondary" onClick={executeSearch} icon={<RefreshCw size={16} />}>
                Thử lại
              </Button>
            }
          />
        ) : !hasSearchCriteria ? (
          <EmptyState
            title="Sẵn sàng tra cứu học liệu"
            description="Nhập từ khóa tìm kiếm hoặc chọn môn học ở bộ lọc phía trên để hiển thị các tài liệu phù hợp."
          />
        ) : results.length === 0 ? (
          <EmptyState
            title="Không tìm thấy kết quả phù hợp"
            description="Không tìm thấy học liệu nào phù hợp với điều kiện tra cứu hiện tại. Hãy thử từ khóa ngắn hơn hoặc kiểm tra môn học đã chọn."
            action={
              <Button variant="secondary" onClick={handleClearFilters}>
                Xóa toàn bộ bộ lọc
              </Button>
            }
          />
        ) : (
          <div className="results-list-wrap">
            <div className="results-count-banner">
              <span>
                Tìm thấy <strong>{totalCount}</strong> học liệu phù hợp (Trang {currentPage} /{' '}
                {totalPages})
              </span>
            </div>

            <div className="results-cards-grid">
              {results.map((mat) => {
                const targetLink = `/sv/mon-hoc/${mat.course_id}/hoc-lieu/${mat.id}`;

                return (
                  <article key={mat.id} className="result-material-card">
                    <div className="res-icon-wrap">
                      <FileText size={26} />
                    </div>

                    <div className="res-info-wrap">
                      <div className="res-course-line">
                        <span className="res-course-code">{mat.course_code}</span>
                        <span className="res-course-name">{mat.course_name}</span>
                        {mat.chapter_title && (
                          <span className="res-chapter-name">• Chương: {mat.chapter_title}</span>
                        )}
                        {mat.lesson_title && (
                          <span className="res-lesson-name">• Bài: {mat.lesson_title}</span>
                        )}
                      </div>

                      <h2 className="res-material-title">
                        <Link to={targetLink} className="res-title-link">
                          {mat.title}
                        </Link>
                      </h2>

                      {mat.description && (
                        <p className="res-material-desc">{mat.description}</p>
                      )}

                      <div className="res-meta-line">
                        <span className="res-type-pill">{mat.material_type.toUpperCase()}</span>
                        <span className="res-version">Phiên bản v{mat.version_number}</span>
                        <span className="res-date">Cập nhật {formatDateVN(mat.updated_at)}</span>
                      </div>

                      {mat.tags && mat.tags.length > 0 && (
                        <div className="res-tags-line">
                          {mat.tags.map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={`res-tag-btn ${selectedTag === t ? 'active' : ''}`}
                              onClick={() => handleSelectTag(t)}
                              title={`Lọc theo thẻ #${t}`}
                            >
                              #{t}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Provenance Match Snippets (Search Highlights) */}
                      {mat.matches && mat.matches.length > 0 && (
                        <div className="res-matches-section">
                          <div className="matches-heading">
                            <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                            <span>Điểm khớp trong nội dung tệp đã quét:</span>
                          </div>
                          {mat.matches.map((m, mIdx) => (
                            <div key={mIdx} className="match-snippet-box">
                              <span className="match-provenance-file">
                                {m.file_name} {m.page_number ? `(Trang ${m.page_number})` : ''}:
                              </span>
                              <span className="match-snippet-text">{m.snippet}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="res-arrow-wrap">
                      <Link to={targetLink} className="view-detail-btn" title="Xem chi tiết học liệu">
                        <ArrowRight size={20} />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="pagination-bar" role="navigation" aria-label="Phân trang tìm kiếm">
                <Button
                  variant="secondary"
                  disabled={currentPage <= 1}
                  onClick={() => handlePageChange(currentPage - 1)}
                  icon={<ChevronLeft size={16} />}
                >
                  Trang trước
                </Button>
                <span className="pagination-indicator">
                  Trang {currentPage} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => handlePageChange(currentPage + 1)}
                  icon={<ChevronRight size={16} />}
                >
                  Trang sau
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
