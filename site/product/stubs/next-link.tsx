import type { AnchorHTMLAttributes, ReactNode } from "react";

/** The hosted prototype has no router: links inside shared components are plain anchors. */
export default function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a href={href.startsWith("http") ? href : "#"} {...rest}>
      {children}
    </a>
  );
}
