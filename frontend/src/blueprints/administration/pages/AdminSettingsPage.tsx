import {uiText} from "../../../shared/i18n/translate";
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../../api/client';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { AdminFileLimitsPanel } from '../../dashboards/pages/AdminFileLimitsPanel';
import {
  Activity,
  Bot,
  Database,
  Mail,
  RefreshCw,
  ShieldCheck,
  HardDrive,
  Server,
} from 'lucide-react';
import './AdminSettingsPage.css';

type RuntimeSettings = {
  ai_auto_index_enabled: boolean;
  ai_index_failed: number;
  ai_index_ready: number;
  notification_email_enabled: boolean;
  notification_email_failed: number;
  notification_email_pending: number;
  ai_chat_configured: boolean;
  ai_chat_model: string;
  ai_embedding_configured: boolean;
  ai_embedding_model: string;
  email_backend: string;
  email_host_configured: boolean;
  email_auth_configured: boolean;
  email_sender_configured: boolean;
  file_storage_backend: string;
  s3_storage_configured: boolean;
  clamav_configured: boolean;
  celery_broker_configured: boolean;
};

type StatusRowProps = {
  label: string;
  configured: boolean;
  detail?: string;
};

function StatusRow({ label, configured, detail }: StatusRowProps) {
  return (
    <div className="runtime-status-row">
      <div>
        <strong>{label}</strong>
        {detail && <p>{detail}</p>}
      </div>
      <span className={`runtime-status-pill ${configured ? 'is-configured' : 'is-missing'}`}>
        <span aria-hidden="true" className="runtime-status-dot" />
        {configured ? uiText("Đã cấu hình") : uiText("Chưa cấu hình")}
      </span>
    </div>
  );
}

