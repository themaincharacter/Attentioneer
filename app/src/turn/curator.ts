import { fencedBlocksOf } from "./proposal";
import { oneLine, type TurnMessage } from "./protocol";

/**
 * THE CURATOR CALL (story 17.12, ADR-0037 decisions 4-8) — the second model
 * that distils a task's reply into a card.
 *
 * WHAT LEAVES: the person's question (the brief's "what was asked"), the reply
 * VERBATIM, the card schema, and — since ADR-0037's amendment — the MAP DIGEST
 * (story 17.14): one bounded block of names, kinds and one-line descriptions,
 * composed by turn/curatorDigest.ts. NOT the material: the curator distils the
 * answer, it does not re-read the sources. That is still a construction fact,
 * not a promise: the digest arrives as a STRING of the map's own labels, and
 * this module never imports the records, the texts or the notes, so no card's
 * reading body can reach the prompt even by accident. The amendment's words
 * are the rule: "It can see material but that's not what I mean here. It sees
 * the big picture of what really matters and should be brief." The digest is
 * the big picture; the reading bodies stay on the map.
 *
 * BREVITY IS AN AIM, NOT A GATE (the person's ruling, 2026-11-21): the prompt
 * asks for the tightest honest form — a title of a few words, the claim in one
 * or two sentences, the other fields as up to three short items — and that is
 * ALL it does. Story 17.14's per-field caps were deleted by that ruling: a card
 * that runs long is still a card, and every byte the model wrote is kept. No
 * cap comes back on the theory that the layout demands one: the card's face
 * CROPS its body, so length cannot break the map. And the default stance is
 * DECLINE (amendment 3): an answer is not attention-worthy because it was
 * returned; if it does not establish something the map can use, the legal
 * answer is one sentence and no card. Without a language game the digest is the
 * only guide, and the prompt says exactly that.
 *
 * WHY THE SAME DISCIPLINE AS THE GHOST BLOCK: the curator is a model and can
 * be wrong, so its answer is PARSED, never trusted. One fenced block with a
 * stated schema; a malformed block yields ONE sentence and NO card. The fence
 * scanner is the ghost scanner's (\`fencedBlocksOf\`), so there is one fenced
 * block discipline in the app, not two that drift.
 *
 * "NOTHING WORTH KEEPING" IS A LEGAL ANSWER (ADR-0037 decision 7): a reply with
 * no fence at all is a DECLINE. The person keeps the reply and can make the
 * card themselves; the ask card says the decline in one sentence.
 *
 * CAVEATS ARE PRESERVED BY RULE, NOT BY HOPE (decision 6). The reply's doubt is
 * detected with the short, literal cue list below; when a cue fires and the
 * card's uncertainty slot is empty or says "none", the card is MALFORMED. The
 * detection is deliberately conservative: it understands no paraphrase and no
 * implication, so a cue it does not know is missed — the person still has the
 * reply. It never claims a caveat the reply did not state; it only refuses a
 * card that is silent when the reply plainly was not.
 *
 * PURE: no fs, no clock, no React, no network. The caller builds the turn and
 * the ask card writes the artifact.
 *
 * PROVISIONAL: the fence's language tag, every sentence below, the five field
 * names, and the cue list. ADR-0037 and its amendment settle the artifact's
 * shape and that the prompt should ASK for brevity — not a length rule, and not
 * these words. (The ruling of 2026-11-21 removed the caps; see above.)
 */

/** The fence's language tag (PROVISIONAL). */
export const CURATOR_FENCE = "attentioneer-card";

/** The schema's five keys, exactly (ADR-0037 decision 5; PROVISIONAL names). */
export const CURATOR_SCHEMA_KEYS = [
  "title",
  "claim",
  "rests on",
  "does not cover",
  "uncertainty",
] as const;

/** The one sentence a malformed block gets: no card is made. */
export const CURATOR_MALFORMED_SENTENCE =
  "the curator's answer was not a card the app can use, so no card was made.";

/**
 * NO LENGTH RULE (the person's ruling, 2026-11-21). Story 17.14's per-field
 * caps — and the sentence that refused a long card — are GONE. A card that runs
 * long is still usable: the card's face CROPS its body, so length cannot break
 * the layout, and the app keeps every byte the model wrote. Brevity is asked
 * for in the prompt as an AIM, never enforced here. This removal is the
 * person's decision — "remove the cap all together" — not a bug, and a cap
 * must not creep back on the belief that the layout needs one.
 */

