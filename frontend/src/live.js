import { useEffect, useRef } from 'react';

export function useLiveReload(resources, reload) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const key = resources.join('|');

  useEffect(() => {
    if (!key) return undefined;
    const names = key.split('|');
    let timer;
    const onSync = (event) => {
      const changed = event.detail?.changed || [];
      if (!changed.some((item) => names.includes(item))) return;
      clearTimeout(timer);
      timer = setTimeout(() => reloadRef.current(), 200);
    };
    window.addEventListener('fbms:sync', onSync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('fbms:sync', onSync);
    };
  }, [key]);
}
