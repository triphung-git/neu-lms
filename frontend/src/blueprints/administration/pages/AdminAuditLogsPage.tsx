import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { removeVietnameseAccents } from '../../../shared/lib/search';
import { AuditEvent } from '../../../shared/kernel/types';
import {
  Eye,
  ShieldCheck,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import './AdminAuditLogsPage.css';

const PAGE_SIZE = 15;

export const AdminAuditLogsPage: React.FC = () => {
  const { auditEvents } = useDatabase();

  // Filters
  const [fromDate, setFromDate] = useState('2026-10-01');
  const [toDate, setToDate] = useState('2026-10-25');
  const [actorQuery, setActorQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Detail Modal
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  // Distinct actions for dropdown
  const allActions = useMemo(() => {
    return Array.from(new Set(auditEvents.map(e => e.action)));
  }, [auditEvents]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return auditEvents.filter(ev => {
      // Date range check
      const evDate = ev.at.split('T')[0];
      if (fromDate && evDate < fromDate) return false;
      if (toDate && evDate > toDate) return false;

      // Action filter
      if (actionFilter !== 'all' && ev.action !== actionFilter) return false;

      // Result filter
      if (resultFilter !== 'all' && ev.result !== resultFilter) return false;

      // Actor query
      if (actorQuery.trim()) {
        const qNorm = removeVietnameseAccents(actorQuery.toLowerCase());
        const actorNorm = removeVietnameseAccents(ev.actorName.toLowerCase());
        return actorNorm.includes(qNorm);
      }

      return true;
    });
  }, [auditEvents, fromDate, toDate, actionFilter, resultFilter, actorQuery]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLogs.slice(start, start + PAGE_SIZE);
  }, [filteredLogs, currentPage]);

  const handlePageChange = (p: number) => {
    if (p >= 1 && p <= totalPages) {
      setCurrentPage(p);
    }
  };

  return (
    <div className="admin-audit-logs-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Nhật ký kiểm toán' }
          ]}
        />
        <h1 className="page-heading">Nhật ký kiểm toán hệ thống (Audit Logs)</h1>
        <p className="page-subheading">
          Ghi nhận toàn bộ các tác vụ nghiệp vụ quan trọng. Dữ liệu bất biến và đã được khử thông tin nhạy cảm.
        </p>
      </div>

      <div className="audit-privacy-notice">
        <ShieldCheck size={18} />
        <span>
          <strong>Tuân thủ bảo mật:</strong> Nhật ký kiểm toán không lưu trữ mật khẩu, mã xác thực hoặc nội dung bài nộp của sinh viên. Mọi thông tin nhạy cảm đều được băm hoặc lược bỏ trước khi ghi sổ.
        </span>
      </div>

      {/* Filter and Search Card */}
      <div className="audit-filters-card">
        <div className="filter-row-top">
          <div className="filter-col">
            <TextField
              label="Tìm theo người thực hiện"
              value={actorQuery}
              onChange={e => {
                setActorQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Nhập tên người dùng..."
            />
          </div>

          <div className="filter-col">
            <SelectField
              label="Hành động"
              value={actionFilter}
              onChange={e => {
                setActionFilter(e.target.value);
                setCurrentPage(1);
              }}
              options={[
                { value: 'all', label: 'Tất cả hành động' },
                ...allActions.map((act: string) => ({ value: act, label: act }))
              ]}
            />
          </div>

          <div className="filter-col">
            <SelectField
              label="Kết quả"
              value={resultFilter}
              onChange={e => {
                setResultFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              options={[
                { value: 'all', label: 'Tất cả kết quả' },
                { value: 'success', label: 'Thành công (Success)' },
                { value: 'failure', label: 'Thất bại (Failure)' }
              ]}
            />
          </div>
        </div>

        <div className="filter-row-dates">
          <div className="date-input-col">
            <TextField
              label="Từ ngày"
              type="date"
              value={fromDate}
              onChange={e => {
                setFromDate(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <div className="date-input-col">
            <TextField
              label="Đến ngày"
              type="date"
              value={toDate}
              onChange={e => {
                setToDate(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {filteredLogs.length === 0 ? (
        <EmptyState
          title="Không tìm thấy sự kiện nào"
          description="Không có nhật ký nào khớp với tiêu chí tìm kiếm và khoảng thời gian đã chọn."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setFromDate('2026-10-01');
                setToDate('2026-10-25');
                setActorQuery('');
                setActionFilter('all');
                setResultFilter('all');
                setCurrentPage(1);
              }}
            >
              Đặt lại bộ lọc
            </Button>
          }
        />
      ) : (
        <div className="audit-table-wrapper">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Người thực hiện</th>
                <th>Vai trò</th>
                <th>Hành động (Action)</th>
                <th>Đối tượng (Entity)</th>
                <th>Kết quả</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.map(log => (
                <tr key={log.id}>
                  <td>{formatDateVN(log.at)}</td>
                  <td><strong>{log.actorName}</strong></td>
                  <td>
                    <span className="role-chip">{log.actorRole}</span>
                  </td>
                  <td>
                    <span className="action-code-text">{log.action}</span>
                  </td>
                  <td>
                    <span className="entity-text">{log.entityType}: {log.entityId}</span>
                  </td>
                  <td>
                    <span className={`result-tag ${log.result}`}>
                      {log.result === 'success' ? 'Thành công' : 'Thất bại'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="npc-btn npc-btn-secondary npc-btn-sm"
                      onClick={() => setSelectedEvent(log)}
                    >
                      <Eye size={14} />
                      <span>Chi tiết</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls (page15) */}
          <div className="table-pagination-bar">
            <span className="page-info-text">
              Hiển thị {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(currentPage * PAGE_SIZE, filteredLogs.length)} trên tổng số {filteredLogs.length} sự kiện
            </span>

            <div className="pagination-buttons">
              <button
                type="button"
                className="page-btn"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Trang trước"
              >
                <ChevronLeft size={16} />
                <span>Trước</span>
              </button>

              <span className="current-page-pill">{currentPage} / {totalPages}</span>

              <button
                type="button"
                className="page-btn"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                aria-label="Trang sau"
              >
                <span>Sau</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Details Modal */}
      {selectedEvent && (
        <Modal
          title={`Chi tiết sự kiện: ${selectedEvent.action}`}
          isOpen={!!selectedEvent}
          onClose={() => setSelectedEvent(null)}
        >
          <div className="audit-detail-stack">
            <div className="detail-meta-box">
              <div className="detail-row">
                <span className="lbl">Mã sự kiện:</span>
                <strong className="font-mono">{selectedEvent.id}</strong>
              </div>
              <div className="detail-row">
                <span className="lbl">Thời gian chính xác:</span>
                <span>{selectedEvent.at}</span>
              </div>
              <div className="detail-row">
                <span className="lbl">Người thực hiện:</span>
                <strong>{selectedEvent.actorName} ({selectedEvent.actorRole})</strong>
              </div>
              <div className="detail-row">
                <span className="lbl">Đối tượng tác động:</span>
                <span>{selectedEvent.entityType} [ID: {selectedEvent.entityId}]</span>
              </div>
              <div className="detail-row">
                <span className="lbl">Kết quả thực thi:</span>
                <span className={`result-tag ${selectedEvent.result}`}>
                  {selectedEvent.result === 'success' ? 'Thành công' : 'Thất bại'}
                </span>
              </div>
            </div>

            <div className="detail-payload-section">
              <h3 className="section-title">Dữ liệu tham số (Đã khử thông tin nhạy cảm):</h3>
              <pre className="sanitized-json-view">
                {selectedEvent.redactedDetails || '(Không có thông tin chi tiết)'}
              </pre>
            </div>

            <div className="modal-actions-bar">
              <Button type="button" variant="primary" onClick={() => setSelectedEvent(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
