import { MAX_HEIGHT } from "../data";

export function frameStyle(output: { width: number; height: number }): React.CSSProperties {
  return {
    width: "100%",
    aspectRatio: `${output.width} / ${output.height}`,
    maxWidth: output.height > output.width ? `${Math.round((MAX_HEIGHT * output.width) / output.height)}px` : undefined,
  };
}
