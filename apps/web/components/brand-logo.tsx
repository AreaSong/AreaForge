import Image from "next/image";

const BRAND_LOCKUP = "/brand/areaforge-logo-lockup.svg";
const BRAND_MARK = "/brand/areaforge-logo-mark.svg";

export function BrandLogo({ priority = false }: { priority?: boolean }) {
  return (
    <Image
      alt="AreaForge"
      className="h-12 w-auto"
      height={52}
      priority={priority}
      src={BRAND_LOCKUP}
      width={160}
    />
  );
}

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className="shrink-0"
      height={size}
      src={BRAND_MARK}
      width={size}
    />
  );
}

export function BrandBreadcrumb({
  section,
  className = "text-teal-300",
}: {
  section?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      <BrandMark />
      <span>{section ? `AreaForge / ${section}` : "AreaForge"}</span>
    </div>
  );
}
