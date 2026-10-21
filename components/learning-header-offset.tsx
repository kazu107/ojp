"use client";

import { useEffect } from "react";

export function LearningHeaderOffset() {
  useEffect(() => {
    const header = document.querySelector(".site-header");
    if (!header) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--learning-header-offset",
        `${header.getBoundingClientRect().height + 8}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--learning-header-offset");
    };
  }, []);
  return null;
}
