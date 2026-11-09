import { describe, expect, it } from "vitest";
import { convertUnit, fmtEng, ohm, parseEng, resistor, toBases, truthTable } from "./eng";

describe("engineering helpers", () => {
  it("parses and formats engineering notation", () => {
    expect(parseEng("4.7k")).toBe(4700);
    expect(parseEng("4k7")).toBe(4700);
    expect(parseEng("10u")).toBeCloseTo(1e-5);
    expect(parseEng("2.2M")).toBe(2.2e6);
    expect(parseEng("1e3")).toBe(1000);
    expect(parseEng("abc")).toBeNaN();
    expect(fmtEng(4700, "Ω")).toBe("4.7 kΩ");
    expect(fmtEng(0.00001, "F")).toBe("10 µF");
  });
  it("solves Ohm's law from any two quantities", () => {
    expect(ohm({ V: 12, R: 4 })).toEqual({ V: 12, I: 3, R: 4, P: 36 });
    expect(ohm({ P: 100, R: 4 })).toEqual({ V: 20, I: 5, R: 4, P: 100 });
    expect(ohm({ V: 5 })).toBeNull();
  });
  it("reads resistor colour codes", () => {
    expect(resistor([4, 7], 2, 10)).toMatchObject({ value: 4700, tol: 5 }); // yellow violet red gold
    expect(resistor([1, 0, 0], 1, 1).value).toBe(1000); // brown black black brown brown
    expect(resistor([1, 0], 10, 10).value).toBeCloseTo(1); // brown black gold
  });
  it("converts between bases with two's complement", () => {
    expect(toBases("255", 10)).toEqual({ dec: "255", hex: "FF", bin: "11111111", oct: "377" });
    expect(toBases("0x1F", 16)!.dec).toBe("31");
    expect(toBases("-1", 10, 8)).toMatchObject({ hex: "FF", bin: "11111111" });
    expect(toBases("12", 2)).toBeNull();
  });
  it("builds truth tables with standard precedence and notations", () => {
    const t = truthTable("A & (B | !C)");
    expect(t.vars).toEqual(["A", "B", "C"]);
    expect(t.minterms).toEqual([4, 6, 7]);
    expect(truthTable("A XOR B").minterms).toEqual([1, 2]);
    expect(truthTable("AB + A'C").minterms).toEqual([1, 3, 6, 7]);
    expect(truthTable("A NAND B").minterms).toEqual([0, 1, 2]);
    expect(truthTable("A | B & C").minterms).toEqual([3, 4, 5, 6, 7]);
    expect(() => truthTable("A & (B")).toThrow();
  });
  it("converts units including temperature offsets", () => {
    expect(convertUnit("Temperature", 100, "°C", "°F")).toBeCloseTo(212);
    expect(convertUnit("Temperature", 0, "K", "°C")).toBeCloseTo(-273.15);
    expect(convertUnit("Length", 1, "inch", "mm")).toBeCloseTo(25.4);
    expect(convertUnit("Data", 1, "MiB", "byte")).toBe(1048576);
  });
});
