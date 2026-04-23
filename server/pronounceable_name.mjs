import { createHash, randomBytes } from "node:crypto";

const NAME_SYLLABLES = [
  "al",
  "an",
  "ar",
  "ba",
  "be",
  "bi",
  "bo",
  "da",
  "de",
  "di",
  "do",
  "el",
  "en",
  "er",
  "fa",
  "fe",
  "fi",
  "ga",
  "ge",
  "gi",
  "ha",
  "he",
  "hi",
  "io",
  "ka",
  "ke",
  "ki",
  "ko",
  "la",
  "le",
  "li",
  "lo",
  "lu",
  "ma",
  "me",
  "mi",
  "mo",
  "na",
  "ne",
  "ni",
  "no",
  "oa",
  "ol",
  "or",
  "pa",
  "pe",
  "pi",
  "ra",
  "re",
  "ri",
  "ro",
  "sa",
  "se",
  "si",
  "so",
  "ta",
  "te",
  "ti",
  "to",
  "ul",
  "ur",
  "va",
  "ve",
  "vi",
  "vo",
  "wa",
  "we",
  "wi",
  "ya",
  "yo",
  "za",
  "ze",
  "zi",
];

const RANDOM_BOARD_WORD_MIN_PARTS = 2;
const RANDOM_BOARD_WORD_MAX_PARTS = 3;
const RANDOM_BOARD_WORD_COUNT = 4;
const RANDOM_WORD_BYTE_WIDTH = 1 + RANDOM_BOARD_WORD_MAX_PARTS * 2;

/**
 * @param {Buffer} bytes
 * @param {number} offset
 * @param {number} minParts
 * @param {number} maxParts
 * @returns {string}
 */
function buildPronounceableWordFromBytes(bytes, offset, minParts, maxParts) {
  let partCount = minParts;
  if (maxParts > minParts) {
    partCount += (bytes[offset] || 0) % (maxParts - minParts + 1);
  }
  let word = "";
  for (let index = 0; index < partCount; index++) {
    const value = bytes.readUInt16BE(offset + 1 + index * 2);
    word +=
      NAME_SYLLABLES[value % NAME_SYLLABLES.length] ||
      NAME_SYLLABLES[0] ||
      "na";
  }
  return word;
}

/**
 * @param {string} seed
 * @param {number} minParts
 * @param {number} maxParts
 * @returns {string}
 */
function buildPronounceableName(seed, minParts, maxParts) {
  const digest = createHash("sha256").update(seed).digest();
  return buildPronounceableWordFromBytes(digest, 0, minParts, maxParts);
}

/**
 * @param {Buffer=} bytes
 * @returns {string}
 */
function buildRandomBoardName(bytes) {
  const randomNameBytes =
    bytes || randomBytes(RANDOM_BOARD_WORD_COUNT * RANDOM_WORD_BYTE_WIDTH);
  const words = [];
  for (let index = 0; index < RANDOM_BOARD_WORD_COUNT; index++) {
    words.push(
      buildPronounceableWordFromBytes(
        randomNameBytes,
        index * RANDOM_WORD_BYTE_WIDTH,
        RANDOM_BOARD_WORD_MIN_PARTS,
        RANDOM_BOARD_WORD_MAX_PARTS,
      ),
    );
  }
  return words.join("-");
}

export { buildPronounceableName, buildRandomBoardName };
