import { useState, useRef } from 'react';

interface UseToastResult {
  toast: string;
  toastVisible: boolean;
  showToast: (msg: string) => void;
}

export function useToast(): UseToastResult {
  const [toast, setToast] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  function showToast(msg: string) {
    setToast(msg);
    setToastVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToastVisible(false), 2200);
  }

  return { toast, toastVisible, showToast };
}
