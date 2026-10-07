import { MAX_HEIGHT } from "../data";

/** `maxHeight` is pixels, or any CSS length — `calc(100dvh - 18rem)` for a frame that fills a screen. */
export function frameStyle(output: { width: number; height: number }, maxHeight: number | string = MAX_HEIGHT): React.CSSProperties {
  if (typeof maxHeight === "string") {
    return { width: "100%", aspectRatio: `${output.width} / ${output.height}`, maxWidth: `calc((${maxHeight}) * ${output.width / output.height})` };
  }
  return {
    width: "100%",
    aspectRatio: `${output.width} / ${output.height}`,
    maxWidth: output.height > output.width ? `${Math.round((maxHeight * output.width) / output.height)}px` : undefined,
  };
}
