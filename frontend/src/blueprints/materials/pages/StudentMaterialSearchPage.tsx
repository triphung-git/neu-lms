import React, { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { SelectField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { removeVietnameseAccents } from '../../../shared/lib/search';
import type { Material, MaterialVersion, Course, Lesson, Membership } from '../../../shared/kernel/types';
import {
  Search,
  FileText,
  Tag,
  ArrowRight
} from 'lucide-react';
import './StudentMaterialSearchPage.css';

export const StudentMaterialSearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { materials, materialVersions, courses, lessons, memberships } = useDatabase();
  const { currentUser } = useSession();

  const queryQ = searchParams.get('q') || '';
  const filterCourse = searchParams.get('mon') || 'all';
  const filterType = searchParams.get('loai') || 'all';
  const sortBy = searchParams.get('sap-xep') || 'moi-nhat';
  const selectedTagsParam = searchParams.getAll('the');

  // Input state for search box
  const [searchInput, setSearchInput] = useState(queryQ);

  // Student's active courses
  const myCourseIds = useMemo(() => {
    return new Set(
      memberships
        .filter((m: Membership) => (m.userId === currentUser?.id || m.emailNormalized === currentUser?.emailNormalized) && m.status === 'active')
        .map((m: Membership) => m.courseId)
    );
  }, [memberships, currentUser]);

  const studentCourses = useMemo(() => {
    return courses.filter((c: Course) => myCourseIds.has(c.id));
  }, [courses, myCourseIds]);

  // Materials student has access to
  const availableMaterials = useMemo(() => {
    return materials.filter(
      (m: Material) => myCourseIds.has(m.courseId) && m.visibility === 'class'
    );
  }, [materials, myCourseIds]);

  const enrichedMaterials = useMemo(() => {
    return availableMaterials.map((m: Material) => {
      const ver = materialVersions.find((v: MaterialVersion) => v.id === m.currentVersionId);
      const fileType = ver?.filename ? ver.filename.split('.').pop()?.toUpperCase() || 'PDF' : 'PDF';
      const versionNumber = ver?.versionNumber || 1;
      const updatedAt = ver?.uploadedAt || new Date().toISOString();
      return {
        material: m,
        fileType,
        versionNumber,
        updatedAt,
      };
    });
  }, [availableMaterials, materialVersions]);

  // All distinct tags
  const allTags = useMemo(() => {
    const set = new Set<string>();
    availableMaterials.forEach((m: Material) => m.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [availableMaterials]);

  // All distinct file types
  const fileTypes = useMemo(() => {
    const set = new Set<string>();
    enrichedMaterials.forEach((item) => set.add(item.fileType));
    return Array.from(set);
  }, [enrichedMaterials]);

  // Filter and Search logic
  const searchResults = useMemo(() => {
    if (!queryQ.trim() && filterCourse === 'all' && filterType === 'all' && selectedTagsParam.length === 0) {
      return [];
    }

    const qNorm = removeVietnameseAccents(queryQ.toLowerCase().trim());

    const filtered = enrichedMaterials.filter((item) => {
      const mat = item.material;

      // Course filter
      if (filterCourse !== 'all' && mat.courseId !== filterCourse) return false;

      // File type filter
      if (filterType !== 'all' && item.fileType.toUpperCase() !== filterType.toUpperCase()) return false;

      // Tag filter
      if (selectedTagsParam.length > 0) {
        const hasAllTags = selectedTagsParam.every((t) => mat.tags.includes(t));
        if (!hasAllTags) return false;
      }

      // Query search
      if (qNorm) {
        const titleNorm = removeVietnameseAccents(mat.title.toLowerCase());
        const tagNorms = mat.tags.map((t) => removeVietnameseAccents(t.toLowerCase())).join(' ');
        const course = courses.find((c: Course) => c.id === mat.courseId);
        const courseNorm = course ? removeVietnameseAccents(course.name.toLowerCase() + ' ' + course.code.toLowerCase()) : '';

        return titleNorm.includes(qNorm) || tagNorms.includes(qNorm) || courseNorm.includes(qNorm);
      }

      return true;
    });

    // Sorting
    if (sortBy === 'moi-nhat') {
      filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    return filtered;
  }, [enrichedMaterials, queryQ, filterCourse, filterType, selectedTagsParam, sortBy, courses]);

  // Handlers
  const handleDoSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (searchInput.trim()) next.set('q', searchInput.trim());
    else next.delete('q');
    setSearchParams(next);
  };

  const handleCourseFilter = (cId: string) => {
    const next = new URLSearchParams(searchParams);
    if (cId === 'all') next.delete('mon');
    else next.set('mon', cId);
    setSearchParams(next);
  };

  const handleTypeFilter = (t: string) => {
    const next = new URLSearchParams(searchParams);
    if (t === 'all') next.delete('loai');
    else next.set('loai', t);
    setSearchParams(next);
  };

  const handleSortChange = (s: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('sap-xep', s);
    setSearchParams(next);
  };

  const handleToggleTag = (tag: string) => {
    const next = new URLSearchParams(searchParams);
    const existing = next.getAll('the');
    next.delete('the');

    if (existing.includes(tag)) {
      existing.filter((t) => t !== tag).forEach((t) => next.append('the', t));
    } else {
      [...existing, tag].forEach((t) => next.append('the', t));
    }
    setSearchParams(next);
  };

  const handleClearFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams());
  };

  return (
    <div className="student-mat-search-page">
      <div className="search-header-row">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/sv' },
            { label: 'Tìm kiếm học liệu' }
          ]}
        />
        <h1 className="search-main-heading">Tra cứu học liệu học tập</h1>
        <p className="search-subheading">
          Tìm kiếm tài liệu bài giảng, giáo trình và tài liệu tham khảo theo từ khóa, môn học hoặc nhãn phân loại.
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
              placeholder="Nhập tên tài liệu, nội dung hoặc từ khóa kiến thức..."
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
              onChange={(e) => handleCourseFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Tất cả các môn đang học' },
                ...studentCourses.map((c: Course) => ({ value: c.id, label: `${c.code} — ${c.name}` }))
              ]}
            />
          </div>

          <div className="dropdown-col">
            <SelectField
              label="Định dạng tệp"
              value={filterType}
              onChange={(e) => handleTypeFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Mọi định dạng' },
                ...fileTypes.map((t) => ({ value: t.toLowerCase(), label: t }))
              ]}
            />
          </div>

          <div className="dropdown-col">
            <SelectField
              label="Sắp xếp kết quả"
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value)}
              options={[
                { value: 'moi-nhat', label: 'Mới cập nhật nhất' },
                { value: 'ten-az', label: 'Theo tên A-Z' }
              ]}
            />
          </div>
        </div>

        {/* Tags cloud */}
        {allTags.length > 0 && (
          <div className="tag-filter-section">
            <div className="tag-section-label">
              <Tag size={15} />
              <span>Lọc nhanh theo nhãn chủ đề:</span>
            </div>
            <div className="tag-chips-wrap">
              {allTags.map((tag) => {
                const isSelected = selectedTagsParam.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`tag-chip-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleToggleTag(tag)}
                  >
                    <span>#{tag}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Results Section */}
      <div className="search-results-section">
        {!queryQ.trim() && filterCourse === 'all' && filterType === 'all' && selectedTagsParam.length === 0 ? (
          <EmptyState
            title="Sẵn sàng tìm kiếm"
            description="Nhập từ khóa tìm kiếm hoặc chọn bộ lọc môn học ở trên để hiển thị danh sách tài liệu."
          />
        ) : searchResults.length === 0 ? (
          <EmptyState
            title="Không tìm thấy kết quả phù hợp"
            description="Không tìm thấy học liệu nào phù hợp với điều kiện tra cứu hiện tại."
            action={
              <Button variant="secondary" onClick={handleClearFilters}>
                Xóa toàn bộ bộ lọc
              </Button>
            }
          />
        ) : (
          <div className="results-list-wrap">
            <div className="results-count-banner">
              <span>Tìm thấy <strong>{searchResults.length}</strong> học liệu phù hợp</span>
            </div>

            <div className="results-cards-grid">
              {searchResults.map(({ material: mat, fileType, versionNumber, updatedAt }) => {
                const c = courses.find((crs: Course) => crs.id === mat.courseId);
                const l = lessons.find((lsn: Lesson) => lsn.id === mat.lessonId);

                return (
                  <Link
                    key={mat.id}
                    to={`/sv/hoc-lieu/${mat.id}`}
                    className="result-material-card"
                  >
                    <div className="res-icon-wrap">
                      <FileText size={24} />
                    </div>

                    <div className="res-info-wrap">
                      <div className="res-course-line">
                        <span className="res-course-code">{c?.code}</span>
                        <span className="res-course-name">{c?.name}</span>
                        {l && <span className="res-lesson-name">• {l.title}</span>}
                      </div>

                      <h2 className="res-material-title">{mat.title}</h2>

                      <div className="res-meta-line">
                        <span className="res-type-pill">{fileType}</span>
                        <span className="res-version">Phiên bản {versionNumber}</span>
                        <span className="res-date">Cập nhật {formatDateVN(updatedAt)}</span>
                      </div>

                      {mat.tags.length > 0 && (
                        <div className="res-tags-line">
                          {mat.tags.map((t) => (
                            <span key={t} className="res-tag-pill">#{t}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="res-arrow-wrap">
                      <ArrowRight size={18} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
