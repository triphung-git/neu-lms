import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { aiAssistantService, type SavedChatTurn, type CourseChatCitation } from '../../../api/aiAssistantService';
import { materialsService } from '../../../api/materialsService';
import { Modal } from '../../../shared/ui/Modal';
import { PdfPreview } from '../../files/components/PdfPreview';
import './CourseChatPanel.css';

export function CourseChatPanel({ courseId }: { courseId: string }) {
  const { currentUser } = useSession();
  return <ChatBody key={`${currentUser?.id}:${courseId}`} courseId={courseId} />;
}

function ChatBody({ courseId }: { courseId: string }) {
  const [turns, setTurns] = useState<SavedChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [preview, setPreview] = useState<{ url: string; page: number; title: string } | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  const pending = useRef<{ question: string; id: string } | null>(null);
  const sourceSeq = useRef(0);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    aiAssistantService.history(courseId, controller.signal).then(data => {
      if (!controller.signal.aborted) setTurns(data);
    }).catch(e => {
      if (!controller.signal.aborted) setHistoryError(e instanceof Error ? e.message : uiText("Không tải được hội thoại."));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [courseId, attempt]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => { transcript.current?.scrollTo?.({ top: transcript.current.scrollHeight }); }, [turns]);

  async function send() {
    const text = question.trim();
    if (lock.current || loading || historyError || text.length < 3 || text.length > 2000) return;
    lock.current = true; setBusy(true); setError('');
    if (pending.current?.question !== text) pending.current = { question: text, id: crypto.randomUUID() };
    try {
      await aiAssistantService.chat(courseId, text, undefined, pending.current.id);
      if (!alive.current) return;
      const data = await aiAssistantService.history(courseId);
      if (!alive.current) return;
      setTurns(data); setQuestion(''); pending.current = null;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : uiText("Không gửi được. Bạn có thể thử gửi lại."));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function clear() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await aiAssistantService.clear(courseId);
      if (alive.current) { setTurns([]); setConfirmClear(false); pending.current = null; }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : uiText("Không xóa được hội thoại."));
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function openSource(c: CourseChatCitation) {
    const seq = ++sourceSeq.current;
    setSourceBusy(true); setError('');
    try {
      const material = await materialsService.getMaterial(courseId, c.material_id);
      if (c.version_id && material.published_version?.id !== c.version_id) {
        throw new Error(uiText("Học liệu đã có phiên bản công bố khác. Hãy hỏi lại để lấy nguồn mới."));
      }
      // The preview API rechecks publication, enrollment and file policy.
      const blob = await materialsService.previewMaterialFile(courseId, c.material_id, c.file_id!);
      if (!alive.current || seq !== sourceSeq.current) return;
      if (blob.type && !blob.type.includes('pdf')) throw new Error(uiText("Nguồn này không phải PDF. Hãy mở học liệu để xem hoặc tải tệp."));
      setPreview({ url: URL.createObjectURL(blob), page: c.page_number || 1, title: material.title });
    } catch (e) {
      if (alive.current && seq === sourceSeq.current) setError(e instanceof Error ? e.message : uiText("Không mở được nguồn."));
    } finally { if (alive.current && seq === sourceSeq.current) setSourceBusy(false); }
  }
  return <section className="course-chat" aria-label={uiText("Trợ lý học tập AI")}>
    <header><div><h3>{uiText("Trợ lý học tập AI")}</h3><p>{uiText("Hỏi đáp từ học liệu đã công bố trong môn.")}</p></div>
      <button type="button" disabled={busy || loading || !!historyError || !turns.length} onClick={() => setConfirmClear(true)}>{uiText("Xóa lịch sử")}</button></header>
    <p className="course-chat-note">{uiText("Lưu tối đa 50 câu hỏi gần nhất theo tài khoản và môn học. Nguồn bị thu hồi sẽ không được hiển thị lại.")}</p>
    {loading && <p role="status">{uiText("Đang tải hội thoại…")}</p>}
    {historyError && <div role="alert"><p>{historyError}</p><button type="button" onClick={() => { setLoading(true); setHistoryError(''); setAttempt(x => x + 1); }}>{uiText("Tải lại hội thoại")}</button></div>}
    <div className="course-chat-transcript" ref={transcript} aria-live="polite" aria-busy={busy}>
      {!loading && !historyError && !turns.length && <p>{uiText("Chưa có hội thoại. Hãy đặt câu hỏi cụ thể về học liệu.")}</p>}
      {turns.map(turn => <article key={turn.id}>
        <div className="course-chat-question"><strong>{uiText("Bạn")}</strong><p>{turn.question}</p></div>
        <div className="course-chat-answer"><strong>{uiText("Trợ lý AI")}</strong><p>{turn.answer}</p>
          {turn.citations.map(c => <details key={c.id}><summary>[{c.id}] {c.material_title}{c.page_number ? ` · Trang ${c.page_number}` : ''}</summary>
            <blockquote>{c.excerpt}</blockquote><p>{c.file_name}</p>
            <div className="course-chat-source-actions"><Link to={`/sv/mon-hoc/${courseId}/hoc-lieu/${c.material_id}`}>{uiText("Mở học liệu")}</Link>
              {c.file_id && /\.pdf$/i.test(c.file_name) && <button type="button" disabled={sourceBusy} onClick={() => void openSource(c)}>{uiText("Xem trang nguồn")}</button>}</div>
          </details>)}
        </div>
      </article>)}
      {busy && <p role="status">{uiText("Đang xử lý…")}</p>}
    </div>
    {error && <p role="alert" className="course-chat-error">{error}</p>}
    <form onSubmit={e => { e.preventDefault(); void send(); }}>
      <label htmlFor="course-chat-question">{uiText("Câu hỏi gửi tới trợ lý AI")}</label>
      <textarea id="course-chat-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={2000} rows={3} disabled={busy || loading || !!historyError} />
      <div className="course-chat-toolbar"><small>{question.length}{uiText("/2000 ký tự")}</small><button type="submit" disabled={busy || loading || !!historyError || question.trim().length < 3}>{uiText("Gửi câu hỏi")}</button></div>
    </form>
    {confirmClear && <Modal isOpen title={uiText("Xóa lịch sử hội thoại?")} onClose={() => !busy && setConfirmClear(false)}>
      <p>{uiText("Xóa toàn bộ hội thoại của bạn trong môn này. Thao tác không thể hoàn tác.")}</p>
      <div className="course-chat-toolbar"><button type="button" disabled={busy} onClick={() => setConfirmClear(false)}>{uiText("Hủy")}</button><button type="button" disabled={busy} onClick={() => void clear()}>{uiText("Xóa lịch sử")}</button></div>
    </Modal>}
    {preview && <Modal isOpen title={preview.title} size="lg" onClose={() => setPreview(null)}><PdfPreview url={preview.url} initialPage={preview.page} /></Modal>}
  </section>;
}
