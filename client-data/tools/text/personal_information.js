// Heuristic for warnings, not automatic bans.
const email = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u;
const link =
  /(?:t\.me|wa\.me|discord\.gg|instagram\.com|snapchat\.com)\/[\w.+-]{3,}/i;
const digits = /(?<!\d)\+?\d(?:[ ().-]{0,3}\d){6,14}(?!\d)/g;

// Informal contact requests, especially Ukrainian/Russian.
const verb = String.raw`(?:скин\p{L}{0,6}|кин\p{L}{0,6}|кид\p{L}{0,5}|дай|дайте|пиш\p{L}{0,6}|напиш\p{L}{0,6}|го|дзвон\p{L}{0,6}|звон\p{L}{0,6}|send|give|add|dm|text|call|drop|passa|manda|dammi|scrivi|chama|donne|envoie)`;
const app = String.raw`(?:тг|тгк|телег\p{L}{0,7}|ва[тц]с\p{L}{0,5}|вайбер|whats?app|wpp|zap|snap(?:chat)?|снап\p{L}{0,4}|insta(?:gram)?|[іи]нст\p{L}{0,5}|discord|дискорд)`;
const detail = String.raw`(?:ном[еє]р\p{L}{0,5}|телефон\p{L}{0,5}|тел\.?|phone|number|num(?:ero|éro)?|${app})`;
const edge = String.raw`(?:^|[^\p{L}\p{N}])`;
const end = String.raw`(?=$|[^\p{L}\p{N}])`;

const invitation = new RegExp(
  `${edge}${verb}[^\\n]{0,22}${detail}${end}|` +
    `${edge}${detail}${end}[^\\n]{0,22}${verb}${end}|` +
    `${edge}давай[^\\n]{0,12}${app}${end}`,
  "iu",
);
const taggedHandle = new RegExp(
  `${edge}(?:${app}|line)\\s*[:：@]\\s*@?[\\w.]{3,}`,
  "iu",
);
const asianContact =
  /(?:加我|给我|給我|交換|交换|教えて|送って).{0,6}(?:微信|手机号|手機號|電話番号|ライン|line)|(?:微信|手机号|手機號|電話番号|ライン|line).{0,6}(?:给我|給我|交換|交换|教えて|送って)/iu;

// Street name + house number, in either order.
const street = String.raw`(?:вул(?:иця)?\.?|вулиц[яі]|ул(?:иц[аые])?\.?|пров(?:улок)?\.?|пер\.|просп(?:ект)?\.?|street|st\.|road|rd\.|avenue|ave\.|rue|boulevard|via(?!\s+(?:telegram|whatsapp|instagram|email|mail))|rua|calle|strasse|straße)`;
const streetFirst = new RegExp(
  `${edge}${street}\\s+(?:[\\p{L}.'’–-]+[,\\s]+){1,5}\\d{1,3}${end}`,
  "iu",
);
const numberFirst = new RegExp(
  `${edge}\\d{1,4}\\s+(?:[\\p{L}.'’–-]+\\s+){0,3}${street}${end}|` +
    `${edge}\\d{1,4}\\s+${street}\\s+[\\p{L}.'’–-]+`,
  "iu",
);
const addressPhrase =
  /(?:^|[^\p{L}\p{N}])(?:мій|моя|мой|моя|my|mon|ma|meu|minha|mio|mia|дай|скинь|кинь|send|give|donne|manda|passa)\s+(?:домашн\p{L}*\s+)?(?:адрес\p{L}*|address|adresse|indirizzo|endere[cç]o)(?=$|[^\p{L}\p{N}])/iu;
const asianAddress =
  /[\p{Script=Han}]{1,10}(?:路|街|道)\d{1,4}(?:号|號)|\d{1,3}丁目\d{1,3}/u;

/** @param {string} text */
export function privateInfoKind(text) {
  const s = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "");

  if (email.test(s)) return "email";
  if (
    link.test(s) ||
    taggedHandle.test(s) ||
    invitation.test(s) ||
    asianContact.test(s)
  )
    return "contact";
  if (
    streetFirst.test(s) ||
    numberFirst.test(s) ||
    addressPhrase.test(s) ||
    asianAddress.test(s)
  )
    return "address";

  for (const match of s.matchAll(digits)) {
    const raw = match[0].trim();
    const n = raw.replace(/\D/g, "");

    // Don't interpret dates as phone numbers.
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}(?:\s+\d{1,2})?$/.test(raw)) continue;

    const nearby = s.slice(
      Math.max(0, match.index - 24),
      match.index + raw.length + 12,
    );
    const labelled =
      /(?:тел(?:ефон)?\.?|номер\p{L}*|ном\.?|num[eé]ro|telefono|telefone|phone|mobile|call|whatsapp|ватсап|вайбер|звон\p{L}*)/iu.test(
        nearby,
      );

    const shaped =
      /^\+/.test(raw) ||
      (/^0/.test(n) && n.length >= 9) ||
      (/^[78]/.test(n) && n.length === 11) ||
      (/^380/.test(n) && n.length === 12) ||
      (/^[39]/.test(n) && n.length === 10) ||
      /^\d{1,4}(?:[ -]\d{2,4}){2,4}$/.test(raw);

    if ((labelled && n.length >= 7) || (shaped && n.length >= 9))
      return "phone";
  }

  return null;
}
