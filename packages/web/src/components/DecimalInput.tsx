import { useEffect, useRef, useState } from 'react';
import { formatDecimalInput, parseDecimalInput } from '@dutoan/core';

/**
 * Number input for take-off values that accepts BOTH the Vietnamese decimal comma and the dot ("1,8" = "1.8" = 1,8)
 * and always shows the value back with a comma. A text input on purpose: `type="number"` silently dropped the comma
 * ("1,8" became 18). Invalid text is never dropped or guessed – it stays in the box, marked red with an explanation,
 * and is not committed.
 */
export function DecimalInput({
  value,
  onChange,
  onCommit,
  integer,
  min,
  testId,
  title,
  placeholder,
  className,
}: {
  value: number;
  /** Called on every keystroke that yields a valid number. */
  onChange?: (n: number) => void;
  /** Called on blur / Enter with the valid number (not called while the text is invalid). */
  onCommit?: (n: number) => void;
  integer?: boolean;
  min?: number;
  testId?: string;
  title?: string;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(() => formatDecimalInput(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(formatDecimalInput(value));
  }, [value]);

  const check = (t: string): { n: number | null; error: string } => {
    const n = parseDecimalInput(t);
    if (n === null) return { n, error: t.trim() ? `“${t}” không phải số hợp lệ – nhập dạng 1,8 hoặc 1.8` : 'Chưa nhập giá trị' };
    if (integer && !Number.isInteger(n)) return { n: null, error: 'Phải là số nguyên' };
    if (min !== undefined && n < min) return { n: null, error: `Giá trị tối thiểu là ${formatDecimalInput(min)}` };
    return { n, error: '' };
  };
  const { error } = check(text);

  const commit = () => {
    const { n } = check(text);
    if (n === null) return;
    setText(formatDecimalInput(n));
    onCommit?.(n);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      data-testid={testId}
      className={`decimal-input${error ? ' invalid' : ''}${className ? ` ${className}` : ''}`}
      aria-invalid={!!error}
      title={error || title}
      placeholder={placeholder}
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        const { n } = check(e.target.value);
        if (n !== null) onChange?.(n);
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}
