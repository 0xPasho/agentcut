// Jump card: a lower third early in the video telling the viewer at what minute the
// test starts. The minute is read off the timeline every time, so it is never stale.
import { placeJump } from "./lib/showcase.mjs";

export default async function jumpCard(ctx) {
  const result = await placeJump(ctx, ctx.params);
  ctx.log(`jump card: "${ctx.params.lead} ${result.time}" at ${result.at} s for ${result.duration} s`);
  return result;
}
