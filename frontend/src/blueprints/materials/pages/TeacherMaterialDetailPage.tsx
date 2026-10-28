import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  materialsService,
  type MaterialDetail,
  type MaterialVersionSummary,
  type MaterialVersionDetail,
  type MaterialFileManifestItem,
} from '../../../api/materialsService';
import { filesService, type StoredFile } from '../../../api/filesService';
import { coursesService, type Chapter, type Course, type Lesson } from '../../../api/coursesService';
import { useNotification } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { TextField } from '../../../shared/ui/TextField';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { Modal } from '../../../shared/ui/Modal';
import { formatFileSize } from '../../../shared/kernel/formatting';
import {
  BookOpen,
  FileText,
  Layers,
  ShieldCheck,
  Eye,
  EyeOff,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Download,
  Lock,
} from 'lucide-react';
import { SecureFileViewer } from '../../files/components/SecureFileViewer';
import './TeacherMaterialDetailPage.css';

export const TeacherMaterialDetailPage: React.FC = () => {
  const { monId, hocLieuId } = useParams<{ monId?: string; hocLieuId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { notifySuccess, notifyError } = useNotification();

  const activeTab = searchParams.get('tab') || 'thong-tin';

  // State: Course and Material
  const [courseId, setCourseId] = useState<string>(monId || '');
  const [course, setCourse] = useState<Course | null>(null);
  const [isArchived, setIsArchived] = useState<boolean>(false);

  const [material, setMaterial] = useState<MaterialDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Versions State
  const [versions, setVersions] = useState<MaterialVersionSummary[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<MaterialVersionDetail | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);

  // Chapters & Lessons for metadata editing
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);

  // Metadata Form Fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [materialType, setMaterialType] = useState('document');
  const [chapterId, setChapterId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [tags, setTags] = useState('');
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);

  // Modals & Action States
  const [isNewRevisionModalOpen, setIsNewRevisionModalOpen] = useState(false);
  const [newRevisionChangelog, setNewRevisionChangelog] = useState('');
  const [cloneFromVersionId, setCloneFromVersionId] = useState<string>('');
  const [isCreatingRevision, setIsCreatingRevision] = useState(false);

  const [isAddFileModalOpen, setIsAddFileModalOpen] = useState(false);
  const [courseFiles, setCourseFiles] = useState<StoredFile[]>([]);
  const [selectedFileToAdd, setSelectedFileToAdd] = useState<string>('');
  const [isAddingFile, setIsAddingFile] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeletingMaterial, setIsDeletingMaterial] = useState(false);

  // File Preview Modal
  const [previewFile, setPreviewFile] = useState<StoredFile | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);

  // Sequence guard
  const reqSeq = useRef(0);

  // 1. Resolve CourseId if missing
  useEffect(() => {
    if (monId) {
      setCourseId(monId);
      return;
    }
    const qCourseId = searchParams.get('courseId');
    if (qCourseId) {
      setCourseId(qCourseId);
    }
  }, [monId, searchParams]);

  // 2. Load Material & Course
  const loadMaterialData = useCallback(async () => {
    if (!hocLieuId) return;
    const seq = ++reqSeq.current;
    setIsLoading(true);
    setLoadError(null);

    try {
      // If we don't have courseId yet, find it through teacher's courses
      let targetCourseId = courseId;
      if (!targetCourseId) {
        const resolved = await materialsService.getMaterialById(hocLieuId);
        if (seq !== reqSeq.current) return;
        targetCourseId = resolved.course_id;
        setCourseId(targetCourseId);
      }

      // Fetch course info
      const courseData = await coursesService.get(targetCourseId);
      if (seq !== reqSeq.current) return;
      setCourse(courseData);
      setIsArchived(courseData.status === 'archived');

      // Fetch material
      const matData = await materialsService.getMaterial(targetCourseId, hocLieuId);
      if (seq !== reqSeq.current) return;
      setMaterial(matData);

      // Populate metadata form
      setTitle(matData.title);
      setDescription(matData.description || '');
      setMaterialType(matData.material_type);
      setChapterId(matData.chapter || '');
      setLessonId(matData.lesson || '');
      const tagList = Array.isArray(matData.tags) ? (matData.tags as string[]) : [];
      setTags(tagList.join(', '));

      // Fetch versions
      const vers = await materialsService.listVersions(targetCourseId, hocLieuId);
      if (seq !== reqSeq.current) return;
      setVersions(vers);

      // Default select latest version or published version
      const defaultVerId = (matData.latest_version as any)?.id || vers[0]?.id || '';
      setSelectedVersionId(defaultVerId);

      // Fetch chapters
      const chaps = await coursesService.listChapters(targetCourseId);
      if (seq !== reqSeq.current) return;
      setChapters(chaps);

      if (matData.chapter) {
        const les = await coursesService.listLessons(targetCourseId, matData.chapter);
        if (seq !== reqSeq.current) return;
        setLessons(les);
      }
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setLoadError(err instanceof Error ? err.message : 'Lỗi khi tải thông tin học liệu.');
    } finally {
      if (seq === reqSeq.current) {
        setIsLoading(false);
      }
    }
  }, [courseId, hocLieuId]);

  useEffect(() => {
    void loadMaterialData();
  }, [loadMaterialData]);

  // 3. Load Selected Version Detail
  useEffect(() => {
    if (!courseId || !hocLieuId || !selectedVersionId) return;
    let cancelled = false;
    setVersionLoading(true);

    materialsService
      .getVersion(courseId, hocLieuId, selectedVersionId)
      .then(value => { if (!cancelled) setSelectedVersion(value); })
      .catch(() => { if (!cancelled) setSelectedVersion(null); })
      .finally(() => { if (!cancelled) setVersionLoading(false); });
    return () => { cancelled = true; };
  }, [courseId, hocLieuId, selectedVersionId]);

  useEffect(() => {
    if (!courseId || !hocLieuId || !selectedVersionId ||
        !['pending', 'processing'].includes(selectedVersion?.processing_status || '')) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const version = await materialsService.getVersion(courseId, hocLieuId!, selectedVersionId);
        if (cancelled) return;
        setSelectedVersion(version);
        if (!['pending', 'processing'].includes(version.processing_status)) return;
      } catch { /* Preserve the last server state; do not invent success. */ }
      if (!cancelled && ++attempts < 120) timer = setTimeout(() => void refresh(), 3000);
    }
    timer = setTimeout(() => void refresh(), 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [courseId, hocLieuId, selectedVersionId, selectedVersion?.processing_status]);

  // 4. Update lessons when chapter changes in form
  const handleChapterChange = async (newChapId: string) => {
    setChapterId(newChapId);
    setLessonId('');
    if (!courseId || !newChapId) {
      setLessons([]);
      return;
    }
    try {
      const les = await coursesService.listLessons(courseId, newChapId);
      setLessons(les);
    } catch {
      setLessons([]);
    }
  };

  const handleSelectTab = (tabKey: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tabKey);
    setSearchParams(next);
  };

  // 5. Save Metadata
  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId || !hocLieuId) return;
    if (!title.trim()) {
      notifyError('Tên học liệu không được để trống.');
      return;
    }

    setIsSavingMetadata(true);
    try {
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const updated = await materialsService.updateMaterial(courseId, hocLieuId, {
        title: title.trim(),
        description: description.trim(),
        material_type: materialType as any,
        chapter_id: chapterId || null,
        lesson_id: lessonId || null,
        tags: parsedTags,
      });

      setMaterial(updated);
      notifySuccess('Đã cập nhật thông tin học liệu thành công.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Cập nhật học liệu thất bại.');
    } finally {
      setIsSavingMetadata(false);
    }
  };

  // 6. Action: Publish Version
  const handlePublishVersion = async (verId: string) => {
    if (!courseId || !hocLieuId) return;
    setActionLoading(true);
    try {
      const updated = await materialsService.publishMaterial(courseId, hocLieuId, {
        version_id: verId,
      });
      setMaterial(updated);
      notifySuccess(`Đã công bố phiên bản thành công.`);
      // Refresh version details
      const vers = await materialsService.listVersions(courseId, hocLieuId);
      setVersions(vers);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Công bố phiên bản thất bại.');
    } finally {
      setActionLoading(false);
    }
  };

  // 7. Action: Toggle Hide / Unhide
  const handleToggleHide = async () => {
    if (!courseId || !hocLieuId || !material) return;
    setActionLoading(true);
    try {
      let updated: MaterialDetail;
      if (material.is_hidden) {
        updated = await materialsService.unhideMaterial(courseId, hocLieuId);
        notifySuccess('Đã hiện học liệu cho sinh viên.');
      } else {
        updated = await materialsService.hideMaterial(courseId, hocLieuId);
        notifySuccess('Đã ẩn học liệu khỏi sinh viên.');
      }
      setMaterial(updated);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Thao tác ẩn/hiện thất bại.');
    } finally {
      setActionLoading(false);
    }
  };

  // 8. Action: Delete Material
  const handleConfirmDelete = async () => {
    if (!courseId || !hocLieuId) return;
    setIsDeletingMaterial(true);
    try {
      await materialsService.deleteMaterial(courseId, hocLieuId);
      notifySuccess('Đã xóa học liệu thành công.');
      navigate(`/gv/mon-hoc/${courseId}/hoc-lieu`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Xóa học liệu thất bại.');
      setIsDeletingMaterial(false);
    }
  };

  // 9. Action: Create New Revision
  const handleCreateRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId || !hocLieuId) return;
    if (!newRevisionChangelog.trim()) {
      notifyError('Vui lòng nhập mô tả bản cập nhật (changelog).');
      return;
    }

    setIsCreatingRevision(true);
    try {
      const newVer = await materialsService.createRevision(courseId, hocLieuId, {
        changelog: newRevisionChangelog.trim(),
        clone_from_version_id: cloneFromVersionId || undefined,
      });

      notifySuccess(`Đã tạo bản sửa đổi v${newVer.version_number} thành công.`);
      setIsNewRevisionModalOpen(false);
      setNewRevisionChangelog('');
      setCloneFromVersionId('');

      // Refresh versions list and select the new version
      const vers = await materialsService.listVersions(courseId, hocLieuId);
      setVersions(vers);
      setSelectedVersionId(newVer.id);
      setSelectedVersion(newVer);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Tạo bản sửa đổi thất bại.');
    } finally {
      setIsCreatingRevision(false);
    }
  };

  // 10. Action: Finalize Draft Version
  const handleFinalizeVersion = async (verId: string) => {
    if (!courseId || !hocLieuId) return;
    setActionLoading(true);
    try {
      const finalized = await materialsService.finalizeVersion(courseId, hocLieuId, verId);
      setSelectedVersion(finalized);
      notifySuccess(`Đã đóng băng manifest v${finalized.version_number}. Quá trình trích xuất văn bản đã bắt đầu.`);
      // Refresh versions
      const vers = await materialsService.listVersions(courseId, hocLieuId);
      setVersions(vers);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Đóng băng phiên bản thất bại.');
    } finally {
      setActionLoading(false);
    }
  };

  // 11. Action: Add File to Draft Version
  const openAddFileModal = async () => {
    if (!courseId) return;
    setIsAddFileModalOpen(true);
    try {
      const res = await filesService.listFiles(courseId, { purpose: 'course_material', page_size: 100 });
      setCourseFiles(res.items?.filter((f) => f.status === 'clean') || []);
    } catch {
      setCourseFiles([]);
    }
  };

  const handleAddFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId || !hocLieuId || !selectedVersionId || !selectedFileToAdd) return;

    setIsAddingFile(true);
    try {
      await materialsService.addFileToVersion(courseId, hocLieuId, selectedVersionId, {
        file_id: selectedFileToAdd,
        label: '',
      });
      notifySuccess('Đã thêm tệp tin vào bản nháp.');
      setIsAddFileModalOpen(false);
      setSelectedFileToAdd('');
      // Reload version detail
      const verDetail = await materialsService.getVersion(courseId, hocLieuId, selectedVersionId);
      setSelectedVersion(verDetail);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Thêm tệp tin thất bại.');
    } finally {
      setIsAddingFile(false);
    }
  };

  // 12. Action: Remove File from Draft Version
  const handleRemoveFile = async (fileId: string) => {
    if (!courseId || !hocLieuId || !selectedVersionId) return;
    setActionLoading(true);
    try {
      await materialsService.removeFileFromVersion(courseId, hocLieuId, selectedVersionId, fileId);
      notifySuccess('Đã xóa tệp tin khỏi bản nháp.');
      const verDetail = await materialsService.getVersion(courseId, hocLieuId, selectedVersionId);
      setSelectedVersion(verDetail);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Xóa tệp tin thất bại.');
    } finally {
      setActionLoading(false);
    }
  };

  // 13. File Preview & Download
  const handlePreviewFile = (fileItem: MaterialFileManifestItem) => {
    const fileObj: StoredFile = {
      id: fileItem.file_id,
      course_id: courseId,
      uploader_id: '',
      uploader_name: '',
      file_name: fileItem.file_name,
      file_size: fileItem.file_size,
      purpose: 'course_material',
      status: 'clean',
      is_published: true,
      sha256_hash: fileItem.sha256_hash,
      created_at: fileItem.created_at,
      updated_at: fileItem.created_at,
    };
    setPreviewFile(fileObj);
    setIsPreviewOpen(true);
  };

  const handleDownloadFile = async (fileItem: MaterialFileManifestItem) => {
    if (!courseId || !hocLieuId) return;
    try {
      const blob = await materialsService.downloadMaterialFile(courseId, hocLieuId, fileItem.file_id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileItem.file_name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Tải tệp tin thất bại.');
    }
  };

  if (isLoading) {
    return <LoadingSkeleton lines={6} />;
  }

  if (loadError || !material) {
    return (
      <div className="teacher-mat-detail-container">
        <ErrorBanner
          title="Không thể tải học liệu"
          message={loadError || 'Học liệu không tồn tại trên hệ thống.'}
          onRetry={() => void loadMaterialData()}
        />
        <Button variant="secondary" onClick={() => navigate(`/gv/mon-hoc/${courseId}/hoc-lieu`)}>
          Quay lại danh sách học liệu
        </Button>
      </div>
    );
  }

  const isPublished = Boolean(material.published_version);
  const isSelectedVerDraft = selectedVersion?.lifecycle_status === 'draft';
  const isSelectedVerFinalized = selectedVersion?.lifecycle_status === 'finalized';
  const isSelectedVerPublished =
    selectedVersion?.is_published ||
    material.published_version?.id === selectedVersion?.id;

  return (
    <div className="teacher-material-detail-page">
      <Breadcrumb
        items={[
          { label: 'Môn học', path: '/gv/mon-hoc' },
          { label: course?.name || 'Chi tiết môn', path: `/gv/mon-hoc/${courseId}` },
          { label: 'Học liệu', path: `/gv/mon-hoc/${courseId}/hoc-lieu` },
          { label: material.title },
        ]}
      />

      {/* Header */}
      <div className="detail-top-card">
        <div className="title-row">
          <span className="file-pill">{material.material_type.toUpperCase()}</span>
          <h2 className="mat-heading">{material.title}</h2>
          {isPublished ? (
            <Badge variant="success">
              Đã công bố (v{material.published_version?.version_number})
            </Badge>
          ) : (
            <Badge variant="warning">Bản nháp - Chưa công bố</Badge>
          )}
          {material.is_hidden && <Badge variant="danger">Đang ẩn với sinh viên</Badge>}
        </div>

        <div className="mat-subtext">
          <span>Tạo ngày: {new Date(material.created_at).toLocaleDateString('vi-VN')}</span>
          <span>·</span>
          <span>
            {selectedVersion?.file_count ?? material.published_version?.file_count ?? 0} tệp tin (
            {formatFileSize(selectedVersion?.total_size_bytes ?? material.published_version?.total_size_bytes ?? 0)})
          </span>
          <span>·</span>
          <span>
            Trạng thái xử lý: <strong>{selectedVersion?.processing_status?.toUpperCase() ?? 'PENDING'}</strong>
          </span>
        </div>

        {/* Quick Action Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          {isPublished && !isArchived && (
            <Button
              variant="secondary"
              size="sm"
              icon={material.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
              disabled={actionLoading}
              onClick={() => void handleToggleHide()}
            >
              {material.is_hidden ? 'Hiện học liệu' : 'Ẩn học liệu'}
            </Button>
          )}

          {!isPublished && !isArchived && (
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={() => setIsDeleteModalOpen(true)}
            >
              Xóa học liệu
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="detail-tabs-bar" role="tablist">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'thong-tin' ? 'active' : ''}`}
          onClick={() => handleSelectTab('thong-tin')}
        >
          <BookOpen size={16} /> Thông tin chung
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'phien-ban' ? 'active' : ''}`}
          onClick={() => handleSelectTab('phien-ban')}
        >
          <Layers size={16} /> Quản lý phiên bản ({versions.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'trich-xuat' ? 'active' : ''}`}
          onClick={() => handleSelectTab('trich-xuat')}
        >
          <FileText size={16} /> Trích xuất & Tìm kiếm
        </button>
      </div>

      {/* TAB 1: THÔNG TIN CHUNG */}
      {activeTab === 'thong-tin' && (
        <div className="tab-pane">
          <div className="metadata-form-card">
            <div>
              <h3 className="card-section-title">Chỉnh sửa thông tin học liệu</h3>
              <p className="card-section-desc">Cập nhật tiêu đề, mô tả và cấu trúc chương/bài học.</p>
            </div>

            <form onSubmit={(e) => void handleSaveMetadata(e)}>
              <TextField
                label="Tên học liệu *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isArchived || isSavingMetadata}
                required
              />

              <div style={{ marginTop: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Mô tả tóm tắt
                </label>
                <textarea
                  rows={3}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isArchived || isSavingMetadata}
                />
              </div>

              <div className="form-fields-grid" style={{ marginTop: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Loại học liệu
                  </label>
                  <select
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
                    value={materialType}
                    onChange={(e) => setMaterialType(e.target.value)}
                    disabled={isArchived || isSavingMetadata}
                  >
                    <option value="document">Bài giảng</option>
                    <option value="slide">Slide trình chiếu</option>
                    <option value="reference">Tài liệu tham khảo</option>
                    <option value="syllabus">Đề cương / Ôn tập</option>
                    <option value="other">Khác</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Chương học
                  </label>
                  <select
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
                    value={chapterId}
                    onChange={(e) => void handleChapterChange(e.target.value)}
                    disabled={isArchived || isSavingMetadata}
                  >
                    <option value="">-- Không gắn chương --</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </div>

                {lessons.length > 0 && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                      Bài học
                    </label>
                    <select
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
                      value={lessonId}
                      onChange={(e) => setLessonId(e.target.value)}
                      disabled={isArchived || isSavingMetadata}
                    >
                      <option value="">-- Không gắn bài học --</option>
                      {lessons.map((les) => (
                        <option key={les.id} value={les.id}>
                          {les.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <TextField
                    label="Thẻ (Tags)"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    disabled={isArchived || isSavingMetadata}
                    placeholder="tag1, tag2, tag3"
                  />
                </div>
              </div>

              {!isArchived && (
                <div className="form-submit-row">
                  <Button variant="primary" type="submit" disabled={isSavingMetadata}>
                    {isSavingMetadata ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: QUẢN LÝ PHIÊN BẢN & MANIFEST */}
      {activeTab === 'phien-ban' && (
        <div className="tab-pane">
          {/* Version Selector Bar */}
          <div className="versions-header-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Chọn phiên bản:</label>
              {versions.map((v) => {
                const isSelected = v.id === selectedVersionId;
                const isPub = v.id === material.published_version?.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: '0.375rem',
                      border: isSelected ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      background: isSelected ? '#e0f2fe' : '#ffffff',
                      fontWeight: isSelected ? 700 : 500,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: '0.85rem',
                    }}
                    onClick={() => setSelectedVersionId(v.id)}
                  >
                    <span>v{v.version_number}</span>
                    {isPub && <span style={{ fontSize: '10px', color: '#16a34a' }}>● Công bố</span>}
                    <Badge
                      variant={v.is_published ? 'published' : v.lifecycle_status === 'finalized' ? 'ready' : 'draft'}
                      label={v.is_published ? 'Đã công bố' : v.lifecycle_status === 'finalized' ? 'Đã đóng băng' : 'Bản nháp'}
                    />
                  </button>
                );
              })}
            </div>

            {!isArchived && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => {
                  setNewRevisionChangelog(`Cập nhật phiên bản v${versions.length + 1}`);
                  setCloneFromVersionId(selectedVersionId || '');
                  setIsNewRevisionModalOpen(true);
                }}
              >
                + Tạo bản sửa đổi mới (New Revision)
              </Button>
            )}
          </div>

          {/* Version Detail Card */}
          {versionLoading || !selectedVersion ? (
            <LoadingSkeleton lines={4} />
          ) : (
            <div className="metadata-form-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>
                    Phiên bản v{selectedVersion.version_number} ({(selectedVersion.lifecycle_status || (selectedVersion as any).status || 'DRAFT').toUpperCase()})
                  </h3>
                  <p style={{ margin: '0.25rem 0', color: '#64748b', fontSize: '0.875rem' }}>
                    Changelog: {selectedVersion.changelog || 'Không có mô tả'}
                  </p>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>
                    Tạo ngày: {new Date(selectedVersion.created_at).toLocaleString('vi-VN')}
                    {selectedVersion.finalized_at && ` · Đóng băng: ${new Date(selectedVersion.finalized_at).toLocaleString('vi-VN')}`}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {isSelectedVerDraft && !isArchived && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Plus size={14} />}
                        onClick={() => void openAddFileModal()}
                      >
                        Thêm tệp vào bản nháp
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Lock size={14} />}
                        disabled={actionLoading || selectedVersion.files.length === 0}
                        onClick={() => void handleFinalizeVersion(selectedVersion.id)}
                      >
                        {actionLoading ? 'Đang xử lý...' : 'Đóng băng manifest (Finalize)'}
                      </Button>
                    </>
                  )}

                  {(isSelectedVerFinalized || isSelectedVerDraft) && !isSelectedVerPublished && !isArchived && (
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<CheckCircle2 size={14} />}
                      disabled={actionLoading || isSelectedVerDraft}
                      onClick={() => void handlePublishVersion(selectedVersion.id)}
                    >
                      {isSelectedVerDraft ? 'Cần đóng băng trước khi công bố' : 'Công bố phiên bản này'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Status Message */}
              {isSelectedVerDraft && (
                <div style={{ padding: '0.75rem 1rem', background: '#fef3c7', borderRadius: '0.375rem', fontSize: '0.85rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={16} />
                  <span>
                    Bản nháp đang mở: Bạn có thể thêm hoặc bớt tệp tin. Sau khi hoàn tất, hãy bấm <strong>Đóng băng manifest</strong> để kích hoạt trích xuất văn bản và cho phép công bố.
                  </span>
                </div>
              )}

              {selectedVersion.manifest_hash && (
                <div style={{ fontSize: '0.8rem', color: '#64748b', background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '0.25rem', fontFamily: 'monospace' }}>
                  SHA-256 Manifest: {selectedVersion.manifest_hash}
                </div>
              )}

              {/* Manifest Files Table */}
              <div>
                <h4 style={{ margin: '1rem 0 0.5rem', fontSize: '1rem' }}>
                  Danh sách tệp tin trong manifest ({selectedVersion.files.length} tệp)
                </h4>

                {selectedVersion.files.length === 0 ? (
                  <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
                    Chưa có tệp tin nào trong phiên bản này.
                  </p>
                ) : (
                  <div className="versions-table-wrap">
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ padding: '0.75rem 1rem' }}>#</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Tên tệp tin</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Dung lượng</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Trích xuất</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Hành động</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedVersion.files.map((fileItem) => (
                          <tr key={fileItem.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <td style={{ padding: '0.75rem 1rem' }}>{fileItem.position}</td>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FileText size={16} style={{ color: '#0284c7' }} />
                                {fileItem.file_name}
                              </div>
                            </td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              {formatFileSize(fileItem.file_size)}
                            </td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <Badge
                                variant={
                                  fileItem.extraction_status === 'success' || selectedVersion?.processing_status === 'ready'
                                    ? 'ready'
                                    : fileItem.extraction_status === 'failed' || selectedVersion?.processing_status === 'failed'
                                    ? 'error'
                                    : 'processing'
                                }
                                label={
                                  fileItem.extraction_status ||
                                  (selectedVersion?.processing_status === 'ready'
                                    ? 'READY'
                                    : selectedVersion?.processing_status === 'failed'
                                    ? 'FAILED'
                                    : 'PENDING')
                                }
                              />
                              {(fileItem as any).page_count ? (
                                <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.5rem' }}>
                                  ({(fileItem as any).page_count} trang)
                                </span>
                              ) : null}
                            </td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  icon={<Eye size={14} />}
                                  onClick={() => handlePreviewFile(fileItem)}
                                >
                                  Xem
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  icon={<Download size={14} />}
                                  onClick={() => void handleDownloadFile(fileItem)}
                                >
                                  Tải
                                </Button>
                                {isSelectedVerDraft && !isArchived && (
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    icon={<Trash2 size={14} />}
                                    disabled={actionLoading}
                                    onClick={() => void handleRemoveFile(fileItem.file_id)}
                                  >
                                    Bỏ
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TRÍCH XUẤT VĂN BẢN & TÌM KIẾM */}
      {activeTab === 'trich-xuat' && (
        <div className="tab-pane">
          <div className="metadata-form-card">
            <h3 className="card-section-title">Trạng thái trích xuất nội dung văn bản</h3>
            <p className="card-section-desc">
              Worker phân tích tệp tin PDF, DOCX, TXT tự động trích xuất ngữ cảnh từng trang
              (provenance) và chỉ mục toàn văn trên PostgreSQL 17 để phục vụ tìm kiếm chính xác.
            </p>

            <div className="pipeline-stages-grid" style={{ marginTop: '1rem' }}>
              <div className="pipeline-card">
                <div className="stage-top">
                  <div className="stage-icon-wrap">
                    <ShieldCheck size={20} className="shield-icon" />
                  </div>
                  <div>
                    <h4 className="stage-title">Quét mã độc ClamAV</h4>
                    <span className="stage-time">Bảo mật fail-closed</span>
                  </div>
                </div>
                <p className="stage-desc">
                  Mọi tệp tin đều phải đạt trạng thái sạch trước khi được đưa vào manifest học liệu.
                </p>
                <Badge variant="success">Quét trước khi gắn tệp</Badge>
              </div>

              <div className="pipeline-card">
                <div className="stage-top">
                  <div className="stage-icon-wrap">
                    <FileText size={20} className="extract-icon" />
                  </div>
                  <div>
                    <h4 className="stage-title">Bóc tách văn bản</h4>
                    <span className="stage-time">Celery Async Task</span>
                  </div>
                </div>
                <div className="stage-desc">
                  Trạng thái tổng hợp phiên bản hiện tại: <strong>{selectedVersion?.processing_status}</strong>
                  {selectedVersion && ['failed', 'no_text', 'unsupported'].includes(selectedVersion.processing_status) && (
                    <Button onClick={async () => {
                      try {
                        setActionLoading(true);
                        const updated = await materialsService.retryExtraction(courseId!, hocLieuId!, selectedVersion.id);
                        setSelectedVersion(updated);
                        notifySuccess('Đã yêu cầu trích xuất lại.');
                      } catch (err) { notifyError(err instanceof Error ? err.message : 'Không thể thử lại.'); }
                      finally { setActionLoading(false); }
                    }} disabled={actionLoading || isArchived}>Thử trích xuất lại</Button>
                  )}
                </div>
                <Badge
                  variant={
                    selectedVersion?.processing_status === 'ready'
                      ? 'ready'
                      : selectedVersion?.processing_status === 'failed'
                      ? 'error'
                      : 'processing'
                  }
                  label={selectedVersion?.processing_status?.toUpperCase() || 'PENDING'}
                />
              </div>
            </div>

            {/* Extracted Snippets Preview */}
            <div style={{ marginTop: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Chi tiết trích xuất từng tệp tin</h4>
              {selectedVersion?.files.map((f) => (
                <div
                  key={f.id}
                  style={{
                    padding: '1rem',
                    background: '#f8fafc',
                    borderRadius: '0.375rem',
                    border: '1px solid #e2e8f0',
                    marginBottom: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{f.file_name}</strong>
                    <Badge
                      variant={
                        f.extraction_status === 'success' || selectedVersion?.processing_status === 'ready'
                          ? 'ready'
                          : 'processing'
                      }
                      label={f.extraction_status || selectedVersion?.processing_status?.toUpperCase() || 'PENDING'}
                    />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                    {(f as any).page_count ? `Số trang: ${(f as any).page_count}` : 'Văn bản không phân trang'} ·{' '}
                    {(f as any).char_count ? `Ký tự: ${(f as any).char_count.toLocaleString()}` : ''}
                  </div>
                  {(f as any).snippet && (
                    <div
                      style={{
                        marginTop: '0.5rem',
                        fontSize: '0.85rem',
                        background: '#ffffff',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.25rem',
                        border: '1px solid #cbd5e1',
                        color: '#334155',
                        fontStyle: 'italic',
                      }}
                    >
                      &ldquo;{(f as any).snippet}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create New Revision */}
      <Modal
        isOpen={isNewRevisionModalOpen}
        onClose={() => setIsNewRevisionModalOpen(false)}
        title="Tạo bản sửa đổi mới (New Revision)"
      >
        <form onSubmit={(e) => void handleCreateRevision(e)}>
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
            Tạo một phiên bản nháp mới (v{versions.length + 1}). Phiên bản công bố hiện tại sẽ không bị
            ảnh hưởng cho tới khi bạn hoàn tất đóng băng và chủ động công bố phiên bản mới.
          </p>

          <TextField
            label="Mô tả cập nhật (Changelog) *"
            value={newRevisionChangelog}
            onChange={(e) => setNewRevisionChangelog(e.target.value)}
            placeholder="VD: Cập nhật tài liệu tham khảo và sửa lỗi chính tả"
            required
          />

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Sao chép danh sách tệp từ phiên bản cũ (Tùy chọn)
            </label>
            <select
              style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
              value={cloneFromVersionId}
              onChange={(e) => setCloneFromVersionId(e.target.value)}
            >
              <option value="">-- Tạo bản nháp trống (không sao chép) --</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Sao chép từ v{v.version_number} ({v.file_count} tệp tin)
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setIsNewRevisionModalOpen(false)}
              disabled={isCreatingRevision}
            >
              Hủy
            </Button>
            <Button variant="primary" type="submit" disabled={isCreatingRevision}>
              {isCreatingRevision ? 'Đang tạo...' : 'Tạo bản sửa đổi'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Add File to Draft Version */}
      <Modal
        isOpen={isAddFileModalOpen}
        onClose={() => setIsAddFileModalOpen(false)}
        title="Thêm tệp tin vào bản nháp"
      >
        <form onSubmit={(e) => void handleAddFileSubmit(e)}>
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
            Chọn tệp tin đã tải lên từ kho lưu trữ của môn học để bổ sung vào manifest của bản nháp
            này.
          </p>

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Chọn tệp tin sạch từ kho môn học *
            </label>
            <select
              style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
              value={selectedFileToAdd}
              onChange={(e) => setSelectedFileToAdd(e.target.value)}
              required
            >
              <option value="">-- Chọn tệp tin --</option>
              {courseFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.file_name} ({formatFileSize(f.file_size)})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setIsAddFileModalOpen(false)}
              disabled={isAddingFile}
            >
              Hủy
            </Button>
            <Button variant="primary" type="submit" disabled={isAddingFile || !selectedFileToAdd}>
              {isAddingFile ? 'Đang thêm...' : 'Thêm vào bản nháp'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Delete Confirmation */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Xác nhận xóa học liệu"
      >
        <p>
          Bạn có chắc chắn muốn xóa học liệu <strong>{material.title}</strong>? Thao tác này chỉ thực
          hiện được khi học liệu chưa từng được công bố và không thể khôi phục.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
          <Button
            variant="secondary"
            onClick={() => setIsDeleteModalOpen(false)}
            disabled={isDeletingMaterial}
          >
            Hủy
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmDelete()}
            disabled={isDeletingMaterial}
          >
            {isDeletingMaterial ? 'Đang xóa...' : 'Xóa học liệu'}
          </Button>
        </div>
      </Modal>

      {/* Secure File Viewer Modal */}
      {previewFile && (
        <SecureFileViewer
          courseId={courseId}
          file={previewFile}
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false);
            setPreviewFile(null);
          }}
        />
      )}
    </div>
  );
};
