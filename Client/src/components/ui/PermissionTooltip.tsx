import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import { describePermission, formatPermission } from '@/lib/permissionGroups';

type Position = { left: number; top: number; below: boolean };

export function PermissionTooltip({ permission, children, showIcon = true }: {
  permission: string;
  children?: ReactNode;
  showIcon?: boolean;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [position, setPosition] = useState<Position | null>(null);
  const description = describePermission(permission);

  const show = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const halfWidth = 144;
    const left = Math.min(window.innerWidth - halfWidth - 12, Math.max(halfWidth + 12, rect.left + rect.width / 2));
    const below = rect.top < 100;
    setPosition({ left, top: below ? rect.bottom + 8 : rect.top - 8, below });
  };

  return (
    <>
      <span
        ref={anchor}
        className="inline-flex min-w-0 items-center gap-1.5"
        aria-describedby={position ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setPosition(null)}
        onFocusCapture={show}
        onBlurCapture={() => setPosition(null)}
      >
        {children ?? <span>{formatPermission(permission)}</span>}
        {showIcon && <CircleHelp size={12} className="shrink-0 opacity-55" aria-hidden="true" />}
      </span>
      {position && createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-[300] w-[288px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-left text-[11px] font-medium leading-relaxed text-white shadow-xl"
          style={{
            left: position.left,
            top: position.top,
            transform: position.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
        >
          <strong className="mb-0.5 block text-[11px] font-bold text-white">{formatPermission(permission)}</strong>
          <span className="text-slate-200">{description}</span>
        </span>,
        document.body,
      )}
    </>
  );
}
