declare module "selenium-server";
declare module "chromedriver";
declare module "jsonwebtoken";
declare module "statsd-client";
declare module "serve-static";
declare module "accept-language-parser" {
  type AcceptedLanguage = { code: string; region?: string };

  const acceptLanguageParser: {
    parse(value: string): AcceptedLanguage[];
    pick(
      supportedLanguages: string[],
      acceptedLanguages: AcceptedLanguage[],
      options?: { loose?: boolean },
    ): string | null;
  };

  export = acceptLanguageParser;
}
