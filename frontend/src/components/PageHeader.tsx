import type { ReactNode } from "react";
import clsx from "clsx";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
  centerMobile?: boolean;
  className?: string;
};

export default function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  centerMobile = true,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={clsx(
        "border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_34%),linear-gradient(180deg,rgba(2,6,23,0.98),rgba(15,23,42,0.94))] px-3 py-3 md:px-6 md:py-4",
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
            <span className="inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/80">
              {eyebrow}
            </span>
          )}
          <h2 className="mt-2 bg-gradient-to-r from-white via-slate-100 to-cyan-300 bg-clip-text text-3xl font-black leading-none tracking-tight text-transparent md:text-[1.75rem]">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center md:w-auto md:min-w-0 md:justify-end">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
