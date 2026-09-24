import { test } from "node:test";
import assert from "node:assert/strict";
import { askState, turnAbout, workingOn } from "../lib/ask-agent";
import type { Message } from "../server/conversation";

let next = 1;
const message = (role: Message["role"], text: string, over: Partial<Message> = {}): Message => ({
  id: next++, role, source: "web", text, sequenceId: "s", context: null, jobId: null, at: next * 1000, changes: null, ...over,
});
const about = (text: string, ...selection: string[]) => message("user", text, { context: { selection } });

test("what the agent is working on comes from the conversation, not from a flag", () => {
  const asked = about("tighten this", "shot-a");
  // Nothing runs, so nothing is being worked on, whatever the last message said.
  assert.deepEqual(workingOn([asked], false), []);
  assert.deepEqual(workingOn([asked], true), ["shot-a"]);
  // Answered: the run that is going now is not about this any more.
  assert.deepEqual(workingOn([asked, message("agent", "done")], true), []);
  // A question about nothing in particular marks no clip.
  assert.deepEqual(workingOn([message("user", "make it shorter")], true), []);
});

test("a turn is found by the clip it named, newest first", () => {
  const first = about("one", "shot-a");
  const answer = message("agent", "did one");
  const second = about("two", "shot-b");
  const messages = [first, answer, second];
  assert.equal(turnAbout(messages, "shot-a")?.asked.text, "one");
  assert.equal(turnAbout(messages, "shot-a")?.answer?.text, "did one");
  assert.equal(turnAbout(messages, "shot-b")?.answer, null);
  assert.equal(turnAbout(messages, "shot-c"), null);
});

test("the panel beside a clip says which of the four things is true", () => {
  const asked = about("tighten this", "shot-a");
  assert.deepEqual(askState([], "shot-a", { working: false }), { kind: "idle" });
  assert.deepEqual(askState([asked], "shot-a", { working: true }), { kind: "working", since: asked.at });
  // The project runs one job at a time, so a second clip waits rather than being refused.
  assert.deepEqual(askState([asked], "shot-b", { working: true, lockedReason: "Editing is running" }),
    { kind: "blocked", reason: "Editing is running" });
  const answer = message("agent", "tightened it", { changes: { revisionBefore: 1, revisionAfter: 2, operations: 3, undone: false } });
  assert.deepEqual(askState([asked, answer], "shot-a", { working: false }),
    { kind: "answered", messageId: answer.id, text: "tightened it", operations: 3, undone: false });
});
