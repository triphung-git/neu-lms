import React, { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN, formatFileSize } from '../../../shared/kernel/formatting';
import {
  FileText,
  Download,
  Bot,
  Send,
  Sparkles,
  AlertTriangle,
  Clock,
  ExternalLink,
  Layers
} from 'lucide-react';
import './StudentMaterialDetailPage.css';

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  citation?: string;
  time: string;
}

export const StudentMaterialDetailPage: React.FC = () => {
  const { hocLieuId } = useParams<{ hocLieuId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { materials, materialVersions, courses, lessons, chapters, memberships, systemSettings } = useDatabase();
  const { currentUser } = useSession();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const selectedVersionParam = searchParams.get('phienBan');

  const material = materials.find(m => m.id === hocLieuId);
  const course = material ? courses.find(c => c.id === material.courseId) : null;
  const lesson = material ? lessons.find(l => l.id === material.lessonId) : null;

  // Check enrollment
  const isEnrolled = memberships.some(
    m => m.courseId === material?.courseId && m.userId === currentUser?.id && m.status === 'active'
  );

  // Versions for this material
  const versions = useMemo(() => {
    return materialVersions
      .filter(v => v.materialId === hocLieuId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }, [materialVersions, hocLieuId]);

  // Current selected version
  const currentVersion = useMemo(() => {
    if (selectedVersionParam) {
      const vNum = parseInt(selectedVersionParam, 10);
      const found = versions.find(v => v.versionNumber === vNum);
      if (found) return found;
    }
    return versions.length > 0 ? versions[0] : null;
  }, [versions, selectedVersionParam]);

  const fileType = currentVersion?.filename.split('.').pop()?.toUpperCase() || 'PDF';
  const scanStatus = currentVersion?.scanStatus || 'clean';
  const indexStatus = currentVersion?.indexStatus || 'pending';
  const fileSize = currentVersion?.sizeBytes || 1024000;
  const sampleContent = currentVersion?.contentExcerpt || currentVersion?.summary || '';
  const updatedAt = currentVersion?.uploadedAt || '';

  // AI Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm1',
      sender: 'ai',
      text: `Xin chào! Tôi là trợ lý học tập AI của tài liệu "${material?.title || 'học liệu'}". Bạn có thể đặt câu hỏi về nội dung tài liệu hoặc chọn các câu hỏi gợi ý bên dưới.`,
      time: '10:00'
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);

  if (!material || !course) {
    return (
      <div className="material-detail-container">
        <EmptyState
          title="Không tìm thấy học liệu"
          description="Tài liệu không tồn tại hoặc đã bị gỡ khỏi khóa học."
          action={
            <Button variant="primary" onClick={() => navigate('/sv/mon-hoc')}>
              Về môn học của tôi
            </Button>
          }
        />
      </div>
    );
  }

  if (!isEnrolled) {
    return (
      <div className="material-detail-container">
        <EmptyState
          title="Không có quyền truy cập"
          description="Bạn chưa được ghi danh vào môn học này để xem học liệu."
          action={
            <Button variant="primary" onClick={() => navigate('/sv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  // Student can only view 'class' visibility materials
  if (material.visibility !== 'class') {
    return (
      <div className="material-detail-container">
        <EmptyState
          title="Học liệu chưa được công bố"
          description="Tài liệu này đang ở chế độ riêng tư hoặc bản nháp của giảng viên."
          action={
            <Button variant="primary" onClick={() => navigate(`/sv/mon-hoc/${course.id}`)}>
              Về môn học
            </Button>
          }
        />
      </div>
    );
  }

  const handleDownloadSample = () => {
    if (scanStatus === 'infected') {
      showNotification('error', 'Tệp bị khóa do phát hiện mã độc.');
      return;
    }
    // Simulate safe clean download
    showNotification('success', `Đang tải xuống tệp: ${material.title}.${fileType.toLowerCase()} (${formatFileSize(fileSize)})`);
  };

  const handleAskSuggested = (question: string) => {
    handleSendMessage(question);
  };

  const handleSendMessage = (textToSend?: string) => {
    const q = (textToSend || inputText).trim();
    if (!q) return;

    if (!systemSettings.aiEnabled) {
      showNotification('error', 'Tính năng trợ lý AI hiện đang tạm tắt theo cấu hình hệ thống.');
      return;
    }

    if (indexStatus !== 'success') {
      showNotification('info', 'Tài liệu chưa được lập chỉ mục AI hoặc chỉ mục đang được xử lý.');
      return;
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: q,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsAiTyping(true);

    setTimeout(() => {
      let reply = '';
      let citation = '';

      if (q.toLowerCase().includes('tóm tắt') || q.toLowerCase().includes('nội dung')) {
        reply = `Tài liệu "${material.title}" tập trung vào các nguyên lý cốt lõi, kiến trúc hệ thống và các tiêu chuẩn kiểm thử tự động. Người học cần nắm vững quy trình xử lý dữ liệu và các ràng buộc bảo mật.`;
        citation = `Nguồn: Trang 3, Mục 1.2 "Mục tiêu bài học" (Phiên bản v${currentVersion?.versionNumber})`;
      } else if (q.toLowerCase().includes('khái niệm') || q.toLowerCase().includes('định nghĩa')) {
        reply = `Khái niệm được định nghĩa rõ: Hệ thống là tập hợp các thành phần tương tác theo hợp đồng dữ liệu chuẩn, đảm bảo tính toàn vẹn và khả năng mở rộng.`;
        citation = `Nguồn: Trang 7, Mục 2.1 "Định nghĩa thuật ngữ"`;
      } else {
        reply = `Theo nội dung phiên bản ${currentVersion?.versionNumber}, vấn đề bạn hỏi liên quan trực tiếp đến cơ chế kiểm soát trạng thái và quy trình xác thực dữ liệu đầu vào.`;
        citation = `Nguồn: Trang 12, Phần "Ràng buộc dữ liệu"`;
      }

      setMessages(prev => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: reply,
          citation,
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setIsAiTyping(false);
    }, 600);
  };

  const handleSwitchVersion = (vNum: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('phienBan', vNum.toString());
    setSearchParams(next);
  };

  return (
    <div className="student-material-detail-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Trang chủ', path: '/sv' },
            { label: `${course.code} — ${course.name}`, path: `/sv/mon-hoc/${course.id}` },
            { label: lesson ? lesson.title : 'Bài học', path: `/sv/mon-hoc/${course.id}?bai=${lesson?.id}` },
            { label: material.title }
          ]}
        />
      </div>

      {/* Infected Alert Guard */}
      {scanStatus === 'infected' && (
        <div className="infected-danger-banner" role="alert">
          <AlertTriangle size={24} />
          <div>
            <strong>Tệp tin này bị chặn do cảnh báo an toàn mã độc</strong>
            <p>
              Hệ thống phát hiện tệp tài liệu có nguy cơ bảo mật. Giảng viên đã được thông báo để tải lên phiên bản thay thế. Tệp không thể tải xuống hoặc xem trực tuyến.
            </p>
          </div>
        </div>
      )}

      {/* Main 2-column layout (Desktop 2-col / Mobile stacked) */}
      <div className="material-detail-layout">
        {/* Left Column: Material Info & Document Viewer (60%) */}
        <section className="material-content-panel">
          <header className="material-header-block">
            <div className="material-badge-row">
              <span className="filetype-badge">{fileType}</span>
              <span className="version-pill">Phiên bản {currentVersion?.versionNumber}</span>
              <Badge
                variant={scanStatus === 'clean' ? 'ready' : scanStatus === 'infected' ? 'error' : 'processing'}
                label={scanStatus === 'clean' ? 'Đã quét an toàn' : scanStatus === 'infected' ? 'Phát hiện mã độc' : 'Đang quét an ninh'}
              />
            </div>

            <h1 className="material-title">{material.title}</h1>

            <div className="material-meta-details">
              <span>Môn học: <strong>{course.name}</strong></span>
              <span className="dot">•</span>
              <span>Cập nhật: <strong>{formatDateVN(updatedAt)}</strong></span>
              <span className="dot">•</span>
              <span>Dung lượng: <strong>{formatFileSize(fileSize)}</strong></span>
            </div>

            {material.tags && material.tags.length > 0 && (
              <div className="material-tags-stack">
                {material.tags.map(t => (
                  <span key={t} className="tag-pill">#{t}</span>
                ))}
              </div>
            )}
          </header>

          {/* Version Switcher */}
          {versions.length > 1 && (
            <div className="version-selector-card">
              <div className="version-sel-title">
                <Layers size={16} />
                <span>Các phiên bản tài liệu:</span>
              </div>
              <div className="version-buttons-row">
                {versions.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    className={`ver-btn ${currentVersion?.versionNumber === v.versionNumber ? 'active' : ''}`}
                    onClick={() => handleSwitchVersion(v.versionNumber)}
                  >
                    <span>v{v.versionNumber}</span>
                    <small>({formatDateVN(v.uploadedAt)})</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Document Content Preview Block */}
          <div className="document-preview-box">
            <div className="preview-top-toolbar">
              <span className="preview-doc-label">Bản xem trước trực tuyến</span>
              <Button
                type="button"
                variant="secondary"
                onClick={handleDownloadSample}
                disabled={scanStatus === 'infected'}
              >
                <Download size={16} />
                <span>Tải tệp mẫu</span>
              </Button>
            </div>

            <div className="preview-text-canvas">
              {sampleContent ? (
                <div className="sample-text-body">
                  <p className="sample-watermark">[NPC LMS — BẢN XEM TRƯỚC HỌC LIỆU CHÍNH THỨC]</p>
                  <h3>{material.title}</h3>
                  <p className="sample-lead">
                    Học liệu thuộc học phần <strong>{course.name}</strong> ({course.code}), bài học <strong>{lesson?.title}</strong>.
                  </p>
                  <hr className="sample-divider" />
                  <div className="sample-content-formatted">
                    {sampleContent.split('\n').map((par: string, pIdx: number) => (
                      <p key={pIdx}>{par}</p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="preview-placeholder-body">
                  <FileText size={48} className="placeholder-icon" />
                  <h3>Xem tài liệu trực tuyến</h3>
                  <p>Học liệu định dạng {fileType} đã sẵn sàng để nghiên cứu.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right Column: AI Interactive Study Assistant (40%) */}
        <aside className="ai-chat-panel" aria-label="Trợ lý học tập AI">
          <div className="ai-chat-header">
            <div className="ai-brand">
              <Bot size={22} className="ai-bot-icon" />
              <div>
                <h2 className="ai-title">Hỏi đáp AI theo ngữ cảnh</h2>
                <span className="ai-scope-subtitle">Được trích dẫn từ tài liệu v{currentVersion?.versionNumber}</span>
              </div>
            </div>
            <span className="ai-status-indicator online" title="Hệ thống AI hoạt động"></span>
          </div>

          {/* AI Disabled or Not Indexed Warning */}
          {!systemSettings.aiEnabled ? (
            <div className="ai-disabled-card">
              <AlertTriangle size={18} />
              <span>Trợ lý AI đang tạm ngưng phục vụ theo lịch bảo trì hệ thống.</span>
            </div>
          ) : indexStatus !== 'success' ? (
            <div className="ai-disabled-card">
              <Clock size={18} />
              <span>Chưa có chỉ mục nội dung cho phiên bản này. Trợ lý AI đang cập nhật.</span>
            </div>
          ) : null}

          {/* Suggested Questions */}
          <div className="ai-suggested-section">
            <span className="suggested-heading">
              <Sparkles size={14} />
              <span>Gợi ý câu hỏi nhanh:</span>
            </span>
            <div className="suggested-chips-list">
              <button
                type="button"
                className="chip-btn"
                onClick={() => handleAskSuggested('Tóm tắt 3 luận điểm chính của bài học này?')}
              >
                Tóm tắt 3 luận điểm chính?
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => handleAskSuggested('Các định nghĩa và thuật ngữ cốt lõi là gì?')}
              >
                Thuật ngữ cốt lõi là gì?
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => handleAskSuggested('Những lưu ý quan trọng khi làm bài tập thực hành?')}
              >
                Lưu ý quan trọng khi làm bài?
              </button>
            </div>
          </div>

          {/* Chat Messages Log */}
          <div className="chat-messages-scroll" role="log" aria-live="polite">
            {messages.map(m => (
              <div key={m.id} className={`chat-bubble-wrap ${m.sender}`}>
                <div className="chat-bubble">
                  <p className="bubble-text">{m.text}</p>
                  {m.citation && (
                    <div className="citation-badge">
                      <ExternalLink size={12} />
                      <span>{m.citation}</span>
                    </div>
                  )}
                  <span className="bubble-time">{m.time}</span>
                </div>
              </div>
            ))}

            {isAiTyping && (
              <div className="chat-bubble-wrap ai">
                <div className="chat-bubble typing">
                  <div className="typing-dots">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Chat Input Box */}
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="chat-input-bar"
          >
            <input
              type="text"
              className="chat-text-input"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="Hỏi về nội dung tài liệu này..."
              disabled={!systemSettings.aiEnabled || indexStatus !== 'success'}
            />
            <button
              type="submit"
              className="chat-send-btn"
              disabled={!inputText.trim() || !systemSettings.aiEnabled || indexStatus !== 'success'}
              aria-label="Gửi câu hỏi"
            >
              <Send size={16} />
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
};
