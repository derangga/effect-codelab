"use client";

import { useEffect, useId, useRef, useState } from "react";

function useIsDark() {
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() =>
      setDark(el.classList.contains("dark")),
    );
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const dark = useIsDark();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;

    void (async () => {
      // mermaid is ~0.5MB, so it loads only on a page that draws one.
      const mermaid = (await import("mermaid")).default;
      // The reader may have moved on while the import was in flight.
      if (cancelled || !el.isConnected) return;

      mermaid.initialize({
        startOnLoad: false,
        // 'base' is the only mermaid theme that takes palette overrides. The
        // variables follow Catppuccin so diagrams match the site's Latte
        // light and Macchiato dark instead of mermaid's stock defaults.
        theme: "base",
        themeVariables: dark
          ? {
              background: "transparent",
              fontFamily: "inherit",
              textColor: "#cad3f5",
              primaryColor: "#363a4f",
              primaryTextColor: "#cad3f5",
              primaryBorderColor: "#8aadf4",
              secondaryColor: "#1e2030",
              tertiaryColor: "#181926",
              lineColor: "#a5adcb",
            }
          : {
              background: "transparent",
              fontFamily: "inherit",
              textColor: "#4c4f69",
              primaryColor: "#ccd0da",
              primaryTextColor: "#4c4f69",
              primaryBorderColor: "#1e66f5",
              secondaryColor: "#e6e9ef",
              tertiaryColor: "#dce0e8",
              lineColor: "#6c6f85",
            },
      });
      // render() takes the source as an argument, so the diagram redraws from
      // the prop on a theme change rather than from whatever the last draw
      // left in the DOM.
      const { svg } = await mermaid.render(`mermaid-${id}`, chart);
      if (!cancelled) {
        // Parse rather than assign innerHTML: DOMParser does not execute
        // scripts, and the script elements are stripped before the node is
        // adopted, so nothing from the markup can run on insertion. The
        // chart source is build-compiled chapter content, not user data.
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        for (const script of [...doc.querySelectorAll("script")]) {
          script.remove();
        }
        el.replaceChildren(document.importNode(doc.documentElement, true));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, dark, id]);

  return (
    <div
      ref={ref}
      className="my-6 flex justify-center overflow-x-auto rounded-lg border p-6"
    />
  );
}
