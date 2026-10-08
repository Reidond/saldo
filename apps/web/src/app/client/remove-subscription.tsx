"use client";
import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useNavigation } from "../../framework/navigation";
import type { RemoveResult } from "../../server/actions";
import { buttonClass } from "../ui/styles";

/** Two-step remove: the confirmation says what removing does and doesn't do. */
export function RemoveSubscription({
  id,
  name,
  remove,
}: {
  id: string;
  name: string;
  remove: (id: string) => Promise<RemoveResult>;
}) {
  const { navigate } = useNavigation();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!confirming)
    return (
      <button
        type="button"
        className={buttonClass({ variant: "ghost", icon: "leading" })}
        onClick={() => setConfirming(true)}
      >
        <Trash2
          className="size-4.5"
          absoluteStrokeWidth
          strokeWidth={2}
          aria-hidden="true"
        />
        Remove
      </button>
    );

  return (
    <div
      role="alertdialog"
      aria-labelledby={`remove-${id}`}
      className="w-full rounded-xl bg-danger-soft p-4 text-danger-ink sm:w-auto sm:max-w-sm"
    >
      <p id={`remove-${id}`} className="text-sm font-medium">
        Remove {name} from your tracker?
      </p>
      <p className="mt-1 text-sm opacity-90">
        This doesn’t cancel the service with the provider.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={buttonClass({ variant: "danger", size: "sm" })}
          onClick={() =>
            startTransition(async () => {
              setError("");
              const result = await remove(id).catch(
                (e: unknown): RemoveResult => ({
                  ok: false,
                  message:
                    e instanceof Error ? e.message : "Could not remove it.",
                }),
              );
              if (result.ok)
                navigate(`/subscriptions?removed=${encodeURIComponent(name)}`, {
                  replace: true,
                });
              else setError(result.message);
            })
          }
        >
          {pending ? "Removing…" : "Remove"}
        </button>
        <button
          type="button"
          disabled={pending}
          autoFocus
          className={buttonClass({ variant: "secondary", size: "sm" })}
          onClick={() => {
            setConfirming(false);
            setError("");
          }}
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
