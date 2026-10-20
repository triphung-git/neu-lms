import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from './Button';
import './ErrorBanner.css';

interface ErrorBannerProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  title = 'Đã có lỗi xảy ra',
  message,
  onRetry,
  className = '',
}) => {
  return (
    <div className={`error-banner ${className}`} role="alert">
      <div className="error-icon" aria-hidden="true">
        <AlertCircle size={22} />
      </div>
      <div className="error-content">
        <h4 className="error-title">{title}</h4>
        <p className="error-message">{message}</p>
      </div>
      {onRetry && (
        <div className="error-action">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRetry}
            icon={<RotateCcw size={14} />}
          >
            Thử lại
          </Button>
        </div>
      )}
    </div>
  );
};
