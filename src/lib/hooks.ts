import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { todayISO } from './date';
import { buildDayIndex } from './dayIndex';

/** Today's date that rolls over at midnight. */
export function useToday() {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const t = setInterval(() => setToday((cur) => (cur === todayISO() ? cur : todayISO())), 30_000);
    return () => clearInterval(t);
  }, []);
  return today;
}

export function useDayIndex() {
  const entities = useStore((s) => s.entities);
  return useMemo(() => buildDayIndex(entities), [entities]);
}

export function useIsMobile() {
  const q = '(max-width: 760px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}
