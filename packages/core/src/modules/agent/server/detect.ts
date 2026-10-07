import { harnessBinary } from "./binary";
import { probeAuth, usable, type AuthState } from "./auth";
import { HARNESSES, type HarnessId } from "../lib/registry";
import { catalogFor } from "./model-cache";
import type { ModelInfo } from "../lib/model-catalog";

/**
 * What one harness looks like on THIS machine: is the binary there, is anybody
 * signed in, and which models can be picked.
 *
 * `ready` is the single thing the UI enables a row on. It folds in the auth
 * lean documented in auth.ts — `unknown` is treated as signed in — so no caller
 * has to re-derive that policy and get it subtly different.
 */
export type HarnessStatus = {
  id: HarnessId;
  label: string;
  /** Absolute path we would spawn, or null when nothing resolved. */
  binary: string | null;
  installed: boolean;
  authState: AuthState;
  accountLabel?: string;
  /** Installed and not known to be signed out. */
  ready: boolean;
  /** Why the row is disabled, empty when it is not. */
  reason: string;
  inheritLabel: string;
  models: ModelInfo[];
  /** Whether those models came from the CLI or from the curated fallback. */
  modelSource: "curated" | "cli";
  modelsFetchedAt: number;
};

function reasonFor(installed: boolean, authState: AuthState, label: string, bin: string): string {
  if (!installed) return `${label} is not installed — no \`${bin}\` on PATH`;
  if (authState === "unauthenticated") return `${label} is installed but signed out`;
  return "";
}

/** Everything about one harness, models included. */
export async function harnessStatus(id: HarnessId): Promise<HarnessStatus> {
  const entry = HARNESSES.find((h) => h.id === id);
  if (!entry) throw new Error(`unknown harness: ${id}`);
  const binary = harnessBinary(entry);
  const installed = binary !== null;
  // Probing credentials for a CLI that is not installed answers a question
  // nobody asked, and on a cold disk it is the slow part of this call.
  const probe = installed ? await probeAuth(id) : { authState: "unknown" as AuthState };
  const catalog = await catalogFor(id, { installed });
  return {
    id,
    label: entry.label,
    binary,
    installed,
    authState: probe.authState,
    ...(probe.accountLabel ? { accountLabel: probe.accountLabel } : {}),
    ready: usable(installed, probe.authState),
    reason: reasonFor(installed, probe.authState, entry.label, entry.bin),
    inheritLabel: entry.inheritLabel,
    models: catalog.models,
    modelSource: catalog.source,
    modelsFetchedAt: catalog.fetchedAt,
  };
}

/** Every harness, in registry order. Probes run concurrently. */
export function detectHarnesses(): Promise<HarnessStatus[]> {
  return Promise.all(HARNESSES.map((h) => harnessStatus(h.id)));
}

/** The ids that could actually run something right now. */
export async function readyHarnesses(): Promise<HarnessId[]> {
  return (await detectHarnesses()).filter((h) => h.ready).map((h) => h.id);
}
