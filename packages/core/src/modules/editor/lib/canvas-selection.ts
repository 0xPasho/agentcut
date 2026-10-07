import type { Box } from "./canvas";

export const sameBox = (a: Box, b: Box) => (Object.keys(a) as (keyof Box)[]).every(key => Math.abs(a[key] - b[key]) < .1);
