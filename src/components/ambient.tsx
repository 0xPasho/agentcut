/**
 * Liquid Glass has nothing to do on a flat background: the material is defined by
 * what it bends and concentrates. This is the content layer's ambient light —
 * soft colour fields the glass above can lens, so the edges and specular read.
 *
 * It sits behind everything and never intersects content, so it costs no
 * legibility. Apple's sidebars pick up the same kind of spill from nearby colour.
 */
export function Ambient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div className="absolute -top-[20%] -left-[10%] size-[55vw] rounded-full bg-primary/12 blur-[120px]" />
      <div className="absolute top-[30%] -right-[15%] size-[50vw] rounded-full bg-[oklch(0.6_0.18_265)]/12 blur-[130px]" />
      <div className="absolute -bottom-[25%] left-[20%] size-[45vw] rounded-full bg-[oklch(0.65_0.16_25)]/10 blur-[140px]" />
      {/* A faint grid gives the lensing something with structure to distort. */}
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage:
            "linear-gradient(to right, oklch(1 0 0 / 4%) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 4%) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
    </div>
  );
}
