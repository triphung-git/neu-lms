import {uiText} from "../i18n/translate";
import React from 'react';
import './Badge.css';

export type BadgeVariant =
  | 'draft'
  | 'published'
  | 'closed'
  | 'archived'
  | 'processing'
  | 'ready'
  | 'error'
  | 'no-text'
  | 'submitted'
  | 'late'
  | 'in-progress'
  | 'graded'
  | 'active'
  | 'locked'
  | 'pending'
  | 'withdrawn'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

interface BadgeProps {
  variant: BadgeVariant;
  label?: string;
  className?: string;
  children?: React.ReactNode;
}

const defaultLabels: Record<BadgeVariant, string> = {
  draft: uiText("Bản nháp"),
  published: uiText("Đã công bố"),
  closed: uiText("Đã đóng nộp"),
  archived: uiText("Đã lưu trữ"),
  processing: uiText("Đang xử lý"),
  ready: uiText("Sẵn sàng AI"),
  error: uiText("Lỗi xử lý"),
  'no-text': uiText("Không có văn bản"),
  submitted: uiText("Đã nộp"),
  late: uiText("Nộp muộn"),
  'in-progress': uiText("Đang chấm"),
  graded: uiText("Đã chấm"),
  active: uiText("Hoạt động"),
  locked: uiText("Đã khóa"),
  pending: uiText("Chờ kích hoạt"),
  withdrawn: uiText("Đã rút"),
  success: uiText("Thành công"),
  warning: uiText("Cảnh báo"),
  danger: uiText("Lỗi"),
  info: uiText("Thông tin"),
  neutral: uiText("Mặc định"),
};

export const Badge: React.FC<BadgeProps> = ({ variant, label, className = '', children }) => {
  const text = label || children || defaultLabels[variant];

  return (
    <span className={`badge badge-${variant} ${className}`}>
      <span className="badge-dot" aria-hidden="true" />
      <span className="badge-text">{text}</span>
    </span>
  );
};
