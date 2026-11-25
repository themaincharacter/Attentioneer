import { describe, expect, test } from "bun:test";
import {
  curatorCardText,
  parseDistilledCardText,
} from "../src/turn/curator";

describe("the curator's glance: the claim is the face", () => {
  test("the card's own text round-trips into its four places", () => {
    const text = curatorCardText({
      title: "the tide",
      claim: "The gate opens on the ebb.",
      restsOn: "one run; the reply's own words",
      doesNotCover: "other models; a loaded network",
      uncertainty: "the run may not hold elsewhere",
    } as never);
    expect(parseDistilledCardText(text)).toEqual({
      claim: "The gate opens on the ebb.",
      restsOn: "one run; the reply's own words",
      doesNotCover: "other models; a loaded network",
      uncertainty: "the run may not hold elsewhere",
    });
  });

  test("any other shape answers null and renders verbatim", () => {
    // A rule's copy; a field pair that is not the three; a claim with its own
    // blank line (the shape would be ambiguous, so it stays verbatim).
    expect(parseDistilledCardText("a rule's copy of the answer.")).toBeNull();
    expect(parseDistilledCardText("claim\n\nrests on: x\nuncertainty: y")).toBeNull();
    expect(
      parseDistilledCardText(
        "para one\n\npara two\n\nrests on: x\ndoes not cover: y\nuncertainty: z",
      ),
    ).toBeNull();
    expect(parseDistilledCardText("")).toBeNull();
  });

  test("the parser reads the record's bytes and never rewrites them", () => {
    const text = curatorCardText({
      title: "t",
      claim: "c",
      restsOn: "r",
      doesNotCover: "d",
      uncertainty: "u",
    } as never);
    expect(text).toBe("c\n\nrests on: r\ndoes not cover: d\nuncertainty: u");
    expect(parseDistilledCardText(text)).not.toBeNull();
  });
});