export const AdminSettingsPage: React.FC = () => {
  const [runtime, setRuntime] = useState<RuntimeSettings | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const loadRuntimeSettings = useCallback(async (signal: AbortSignal) => {
    setIsLoading(true);
    setError('');
    try {
      const result = await apiClient.untypedRequest<RuntimeSettings>(
        '/api/v1/admin/runtime-settings',
        { signal },
      );
      if (!signal.aborted) setRuntime(result);
    } catch (caughtError) {
      if (!signal.aborted) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : uiText("Không tải được trạng thái cấu hình hệ thống."),
        );
      }
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRuntimeSettings(controller.signal);
    return () => controller.abort();
  }, [attempt, loadRuntimeSettings]);

  return (
    <div className="admin-settings-page">
      {runtime && <section className="runtime-jobs" aria-label={uiText("Hàng đợi nền")}>
        <h2>{uiText("Xử lý nền")}</h2>
        <dl><div><dt>{uiText("Tự động cập nhật embeddings")}</dt><dd>{runtime.ai_auto_index_enabled ? uiText("Đã bật") : uiText("Đã tắt")} · {runtime.ai_index_ready} {uiText(" hoàn tất · ")}{runtime.ai_index_failed} {uiText(" đang lỗi")}</dd></div>
        <div><dt>{uiText("Email thông báo môn học và điểm")}</dt><dd>{runtime.notification_email_enabled ? uiText("Đã bật") : uiText("Đã tắt")} · {runtime.notification_email_pending} {uiText(" đang chờ · ")}{runtime.notification_email_failed} {uiText(" hết lượt thử")}</dd></div></dl>
        <p>{uiText("Số liệu hàng đợi không thay thế kiểm tra kết nối nhà cung cấp. Tải lại để cập nhật.")}</p>
      </section>}

      <div className="page-header">
        <Breadcrumb
          items={[
            { label: uiText("Bàn làm việc"), path: '/ad' },
            { label: uiText("Cấu hình hệ thống") },
          ]}
        />
        <h1 className="page-heading">{uiText("Cấu hình hệ thống toàn trường")}</h1>
        <p className="page-subheading">
          {uiText("Theo dõi trạng thái cấu hình runtime của AI, email, lưu trữ và dịch vụ nền.")}</p>
      </div>

      <AdminFileLimitsPanel />

      <section className="settings-card runtime-settings-card" aria-labelledby="runtime-settings-title">
        <div className="card-top-header">
          <Server size={22} className="card-icon blue" />
          <div>
            <h2 className="card-title" id="runtime-settings-title">{uiText("Trạng thái cấu hình máy chủ")}</h2>
            <p className="card-subtitle">
              {uiText("Dữ liệu được đọc trực tiếp từ backend. Giao diện không trả về hoặc lưu bất kỳ secret nào.")}</p>
          </div>
          <button
            type="button"
            className="runtime-refresh-button"
            onClick={() => setAttempt(value => value + 1)}
            disabled={isLoading}
          >
            <RefreshCw size={15} />
            {uiText("Làm mới")}</button>
        </div>

        {error && (
          <div className="runtime-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setAttempt(value => value + 1)}>
              {uiText("Thử lại")}</button>
          </div>
        )}
        {isLoading && !runtime && <p role="status">{uiText("Đang tải trạng thái cấu hình…")}</p>}

        {runtime && (
          <div className="runtime-sections">
            <section className="runtime-section" aria-labelledby="runtime-ai-title">
              <h3 id="runtime-ai-title"><Bot size={17} /> {uiText(" Dịch vụ AI/RAG")}</h3>
              <StatusRow
                label={uiText("Mô hình chat")}
                configured={runtime.ai_chat_configured}
                detail={runtime.ai_chat_model || uiText("Chưa khai báo AI_CHAT_MODEL")}
              />
              <StatusRow
                label={uiText("Embedding học liệu")}
                configured={runtime.ai_embedding_configured}
                detail={runtime.ai_embedding_model || uiText("Chưa khai báo AI_EMBEDDING_MODEL")}
              />
            </section>

            <section className="runtime-section" aria-labelledby="runtime-email-title">
              <h3 id="runtime-email-title"><Mail size={17} /> Email</h3>
              <StatusRow
                label="SMTP host"
                configured={runtime.email_host_configured}
                detail={runtime.email_backend}
              />
              <StatusRow label={uiText("Thông tin xác thực SMTP")} configured={runtime.email_auth_configured} />
              <StatusRow label={uiText("Địa chỉ gửi mặc định")} configured={runtime.email_sender_configured} />
            </section>

            <section className="runtime-section" aria-labelledby="runtime-storage-title">
              <h3 id="runtime-storage-title"><HardDrive size={17} /> {uiText(" File, lưu trữ và worker")}</h3>
              <StatusRow
                label={uiText("Backend lưu trữ")}
                configured={runtime.file_storage_backend === 's3' ? runtime.s3_storage_configured : runtime.file_storage_backend === 'local'}
                detail={uiText("Chế độ hiện tại: {0}",[runtime.file_storage_backend])}
              />
              <StatusRow label="Object storage S3" configured={runtime.s3_storage_configured} />
              <StatusRow label="ClamAV scanner" configured={runtime.clamav_configured} />
              <StatusRow label="Celery broker" configured={runtime.celery_broker_configured} />
            </section>

            <section className="runtime-section runtime-security-note" aria-labelledby="runtime-security-title">
              <h3 id="runtime-security-title"><ShieldCheck size={17} /> {uiText(" Chính sách và giới hạn")}</h3>
              <p>
                {uiText("Khóa API, mật khẩu SMTP, S3 credentials và kết nối cơ sở dữ liệu phải được cấu hình qua secret manager hoặc biến môi trường trên máy chủ; không chỉnh sửa qua trình duyệt.")}</p>
              <p>
                {uiText("Các trạng thái trên chỉ xác nhận sự hiện diện của cấu hình, không thay thế health check kết nối, kiểm tra worker hoặc smoke test trên staging.")}</p>
            </section>
          </div>
        )}

        {!isLoading && !error && !runtime && (
          <div className="runtime-error" role="alert">{uiText("Backend không trả về dữ liệu cấu hình.")}</div>
        )}
      </section>

      <section className="settings-card security-policy-card">
        <div className="card-top-header">
          <Activity size={22} className="card-icon green" />
          <div>
            <h2 className="card-title">{uiText("Chính sách bảo mật tệp")}</h2>
            <p className="card-subtitle">{uiText("Các giới hạn và bộ quét được backend áp dụng; không thể tắt từ giao diện.")}</p>
          </div>
        </div>
        <div className="security-enforced-banner">
          <Database size={21} />
          <p className="enforced-desc">
            {uiText("Tệp tải lên chỉ được phân phối sau khi quy trình kiểm tra an toàn hoàn tất. Trong staging, cần bảo đảm file worker, scheduler, object storage và ClamAV hoạt động trước khi nghiệm thu.")}</p>
        </div>
      </section>
    </div>
  );
};
