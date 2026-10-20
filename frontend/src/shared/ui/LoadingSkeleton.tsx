import React from 'react';
import './LoadingSkeleton.css';

interface LoadingSkeletonProps {
  lines?: number;
  height?: string;
  className?: string;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  lines = 3,
  height,
  className = '',
}) => {
  return (
    <div className={`skeleton-wrapper ${className}`} aria-busy="true" aria-label="Đang tải dữ liệu...">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton-bar"
          style={{ height: height || undefined, width: i === lines - 1 && lines > 1 ? '70%' : '100%' }}
        />
      ))}
    </div>
  );
};
