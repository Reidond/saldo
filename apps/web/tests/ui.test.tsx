// @vitest-environment jsdom
import type { Subscription } from "@saldo/domain";
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
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { Chat } from "../src/app/client/chat";
import { draftsStore } from "../src/app/client/drafts-store";
import type { SaveProposal } from "../src/app/client/review-card";
import { CsvImport, DraftInbox } from "../src/app/client/review-inbox";
import { SubscriptionForm } from "../src/app/client/subscription-form";
import {
  NavigationContext,
  type Navigation,
} from "../src/framework/navigation";
import type {
  ProposalResult,
  SaveSubscriptionState,
} from "../src/server/actions";
import { syntheticSubscriptions } from "../src/server/api/synthetic";

const saved = syntheticSubscriptions(new Date("2026-10-08T12:00:00Z"));
let navigate: ReturnType<typeof vi.fn<Navigation["navigate"]>>;

function renderWithNavigation(ui: ReactNode) {
  return render(
    <NavigationContext value={{ pending: false, navigate }}>
      {ui}
    </NavigationContext>,
  );
}

beforeEach(() => {
  navigate = vi.fn<Navigation["navigate"]>();
  draftsStore.reset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function importCsv(text: string) {
  const file = new File([text], "synthetic.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  const input = document.querySelector<HTMLInputElement>(
    'input[accept*="csv"]',
  )!;
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText(/ready below/);
}

function Inbox({
  save,
  items = saved,
}: {
  save: SaveProposal;
  items?: Subscription[];
}) {
  return (
    <>
      <CsvImport subscriptions={items} />
      <DraftInbox subscriptions={items} locale="en-US" save={save} />
    </>
  );
}

describe("review drafts (DOM integration, not visual QA)", () => {
  it("saves nothing until a decision, and blocks a duplicate unless it updates", async () => {
    const save = vi.fn<SaveProposal>(async ({ proposal }) => ({
      ok: true,
      id: proposal.targetId ?? proposal.id,
      alreadySaved: false,
    }));
    renderWithNavigation(<Inbox save={save} />);
    await importCsv(
      "service,amount,currency,cadence,status\nLumen Music,10.99,USD,monthly,active",
    );
    expect(save).not.toHaveBeenCalled();
    const card = screen.getByRole("article");
    const target = within(card).getByLabelText("Save as") as HTMLSelectElement;
    expect(target.value).toBe("syn-lumen");
    await userEvent.selectOptions(target, "__new");
    expect(
      (
        within(card).getByRole("button", {
          name: "Create",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      within(card).getByText(/Already tracked as Lumen Music/),
    ).toBeTruthy();
    await userEvent.selectOptions(target, "syn-lumen");
    await userEvent.click(
      within(card).getByRole("button", { name: "Update Lumen Music" }),
    );
    await screen.findByText("Updated Lumen Music");
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].proposal).toMatchObject({
      operation: "update",
      targetId: "syn-lumen",
      amount: 10.99,
    });
  });

  it("retries an uncertain save with the same request ID", async () => {
    const results: ProposalResult[] = [
      {
        ok: false,
        message: "Saldo's data service is unavailable right now.",
        retryable: true,
      },
      { ok: true, id: "new-id", alreadySaved: true },
    ];
    const save = vi.fn<SaveProposal>(async () => results.shift()!);
    renderWithNavigation(<Inbox save={save} />);
    await importCsv(
      "service,amount,currency,cadence,status\nSynthetic Plan,2,EUR,monthly,active",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/can’t save twice/);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Created");
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0].requestId).toBe(
      save.mock.calls[1][0].requestId,
    );
    expect(save.mock.calls[0][0].proposal).toEqual(
      save.mock.calls[1][0].proposal,
    );
  });

  it("gives an edited draft a new request ID, and discarding can be undone", async () => {
    const save = vi.fn<SaveProposal>();
    renderWithNavigation(<Inbox save={save} />);
    await importCsv(
      "service,amount,currency,cadence,status\nSynthetic Plan,2,EUR,monthly,active",
    );
    const before = draftsSnapshot()[0].requestId;
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Synthetic Plan" }),
    );
    const amount = screen.getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "3");
    await userEvent.click(
      screen.getByRole("button", { name: "Use these details" }),
    );
    expect(draftsSnapshot()[0]).toMatchObject({ proposal: { amount: 3 } });
    expect(draftsSnapshot()[0].requestId).not.toBe(before);
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText(/Discarded. Nothing was saved./)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses files that are not small CSVs", async () => {
    renderWithNavigation(<Inbox save={vi.fn()} />);
    const input = document.querySelector<HTMLInputElement>(
      'input[accept*="csv"]',
    )!;
    const big = new File(["x"], "big.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: 3 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /smaller than 2 MB/,
    );
    expect(draftsSnapshot()).toHaveLength(0);
  });
});

const draftsSnapshot = () => draftsStore.get().drafts;

