"use client";

import { useEffect, useRef } from "react";

export function DetailHeading(props: { children: React.ReactNode; className?: string; id?: string; level?: 1 | 2 }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  if (props.level === 2) {
    return <h2 ref={headingRef} id={props.id} tabIndex={-1} className={props.className}>{props.children}</h2>;
  }
  return <h1 ref={headingRef} id={props.id} tabIndex={-1} className={props.className}>{props.children}</h1>;
}
