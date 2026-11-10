import { describe, expect, it } from "vitest";
import { interpret } from "./commands";
import { encode, normalise } from "./listen";

const NOW = new Date(2026, 10, 9, 10, 0); // Monday

describe("spoken commands", () => {
  it("turns transcripts into command-bar text", () => {
    expect(normalise(" Add a quiz for Machine Learning on Friday at 3 p.m.")).toBe("Add a quiz for Machine Learning on Friday at 3pm");
    expect(normalise("Hey Orion, brief me.")).toBe("orion brief");
    expect(normalise("Good night.")).toBe("orion wrap up");
    expect(normalise("Start a 50 minute focus")).toBe("orion focus 50");
    expect(normalise("focus for 30 minutes")).toBe("orion focus 30");
    expect(normalise("Start a focus block")).toBe("orion focus 25");
    expect(normalise("Focus on operating systems")).toBe("Focus on operating systems");
    expect(normalise("Tell me a joke!")).toBe("orion joke");
    expect(normalise("Spent 450 on lunch.")).toBe("Spent 450 on lunch");
  });
  it("produces text the command grammar understands", () => {
    expect(interpret(normalise("Add a quiz for Machine Learning on Friday at 3 p.m."), NOW)[0]).toMatchObject({ type: "deadline", kind: "quiz", title: "Machine Learning", due: "2026-11-13T15:00" });
    expect(interpret(normalise("Spent 450 on lunch."), NOW)[0]).toMatchObject({ type: "tx", amount: -450 });
    expect(interpret(normalise("Open my timetable"), NOW)[0]).toMatchObject({ type: "go", world: "academy" });
  });
  it("encodes audio as 16 kHz 16-bit PCM", () => {
    const one = new Float32Array(48000).fill(0.5); // one second at 48 kHz
    const bytes = Uint8Array.from(atob(encode(one, 48000)), (c) => c.charCodeAt(0));
    expect(bytes.length).toBe(16000 * 2);
    expect(new Int16Array(bytes.buffer)[100]).toBe(16384);
  });
});
