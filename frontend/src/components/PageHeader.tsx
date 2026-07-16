import type { ReactNode } from "react";
import clsx from "clsx";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  mobileBadge?: ReactNode;
  actions?: ReactNode;
  centerMobile?: boolean;
  className?: string;
};

export default function PageHeader({
  title,
  subtitle,
  eyebrow,
  mobileBadge,
  actions,
  centerMobile = true,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={clsx(
        "border-b border-hairline bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_36%),linear-gradient(180deg,rgba(2,6,23,0.6),rgba(15,23,42,0.4))] px-3 py-3 md:px-6 md:py-4",
        className,
      )}
    >
      <div
        className={clsx(
          "flex flex-col gap-3 md:flex-row md:items-end md:justify-between",
          centerMobile ? "items-center text-center md:items-end md:text-left" : "items-start text-left",
        )}
      >
        <div className="min-w-0">
          {eyebrow && (
            <span
              className="hidden md:inline-flex rounded-pill border px-[10px] py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[#7cc4ff]"
              style={{ borderColor: "rgba(56,189,248,0.22)", background: "rgba(56,189,248,0.10)" }}
            >
              {eyebrow}
            </span>
          )}
          <div className="mt-2 flex items-center gap-2.5">
            <h2 className="text-3xl font-black leading-none tracking-tight text-ink md:text-[1.75rem]">
              {title}
            </h2>
            {mobileBadge && (
              <div className="md:hidden">{mobileBadge}</div>
            )}
          </div>
          {subtitle && (
            <p className="mt-1.5 hidden max-w-2xl text-[13.5px] text-ink-muted md:block">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="hidden w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center md:flex md:w-auto md:min-w-0 md:justify-end">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
