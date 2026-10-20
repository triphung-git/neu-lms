import React from 'react';
import './TextField.css';

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export const TextField: React.FC<TextFieldProps> = ({
  label,
  error,
  helperText,
  id,
  required,
  className = '',
  ...props
}) => {
  const inputId = id || `input-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;

  return (
    <div className={`field-group ${error ? 'field-has-error' : ''} ${className}`}>
      <label htmlFor={inputId} className="field-label">
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </label>
      <input
        id={inputId}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : helperText ? helperId : undefined}
        className="field-input"
        {...props}
      />
      {error && (
        <span id={errorId} className="field-error-text" role="alert">
          {error}
        </span>
      )}
      {!error && helperText && (
        <span id={helperId} className="field-helper-text">
          {helperText}
        </span>
      )}
    </div>
  );
};

export interface TextAreaFieldProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export const TextAreaField: React.FC<TextAreaFieldProps> = ({
  label,
  error,
  helperText,
  id,
  required,
  className = '',
  rows = 4,
  ...props
}) => {
  const inputId = id || `textarea-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;

  return (
    <div className={`field-group ${error ? 'field-has-error' : ''} ${className}`}>
      <label htmlFor={inputId} className="field-label">
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </label>
      <textarea
        id={inputId}
        required={required}
        rows={rows}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : helperText ? helperId : undefined}
        className="field-input field-textarea"
        {...props}
      />
      {error && (
        <span id={errorId} className="field-error-text" role="alert">
          {error}
        </span>
      )}
      {!error && helperText && (
        <span id={helperId} className="field-helper-text">
          {helperText}
        </span>
      )}
    </div>
  );
};

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  helperText?: string;
  options: { value: string; label: string }[];
}

export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  error,
  helperText,
  options,
  id,
  required,
  className = '',
  ...props
}) => {
  const inputId = id || `select-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;

  return (
    <div className={`field-group ${error ? 'field-has-error' : ''} ${className}`}>
      <label htmlFor={inputId} className="field-label">
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </label>
      <select
        id={inputId}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : helperText ? helperId : undefined}
        className="field-input field-select"
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <span id={errorId} className="field-error-text" role="alert">
          {error}
        </span>
      )}
      {!error && helperText && (
        <span id={helperId} className="field-helper-text">
          {helperText}
        </span>
      )}
    </div>
  );
};
