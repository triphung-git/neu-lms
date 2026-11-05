import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useOutletContext, useNavigate, Link } from 'react-router-dom';
import {
  materialsService,
  type MaterialListItem,
} from '../../../api/materialsService';
import { coursesService, type Chapter, type Course } from '../../../api/coursesService';
import { CourseFilePolicyPage } from '../../files/pages/CourseFilePolicyPage';
import { useNotification } from '../../../app/providers/NotificationContext';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { Modal } from '../../../shared/ui/Modal';
import { formatFileSize } from '../../../shared/kernel/formatting';
import {
  BookOpen,
  FileText,
  UploadCloud,
  Layers,
  Settings,
  Eye,
  EyeOff,
  Trash2,
  CheckCircle2,
  FolderOpen,
  ExternalLink,
} from 'lucide-react';
import './TeacherMaterialListPage.css';

export interface TeacherMaterialListPageProps {
  initialTab?: 'materials' | 'files' | 'policy';
}

export const TeacherMaterialListPage: React.FC<TeacherMaterialListPageProps> = ({
  initialTab = 'materials',
}) => {
  const { monId } = useParams<{ monId: string }>();
  const outletContext = useOutletContext<{ course?: Course; isArchived?: boolean } | null>();
  const navigate = useNavigate();
  const { notifySuccess, notifyError } = useNotification();

  const [course, setCourse] = useState<Course | null>(outletContext?.course || null);
  const [courseLoading, setCourseLoading] = useState(!outletContext?.course);
  const isArchived = Boolean(outletContext?.isArchived || course?.status === 'archived');

  const [activeTab, setActiveTab] = useState<'materials' | 'files' | 'policy'>(initialTab);

  // Materials State
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Filter States
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('');

  // Mutation Action Loaders (per material ID)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Delete Material Confirmation Modal
  const [pendingDeleteMaterial, setPendingDeleteMaterial] = useState<MaterialListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sequence guard
  const reqSeq = useRef(0);

  // 1. Load course if not from outlet
  useEffect(() => {
    if (outletContext?.course) {
      setCourse(outletContext.course);
      setCourseLoading(false);
      return;
    }
    if (!monId) return;

    let mounted = true;
    coursesService
      .get(monId)
      .then((c) => {
        if (mounted) {
          setCourse(c);
          setCourseLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setMaterialsError(err instanceof Error ? err.message : uiText("Không thể tải thông tin môn học."));
          setCourseLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [monId, outletContext]);

  // 2. Load chapters for filter
  useEffect(() => {
    if (!monId) return;
    coursesService
      .listChapters(monId)
      .then(setChapters)
      .catch(() => setChapters([]));
  }, [monId]);

  // 3. Load Materials
  const loadMaterials = useCallback(async () => {
    if (!monId) return;
    const seq = ++reqSeq.current;
    setMaterialsLoading(true);
    setMaterialsError(null);

    try {
      const res = await materialsService.listMaterials(monId, {
        page,
        page_size: 10,
        chapter_id: selectedChapterId !== 'all' ? selectedChapterId : undefined,
        tag: tagFilter.trim() || undefined,
      });

      if (seq !== reqSeq.current) return;
      setMaterials(res.items || []);
      setTotalPages(res.pagination?.total_pages || 1);
      setTotalItems(res.pagination?.total_items || 0);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setMaterialsError(err instanceof Error ? err.message : uiText("Lỗi khi tải danh sách học liệu."));
    } finally {
      if (seq === reqSeq.current) {
        setMaterialsLoading(false);
      }
    }
  }, [monId, page, selectedChapterId, tagFilter]);

  useEffect(() => {
    if (activeTab === 'materials' && monId) {
      void loadMaterials();
    }
  }, [activeTab, monId, loadMaterials]);

  // Action: Publish Latest Version
  const handlePublish = async (mat: MaterialListItem) => {
    if (!monId) return;
    if (actionLoading[mat.id]) return;

    setActionLoading((prev) => ({ ...prev, [mat.id]: true }));
    try {
      const versions = await materialsService.listVersions(monId, mat.id);
      const targetVersion = versions.find((v) => v.lifecycle_status === 'finalized') || versions[0];
      if (!targetVersion) {
        throw new Error(uiText("Chưa có phiên bản nào sẵn sàng để công bố."));
      }
      await materialsService.publishMaterial(monId, mat.id, {
        version_id: targetVersion.id,
      });
      notifySuccess(uiText("Đã công bố học liệu \"{0}\" (phiên bản v{1}).",[mat.title,targetVersion.version_number]));
      await loadMaterials();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : uiText("Công bố học liệu thất bại."));
    } finally {
      setActionLoading((prev) => ({ ...prev, [mat.id]: false }));
    }
  };

  // Action: Toggle Hide / Unhide
  const handleToggleHide = async (mat: MaterialListItem) => {
    if (!monId) return;
    if (actionLoading[mat.id]) return;

    setActionLoading((prev) => ({ ...prev, [mat.id]: true }));
    try {
      if (mat.is_hidden) {
        await materialsService.unhideMaterial(monId, mat.id);
        notifySuccess(uiText("Đã hiện học liệu \"{0}\" cho sinh viên.",[mat.title]));
      } else {
        await materialsService.hideMaterial(monId, mat.id);
        notifySuccess(uiText("Đã ẩn học liệu \"{0}\" khỏi sinh viên.",[mat.title]));
      }
      await loadMaterials();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : uiText("Thao tác ẩn/hiện thất bại."));
    } finally {
      setActionLoading((prev) => ({ ...prev, [mat.id]: false }));
    }
  };

  // Action: Delete Material
  const handleConfirmDelete = async () => {
    if (!monId || !pendingDeleteMaterial) return;
    setIsDeleting(true);
    try {
      await materialsService.deleteMaterial(monId, pendingDeleteMaterial.id);
      notifySuccess(uiText("Đã xóa học liệu \"{0}\".",[pendingDeleteMaterial.title]));
      setPendingDeleteMaterial(null);
      await loadMaterials();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : uiText("Xóa học liệu thất bại."));
    } finally {
      setIsDeleting(false);
    }
  };

  // If Tab is Files or Policy, render CourseFilePolicyPage preserving 100% B08 capability
  if (activeTab === 'files') {
    return (
      <div>
        <div className="teacher-materials-nav-tabs" role="tablist">
          <button
            type="button"
            className="teacher-materials-tab-btn"
            onClick={() => setActiveTab('materials')}
          >
            <BookOpen size={16} /> {uiText(" Danh sách học liệu")}</button>
          <button
            type="button"
            className="teacher-materials-tab-btn active"
            onClick={() => setActiveTab('files')}
          >
            <FolderOpen size={16} /> {uiText(" Kho tệp tin")}</button>
          <button
            type="button"
            className="teacher-materials-tab-btn"
            onClick={() => setActiveTab('policy')}
          >
            <Settings size={16} /> {uiText(" Chính sách tệp tin")}</button>
        </div>
        <CourseFilePolicyPage initialTab="files" />
      </div>
    );
  }

  if (activeTab === 'policy') {
    return (
      <div>
        <div className="teacher-materials-nav-tabs" role="tablist">
          <button
            type="button"
            className="teacher-materials-tab-btn"
            onClick={() => setActiveTab('materials')}
          >
            <BookOpen size={16} /> {uiText(" Danh sách học liệu")}</button>
          <button
            type="button"
            className="teacher-materials-tab-btn"
            onClick={() => setActiveTab('files')}
          >
            <FolderOpen size={16} /> {uiText(" Kho tệp tin")}</button>
          <button
            type="button"
            className="teacher-materials-tab-btn active"
            onClick={() => setActiveTab('policy')}
          >
            <Settings size={16} /> {uiText(" Chính sách tệp tin")}</button>
        </div>
        <CourseFilePolicyPage initialTab="policy" />
      </div>
    );
  }

  // Active Tab: Materials
  return (
    <div className="teacher-materials-container">
      {/* Tab Navigation */}
      <div className="teacher-materials-nav-tabs" role="tablist">
        <button
          type="button"
          className="teacher-materials-tab-btn active"
          onClick={() => setActiveTab('materials')}
        >
          <BookOpen size={16} /> {uiText(" Danh sách học liệu")}</button>
        <button
          type="button"
          className="teacher-materials-tab-btn"
          onClick={() => setActiveTab('files')}
        >
          <FolderOpen size={16} /> {uiText(" Kho tệp tin")}</button>
        <button
          type="button"
          className="teacher-materials-tab-btn"
          onClick={() => setActiveTab('policy')}
        >
          <Settings size={16} /> {uiText(" Chính sách tệp tin")}</button>
      </div>

      {/* Header */}
      <div className="teacher-materials-header">
        <div>
          <h2>{uiText("Quản lý học liệu môn học")}</h2>
          <p>{uiText("Quản lý tài liệu theo phiên bản, trích xuất nội dung văn bản và kiểm soát xuất bản.")}</p>
        </div>
        {!isArchived && (
          <Button
            variant="primary"
            icon={<UploadCloud size={16} />}
            onClick={() => navigate(`/gv/mon-hoc/${monId}/hoc-lieu/tai-len`)}
          >
            {uiText("Tải lên học liệu mới")}</Button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="teacher-materials-filter-bar">
        <div className="teacher-materials-filter-group">
          <label htmlFor="chapter-filter">{uiText("Chương học:")}</label>
          <select
            id="chapter-filter"
            value={selectedChapterId}
            onChange={(e) => {
              setSelectedChapterId(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{uiText("Tất cả chương")}</option>
            {chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.title}
              </option>
            ))}
          </select>
        </div>

        <div className="teacher-materials-filter-group">
          <label htmlFor="tag-filter">{uiText("Thẻ (Tag):")}</label>
          <input
            id="tag-filter"
            type="text"
            placeholder={uiText("Lọc theo thẻ...")}
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* Content Area */}
      {courseLoading || materialsLoading ? (
        <LoadingSkeleton lines={6} />
      ) : materialsError ? (
        <ErrorBanner
          title={uiText("Không thể tải danh sách học liệu")}
          message={materialsError}
          onRetry={() => void loadMaterials()}
        />
      ) : materials.length === 0 ? (
        <EmptyState
          title={uiText("Chưa có học liệu nào")}
          description={uiText("Môn học chưa có tài liệu học tập nào được tải lên.")}
          action={
            !isArchived ? (
              <Button
                variant="primary"
                icon={<UploadCloud size={16} />}
                onClick={() => navigate(`/gv/mon-hoc/${monId}/hoc-lieu/tai-len`)}
              >
                {uiText("Tải lên học liệu đầu tiên")}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="teacher-materials-grid">
          {materials.map((mat) => {
            const hasPublished = mat.published_version_number !== null;
            const canPublish =
              !isArchived &&
              (mat.published_version_number === null ||
                mat.published_version_number < mat.latest_version_number);
            const tagList = Array.isArray(mat.tags) ? (mat.tags as string[]) : [];

            return (
              <div key={mat.id} className="teacher-material-card">
                <div className="teacher-material-card-top">
                  <div className="teacher-material-card-main">
                    <Link
                      to={`/gv/mon-hoc/${monId}/hoc-lieu/${mat.id}`}
                      className="teacher-material-card-title"
                    >
                      <BookOpen size={18} />
                      {mat.title}
                    </Link>

                    <div className="teacher-material-card-badges">
                      <Badge variant="neutral" label={mat.material_type} />
                      {hasPublished ? (
                        <Badge
                          variant="published"
                          label={uiText("Đã công bố (v{0})",[mat.published_version_number])}
                        />
                      ) : (
                        <Badge variant="draft" label={uiText("Bản nháp")} />
                      )}
                      {mat.is_hidden && <Badge variant="locked" label={uiText("Đang ẩn")} />}
                      {tagList.map((t) => (
                        <Badge key={t} variant="info" label={`#${t}`} />
                      ))}
                    </div>
                  </div>

                  <div className="teacher-material-card-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ExternalLink size={14} />}
                      onClick={() => navigate(`/gv/mon-hoc/${monId}/hoc-lieu/${mat.id}`)}
                    >
                      {uiText("Chi tiết & Phiên bản")}</Button>

                    {canPublish && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={actionLoading[mat.id]}
                        icon={<CheckCircle2 size={14} />}
                        onClick={() => void handlePublish(mat)}
                      >
                        {actionLoading[mat.id] ? uiText("Đang xử lý...") : uiText("Công bố v{0}",[mat.latest_version_number])}
                      </Button>
                    )}

                    {hasPublished && !isArchived && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actionLoading[mat.id]}
                        icon={mat.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                        onClick={() => void handleToggleHide(mat)}
                      >
                        {mat.is_hidden ? uiText("Hiện") : uiText("Ẩn")}
                      </Button>
                    )}

                    {!hasPublished && !isArchived && (
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        onClick={() => setPendingDeleteMaterial(mat)}
                      >
                        {uiText("Xóa")}</Button>
                    )}
                  </div>
                </div>

                <div className="teacher-material-card-meta">
                  <span>
                    <Layers size={14} style={{ display: 'inline', marginRight: 4 }} />
                    {uiText("Phiên bản mới nhất: v")}{mat.latest_version_number}
                  </span>
                  <span>
                    <FileText size={14} style={{ display: 'inline', marginRight: 4 }} />
                    {mat.file_count} {uiText(" tệp tin (")}{formatFileSize(mat.total_size_bytes)})
                  </span>
                  <span>{uiText("Tạo ngày: ")}{new Date(mat.created_at).toLocaleDateString(currentLocale())}</span>
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination-controls">
              <span>
                Trang {page} / {totalPages} {uiText(" (Tổng số ")}{totalItems} {uiText(" học liệu)")}</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {uiText("Trang trước")}</Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Trang sau
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(pendingDeleteMaterial)}
        onClose={() => setPendingDeleteMaterial(null)}
        title={uiText("Xác nhận xóa bản nháp học liệu")}
      >
        <p>
          {uiText("Bạn có chắc chắn muốn xóa học liệu ")}<strong>{pendingDeleteMaterial?.title}</strong>{uiText("? Thao tác này sẽ xóa bản nháp và không thể khôi phục.")}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
          <Button
            variant="secondary"
            onClick={() => setPendingDeleteMaterial(null)}
            disabled={isDeleting}
          >
            {uiText("Hủy")}</Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmDelete()}
            disabled={isDeleting}
          >
            {isDeleting ? uiText("Đang xóa...") : uiText("Xóa học liệu")}
          </Button>
        </div>
      </Modal>
    </div>
  );
};