describe("manual subscription form", () => {
  const initial = {
    name: "",
    amount: null,
    currency: "USD",
    cadence: "monthly" as const,
    renewalDate: null,
    status: "active" as const,
    category: "Other",
    source: "",
    lastVerified: null,
    notes: "",
  };

  it("submits the typed values, shows field errors, and opens the record once saved", async () => {
    const states: SaveSubscriptionState[] = [
      {
        status: "error",
        message: "Check the highlighted fields. Nothing was saved.",
        fieldErrors: {
          currency: "Use a three-letter code such as USD, or UNK if unknown.",
        },
      },
      { status: "saved", id: "new-id", name: "Synthetic Work" },
    ];
    const save = vi.fn(
      async (_state: SaveSubscriptionState, data: FormData) => {
        void data;
        return states.shift()!;
      },
    );
    renderWithNavigation(
      <SubscriptionForm
        initial={initial}
        categories={["Other"]}
        lastVerifiedLabel={null}
        cancelHref="/subscriptions"
        save={save}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
    ).toBe("/subscriptions");
    await userEvent.type(screen.getByLabelText("Name"), "Synthetic Work");
    await userEvent.type(screen.getByLabelText(/Amount/), "5");
    await userEvent.click(
      screen.getByRole("button", { name: "Add subscription" }),
    );
    await screen.findByText(/Check the highlighted fields/);
    const data = save.mock.calls[0][1];
    expect(Object.fromEntries(data)).toMatchObject({
      name: "Synthetic Work",
      amount: "5",
      currency: "USD",
      cadence: "monthly",
    });
    const currency = screen.getByLabelText("Currency");
    expect(currency.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(currency);
    expect(screen.getByLabelText("Name") as HTMLInputElement).toHaveProperty(
      "value",
      "Synthetic Work",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add subscription" }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/subscriptions/new-id?saved=1", {
        replace: true,
        scroll: true,
      }),
    );
  });
});

describe("chat", () => {
  const pngFile = (name: string) =>
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, {
      type: "image/png",
    });

  it("keeps manual workflows and sends nothing when AI is unavailable", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderWithNavigation(
      <Chat
        aiAvailable={false}
        subscriptions={saved}
        locale="en-US"
        save={vi.fn()}
      />,
    );
    expect(screen.getByText("AI is unavailable")).toBeTruthy();
    expect(
      (screen.getByLabelText("Message Saldo") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Send for review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("link", { name: "Add manually" }).getAttribute("href"),
    ).toBe("/subscriptions/new");
    expect(
      screen.getByRole("link", { name: "Import CSV" }).getAttribute("href"),
    ).toBe("/review#import");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("previews and removes images, and refuses unsupported ones", async () => {
    renderWithNavigation(
      <Chat aiAvailable subscriptions={saved} locale="en-US" save={vi.fn()} />,
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [pngFile("receipt.png")] } });
    await screen.findByRole("button", { name: "Remove receipt.png" });
    expect(
      within(screen.getByRole("list", { name: "Attached images" })).getByText(
        "receipt.png",
      ),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove receipt.png" }),
    );
    expect(screen.queryByRole("list", { name: "Attached images" })).toBeNull();
    fireEvent.change(input, {
      target: {
        files: [new File(["GIF89a"], "anim.gif", { type: "image/gif" })],
      },
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /PNG, JPEG and WebP/,
    );
    fireEvent.change(input, {
      target: { files: ["a", "b", "c", "d"].map((n) => pngFile(`${n}.png`)) },
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /up to 3 images/,
    );
  });

  it("locks repeated sends and cancels an interrupted request without saving", async () => {
    let aborted = false;
    const fetchSpy = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const save = vi.fn<SaveProposal>();
    renderWithNavigation(
      <Chat aiAvailable subscriptions={saved} locale="en-US" save={save} />,
    );
    await userEvent.type(
      screen.getByLabelText("Message Saldo"),
      "Add Synthetic Notes for $6 a month",
    );
    const send = screen.getByRole("button", { name: "Send for review" });
    act(() => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    expect(fetchSpy.mock.calls[0][0]).toBe("/chat/messages");
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(aborted).toBe(true));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Stopped. Nothing was saved/,
    );
    expect(
      (screen.getByLabelText("Message Saldo") as HTMLTextAreaElement).value,
    ).toBe("Add Synthetic Notes for $6 a month");
    expect(screen.getByText("Not sent")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("turns a reply's proposals into review cards", async () => {
    const proposal = {
      ...saved[0],
      id: "proposal-1",
      name: "Synthetic Notes",
      operation: "add",
      warnings: ["Renewal date not visible. Left unknown."],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          reply: "Check the details below.",
          proposals: [proposal],
        }),
      ),
    );
    renderWithNavigation(
      <Chat aiAvailable subscriptions={saved} locale="en-US" save={vi.fn()} />,
    );
    await userEvent.type(
      screen.getByLabelText("Message Saldo"),
      "Add Synthetic Notes{Enter}",
    );
    await screen.findByText("Check the details below.");
    const card = screen.getByRole("article");
    expect(within(card).getByText("Synthetic Notes")).toBeTruthy();
    expect(within(card).getByText(/Renewal date not visible/)).toBeTruthy();
    const body = JSON.parse(
      String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body),
    );
    expect(body).toMatchObject({
      message: "Add Synthetic Notes",
      attachments: [],
      history: [],
    });
  });
});
