import React from 'react';
import { formatFileSize } from '../kernel/formatting';
import './QuotaGaugeBar.css';

export interface QuotaGaugeBarProps {
  usedBytes: number;
  totalBytes: number;
  reservedBytes?: number;
  className?: string;
}

export const QuotaGaugeBar: React.FC<QuotaGaugeBarProps> = ({
  usedBytes,
  totalBytes,
  reservedBytes = 0,
  className = '',
}) => {
  const safeTotal = totalBytes > 0 ? totalBytes : 1;
  const usedRatio = Math.max(0, Math.min(1, usedBytes / safeTotal));
  const usedPercent = Math.round(usedRatio * 100);

  const reservedRatio = Math.max(0, Math.min(1 - usedRatio, reservedBytes / safeTotal));
  const reservedPercent = Math.round(reservedRatio * 100);

  let statusClass = 'gauge-normal';
  let badgeVariant = 'badge-normal';
  if (usedPercent >= 90) {
    statusClass = 'gauge-danger';
    badgeVariant = 'badge-danger';
  } else if (usedPercent >= 70) {
    statusClass = 'gauge-warning';
    badgeVariant = 'badge-warning';
  }

  return (
    <div className={`quota-gauge-container ${statusClass} ${className}`.trim()} data-testid="quota-gauge-bar">
      <div className="quota-gauge-header">
        <div className="quota-gauge-title-group">
          <span className="quota-gauge-title">Dung lượng môn học</span>
          <span className={`quota-gauge-badge ${badgeVariant}`}>
            {usedPercent}%
          </span>
        </div>
        <div className="quota-gauge-numbers" data-testid="quota-gauge-numbers">
          <strong className="quota-used">{formatFileSize(usedBytes)}</strong>
          <span className="quota-separator">/</span>
          <span className="quota-total">{formatFileSize(totalBytes)}</span>
        </div>
      </div>

      <div
        className="quota-progress-track"
        role="progressbar"
        aria-valuenow={usedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Thanh đo dung lượng môn học"
      >
        <div
          className="quota-progress-fill used"
          style={{ width: `${usedPercent}%` }}
          data-testid="quota-progress-fill"
        />
        {reservedPercent > 0 && (
          <div
            className="quota-progress-fill reserved"
            style={{ width: `${reservedPercent}%` }}
            title={`Đang giữ chỗ: ${formatFileSize(reservedBytes)}`}
            data-testid="quota-progress-reserved"
          />
        )}
      </div>

      <div className="quota-gauge-footer">
        <span className="quota-note">Trần hệ thống tối đa 5,0 GB cho mỗi môn học</span>
        {reservedBytes > 0 && (
          <span className="quota-reserved-note">
            Đang giữ chỗ: {formatFileSize(reservedBytes)}
          </span>
        )}
      </div>
    </div>
  );
};
