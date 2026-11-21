// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/I18nProvider";
import PhoneVerify from "@/components/PhoneVerify";
import { createTranslator } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const t = createTranslator("en");

/** A page with an opener button that shows the dialog, like the report form does. */
function Page({ onVerified = vi.fn().mockResolvedValue(null) }) {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider initialLang="en">
      <button onClick={() => setOpen(true)}>Open dialog</button>
      {open && <PhoneVerify onVerified={onVerified} onCancel={() => setOpen(false)} busy={false} />}
    </I18nProvider>
  );
}

describe("PhoneVerify dialog", () => {
  beforeEach(() => localStorage.clear());

  it("moves focus into the dialog on open and back to the opener on Escape", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: t("verify.title") });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText(t("verify.phone"))).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("wraps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = screen.getByRole("dialog");
    const phone = screen.getByLabelText(t("verify.phone"));
    const lastButton = screen.getByRole("button", { name: t("verify.sendUnverified") });

    await user.tab({ shift: true });
    expect(lastButton).toHaveFocus();
    await user.tab();
    expect(phone).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("pre-fills a remembered phone number", async () => {
    localStorage.setItem("civicresolve.phone", "98765 43210");
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(screen.getByLabelText(t("verify.phone"))).toHaveValue("98765 43210");
  });

  it("requests a code and shows the demo code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ challenge: "c", phone: "+919876543210", devCode: "123456" }))),
    );
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await user.type(screen.getByLabelText(t("verify.phone")), "9876543210");
    await user.click(screen.getByRole("button", { name: t("verify.sendCode") }));
    expect(await screen.findByText("123456")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
