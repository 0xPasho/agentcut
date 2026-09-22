import { FAV_KEY } from "../data";

export const readFavourites = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? "{}") as Record<string, string>; }
  catch { return {}; }
};
