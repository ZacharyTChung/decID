/**
 * The decID mark: a seal that is half filled. It stands for selective disclosure: the
 * credential stays whole, and only the part a business needs is shown.
 */
export function DecidMark({ size = 20, className = "", inverted = false }: { size?: number; className?: string; inverted?: boolean }) {
  const fg = inverted ? "#fff" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <circle cx="12" cy="12" r="9.25" fill="none" stroke={fg} strokeWidth="1.75" />
      <path d="M12 5.5a6.5 6.5 0 0 1 0 13z" fill={fg} />
    </svg>
  );
}

export function DecidWordmark({ className = "", product }: { className?: string; product?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <DecidMark size={20} />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">
        decID{product && <span className="font-normal text-ink-10"> {product}</span>}
      </span>
    </span>
  );
}
