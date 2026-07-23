import { TextareaHTMLAttributes } from 'react';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxChars?: number;
  wrapperClassName?: string;
}

/**
 * Drop-in replacement for <textarea>.
 * Renders a character counter below the field.
 * Pass maxChars to set a soft/hard limit (also applied as maxLength).
 */
export function CountedTextarea({ maxChars, wrapperClassName = '', className, value, onChange, ...rest }: Props) {
  const count = typeof value === 'string' ? value.length : 0;
  const limited = maxChars != null;
  const remaining = limited ? maxChars - count : null;

  const counterColor =
    remaining == null         ? 'text-[var(--text-muted)]'
    : remaining <= 0          ? 'text-red-500 font-semibold'
    : remaining <= maxChars! * 0.1 ? 'text-amber-500 font-medium'
    : 'text-[var(--text-muted)]';

  return (
    <div className={`flex flex-col ${wrapperClassName}`}>
      <textarea
        className={className}
        value={value}
        onChange={onChange}
        maxLength={maxChars}
        {...rest}
      />
      <span className={`text-[10.5px] text-right mt-0.5 select-none ${counterColor}`}>
        {limited
          ? `${count} / ${maxChars}`
          : count > 0 ? `${count} chars` : ''}
      </span>
    </div>
  );
}
