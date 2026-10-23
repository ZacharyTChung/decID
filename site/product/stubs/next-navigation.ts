/** Shared components import next/navigation; the hosted prototype has no routes. */
export const usePathname = () => "/";
export const useRouter = () => ({ push: () => undefined, replace: () => undefined });
export const useSearchParams = () => new URLSearchParams();
