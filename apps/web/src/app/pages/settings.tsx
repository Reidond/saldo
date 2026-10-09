import { Download, LogOut, ShieldCheck, Sparkles } from "lucide-react";
import { currencyOptions, localeOptions } from "../../lib/preferences";
import { savePreferences } from "../../server/actions";
import { getRequestContext } from "../../server/context";
import { PreferencesForm } from "../client/preferences-form";
import { SignOutLink } from "../client/sign-out-link";
import {
  Card,
  CardHeader,
  Initial,
  Notice,
  PageHeader,
  Pill,
} from "../ui/components";
import { buttonClass } from "../ui/styles";
import { attempt, Title } from "./shared";

function timeZones(current: string) {
  const zones = Intl.supportedValuesOf?.("timeZone") ?? [];
  return Array.from(new Set(["UTC", current, ...zones]));
}

export async function SettingsPage() {
  const { load, preferences, dataSource } = getRequestContext();
  const [me, status] = await Promise.all([
    attempt(load.me),
    attempt(load.status),
  ]);
  const aiConnected = status.ok && status.value.aiConnected;
  const name = (me.ok && (me.value.displayName || me.value.email)) || "Owner";
  return (
    <>
      <Title>Settings</Title>
      <PageHeader
        title="Settings"
        description="Your account, AI connection, display preferences and data."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          id="account"
          aria-labelledby="account-title"
          className="scroll-mt-20"
        >
          <CardHeader id="account-title" title="Account" />
          <div className="px-5 pb-5">
            {me.ok ? (
              <div className="flex items-center gap-3">
                <Initial name={name} size="md" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{name}</p>
                  <p className="truncate text-sm text-ink-muted">
                    {me.value.email ?? "No email shared by Access"} ·{" "}
                    {me.value.role === "owner" ? "Owner" : me.value.role}
                  </p>
                </div>
              </div>
            ) : (
              <Notice
                tone={me.error.code === "unauthenticated" ? "warn" : "info"}
              >
                {me.error.code === "unauthenticated"
                  ? "Your session expired. Reload to sign in again."
                  : "Account details aren’t available right now."}
              </Notice>
            )}
            <p className="mt-4 text-sm text-ink-muted">
              Sign-in is managed by Cloudflare Access; there is no separate
              Saldo password. Signing out ends your Saldo session at once and
              your session for every app behind the same Access team.
            </p>
            <SignOutLink className={`${buttonClass({ icon: "leading" })} mt-4`}>
              <LogOut
                className="size-4.5"
                absoluteStrokeWidth
                strokeWidth={2}
                aria-hidden="true"
              />
              Sign out
            </SignOutLink>
          </div>
        </Card>

        <Card
          id="chatgpt"
          aria-labelledby="chatgpt-title"
          className="scroll-mt-20"
        >
          <CardHeader
            id="chatgpt-title"
            title="ChatGPT"
            action={
              <Pill tone={aiConnected ? "brand" : "neutral"}>
                {aiConnected ? "Connected" : "AI unavailable"}
              </Pill>
            }
          />
          <div className="px-5 pb-5 text-sm text-ink-muted">
            <div className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-soft-ink">
                <Sparkles
                  className="size-4.5"
                  absoluteStrokeWidth
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </span>
              <p>
                {aiConnected
                  ? "Chat can read your messages and screenshots and propose changes for you to review."
                  : status.ok
                    ? "ChatGPT isn’t connected, so chat can’t read messages or screenshots. Signing in to Saldo doesn’t connect AI by itself."
                    : "Saldo couldn’t check the AI connection right now."}
              </p>
            </div>
            <p className="mt-3">
              Manual entry, CSV import and export work without AI.
              {!aiConnected &&
                " Connecting your ChatGPT plan from here arrives in a later update."}
            </p>
          </div>
        </Card>

        <Card aria-labelledby="display-title" className="lg:col-span-2">
          <CardHeader
            id="display-title"
            title="Display"
            description="Saved in this browser. Used for formatting money and dates, and for what counts as today."
          />
          <div className="px-5 pb-5">
            <PreferencesForm
              initial={preferences}
              currencies={Array.from(
                new Set([preferences.currency, ...currencyOptions]),
              )}
              locales={localeOptions.map(([value, label]) => [value, label])}
              timeZones={timeZones(preferences.timeZone)}
              save={savePreferences}
            />
          </div>
        </Card>

        <Card aria-labelledby="export-title">
          <CardHeader
            id="export-title"
            title="Export"
            description="Download every subscription you track."
          />
          <div className="flex flex-wrap gap-2 px-5 pb-5">
            <a
              href="/settings/export.csv"
              download
              className={buttonClass({ icon: "leading" })}
            >
              <Download
                className="size-4.5"
                absoluteStrokeWidth
                strokeWidth={2}
                aria-hidden="true"
              />
              CSV
            </a>
            <a
              href="/settings/export.json"
              download
              className={buttonClass({ icon: "leading" })}
            >
              <Download
                className="size-4.5"
                absoluteStrokeWidth
                strokeWidth={2}
                aria-hidden="true"
              />
              JSON
            </a>
            <p className="w-full pt-1 text-sm text-ink-muted">
              The CSV uses the import columns, so it can be imported again.
            </p>
          </div>
        </Card>

        <Card aria-labelledby="privacy-title">
          <CardHeader id="privacy-title" title="Your data" />
          <div className="flex gap-3 px-5 pb-5 text-sm text-ink-muted">
            <ShieldCheck
              className="mt-0.5 size-4.5 shrink-0 text-brand"
              absoluteStrokeWidth
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <div className="space-y-2">
              <p>
                Records live in private storage on your Cloudflare account and
                only you can open them.
              </p>
              <p>
                A message or screenshot goes to ChatGPT only when you press
                send, for that request. Proposals are drafts until you decide.
              </p>
              {dataSource === "synthetic" && (
                <p className="font-medium text-warn-ink">
                  This development server shows fictional data; nothing here
                  reaches a real workspace.
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
