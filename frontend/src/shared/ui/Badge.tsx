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
  draft: 'Bản nháp',
  published: 'Đã công bố',
  closed: 'Đã đóng nộp',
  archived: 'Đã lưu trữ',
  processing: 'Đang xử lý',
  ready: 'Sẵn sàng AI',
  error: 'Lỗi xử lý',
  'no-text': 'Không có văn bản',
  submitted: 'Đã nộp',
  late: 'Nộp muộn',
  'in-progress': 'Đang chấm',
  graded: 'Đã chấm',
  active: 'Hoạt động',
  locked: 'Đã khóa',
  pending: 'Chờ kích hoạt',
  withdrawn: 'Đã rút',
  success: 'Thành công',
  warning: 'Cảnh báo',
  danger: 'Lỗi',
  info: 'Thông tin',
  neutral: 'Mặc định',
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