/**
 * The one sentence a decline gets when the curator's own words are empty. A
 * decline is SUCCESS (ADR-0037 decision 7), so the fallback still says the
 * legal fact rather than an error.
 */
export const CURATOR_DECLINED_SENTENCE =
  "nothing worth keeping, so no card was made.";

/**
 * THE CAVEAT CUES (PROVISIONAL). Each is a literal phrase matched on word
 * boundaries against the reply, lowercased. Kept short on purpose: a phrase
 * here means "the reply plainly carried doubt", and a false cue would refuse a
 * card the person asked for. A cue missing from this list is a MISS, never a
 * silent pass dressed as certainty.
 *
 * Apostrophes are dropped from both sides before matching, so "can't say" is
 * the cue "cant say" and the reply's own punctuation cannot hide it.
 */
export const CAVEAT_CUES: readonly string[] = [
  "may not",
  "might not",
  "cant say",
  "cannot say",
  "not sure",
  "uncertain",
  "unclear",
  "unknown",
  "doubt",
  "contradict",
  "contradiction",
  "depends",
  "assuming",
  "assumption",
  "caveat",
  "only applies",
  "not always",
  "in some cases",
  "limited to",
  "appears to",
  "seems to",
  "possibly",
  "perhaps",
];

/**
 * WHAT THE UNCERTAINTY SLOT MAY SAY WHEN THE REPLY CARRIED DOUBT. An empty
 * slot, or one of these words, is a DROPPED caveat; anything else is accepted
 * as carrying it (the app does not grade the wording — a curator that says the
 * doubt in its own sentence has kept it).
 */
const NO_UNCERTAINTY = [
  "",
  "none",
  "none stated",
  "nothing",
  "n/a",
  "na",
  "no uncertainty",
  "no caveats",
  "no caveat",
  "not applicable",
];

/** One card, as the curator stated it (the schema's five fields, camel-cased). */
export interface CuratorCard {
  /** The card's proposed name: a short phrase. */
  title: string;
  /** What the reply established. */
  claim: string;
  /** What the claim rests on, as the reply stated it. */
  restsOn: string;
  /** What the answer does not establish. */
  doesNotCover: string;
  /** The caveats, doubts and scope limits the reply carried. */
  uncertainty: string;
}

/** What reading one curator answer found. */
export type CuratorRead =
  /**
   * The legal decline: one sentence, no card. The person keeps the reply and
   * may make the card themselves (ADR-0037 decision 7).
   */
  | { kind: "declined"; sentence: string }
  /** One usable card, and the exact text the artifact will hold. */
  | { kind: "card"; card: CuratorCard; text: string }
  /** A tagged block that is not a usable card: one sentence, no card. */
  | { kind: "invalid"; sentence: string };

/** What the curator's prompt is built from — these three things and nothing else. */
export interface CuratorInput {
  /** The person's authored question, verbatim (the brief's "what was asked"). */
  question: string;
  /** The task model's reply, verbatim. Never edited, capped or re-wrapped. */
  reply: string;
  /**
   * THE MAP DIGEST (story 17.14, ADR-0037's amendment): one already-bounded
   * block of the map's cards — names, kinds and one-line descriptions, never a
   * reading body — composed by turn/curatorDigest.ts. PROMPT MATERIAL ONLY:
   * nothing in this module records it, and an empty string means the caller
   * had no map to describe.
   */
  digest: string;
}

/** The prompt's title (PROVISIONAL, and part of the bytes). */
export const CURATOR_TITLE = "# distilling one answer into a card";

/** The brief's heading. */
const BRIEF_HEADING = "## the brief";

/** The reply's heading. */
const REPLY_HEADING = "## the reply, verbatim";

/** The map digest's heading. */
const DIGEST_HEADING = "## the map digest";

/** The card instruction's heading. */
const CARD_HEADING = "## the card";

/**
 * THE PROMPT (stories 17.12 and 17.14): the brief (the question, why this call
 * exists, and the default stance), the MAP DIGEST (the map's own labels,
 * nearest first — PROMPT MATERIAL ONLY), the reply WHOLE, and the schema with
 * its brevity AIMS (the ruling of 2026-11-21: asked, never refused). There is
 * no material section: the digest is a string of names and kinds, never a
 * reading, and this module could not include one.
 */
