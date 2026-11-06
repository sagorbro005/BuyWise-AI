'use client';

import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  const apply = useCallback((darkMode: boolean) => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    setDark(darkMode);
  }, []);

  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    function sync() {
      let preference: string | null = null;
      try { preference = localStorage.getItem('buywise-theme'); } catch {}
      apply(preference === 'dark' || (preference !== 'light' && system.matches));
    }
    sync();
    system.addEventListener('change', sync);
    window.addEventListener('storage', sync);
    return () => {
      system.removeEventListener('change', sync);
      window.removeEventListener('storage', sync);
    };
  }, [apply]);

  function toggle() {
    const next = document.documentElement.dataset.theme !== 'dark';
    apply(next);
    try { localStorage.setItem('buywise-theme', next ? 'dark' : 'light'); } catch {}
  }

  return <button type="button" className="theme-switch" role="switch" aria-label="Dark mode" aria-checked={dark}
    title={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggle}>
    <Sun size={16} className="sun-icon" aria-hidden="true"/>
    <Moon size={16} className="moon-icon" aria-hidden="true"/>
  </button>;
}
