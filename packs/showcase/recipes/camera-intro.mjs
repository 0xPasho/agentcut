// Camera intro: the first shot of the video opens on the speaker full screen, holds,
// then eases down into the corner where the camera always sits and lands on it exactly.
import { placeCamera } from "./lib/showcase.mjs";

export default async function cameraIntro(ctx) {
  const result = await placeCamera(ctx, ctx.params);
  ctx.log(`camera: full screen at ${result.at.toFixed(1)} s for ${result.hold} s, then into its corner`);
  return result;
}