export function curatorPrompt(input: CuratorInput): string {
  const digest = input.digest.trim();
  return [
    CURATOR_TITLE,
    "",
    BRIEF_HEADING,
    "",
    "The person asked:",
    "",
    input.question.trim(),
    "",
    "They asked for a card they can keep, so this step distils the reply below into one. This step does not re-read any source: the digest below is the map's own labels, never any card's reading, and nothing about a source is inferred from them.",
    "",
    'A returned answer is not automatically worth keeping. It earns a card only if it establishes something this map can use; there is no language game here yet, so the digest below is the only guide to what matters.',
    "",
    ...(digest === ""
      ? []
      : [
          DIGEST_HEADING,
          "",
          "What this map already holds, nearest first — the ask being distilled, the artifacts already made from it, the cards wired into it, then the rest of the map. These are labels, not readings.",
          "",
          digest,
          "",
        ]),
    REPLY_HEADING,
    "",
    input.reply,
    "",
    CARD_HEADING,
    "",
    "A card is a COMPRESSION of the reply and a GLANCE at it: the tightest honest form, never a restatement. Say what matters and stop.",
    "Aim for:",
    "",
    "- a title of a few words;",
    "- the claim in one or two sentences;",
    "- every other field as up to three short items.",
    "",
    "Do NOT restate the question. Do NOT open with a preamble. Do NOT end with a hedge.",
    "",
    "Write one fenced code block whose language tag is " + CURATOR_FENCE + ".",
    "The block carries ONE JSON object with exactly these five keys, each a non-empty string:",
    "",
    '- "title": the card\'s name, a phrase of a few words.',
    '- "claim": what the reply established, in one or two sentences.',
    '- "rests on": what the claim rests on, as up to three short items.',
    '- "does not cover": what the answer does not establish, as up to three short items.',
    '- "uncertainty": every doubt, contradiction, scope limit or "this may not apply" the reply carried, as up to three short items.',
    "",
    'If the reply carried none of those, write "none stated" in "uncertainty".',
    "If the reply carried any of them, the card MUST carry them: a card that drops a caveat is not usable.",
    "",
    "DECLINE IS THE DEFAULT. If the reply establishes nothing this map can use — it restates the question, repeats a card already on the map, or adds a claim nobody is working on — write NO block and answer in ONE sentence saying why (for example: \"nothing here the map can use: it repeats the question and adds no claim.\"). A decline is a legal answer.",
    "Write one block at most. A second block, a missing key or a block that is not JSON makes no card.",
  ].join("\n");
}

/** The ONE message the curator call sends (the same one-user-message shape). */
export function buildCuratorMessages(input: CuratorInput): TurnMessage[] {
  return [{ role: "user", content: curatorPrompt(input) }];
}

/**
 * Is this cue in the reply? Literal, word-bounded, apostrophe-blind. A cue is
 * a phrase of letters and spaces by construction (see CAVEAT_CUES), so the
 * only work is turning its spaces into whitespace gaps.
 */
function cueIn(cue: string, text: string): boolean {
  return new RegExp("\\b" + cue.split(" ").join("\\s+") + "\\b").test(text);
}

/** Does the reply plainly carry a caveat? Word-boundary literal cues only. */
export function replyCarriedCaveat(reply: string): boolean {
  // Apostrophes are dropped on BOTH sides so "can't" and "cant" agree.
  const text = reply.toLowerCase().split("'").join("").replace(/[^\p{L}\p{N}\s]/gu, " ");
  return CAVEAT_CUES.some((cue) => cueIn(cue, text));
}

/** The uncertainty slot as a comparison word ("none." and "None" alike). */
function uncertaintyWord(uncertainty: string): string {
  return uncertainty.trim().toLowerCase().replace(/\.+$/, "");
}

/**
 * THE CAVEAT RULE (ADR-0037 decision 6): a card is malformed when the reply's
 * caveat detection fired and the card's uncertainty slot is EMPTY or says
 * "none". It does not check that the card repeats the reply's words — a
 * paraphrase is a person's judgement and the app does not grade it. That is the
 * conservatism: only a plain drop is caught, and a miss leaves the reply whole.
 */
