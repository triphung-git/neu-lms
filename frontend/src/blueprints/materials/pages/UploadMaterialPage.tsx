import {uiText} from "../../../shared/i18n/translate";
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { materialsService, type MaterialListItem } from '../../../api/materialsService';
import { filesService, type CourseFilePolicy } from '../../../api/filesService';
import { coursesService, type Chapter, type Course, type Lesson } from '../../../api/coursesService';
import { useNotification } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Badge } from '../../../shared/ui/Badge';
import { formatFileSize } from '../../../shared/kernel/formatting';
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  Trash2,
  Layers,
  Loader2,
  Plus,
} from 'lucide-react';
import './UploadMaterialPage.css';

interface QueueItem {
  id: string; // StoredFile id if already created, or temp client id
  file?: File;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'committing' | 'scanning' | 'clean' | 'error';
  storedFileId?: string;
  error?: string;
}

export const UploadMaterialPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const outletContext = useOutletContext<{ course?: Course; isArchived?: boolean } | null>();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(outletContext?.course || null);
  const [courseLoading, setCourseLoading] = useState(!outletContext?.course);
  const isArchived = Boolean(outletContext?.isArchived || course?.status === 'archived');

  const [policy, setPolicy] = useState<CourseFilePolicy | null>(null);

  // Upload Mode: New Material vs New Version for Existing Material
  const [uploadMode, setUploadMode] = useState<'new_material' | 'new_version'>('new_material');
  const [existingMaterials, setExistingMaterials] = useState<MaterialListItem[]>([]);
  const [targetMaterialId, setTargetMaterialId] = useState<string>('');

  // Course structure: chapters & lessons
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');

  // Form Fields (Mode 1: New Material)
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const createCommandKey = useRef<string | null>(null);
  const [materialType, setMaterialType] = useState<string>('document');
  const [tags, setTags] = useState('');
  const [changelog, setChangelog] = useState(uiText("Khởi tạo tài liệu v1"));

  // Options
  const [autoFinalize, setAutoFinalize] = useState(true);
  const [autoPublish, setAutoPublish] = useState(false);

  // Upload Queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const requireMounted = () => { if (!mounted.current) throw new Error('Upload cancelled after navigation'); };
  const revisionId = useRef<string | null>(null);
  const revisionFiles = useRef(new Set<string>());
  useEffect(() => {
    revisionId.current = null;
    revisionFiles.current.clear();
    createCommandKey.current = null;
  }, [targetMaterialId, uploadMode]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Load course info if not in outlet
  useEffect(() => {
    if (outletContext?.course) {
      setCourse(outletContext.course);
      setCourseLoading(false);
      return;
    }
    if (!monId) return;

    coursesService
      .get(monId)
      .then((c) => {
        setCourse(c);
        setCourseLoading(false);
      })
      .catch(() => setCourseLoading(false));
  }, [monId, outletContext]);

  // 2. Load policy, chapters, and existing materials
  useEffect(() => {
    if (!monId) return;

    filesService
      .getFilePolicy(monId)
      .then(setPolicy)
      .catch(() => setPolicy(null));

    coursesService
      .listChapters(monId)
      .then(setChapters)
      .catch(() => setChapters([]));

    materialsService
      .listMaterials(monId, { page_size: 100 })
      .then((res) => setExistingMaterials(res.items || []))
      .catch(() => setExistingMaterials([]));
  }, [monId]);

  // 3. Load lessons when selected chapter changes
  useEffect(() => {
    if (!monId || !selectedChapterId) {
      setLessons([]);
      setSelectedLessonId('');
      return;
    }

    coursesService
      .listLessons(monId, selectedChapterId)
      .then((les) => {
        setLessons(les);
        setSelectedLessonId('');
      })
      .catch(() => setLessons([]));
  }, [monId, selectedChapterId]);

  // Handle local files selected
  const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;

    const newItems: QueueItem[] = Array.from(selected).map((f) => ({
      id: `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      file: f,
      name: f.name,
      size: f.size,
      progress: 0,
      status: 'pending',
    }));

    setQueue((prev) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  // Submit Handler: Real bytes upload + Material Creation
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!monId) return;

    if (uploadMode === 'new_material' && !title.trim()) {
      notifyError(uiText("Vui lòng nhập tên học liệu."));
      return;
    }

    if (uploadMode === 'new_version' && !targetMaterialId) {
      notifyError(uiText("Vui lòng chọn học liệu cần thêm phiên bản mới."));
      return;
    }

    if (queue.length === 0) {
      notifyError(uiText("Vui lòng chọn ít nhất một tệp tin tài liệu."));
      return;
    }

    if (isSubmitting) return;
    if (policy && (queue.length > (policy.max_files_per_assignment ?? 1) || queue.some(item =>
      item.size > (policy.max_file_size_bytes ?? 26214400) || item.size <= 0 ||
      !(Array.isArray(policy.allowed_extensions) ? policy.allowed_extensions : ['pdf', 'docx']).includes(item.name.split('.').pop()?.toLowerCase() || '')))) {
      notifyError(uiText("Các tệp vượt giới hạn số lượng, loại hoặc dung lượng theo chính sách."));
      return;
    }
    if (!createCommandKey.current) createCommandKey.current = crypto.randomUUID();
    setIsSubmitting(true);

    try {
      // Step 1: Upload all pending files in the queue
      const cleanStoredFileIds: string[] = [];

      for (let i = 0; i < queue.length; i++) {
        requireMounted();
        const item = queue[i];
        if (item.storedFileId && item.status === 'clean') {
          cleanStoredFileIds.push(item.storedFileId);
          continue;
        }

        if (!item.file) continue;

        // 1a. Create upload intent
        setQueue((prev) =>
          prev.map((q, idx) => (idx === i ? { ...q, status: 'uploading', progress: 10 } : q)),
        );

        const intent = item.storedFileId ? { file_id: item.storedFileId } : await filesService.createUploadIntent(monId, {
          file_name: item.name,
          file_size: item.size,
          purpose: 'course_material',
        });
        setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, storedFileId: intent.file_id } : q));
        const existing = item.storedFileId ? await filesService.getFile(monId, intent.file_id) : null;
        if (!existing || existing.status === 'quarantine_pending') {

          // 1b. Upload content
          setQueue((prev) =>
            prev.map((q, idx) => (idx === i ? { ...q, progress: 40 } : q)),
          );

          await filesService.uploadContent(monId, intent.file_id, item.file);

          // 1c. Commit upload
          setQueue((prev) =>
            prev.map((q, idx) =>
              idx === i ? { ...q, status: 'committing', progress: 80 } : q,
            ),
          );

          await filesService.commitUpload(monId, intent.file_id, {
            client_checksum: '',
          });

        }
        // 1d. Check clean status
        requireMounted();
        let fileRecord = await filesService.getFile(monId, intent.file_id);
        for (let attempt = 0; fileRecord.status === 'scanning' || fileRecord.status === 'quarantine_pending'; attempt++) {
          setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, storedFileId: intent.file_id, status: 'scanning' } : q));
          if (attempt >= 60) throw new Error(uiText("Quét chưa hoàn tất. Kiểm tra lại trong kho tệp."));
          await new Promise(resolve => setTimeout(resolve, 1500));
          requireMounted();
          fileRecord = await filesService.getFile(monId, intent.file_id);
        }
        if (fileRecord.status !== 'clean' && fileRecord.status !== 'infected') {
          throw new Error(uiText("Tệp chưa ở trạng thái sạch; không thể tạo manifest."));
        }
        if (fileRecord.status === 'infected') {
          setQueue((prev) =>
            prev.map((q, idx) =>
              idx === i
                ? { ...q, status: 'error', error: uiText("Tệp tin bị nhiễm mã độc, hệ thống đã loại bỏ.") }
                : q,
            ),
          );
          throw new Error(uiText("Tệp tin \"{0}\" không an toàn và đã bị loại bỏ.",[item.name]));
        }

        setQueue((prev) =>
          prev.map((q, idx) =>
            idx === i
              ? { ...q, status: 'clean', progress: 100, storedFileId: fileRecord.id }
              : q,
          ),
        );

        cleanStoredFileIds.push(fileRecord.id);
      }

      requireMounted();
      // Step 2: Create Material or Revision
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      if (uploadMode === 'new_material') {
        // Mode 1: Create new material with clean files
        const newMat = await materialsService.createMaterial(monId, {
          title: title.trim(),
          description: description.trim(),
          material_type: materialType as any,
          chapter_id: selectedChapterId || undefined,
          lesson_id: selectedLessonId || undefined,
          tags: parsedTags,
          initial_file_ids: cleanStoredFileIds,
        }, createCommandKey.current);

        notifySuccess(uiText("Đã tạo học liệu \"{0}\" thành công.",[newMat.title]));

        // Finalize if requested
        if (autoFinalize) {
          requireMounted();
          let targetVerId = (newMat.latest_version as any)?.id;
          if (!targetVerId) {
            const versions = await materialsService.listVersions(monId, newMat.id);
            targetVerId = versions[0]?.id;
          }

          if (targetVerId) {
            const finVer = await materialsService.finalizeVersion(
              monId,
              newMat.id,
              targetVerId,
            );
            notifySuccess(uiText("Đã đóng băng manifest phiên bản v{0}.",[finVer.version_number]));

            // Publish if requested
            if (autoPublish) {
              requireMounted();
              await materialsService.publishMaterial(monId, newMat.id, {
                version_id: finVer.id,
              });
              notifySuccess(uiText("Đã công bố học liệu v{0} cho sinh viên.",[finVer.version_number]));
            }
          }
        }

        navigate(`/gv/mon-hoc/${monId}/hoc-lieu/${newMat.id}`);
      } else {
        // Mode 2: Create revision for existing material
        const newVer = revisionId.current ? { id: revisionId.current, version_number: '?' } : await materialsService.createRevision(monId, targetMaterialId, {
          changelog: changelog.trim() || uiText("Cập nhật phiên bản mới"),
        }, createCommandKey.current || undefined);

        revisionId.current = newVer.id;
        requireMounted();
        // Add files to this new version
        for (let idx = 0; idx < cleanStoredFileIds.length; idx++) {
          requireMounted();
          if (revisionFiles.current.has(cleanStoredFileIds[idx])) continue;
          await materialsService.addFileToVersion(monId, targetMaterialId, newVer.id, {
            file_id: cleanStoredFileIds[idx],
            label: '',
            position: idx + 1,
          });
          revisionFiles.current.add(cleanStoredFileIds[idx]);
        }

        notifySuccess(uiText("Đã tạo phiên bản v{0} thành công.",[newVer.version_number]));

        // Finalize if requested
        if (autoFinalize) {
          requireMounted();
          await materialsService.finalizeVersion(monId, targetMaterialId, newVer.id);
          notifySuccess(uiText("Đã đóng băng manifest v{0}.",[newVer.version_number]));

          if (autoPublish) {
              requireMounted();
            await materialsService.publishMaterial(monId, targetMaterialId, {
              version_id: newVer.id,
            });
            notifySuccess(uiText("Đã công bố phiên bản v{0} cho sinh viên.",[newVer.version_number]));
          }
        }

        navigate(`/gv/mon-hoc/${monId}/hoc-lieu/${targetMaterialId}`);
      }
    } catch (err) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : uiText("Tải lên học liệu thất bại.");
      setQueue(prev => prev.map(q => ['uploading', 'committing', 'scanning'].includes(q.status) ? { ...q, status: 'error', error: message } : q));
      notifyError(message);
    } finally {
      if (mounted.current) setIsSubmitting(false);
    }
  };

  if (courseLoading) {
    return <div className="upload-page-container">{uiText("Đang tải thông tin môn học...")}</div>;
  }

  if (isArchived) {
    return (
      <div className="upload-page-container">
        <EmptyState
          title={uiText("Môn học đã lưu trữ")}
          description={uiText("Không thể tải thêm tài liệu vào môn học đã kết thúc và lưu trữ.")}
          action={
            <Button variant="secondary" onClick={() => navigate(`/gv/mon-hoc/${monId}/hoc-lieu`)}>
              {uiText("Quay lại danh sách học liệu")}</Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="upload-material-page">
      <Breadcrumb
        items={[
          { label: uiText("Môn học"), path: '/gv/mon-hoc' },
          { label: course?.name || uiText("Chi tiết môn"), path: `/gv/mon-hoc/${monId}` },
          { label: uiText("Học liệu"), path: `/gv/mon-hoc/${monId}/hoc-lieu` },
          { label: uiText("Tải lên học liệu") },
        ]}
      />

      <div className="upload-header">
        <h2>{uiText("Tải lên học liệu mới")}</h2>
        <p>{uiText("Tải lên tài liệu giảng dạy, quản lý manifest phiên bản và kích hoạt trích xuất văn bản.")}</p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="upload-form-stack">
        {/* Mode Selector */}
        <div className="upload-mode-card">
          <label style={{ fontWeight: 600 }}>{uiText("Chế độ tải lên:")}</label>
          <div className="mode-toggle-group">
            <button
              type="button"
              className={`mode-btn ${uploadMode === 'new_material' ? 'active' : ''}`}
              onClick={() => setUploadMode('new_material')}
            >
              <Plus size={16} /> {uiText(" Tạo học liệu mới")}</button>
            <button
              type="button"
              className={`mode-btn ${uploadMode === 'new_version' ? 'active' : ''}`}
              onClick={() => setUploadMode('new_version')}
            >
              <Layers size={16} /> {uiText(" Cập nhật phiên bản mới cho học liệu có sẵn")}</button>
          </div>

          {uploadMode === 'new_version' && (
            <div className="existing-material-picker">
              <label htmlFor="target-mat">{uiText("Chọn học liệu đích:")}</label>
              <select
                id="target-mat"
                value={targetMaterialId}
                onChange={(e) => setTargetMaterialId(e.target.value)}
                required
              >
                <option value="">{uiText("-- Chọn học liệu --")}</option>
                {existingMaterials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} (v{m.latest_version_number || 1})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Metadata Fields (for new material) */}
        {uploadMode === 'new_material' && (
          <div className="upload-section-card">
            <h3>{uiText("Thông tin học liệu")}</h3>
            <TextField
              label={uiText("Tên học liệu *")}
              placeholder={uiText("VD: Giáo trình Chương 1 - Nhập môn Kiến trúc phần mềm")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />

            <div style={{ marginTop: '1rem' }}>
              <label htmlFor="mat-desc" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                {uiText("Mô tả học liệu")}</label>
              <textarea
                id="mat-desc"
                rows={3}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
                placeholder={uiText("Tóm tắt nội dung học liệu...")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
              <div>
                <label htmlFor="mat-type" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  {uiText("Loại học liệu")}</label>
                <select
                  id="mat-type"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
                  value={materialType}
                  onChange={(e) => setMaterialType(e.target.value)}
                >
                  <option value="document">{uiText("Bài giảng")}</option>
                  <option value="slide">{uiText("Slide trình chiếu")}</option>
                  <option value="reference">{uiText("Tài liệu tham khảo")}</option>
                  <option value="syllabus">{uiText("Đề cương / Ôn tập")}</option>
                  <option value="other">{uiText("Khác")}</option>
                </select>
              </div>

              <div>
                <label htmlFor="mat-chapter" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  {uiText("Chương học (Tùy chọn)")}</label>
                <select
                  id="mat-chapter"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
                  value={selectedChapterId}
                  onChange={(e) => setSelectedChapterId(e.target.value)}
                >
                  <option value="">{uiText("-- Không gắn chương --")}</option>
                  {chapters.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.title}
                    </option>
                  ))}
                </select>
              </div>

              {lessons.length > 0 && (
                <div>
                  <label htmlFor="mat-lesson" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    {uiText("Bài học cụ thể")}</label>
                  <select
                    id="mat-lesson"
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1' }}
                    value={selectedLessonId}
                    onChange={(e) => setSelectedLessonId(e.target.value)}
                  >
                    <option value="">{uiText("-- Không gắn bài học --")}</option>
                    {lessons.map((les) => (
                      <option key={les.id} value={les.id}>
                        {les.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div style={{ marginTop: '1rem' }}>
              <TextField
                label={uiText("Thẻ phân loại (Tags)")}
                placeholder={uiText("VD: kien-truc, chuong-1, microservices (phân cách bằng dấu phẩy)")}
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>
          </div>
        )}

        {uploadMode === 'new_version' && (
          <div className="upload-section-card">
            <h3>{uiText("Ghi chú phiên bản (Changelog)")}</h3>
            <TextField
              label={uiText("Mô tả cập nhật của phiên bản mới *")}
              placeholder={uiText("VD: Cập nhật sơ đồ hệ thống và bổ sung bài tập mẫu")}
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              required
            />
          </div>
        )}

        {/* File Dropzone & Queue */}
        <div className="upload-section-card">
          <h3>{uiText("Tệp tin tài liệu")}</h3>
          <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0.25rem 0 1rem' }}>
            {uiText("Hỗ trợ PDF, DOCX, TXT (tự động trích xuất nội dung văn bản) và các định dạng tệp tin cho phép theo chính sách môn học (tối đa ")}{policy?.max_file_size_bytes ? formatFileSize(policy.max_file_size_bytes) : '50MB'}{uiText("/tệp).")}</p>

          <div
            className="dropzone-card"
            onClick={() => fileInputRef.current?.click()}
            style={{ cursor: 'pointer', textAlign: 'center', padding: '2rem', border: '2px dashed #cbd5e1', borderRadius: '0.5rem' }}
          >
            <UploadCloud size={40} style={{ color: '#0284c7', margin: '0 auto' }} />
            <p style={{ fontWeight: 600, marginTop: '0.5rem' }}>
              {uiText("Nhấn để chọn tệp tin từ máy tính hoặc kéo thả vào đây")}</p>
            <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {uiText("Mọi tệp tin đều được quét mã độc an toàn và tính hash SHA-256 bất biến.")}</p>
            <input
              type="file"
              ref={fileInputRef}
              multiple
              style={{ display: 'none' }}
              onChange={handleSelectFiles}
            />
          </div>

          {/* Queue List */}
          {queue.length > 0 && (
            <div className="files-queue-list" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {queue.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    background: '#f8fafc',
                    borderRadius: '0.375rem',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                    <FileText size={20} style={{ color: '#0284c7' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.name}</div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {formatFileSize(item.size)}
                        {item.status === 'uploading' && uiText(" · Đang tải lên {0}%...",[item.progress])}
                        {item.status === 'committing' && uiText(" · Đang xác thực hash SHA-256...")}
                        {item.status === 'scanning' && uiText(" · Đang quét an toàn...")}
                        {item.status === 'clean' && uiText(" · Đã quét sạch an toàn")}
                        {item.status === 'error' && uiText(" · Lỗi: {0}",[item.error])}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {item.status === 'clean' && <Badge variant="success">{uiText("Sạch")}</Badge>}
                    {item.status === 'error' && <Badge variant="danger">{uiText("Lỗi")}</Badge>}
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => handleRemoveQueueItem(item.id)}
                      disabled={isSubmitting}
                    >
                      {uiText("Bỏ")}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Workflow & Options Card */}
        <div className="upload-section-card" style={{ background: '#f8fafc' }}>
          <h3>{uiText("Tùy chọn quy trình xuất bản")}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoFinalize}
                onChange={(e) => setAutoFinalize(e.target.checked)}
              />
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {uiText("Đóng băng manifest ngay sau khi tải lên (Kích hoạt trích xuất văn bản)")}</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoPublish}
                disabled={!autoFinalize}
                onChange={(e) => setAutoPublish(e.target.checked)}
              />
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: autoFinalize ? '#0f172a' : '#94a3b8' }}>
                {uiText("Công bố ngay cho sinh viên sau khi đóng băng")}</span>
            </label>
          </div>
        </div>

        {/* Form Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
          <Button
            variant="secondary"
            onClick={() => navigate(`/gv/mon-hoc/${monId}/hoc-lieu`)}
            disabled={isSubmitting}
          >
            {uiText("Hủy")}</Button>
          <Button
            variant="primary"
            type="submit"
            icon={isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            disabled={isSubmitting}
          >
            {isSubmitting ? uiText("Đang tải lên & xử lý...") : uploadMode === 'new_material' ? uiText("Tạo học liệu") : uiText("Lưu phiên bản mới")}
          </Button>
        </div>
      </form>
    </div>
  );
};
