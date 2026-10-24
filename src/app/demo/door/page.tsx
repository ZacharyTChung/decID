"use client";

import { NeonHallDoor } from "@/components/product/door";
import { useHttpAgeCheck } from "@/components/demo/use-age-check";

/**
 * Neon Hall: a demo 21+ venue's door screen. The QR code is a decID request created by Neon
 * Hall's backend; a guest scans it with decID Pass, and the screen shows the verdict and the
 * same match code as the guest's phone.
 */
export default function Door() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0e0b12]">
      <NeonHallDoor check={useHttpAgeCheck("neonhall")} className="flex-1" />
    </div>
  );
}
