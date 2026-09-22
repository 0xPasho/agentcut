export const asNumber = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));
