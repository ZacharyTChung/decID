"use client";

import { HoplineCheckout } from "@/components/product/checkout";
import { useHttpAgeCheck } from "@/components/demo/use-age-check";

/**
 * Hopline: a demo online drinks shop that uses decID Verify for its 21+ checkout. Everything
 * Hopline knows about the customer's age comes from its own backend's call to decID
 * (src/app/api/demo/[merchant]), which the page shows verbatim.
 */
export default function Shop() {
  return <HoplineCheckout check={useHttpAgeCheck("hopline")} />;
}
