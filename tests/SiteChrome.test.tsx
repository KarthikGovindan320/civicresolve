// @vitest-environment jsdom
// What every page shares: the header and footer, page titles, the not-found notice, and the
// copy-link button on the confirmation screen.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NotFound, { generateMetadata as notFoundMetadata } from "@/app/not-found";
import NotFoundNotice from "@/components/NotFoundNotice";
import { metadata as staffMetadata } from "@/app/staff/layout";
import { generateMetadata as trackMetadata } from "@/app/track/layout";
import CopyButton from "@/components/CopyButton";
import { I18nProvider } from "@/components/I18nProvider";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { createTranslator } from "@/lib/i18n";
import { PREFERENCE_COOKIES } from "@/lib/i18n/preferences";
import { expectNoAxeViolations } from "./setup";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/track/CR-1" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === PREFERENCE_COOKIES.lang ? { name, value: "hi" } : undefined),
  }),
  headers: async () => new Headers(),
}));

const hi = createTranslator("hi");
const en = createTranslator("en");

describe("site header and footer", () => {
  it("marks the current section and has no axe violations", async () => {
    const { container } = render(
      <I18nProvider initialLang="en">
        <SiteHeader initialDisplay={{ highContrast: false, largeText: false }} />
        <main id="main" />
        <SiteFooter />
      </I18nProvider>,
    );
    expect(screen.getByRole("link", { name: en("nav.track") })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: en("nav.report") })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("contentinfo")).toHaveTextContent(en("footer.poweredBy"));
    await expectNoAxeViolations(container);
  });
});

describe("page titles", () => {
  it("names the tracking and not-found pages in the visitor's language, and the staff portal in English", async () => {
    expect(await trackMetadata()).toEqual({ title: hi("track.heading") });
    expect(await notFoundMetadata()).toEqual({ title: hi("notFound.title") });
    expect(staffMetadata).toEqual({ title: "Staff portal" });
  });

  it("renders the not-found notice in the visitor's language", async () => {
    // NotFoundNotice is an async server component, which Testing Library cannot await itself.
    expect(NotFound()).toEqual(<NotFoundNotice kind="page" />);
    render(await NotFoundNotice({ kind: "page" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(hi("notFound.title"));
    expect(screen.getByRole("link", { name: hi("notFound.toTrack") })).toHaveAttribute("href", "/track");
  });
});

describe("CopyButton", () => {
  it("copies the text and announces it", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLang="en">
        <CopyButton text="https://example.test/link" />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: en("copy.copy") }));
    expect(await navigator.clipboard.readText()).toBe("https://example.test/link");
    expect(screen.getByRole("button", { name: en("copy.copied") })).toBeVisible();
  });
});
