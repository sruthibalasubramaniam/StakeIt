import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';
import { MaterialIcon } from './core';

const CONTROL_BASE =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-space-md text-body-md text-on-surface ' +
  'placeholder:text-[#94A3B8] transition-shadow ' +
  'focus:border-primary-container focus:outline-none focus:ring-2 focus:ring-primary-container/10 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-[#94A3B8]';

const CONTROL_HEIGHT = 'h-9';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="font-label-sm text-label-sm text-on-surface">
          {label}
          {required ? <span className="ml-0.5 text-error">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="flex items-center gap-1 font-body-sm text-body-sm text-error">
          <MaterialIcon name="error" className="text-[14px]" />
          {error}
        </p>
      ) : hint ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  icon?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, className, id, required, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required}>
      <div className="relative">
        {icon ? (
          <MaterialIcon name={icon} className="pointer-events-none absolute left-space-md top-1/2 -translate-y-1/2 text-on-surface-variant" />
        ) : null}
        <input
          ref={ref}
          id={inputId}
          required={required}
          className={cn(
            CONTROL_BASE,
            CONTROL_HEIGHT,
            icon && 'pl-9',
            error && 'border-error focus:border-error focus:ring-error/10',
            className,
          )}
          {...rest}
        />
      </div>
    </Field>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, required, rows = 4, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        required={required}
        className={cn(CONTROL_BASE, 'py-space-sm leading-relaxed', error && 'border-error', className)}
        {...rest}
      />
    </Field>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, id, options, placeholder, required, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required}>
      <select
        ref={ref}
        id={inputId}
        required={required}
        className={cn(CONTROL_BASE, CONTROL_HEIGHT, 'pr-space-lg', error && 'border-error', className)}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
});

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
  className,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-space-sm', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded-sm border-[1.5px] border-[#CBD5E1] text-primary-container accent-[#4338CA] disabled:cursor-not-allowed"
      />
      <div className="flex flex-col">
        <label htmlFor={id} className={cn('font-label-md text-label-md', disabled ? 'text-[#94A3B8]' : 'text-on-surface')}>
          {label}
        </label>
        {hint ? <span className="font-body-sm text-body-sm text-on-surface-variant">{hint}</span> : null}
      </div>
    </div>
  );
}

export function Radio({
  label,
  detail,
  name,
  value,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  detail?: string | null;
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-space-md rounded px-space-md py-space-sm transition-colors',
        checked ? 'bg-primary-fixed/50' : 'hover:bg-surface-container-low',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 h-4 w-4 border-[1.5px] border-[#CBD5E1] text-primary-container accent-[#4338CA]"
      />
      <span className="flex flex-col">
        <span className="font-label-md text-label-md text-on-surface">{label}</span>
        {detail ? <span className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{detail}</span> : null}
      </span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-space-lg">
      {label || description ? (
        <div className="flex flex-col">
          {label ? (
            <label htmlFor={id} className="font-label-md text-label-md text-on-surface">
              {label}
            </label>
          ) : null}
          {description ? <span className="font-body-sm text-body-sm text-on-surface-variant">{description}</span> : null}
        </div>
      ) : null}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ?? 'Toggle'}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
          checked ? 'border-primary-container bg-primary-container' : 'border-outline-variant bg-surface-container-high',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-surface-container-lowest transition-all',
            checked ? 'left-[1.15rem]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}

/** Accessible star rating bound to a numeric value. */
export function RatingInput({
  value,
  onChange,
  max = 5,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {Array.from({ length: max }, (_, index) => index + 1).map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} of ${max}`}
          disabled={disabled}
          onClick={() => onChange(star)}
          className={cn('transition-colors', disabled ? 'cursor-not-allowed' : 'hover:text-primary-container')}
        >
          <MaterialIcon
            name="star"
            filled={star <= value}
            className={cn('text-[20px]', star <= value ? 'text-primary-container' : 'text-outline-variant')}
          />
        </button>
      ))}
      <span className="ml-1 font-mono text-label-sm tabular text-on-surface-variant">
        {value}/{max}
      </span>
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  className,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onSubmit?: () => void;
}) {
  return (
    <form
      className={cn('relative', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <MaterialIcon name="search" className="pointer-events-none absolute left-space-md top-1/2 -translate-y-1/2 text-on-surface-variant" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(CONTROL_BASE, CONTROL_HEIGHT, 'pl-9')}
      />
    </form>
  );
}
