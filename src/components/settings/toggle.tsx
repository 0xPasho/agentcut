"use client";
import { cn } from "cn";

/**
 * On or off, with the word beside it: colour alone never carries a state. The input
 * is the real control — hidden visually, not from the keyboard or a screen reader —
 * so the label, the focus ring and Space all work without a line of custom JS.
 */
export function Toggle({ checked, onChange, label, about, disabled, describedBy }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The visible word, which is the state: "On" or "Off". */
  label: string;
  /**
   * What it is on or off for. A switch reached out of context announces its own
   * label and nothing else, and "On" alone is not an answer — so the name keeps the
   * visible word and adds the thing it governs.
   */
  about?: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 py-1.5 text-xs", disabled && "cursor-not-allowed opacity-60")}>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={about ? `${label} for ${about}` : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="relative h-5 w-9 shrink-0 rounded-full bg-foreground/20 transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-background after:transition-transform after:content-[''] peer-checked:after:translate-x-4 motion-reduce:transition-none motion-reduce:after:transition-none"
      />
      <span className="text-muted-foreground peer-checked:text-foreground">{label}</span>
    </label>
  );
}
