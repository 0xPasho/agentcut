import { useState, useEffect } from "react";

/** Listen before placing. One element for the whole panel: two sounds at once tell you nothing. */
export function useAudition() {
  const [playing, setPlaying] = useState<HTMLAudioElement | null>(null);
  useEffect(() => () => playing?.pause(), [playing]);
  return (url: string) => {
    playing?.pause();
    const element = new Audio(url);
    setPlaying(element);
    void element.play().catch(() => {});
  };
}
