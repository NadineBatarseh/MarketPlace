import { useState, useRef } from 'react';

export function useFieldHint() {
  const [hint, setHint] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (msg: string) => {
    setHint(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHint(''), 2000);
  };

  const clear = () => setHint('');

  return { hint, show, clear };
}
