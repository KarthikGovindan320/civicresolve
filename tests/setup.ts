// Shared test setup: jest-dom matchers, and unmounting Testing Library trees between tests
// (Vitest does not expose globals, so Testing Library cannot register its own cleanup).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
