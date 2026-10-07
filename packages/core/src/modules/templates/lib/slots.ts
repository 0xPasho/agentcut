import type { SlotValue } from "../types";

/**
 * A slot key that is present but empty — `{}`, or a blank path — is not a filled slot.
 * Checking the key alone says "filled" for something that supplies nothing, and the
 * failure then surfaces much later as an empty pool instead of a missing input.
 */
export const slotFilled = (value: SlotValue | undefined): boolean =>
  !!value && !!(value.folder?.trim() || value.assetIds?.length || value.assetId?.trim() || value.text?.trim());
