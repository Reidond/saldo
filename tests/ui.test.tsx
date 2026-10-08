// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { subscriptionSchema } from "../src/domain";
const respond = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    }),
  );
let requests: { path: string; body: any; options?: RequestInit }[];
let connected = false;
let chatHandler: ((options: RequestInit) => Promise<Response>) | undefined;
let reviewHandler: ((body: any) => Promise<Response>) | undefined;
beforeEach(() => {
  requests = [];
  connected = false;
  chatHandler = undefined;
  reviewHandler = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      requests.push({ path, body, options });
      if (path === "/api/status")
        return respond({ authenticated: connected, aiConnected: connected });
      if (path === "/api/subscriptions" && !options?.method)
        return respond({ subscriptions: [] });
      if (path === "/api/subscriptions")
        return respond({
          subscription: { ...body, id: body.id ?? "new-record" },
        });
      if (path === "/api/chat" && chatHandler) return chatHandler(options!);
      if (path === "/api/review" && reviewHandler) return reviewHandler(body);
      return respond({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function loaded() {
  render(<App />);
  await waitFor(() =>
    expect(screen.queryByText("Opening your workspace…")).toBeNull(),
  );
}
async function sample() {
  await loaded();
  await userEvent.click(screen.getByRole("button", { name: "Load demo" }));
}
async function importCsv(text: string) {
  await userEvent.click(screen.getByRole("button", { name: "Import CSV" }));
  const file = new File([text], "synthetic.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  const input = document.querySelector<HTMLInputElement>(
    'input[accept*="csv"]',
  )!;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText("0 of 1 checked")).toBeTruthy());
}
describe("UI state and review boundaries (DOM integration, not visual QA)", () => {
  it("starts empty and blocks disconnected real saves", async () => {
    await loaded();
    expect(screen.queryByRole("button", { name: "Edit Spotify" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Add subscription" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Add subscription",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests.filter((r) => r.options?.method === "POST")).toHaveLength(
      0,
    );
  });
  it("cancels edits and keeps synthetic saves isolated from the real ledger", async () => {
    await sample();
    await userEvent.click(screen.getByRole("button", { name: "Edit Spotify" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.clear(within(dialog).getByLabelText("Subscription name"));
    await userEvent.type(
      within(dialog).getByLabelText("Subscription name"),
      "Not saved",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.getByRole("button", { name: "Edit Spotify" })).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Add subscription" }),
    );
    await userEvent.type(
      screen.getByLabelText("Subscription name"),
      "Synthetic Library",
    );
    await userEvent.type(screen.getByLabelText(/Amount/), "5");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add subscription",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit Synthetic Library" }),
      ).toBeTruthy(),
    );
    expect(requests.filter((r) => r.options?.method === "POST")).toHaveLength(
      0,
    );
    await userEvent.click(screen.getByRole("button", { name: "Exit demo" }));
    expect(
      screen.queryByRole("button", { name: "Edit Synthetic Library" }),
    ).toBeNull();
  });
  it("requires per-record review before CSV saves and blocks duplicates", async () => {
    await sample();
    await importCsv(
      "service,amount,currency,cadence,status\nSynthetic Music,5,USD,monthly,active",
    );
    const save = screen.getByRole("button", {
      name: "Save 1 reviewed subscription",
    });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(requests.filter((r) => r.path === "/api/review")).toHaveLength(0);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(save);
    await waitFor(() =>
      expect(
        screen.getAllByText(/1 subscription saved/).length,
      ).toBeGreaterThan(0),
    );
    await userEvent.click(screen.getByRole("button", { name: "Close import" }));
    expect(
      screen.getByRole("button", { name: "Edit Synthetic Music" }),
    ).toBeTruthy();
    await importCsv(
      "service,amount,currency,cadence,status\nSynthetic Music,5,USD,monthly,active",
    );
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(
      screen.getByRole("button", { name: "Save 1 reviewed subscription" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("duplicate"),
    );
    expect(requests.filter((r) => r.path === "/api/review")).toHaveLength(0);
  });
  it("sends valid manual records to authenticated API", async () => {
    connected = true;
    await loaded();
    await userEvent.click(
      screen.getByRole("button", { name: "Add subscription" }),
    );
    await userEvent.type(
      screen.getByLabelText("Subscription name"),
      "Synthetic Work",
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add subscription",
      }),
    );
    await waitFor(() =>
      expect(
        requests.find(
          (r) =>
            r.path === "/api/subscriptions" && r.options?.method === "POST",
        ),
      ).toBeTruthy(),
    );
    const data = requests.find((r) => r.options?.method === "POST")!.body;
    expect(() =>
      subscriptionSchema.parse({ ...data, id: "test" }),
    ).not.toThrow();
  });
  it("locks repeated AI sends and cancels an interrupted request without saving", async () => {
    connected = true;
    let aborted = false;
    chatHandler = (options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    await loaded();
    await userEvent.click(
      screen.getByRole("button", { name: "Chat with Saldo" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Message Saldo AI" }),
      "Review a synthetic subscription",
    );
    const send = screen.getByRole("button", { name: "Send to AI for review" });
    act(() => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    await waitFor(() =>
      expect(requests.filter((r) => r.path === "/api/chat")).toHaveLength(1),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Cancel request/ }),
    );
    await waitFor(() => expect(aborted).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Close import" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests.filter((r) => r.path === "/api/review")).toHaveLength(0);
  });
  it("retries uncertain atomic review with the same request ID", async () => {
    connected = true;
    let attempts = 0;
    reviewHandler = (body) => {
      attempts++;
      if (attempts === 1)
        return Promise.reject(new Error("Connection interrupted"));
      return respond({ subscriptions: body.proposals });
    };
    await loaded();
    await importCsv(
      "service,amount,currency,cadence,status\nSynthetic Plan,2,EUR,monthly,active",
    );
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(
      screen.getByRole("button", { name: "Save 1 reviewed subscription" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry this reviewed batch" }),
      ).toBeTruthy(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Retry this reviewed batch" }),
    );
    await waitFor(() =>
      expect(requests.filter((r) => r.path === "/api/review")).toHaveLength(2),
    );
    const batches = requests.filter((r) => r.path === "/api/review");
    expect(batches[0].body.requestId).toBe(batches[1].body.requestId);
    expect(batches[0].body.proposals).toEqual(batches[1].body.proposals);
  });
});
