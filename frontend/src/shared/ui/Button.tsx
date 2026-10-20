import React from 'react';
import { Loader2 } from 'lucide-react';
import './Button.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  disabledReason?: string;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabledReason,
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const isDisabled = disabled || isLoading || Boolean(disabledReason);

  return (
    <div className="btn-wrapper" title={disabledReason}>
      <button
        className={`btn btn-${variant} btn-${size} ${isLoading ? 'btn-loading' : ''} ${className}`}
        disabled={isDisabled}
        aria-describedby={disabledReason ? `${props.id || 'btn'}-reason` : undefined}
        {...props}
      >
        {isLoading && <Loader2 className="btn-spinner" size={16} aria-hidden="true" />}
        {!isLoading && icon && <span className="btn-icon" aria-hidden="true">{icon}</span>}
        <span className="btn-text">{children}</span>
      </button>
      {disabledReason && (
        <span id={`${props.id || 'btn'}-reason`} className="sr-only">
          {disabledReason}
        </span>
      )}
    </div>
  );
};
