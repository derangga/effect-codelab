'use client';

import { useEffect, useId, useRef, useState } from 'react';

function useIsDark() {
  const [dark, setDark] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() =>
      setDark(el.classList.contains('dark')),
    );
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  const dark = useIsDark();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;

    void (async () => {
      // mermaid is ~0.5MB, so it loads only on a page that draws one.
      const mermaid = (await import('mermaid')).default;
      // The reader may have moved on while the import was in flight.
      if (cancelled || !el.isConnected) return;

      mermaid.initialize({
        startOnLoad: false,
        theme: dark ? 'dark' : 'default',
      });
      // render() takes the source as an argument, so the diagram redraws from
      // the prop on a theme change rather than from whatever the last draw
      // left in the DOM.
      const { svg } = await mermaid.render(`mermaid-${id}`, chart);
      if (!cancelled) el.innerHTML = svg;
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, dark, id]);

  return <div ref={ref} className="my-6 flex justify-center" />;
}
