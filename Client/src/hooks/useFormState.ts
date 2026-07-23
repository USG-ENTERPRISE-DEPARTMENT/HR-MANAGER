import { useState, useRef } from 'react';
import type { ChangeEvent } from 'react';

export function useFormState<T extends Record<string, any>>(
  initialState: T,
  initialData?: T | null
) {
  const [formData, setFormData] = useState<T>(
    initialData ? { ...initialState, ...initialData } : initialState
  );

  // Keep a stable ref so callers can reset to the seed data without
  // the effect-based pattern that caused re-resets in Strict Mode.
  const seedRef = useRef<T>(
    initialData ? ({ ...initialState, ...initialData } as T) : initialState
  );

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => setFormData(seedRef.current);

  return { formData, handleChange, setFormData, resetForm };
}
