import type { ReactNode } from "react";
import { Lock, RotateCw } from "lucide-react";
import { DecidMark } from "./brand";

/**
 * The demo businesses' brand marks, decID's "Verify age" button (styled after Apple's Verify with
 * Wallet button: fixed label, black, no QR/NFC glyph, never hidden), illustrated product cans and
 * a browser frame for the demo stage.
 */

export interface MerchantBrand {
  id: string;
  name: string;
  domain: string;
  kind: "online" | "venue";
}

export const HOPLINE: MerchantBrand = { id: "hopline", name: "Hopline", domain: "hopline.example", kind: "online" };
export const NEON_HALL: MerchantBrand = { id: "neonhall", name: "Neon Hall", domain: "neonhall.example", kind: "venue" };
export const brandFor = (id: string, name: string, kind: "online" | "venue"): MerchantBrand => (id === "hopline" ? HOPLINE : id === "neonhall" ? NEON_HALL : { id, name, kind, domain: `${id}.example` });
/** For APIs that name the business but don't give its id (the wallet request). */
export const brandByName = (name: string, kind: "online" | "venue"): MerchantBrand => (name === HOPLINE.name ? HOPLINE : name === NEON_HALL.name ? NEON_HALL : brandFor(name.toLowerCase().replace(/[^a-z0-9]/g, ""), name, kind));

export function MerchantLogo({ merchant, size = 40 }: { merchant: MerchantBrand; size?: number }) {
  if (merchant.id === "hopline") {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" className="shrink-0" aria-hidden>
        <rect width="40" height="40" rx="8" fill="#141414" />
        <text x="20" y="27.5" textAnchor="middle" fontSize="19" fontWeight="800" fill="#F4D23C" className="font-hop" fontStretch="75%">
          HL
        </text>
      </svg>
    );
  }
  if (merchant.id === "neonhall") {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" className="shrink-0" aria-hidden>
        <rect width="40" height="40" rx="8" fill="#0E0B12" />
        <text x="20" y="28.5" textAnchor="middle" fontSize="22" fontWeight="800" fill="#FF3EA5" className="font-neon">
          NH
        </text>
      </svg>
    );
  }
  return (
    <span className="grid shrink-0 place-items-center rounded-md bg-ink-12 text-sm font-semibold text-white" aria-hidden>
      {merchant.name.slice(0, 1)}
    </span>
  );
}

export function VerifyAgeButton({ onClick, busy, testId = "verify-age" }: { onClick: () => void; busy?: boolean; testId?: string }) {
  return (
    <button onClick={onClick} disabled={busy} data-testid={testId} className="press flex h-12 w-full items-center justify-center gap-2.5 rounded-sm bg-black font-sans text-[16px] font-medium text-white hover:bg-[#1f1f1f] disabled:opacity-60">
      <DecidMark size={19} inverted />
      Verify age with decID
    </button>
  );
}

/** A drinks can drawn from a few shapes: body, rims, label band and name. */
export function CanArt({ label, band, ink = "#141414", accent, size = 64 }: { label: string; band: string; ink?: string; accent: string; size?: number }) {
  return (
    <svg width={size * 0.62} height={size} viewBox="0 0 62 100" aria-hidden>
      <defs>
        <linearGradient id={`metal-${label}`} x1="0" x2="1">
          <stop offset="0" stopColor="#c9ccd1" />
          <stop offset="0.35" stopColor="#f4f5f7" />
          <stop offset="0.7" stopColor="#b9bdc3" />
          <stop offset="1" stopColor="#e3e5e8" />
        </linearGradient>
      </defs>
      <rect x="4" y="6" width="54" height="88" rx="7" fill={band} />
      <rect x="4" y="34" width="54" height="34" fill={accent} />
      <path d="M8 6h46l-3-4H11z" fill={`url(#metal-${label})`} />
      <path d="M8 94h46l-3 4H11z" fill={`url(#metal-${label})`} />
      <rect x="4" y="6" width="54" height="88" rx="7" fill="none" stroke="#000" strokeOpacity="0.12" />
      <rect x="10" y="10" width="5" height="80" rx="2.5" fill="#fff" opacity="0.18" />
      <text x="31" y="56" textAnchor="middle" fontSize="13" fontWeight="800" fill={ink} className="font-hop" fontStretch="75%">
        {label}
      </text>
    </svg>
  );
}

/** A minimal browser window, so the demo stage reads as "this is the business's own website". */
export function BrowserFrame({ url, children, onReload }: { url: string; children: ReactNode; onReload?: () => void }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[14px] bg-white shadow-float ring-1 ring-black/5">
      <div className="grid h-11 shrink-0 grid-cols-[60px_minmax(0,1fr)_60px] items-center gap-3 border-b border-ink-4 bg-ink-1 px-3.5">
        <span className="flex gap-2" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </span>
        <div className="mx-auto flex h-7 w-full max-w-[420px] min-w-0 items-center justify-center gap-1.5 rounded-[8px] bg-ink-3 px-3 text-ui text-ink-11">
          <Lock size={11} strokeWidth={2.25} className="shrink-0 text-ink-10" aria-hidden />
          <span className="truncate">{url}</span>
        </div>
        <span className="flex justify-end">
          {onReload && (
            <button onClick={onReload} className="press grid h-7 w-7 place-items-center rounded-full text-ink-10 hover:bg-ink-3" aria-label="Reload page">
              <RotateCw size={14} strokeWidth={1.75} />
            </button>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
