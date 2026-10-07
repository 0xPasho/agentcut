/**
 * How early a shot's video element is mounted so it can load before it is seen.
 *
 * A cut — the joint between two shots, or the splice a silence leaves behind — mounts a
 * new `<video>` on the source. In the Player that element starts from nothing: it reads
 * the recording's header, seeks to a point that can be hours in, and shows black until a
 * frame decodes. Premounting renders the shot ahead of time, frozen on its first frame
 * and invisible, so the seek happens while the previous shot is still playing and the cut
 * lands on a picture.
 *
 * Two seconds rather than Remotion's one: the sources here are multi-hour recordings, and
 * a first seek into one was measured in whole seconds, not frames. Remotion ignores this
 * entirely while rendering — an export extracts frames off-thread and has no such gap.
 */
export const PREMOUNT_SEC = 2;

export const premountFrames = (fps: number) => Math.round(PREMOUNT_SEC * fps);
