"use client";

import { useEffect, useRef } from "react";

export function DetailHeading(props: { children: React.ReactNode; className?: string; id?: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <h1 ref={headingRef} id={props.id} tabIndex={-1} className={props.className}>
      {props.children}
    </h1>
  );
}
