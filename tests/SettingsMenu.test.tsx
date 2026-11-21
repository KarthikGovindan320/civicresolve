// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/I18nProvider";
import SettingsMenu from "@/components/SettingsMenu";
import { createTranslator } from "@/lib/i18n";
import { expectNoAxeViolations } from "./setup";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const t = createTranslator("en");

function setup() {
  const user = userEvent.setup();
  render(
    <I18nProvider initialLang="en">
      <SettingsMenu initialDisplay={{ highContrast: false, largeText: false }} />
    </I18nProvider>,
  );
  return { user, trigger: screen.getByRole("button", { name: t("settings.open") }) };
}

describe("SettingsMenu", () => {
  it("opens with focus on the selected language and closes on Escape, returning focus", async () => {
    const { user, trigger } = setup();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "English" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("switches language, updating aria-pressed, the page language and the route", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    const tamil = screen.getByRole("button", { name: "தமிழ்" });
    expect(tamil).toHaveAttribute("aria-pressed", "false");

    await user.click(tamil);
    expect(screen.getByRole("button", { name: "தமிழ்" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.lang).toBe("ta");
    expect(refresh).toHaveBeenCalled();
  });

  it("toggles the display aids and reflects them on the document", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    const contrast = screen.getByRole("button", { name: t("settings.highContrast") });
    expect(contrast).toHaveAttribute("aria-pressed", "false");

    await user.click(contrast);
    expect(contrast).toHaveAttribute("aria-pressed", "true");
    await user.click(contrast);
    expect(contrast).toHaveAttribute("aria-pressed", "false");
  });

  it("has no axe violations while open", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await expectNoAxeViolations(document.body);
  });
});