export function cardDroppedCaveat(card: CuratorCard, reply: string): boolean {
  if (!replyCarriedCaveat(reply)) return false;
  return NO_UNCERTAINTY.includes(uncertaintyWord(card.uncertainty));
}

/**
 * The card as the artifact's text (PROVISIONAL wording and layout): the claim,
 * then the three remaining fields by name. The TITLE is the card's own name on
 * the map, so it is not repeated in the reading. It is a reading, never a
 * record: nothing here counts, summarises further or adds a source.
 */
export function curatorCardText(card: CuratorCard): string {
  return [
    card.claim.trim(),
    "",
    "rests on: " + card.restsOn.trim(),
    "does not cover: " + card.doesNotCover.trim(),
    "uncertainty: " + card.uncertainty.trim(),
  ].join("\n");
}

/** The decline's one sentence: the curator's first line, or the stated one. */
function declineSentence(answer: string): string {
  const first = answer.trim().split(/\n\s*\n/)[0] ?? "";
  const line = oneLine(first);
  return line === "" ? CURATOR_DECLINED_SENTENCE : line;
}

/** The five fields from a parsed object, or null when the shape is wrong. */
function cardOf(value: Record<string, unknown>): CuratorCard | null {
  if (Object.keys(value).length !== CURATOR_SCHEMA_KEYS.length) return null;
  for (const key of CURATOR_SCHEMA_KEYS) {
    if (typeof value[key] !== "string") return null;
  }
  const card: CuratorCard = {
    title: (value.title as string).trim(),
    claim: (value.claim as string).trim(),
    restsOn: (value["rests on"] as string).trim(),
    doesNotCover: (value["does not cover"] as string).trim(),
    uncertainty: (value.uncertainty as string).trim(),
  };
  // Every slot says something: the prompt asks for "none stated" rather than a
  // blank, so a blank is a shape failure, not a quiet omission.
  if (
    card.title === "" ||
    card.claim === "" ||
    card.restsOn === "" ||
    card.doesNotCover === "" ||
    card.uncertainty === ""
  ) {
    return null;
  }
  return card;
}

/**
 * READ one curator answer. The discipline is the ghost block's: exactly one
 * tagged block, a JSON object, the stated schema, and every failure is the ONE
 * sentence with no card. A reply with no fence at all is a DECLINE (a legal
 * answer); a reply that wrote some other fence instead of the card fence is
 * not — it tried to answer and got the shape wrong, so it is malformed.
 */
export function readCuratorAnswer(answer: string, reply: string): CuratorRead {
  const blocks = fencedBlocksOf(answer);
  const tagged = blocks.filter((block) => block.tag === CURATOR_FENCE);
  // No fence at all: the curator declined in prose. One sentence, no card.
  if (blocks.length === 0 && tagged.length === 0) {
    return { kind: "declined", sentence: declineSentence(answer) };
  }
  // A fence with the wrong tag, or more than one card block: the answer tried
  // and got the shape wrong. Refuse the card, never guess which block it meant.
  if (tagged.length !== 1) {
    return { kind: "invalid", sentence: CURATOR_MALFORMED_SENTENCE };
  }
  const body = tagged[0].body.trim();
  if (body === "") {
    return { kind: "invalid", sentence: CURATOR_MALFORMED_SENTENCE };
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { kind: "invalid", sentence: CURATOR_MALFORMED_SENTENCE };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "invalid", sentence: CURATOR_MALFORMED_SENTENCE };
  }
  const card = cardOf(value as Record<string, unknown>);
  if (card === null) {
    return { kind: "invalid", sentence: CURATOR_MALFORMED_SENTENCE };
  }
  // NO LENGTH GATE (the ruling of 2026-11-21): a long but well-shaped card is
  // accepted here, and its bytes are kept exactly as the model wrote them.
  // THE CAVEAT RULE, enforced before the card can become an artifact. It reads
  // the REPLY, never the curator's own answer: the question is what the reply
  // carried, not what the card says about itself.
  if (cardDroppedCaveat(card, reply)) {
    return { kind: "invalid", sentence: CURATOR_MALFORMED_SENTENCE };
  }
  return { kind: "card", card, text: curatorCardText(card) };
}
