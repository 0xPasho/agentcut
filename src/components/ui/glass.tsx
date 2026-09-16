import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * Liquid Glass.
 *
 * The material is layered: a tint that still lets content through, a lensed edge
 * that bends light around the silhouette, and a specular highlight along the top.
 * `backdrop-saturate` stands in for the way real glass concentrates the colour
 * behind it, which is what keeps it from reading as flat grey.
 *
 * Two rules from Apple that this component cannot enforce for you:
 *  - Glass belongs to the navigation layer. Content surfaces stay solid, or the
 *    hierarchy muddies.
 *  - Never put glass on glass. Inside a glass container use fills and vibrancy.
 */
const glassVariants = cva(
  [
    "relative isolate",
    "border border-[var(--glass-edge)]",
    // Specular highlight along the top edge, plus a soft ambient shadow that
    // separates the material from whatever is behind it.
    "shadow-[inset_0_1px_0_0_var(--glass-specular),0_8px_32px_-8px_rgb(0_0_0/0.55)]",
    // Reduce Transparency: frostier, obscuring more of the content behind.
    "reduce-transparency:backdrop-blur-none reduce-transparency:bg-popover",
    // Increase Contrast: predominantly solid, with a contrasting border.
    "more-contrast:bg-popover more-contrast:border-foreground/60",
  ],
  {
    variants: {
      variant: {
        /** Legible over anything. The default, and what you want almost always. */
        regular:
          "bg-[var(--glass-tint)] backdrop-blur-[var(--glass-blur)] backdrop-saturate-[1.8]",
        /**
         * Only over media-rich content, and only with the dimming layer — without
         * it legibility falls apart. Never mixed with regular in the same view.
         */
        clear:
          "bg-black/25 backdrop-blur-sm backdrop-saturate-[1.6] backdrop-brightness-[0.85]",
      },
      shape: {
        capsule: "rounded-full",
        /** Concentric: nested radii are the parent's radius minus the padding. */
        panel: "rounded-3xl",
        card: "rounded-2xl",
      },
      /** Larger glass simulates a thicker material: deeper shadow, more lensing. */
      thickness: {
        thin: "",
        thick:
          "backdrop-blur-[calc(var(--glass-blur)*1.5)] shadow-[inset_0_1px_0_0_var(--glass-specular),0_20px_60px_-12px_rgb(0_0_0/0.7)]",
      },
    },
    defaultVariants: { variant: "regular", shape: "panel", thickness: "thin" },
  },
);

function Glass({
  className,
  variant,
  shape,
  thickness,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof glassVariants>) {
  return (
    <div
      data-slot="glass"
      className={cn(glassVariants({ variant, shape, thickness }), className)}
      {...props}
    />
  );
}

/**
 * Scroll edge effect: content dissolves into the background as it passes under a
 * glass element, instead of meeting it at a hard divider. Apple's rule is one
 * effect per scrolling view — don't stack them.
 */
function ScrollEdge({
  className,
  edge = "top",
  ...props
}: React.ComponentProps<"div"> & { edge?: "top" | "bottom" }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 h-12",
        edge === "top"
          ? "top-0 bg-gradient-to-b from-background to-transparent"
          : "bottom-0 bg-gradient-to-t from-background to-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Glass, ScrollEdge, glassVariants };
