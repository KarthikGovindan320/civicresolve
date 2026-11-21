import "server-only";
import { cookies, headers } from "next/headers";
import { createTranslator, type Translate } from "./index";
import { readPreferences, type Preferences } from "./preferences";

/** Reads this visitor's language and display preferences from the request, for server components. */
export async function getPreferences(): Promise<Preferences> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return readPreferences((name) => cookieStore.get(name)?.value, headerList.get("accept-language"));
}

/** The translate function for this request's language, for server components. */
export async function getTranslator(): Promise<Translate> {
  return createTranslator((await getPreferences()).lang);
}
