import { test } from "node:test";
import assert from "node:assert/strict";
import { dayInZone } from "../lib/resolve";
import { calendarTime } from "../lib/calendar";
import { resolveTimeField, resolveTimeFieldTimestamp } from "../lib/time-field";

test("publication fields use the publication timezone and round trip a saved instant", () => {
  const at = resolveTimeField("2026-09-28", "18:30", "America/Mexico_City", null);
  assert.equal(at, "2026-09-29T00:30:00.000Z");
  assert.equal(dayInZone(at, "America/Mexico_City"), "2026-09-28");
  assert.equal(calendarTime(at, "America/Mexico_City"), "18:30");
  const precise = "2026-11-01T01:30:45-05:00";
  assert.equal(resolveTimeField("2026-11-01", "01:30", "America/New_York", precise), precise);
});

test("publication fields keep the shared DST validation and explicit offset escape hatch", () => {
  assert.throws(() => resolveTimeField("2026-03-08", "02:30", "America/New_York", null), /does not exist/);
  assert.throws(() => resolveTimeField("2026-11-01", "01:30", "America/New_York", null), /occurs twice/);
  assert.throws(() => resolveTimeField("2026-09-28", "", "UTC", null), /Choose a date and time/);
  assert.throws(() => resolveTimeFieldTimestamp("2026-11-01T01:30:00"), /UTC offset/);
  assert.throws(() => resolveTimeFieldTimestamp("2026-02-30T01:30:00Z"), /UTC offset/);
  for (const at of ["2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00"]) {
    assert.equal(resolveTimeFieldTimestamp(at), at);
  }
});
