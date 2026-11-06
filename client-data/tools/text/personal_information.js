// Heuristics for a local warning, not validation: international formats vary.
const EMAIL =
  /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)*\.[\p{L}]{2,}/u;
const PHONE =
  /(?<![\p{L}\p{N}])\+?\d(?:[ ().-]*\d){8,14}(?![\p{L}\p{N}]|[ ().-]*\d)/u;
const NUMBERED_STREET =
  /\b\d{1,6}[a-z]?\s+(?:[\p{L}][\p{L}'’-]*\s+){1,5}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd|way|place|pl|terrace|close|crescent)\b/iu;
const NAMED_STREET =
  /\b\d{1,6}[a-z]?(?:\s*,)?\s+(?:rue|avenue|boulevard|chemin|route|allée|calle|carrer|via|rua)\s+(?:[\p{L}][\p{L}'’-]*\s*){1,5}|\b[\p{L}][\p{L}'’-]*(?:straße|strasse|str\.|weg|platz)\s+\d{1,6}[a-z]?\b/iu;

/** @param {string} text */
export function mayContainPersonalInformation(text) {
  return (
    EMAIL.test(text) ||
    PHONE.test(text) ||
    NUMBERED_STREET.test(text) ||
    NAMED_STREET.test(text)
  );
}
