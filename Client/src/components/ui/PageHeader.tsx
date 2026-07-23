interface PageHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
}

export function PageHeader({ title, subtitle, className = 'mb-6' }: PageHeaderProps) {
  return (
    <div className={className}>
      <h2 className="text-lg sm:text-[22px] font-bold syne text-[var(--text-primary)] tracking-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="text-xs sm:text-[13px] text-[var(--text-muted)] mt-1 font-medium">{subtitle}</p>
      )}
    </div>
  );
}
