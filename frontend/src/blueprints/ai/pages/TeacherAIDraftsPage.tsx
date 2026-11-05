import {Trash2} from 'lucide-react';
import {uiText} from "../../../shared/i18n/translate";
import {useParams} from 'react-router-dom';
import { remove } from '../../learning/api';
import { useLanguage } from '../../learning/i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { aiSummaryDraftService, type MaterialSummaryDraft } from '../../../api/aiAssistantService';
import { coursesService, type Course } from '../../../api/coursesService';
import { materialsService, type MaterialListItem } from '../../../api/materialsService';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextAreaField } from '../../../shared/ui/TextField';
import { formatDateVN } from '../../../shared/kernel/formatting';
import {
  Bot,
  CheckCircle2,
  FileText,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import './TeacherAIDraftsPage.css';

export const TeacherAIDraftsPage: React.FC = () => {
  const { t } = useLanguage();
  const {monId}=useParams();
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget,setDeleteTarget]=useState<MaterialSummaryDraft|null>(null);
  const [deleteError,setDeleteError]=useState('');
  const { showNotification } = useNotifications();
  const [courses, setCourses] = useState<Course[]>([]);
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [drafts, setDrafts] = useState<MaterialSummaryDraft[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [selectedDraft, setSelectedDraft] = useState<MaterialSummaryDraft | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState('');
  const materialRequestSeq = useRef(0);

  const loadDrafts = useCallback(async () => {
    const result = await aiSummaryDraftService.list(monId);
    setDrafts(result);
  }, [monId]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError('');
    Promise.all([
      coursesService.list({ role: 'teacher', page_size: 100 }),
      aiSummaryDraftService.list(monId),
    ])
      .then(([coursePage, draftItems]) => {
        if (!active) return;
        setCourses(coursePage.items.filter(c=>!monId||c.id===monId));
        setDrafts(draftItems);
        setSelectedCourseId(monId || coursePage.items[0]?.id || '');
      })
      .catch((caughtError) => {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : uiText("Không tải được dữ liệu bản nháp AI."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [monId]);

  useEffect(() => {
    const requestId = ++materialRequestSeq.current;
    setMaterials([]);
    setSelectedMaterialId('');
    if (!selectedCourseId) return;

    setIsLoadingMaterials(true);
    materialsService
      .listMaterials(selectedCourseId, { page: 1, page_size: 100 })
      .then((page) => {
        if (requestId !== materialRequestSeq.current) return;
        const visible = page.items.filter((item) => !item.is_hidden);
        setMaterials(visible);
        setSelectedMaterialId(visible[0]?.id ?? '');
      })
      .catch((caughtError) => {
        if (requestId === materialRequestSeq.current) {
          showNotification('error', caughtError instanceof Error ? caughtError.message : uiText("Không tải được danh sách học liệu."));
        }
      })
      .finally(() => {
        if (requestId === materialRequestSeq.current) setIsLoadingMaterials(false);
      });

    return () => {
      materialRequestSeq.current += 1;
    };
  }, [selectedCourseId, showNotification]);

  const handleGenerate = async () => {
    if (!selectedCourseId || !selectedMaterialId || isGenerating) return;
    setIsGenerating(true);
    setError('');
    try {
      const draft = await aiSummaryDraftService.create(selectedCourseId, selectedMaterialId);
      if (draft.status === 'pending') {
        setSelectedDraft(draft);
        setEditedContent(draft.summary);
        showNotification('success', uiText("Đã tạo bản nháp tóm tắt. Hãy rà soát trước khi xác nhận."));
      }
      try {
        await loadDrafts();
      } catch (refreshError) {
        showNotification(
          'info',
          refreshError instanceof Error
            ? uiText("Đã tạo bản nháp nhưng chưa làm mới được danh sách: {0}",[refreshError.message])
            : uiText("Đã tạo bản nháp nhưng chưa làm mới được danh sách."),
        );
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : uiText("Không tạo được bản nháp AI.");
      setError(message);
      showNotification('error', message);
    } finally {
      setIsGenerating(false);
    }
  };

  const openDraft = (draft: MaterialSummaryDraft) => {
    setSelectedDraft(draft);
    setEditedContent(draft.summary);
  };

  const handleReview = async (status: 'confirmed' | 'discarded') => {
    if (!selectedDraft || isReviewing) return;
    if (status === 'confirmed' && editedContent.trim().length < 3) {
      showNotification('error', uiText("Tóm tắt cần có ít nhất 3 ký tự."));
      return;
    }
    setIsReviewing(true);
    try {
      const reviewedDraft = await aiSummaryDraftService.review(
        selectedDraft.id,
        status,
        status === 'confirmed' ? editedContent.trim() : undefined,
      );
      setDrafts((previous) =>
        previous.map((draft) => draft.id === reviewedDraft.id ? reviewedDraft : draft),
      );
      setSelectedDraft(null);
      showNotification(
        status === 'confirmed' ? 'success' : 'info',
        status === 'confirmed'
          ? uiText("Đã xác nhận tóm tắt và lưu vào phiên bản học liệu.")
          : uiText("Đã từ chối bản nháp AI."),
      );
      try {
        await loadDrafts();
      } catch (refreshError) {
        showNotification(
          'info',
          refreshError instanceof Error
            ? uiText("Đã lưu quyết định nhưng chưa làm mới được danh sách: {0}",[refreshError.message])
            : uiText("Đã lưu quyết định nhưng chưa làm mới được danh sách."),
        );
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : uiText("Không cập nhật được trạng thái bản nháp.");
      showNotification('error', message);
    } finally {
      setIsReviewing(false);
    }
  };

  const pendingCount = drafts.filter((draft) => draft.status === 'pending').length;

  return (
    <div className="teacher-ai-drafts-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: uiText("Bàn làm việc"), path: '/gv' },
            { label: uiText("Bản nháp AI & Trợ lý học vụ") },
          ]}
        />
        <h1 className="page-heading">{uiText("Bản nháp AI & Hỗ trợ giảng dạy")}</h1>
        <p className="page-subheading">
          {uiText("Tạo bản nháp tóm tắt từ văn bản học liệu đã xử lý, sau đó biên tập và phê duyệt trước khi lưu vào phiên bản tài liệu.")}</p>
      </div>

      <section className="ai-draft-generator-card" aria-labelledby="ai-draft-generator-title">
        <div className="ai-draft-generator-heading">
          <div className="ai-draft-icon"><Sparkles size={22} /></div>
          <div>
            <h2 id="ai-draft-generator-title">{uiText("Tạo bản nháp tóm tắt học liệu")}</h2>
            <p>{uiText("AI chỉ sử dụng văn bản trích xuất từ tệp đã quét sạch. Nội dung không tự động công bố cho sinh viên.")}</p>
          </div>
        </div>

        <div className="ai-draft-generator-fields">
          <label>
            <span>{uiText("Học phần")}</span>
            <select
              value={selectedCourseId}
              onChange={(event) => setSelectedCourseId(event.target.value)}
              disabled={isLoading || courses.length === 0}
            >
              {courses.length === 0 && <option value="">{uiText("Chưa có học phần phụ trách")}</option>}
              {courses.map((course) => (
                <option key={course.id} value={course.id}>{course.code} — {course.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>{uiText("Học liệu")}</span>
            <select
              value={selectedMaterialId}
              onChange={(event) => setSelectedMaterialId(event.target.value)}
              disabled={!selectedCourseId || isLoadingMaterials || materials.length === 0}
            >
              {isLoadingMaterials && <option value="">{uiText("Đang tải học liệu…")}</option>}
              {!isLoadingMaterials && materials.length === 0 && <option value="">{uiText("Không có học liệu khả dụng")}</option>}
              {materials.map((material) => (
                <option key={material.id} value={material.id}>{material.title}</option>
              ))}
            </select>
          </label>

          <Button
            type="button"
            variant="primary"
            isLoading={isGenerating}
            disabled={!selectedCourseId || !selectedMaterialId || isLoadingMaterials}
            onClick={() => void handleGenerate()}
          >
            <Bot size={16} />
            <span>{uiText("Tạo bản nháp AI")}</span>
          </Button>
        </div>
        <p className="ai-draft-policy-note">
          {uiText("Yêu cầu cần có phiên bản học liệu đã đóng băng và pipeline trích xuất B08–B09 ở trạng thái sẵn sàng. Giới hạn 12 yêu cầu tạo bản nháp mỗi 15 phút cho mỗi giảng viên.")}</p>
      </section>

      {error && <div className="ai-draft-error" role="alert">{error}</div>}

      <section className="ai-draft-list-card" aria-labelledby="ai-draft-list-title">
        <div className="ai-draft-list-heading">
          <div>
            <h2 id="ai-draft-list-title">{uiText("Bản nháp của các học phần phụ trách")}</h2>
            <p>{pendingCount} {uiText(" bản nháp đang chờ giảng viên rà soát")}</p>
          </div>
          <button
            type="button"
            className="ai-draft-refresh"
            onClick={() => void loadDrafts().catch((caughtError) => showNotification('error', caughtError instanceof Error ? caughtError.message : uiText("Không làm mới được danh sách.")))}
            disabled={isLoading}
          >
            <RefreshCw size={15} /> {uiText(" Làm mới")}</button>
        </div>

        {isLoading ? (
          <p role="status" className="ai-draft-loading"><LoaderCircle size={16} /> {uiText(" Đang tải bản nháp…")}</p>
        ) : drafts.length === 0 ? (
          <div className="ai-draft-empty">
            <FileText size={28} />
            <strong>{uiText("Chưa có bản nháp AI")}</strong>
            <span>{uiText("Chọn một học liệu ở phía trên để tạo bản tóm tắt đầu tiên.")}</span>
          </div>
        ) : (
          <div className="ai-draft-table-wrap">
            <table className="ai-draft-table">
              <thead>
                <tr>
                  <th>{uiText("Học liệu")}</th>
                  <th>{uiText("Học phần")}</th>
                  <th>{uiText("Phiên bản")}</th>
                  <th>{uiText("Nguồn")}</th>
                  <th>{uiText("Tạo lúc")}</th>
                  <th>{uiText("Trạng thái")}</th>
                  <th>{uiText("Thao tác")}</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => (
                  <tr key={draft.id}>
                    <td><strong>{draft.material_title}</strong></td>
                    <td>{draft.course_code} — {draft.course_name}</td>
                    <td>v{draft.version_number}</td>
                    <td>{draft.source_file_names.length} {uiText(" tệp")}</td>
                    <td>{formatDateVN(draft.created_at)}</td>
                    <td>
                      <Badge
                        variant={draft.status === 'confirmed' ? 'published' : draft.status === 'discarded' ? 'archived' : 'draft'}
                        label={draft.status === 'confirmed' ? uiText("Đã xác nhận") : draft.status === 'discarded' ? uiText("Đã từ chối") : uiText("Chờ duyệt")}
                      />
                    </td>
                    <td>
                      {<button className="ai-draft-delete" type="button" disabled={deleting} onClick={()=>{setDeleteError('');setDeleteTarget(draft);}}><Trash2 size={16} aria-hidden="true"/><span>{deleting?t('Đang xóa…','Deleting…'):t('Xóa bản nháp', 'Delete draft')}</span></button>}
                      <button type="button" className="ai-draft-open" onClick={() => openDraft(draft)}>
                        {draft.status === 'pending' ? uiText("Biên tập & duyệt") : uiText("Xem nội dung")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedDraft && (
        <Modal
          title={selectedDraft.status === 'pending' ? uiText("Biên tập & phê duyệt tóm tắt AI") : uiText("Nội dung tóm tắt AI")}
          isOpen={Boolean(selectedDraft)}
          onClose={() => setSelectedDraft(null)}
        >
          <div className="ai-draft-review-modal">
            <div className="ai-draft-source-details">
              <strong>{selectedDraft.material_title}</strong>
              <span>{selectedDraft.course_code} — {selectedDraft.course_name} {uiText(" · phiên bản ")}{selectedDraft.version_number}</span>
              <span>{uiText("Nguồn: ")}{selectedDraft.source_file_names.join(', ')}</span>
            </div>
            <TextAreaField
              label={uiText("Nội dung tóm tắt")}
              value={editedContent}
              onChange={(event) => setEditedContent(event.target.value)}
              rows={12}
              disabled={selectedDraft.status !== 'pending' || isReviewing}
            />
            <div className="ai-draft-review-actions">
              {selectedDraft.status === 'pending' ? (
                <>
                  <Button type="button" variant="ghost" onClick={() => void handleReview('discarded')} disabled={isReviewing}>
                    <XCircle size={16} /> {uiText(" Từ chối")}</Button>
                  <Button type="button" variant="primary" isLoading={isReviewing} onClick={() => void handleReview('confirmed')}>
                    <CheckCircle2 size={16} /> {uiText(" Xác nhận & lưu")}</Button>
                </>
              ) : (
                <span className="ai-draft-reviewed-note">{uiText("Bản nháp đã được xử lý, không thể chỉnh sửa lại.")}</span>
              )}
            </div>
          </div>
        </Modal>
      )}
      {deleteTarget && <Modal isOpen size="sm" title={t('Xóa bản nháp AI','Delete AI draft')} onClose={()=>{if(!deleting)setDeleteTarget(null);}} footer={<>
        <Button variant="secondary" disabled={deleting} onClick={()=>setDeleteTarget(null)}>{t('Giữ lại','Keep draft')}</Button>
        <button type="button" className="ai-draft-delete ai-draft-delete-confirm" disabled={deleting} onClick={async()=>{
          if(deleting)return;setDeleting(true);setDeleteError('');
          try{await remove('/drafts/'+deleteTarget.id);setDrafts(rows=>rows.filter(row=>row.id!==deleteTarget.id));if(selectedDraft?.id===deleteTarget.id)setSelectedDraft(null);setDeleteTarget(null);showNotification('success',t('Đã xóa bản nháp AI.','AI draft deleted.'));}
          catch(e){setDeleteError(e instanceof Error?e.message:String(e));}finally{setDeleting(false);}
        }}><Trash2 size={16}/>{deleting?t('Đang xóa…','Deleting…'):t('Xóa bản nháp','Delete draft')}</button>
      </>}><div className="ai-draft-delete-symbol"><Trash2 size={28}/></div><p><strong>{deleteTarget.material_title}</strong></p><p>{t('Bản nháp sẽ bị xóa vĩnh viễn. Tài liệu gốc và tóm tắt đã công bố vẫn được giữ lại.','This draft will be permanently deleted. Original materials and published summaries will be retained.')}</p>{deleteError&&<p role="alert" className="ai-draft-delete-error">{deleteError}</p>}</Modal>}
    </div>
  );
};
