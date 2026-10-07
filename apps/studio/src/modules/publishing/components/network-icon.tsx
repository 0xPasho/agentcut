import { Camera, Music2, SquarePlay } from "lucide-react";
import type { Network } from "@agentcut/core/modules/publishing/types";

export function NetworkIcon({
  network,
  className = "size-4",
}: {
  network: Network;
  className?: string;
}) {
  if (network === "youtube")
    return <SquarePlay aria-hidden className={className} strokeWidth={1.5} />;
  if (network === "instagram")
    return <Camera aria-hidden className={className} strokeWidth={1.5} />;
  return <Music2 aria-hidden className={className} strokeWidth={1.5} />;
}
