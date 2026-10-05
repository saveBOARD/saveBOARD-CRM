import Link from "next/link";
import clsx from "clsx";
import type { ActionState } from "@/lib/action-state";

// Form pieces from the ERP design (docs/erp-reference/Design.md §5 "Form", §6 "Inputs", "Messages").

type Base = { name: string; label: string; error?: string; className?: string; hint?: string };

function Label({ name, label, error, hint, className, children }: Base & { children: React.ReactNode }) {
  return (
    <div className={clsx("grid content-start gap-1", className)}>
      <label htmlFor={name} className="text-xs text-muted">
        {label}
      </label>
      {children}
      {hint && !error && <span className="text-xs text-muted">{hint}</span>}
      {error && (
        <span id={`${name}-error`} role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </div>
  );
}

export function TextField({ defaultValue, type = "text", required, ...p }: Base & { defaultValue?: string | null; type?: string; required?: boolean }) {
  return (
    <Label {...p}>
      <input
        id={p.name}
        name={p.name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? ""}
        aria-invalid={!!p.error}
        aria-describedby={p.error ? `${p.name}-error` : undefined}
        className={clsx("input", p.error && "border-bad")}
      />
    </Label>
  );
}

export function TextArea({ defaultValue, rows = 4, ...p }: Base & { defaultValue?: string | null; rows?: number }) {
  return (
    <Label {...p}>
      <textarea
        id={p.name}
        name={p.name}
        rows={rows}
        defaultValue={defaultValue ?? ""}
        aria-invalid={!!p.error}
        className={clsx("input", p.error && "border-bad")}
      />
    </Label>
  );
}

export function SelectField({
  options,
  defaultValue,
  ...p
}: Base & { options: { value: string; label: string }[]; defaultValue?: string | null }) {
  return (
    <Label {...p}>
      <select id={p.name} name={p.name} defaultValue={defaultValue ?? ""} aria-invalid={!!p.error} className={clsx("input", p.error && "border-bad")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Label>
  );
}

export function Checkbox({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label htmlFor={name} className="flex items-start gap-2 text-sm">
      <input id={name} name={name} type="checkbox" defaultChecked={defaultChecked} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 font-medium">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

/** Message, duplicate links, and the confirm-anyway checkbox, shown at the top of a form. */
export function FormMessages({ state, allowConfirm }: { state: ActionState; allowConfirm?: boolean }) {
  if (!state.message && !state.duplicates?.length) return null;
  return (
    <div role="alert" className={clsx("rounded px-3 py-2 text-sm", state.ok ? "bg-ok/15 text-ok" : "bg-bad/10 text-bad")}>
      {state.message}
      {state.duplicates && state.duplicates.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-ink">
          {state.duplicates.map((d) => (
            <li key={d.id}>
              <Link href={d.href} className="text-link hover:underline">
                {d.label}
              </Link>{" "}
              <span className="text-muted">({d.reason})</span>
            </li>
          ))}
        </ul>
      )}
      {allowConfirm && state.duplicates && state.duplicates.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-ink">
          <input type="checkbox" name="confirm_duplicate" value="yes" />
          It&apos;s a different company: save it anyway
        </label>
      )}
    </div>
  );
}

/** Sticky bar at the bottom of a form: status on the left, Cancel and the primary action on the right. */
export function ActionBar({ cancelHref, submitLabel, pending }: { cancelHref: string; submitLabel: string; pending: boolean }) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-4 flex items-center gap-2 border-t border-line bg-page/95 px-4 py-3 sm:-mx-6 sm:px-6">
      <span className="mr-auto text-sm text-muted">{pending ? "Saving…" : ""}</span>
      <Link href={cancelHref} className="btn-secondary">
        Cancel
      </Link>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}
