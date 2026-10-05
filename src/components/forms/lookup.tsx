"use client";

import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { findCompanies } from "@/app/(app)/actions";
import { findContacts } from "@/app/(app)/deal-actions";

export type LookupOption = { id: string; name: string; detail: string | null };
type Option = LookupOption;

type LookupProps = {
  /** Field name submitted with the chosen id; `${name}_label` carries the shown text (to refill after an error). */
  name: string;
  label: string;
  search: (q: string) => Promise<Option[]>;
  defaultId?: string | null;
  defaultName?: string | null;
  error?: string;
  placeholder?: string;
  onChange?: (o: Option | null) => void;
};

// Type-ahead look-up (thousands of companies and contacts are too many for a plain drop-down).
export function Lookup({ name, label, search, defaultId, defaultName, error, placeholder, onChange }: LookupProps) {
  const [selected, setSelected] = useState<Option | null>(defaultId ? { id: defaultId, name: defaultName ?? "", detail: null } : null);
  const [text, setText] = useState(defaultName ?? "");
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputId = useId();
  const seq = useRef(0);
  // Keep the latest search function without re-running the search when a parent passes a new one each render.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    if (selected && text === selected.name) return;
    const q = text.trim();
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const found = q.length >= 2 ? await searchRef.current(q) : [];
      if (n === seq.current) {
        setOptions(found);
        setActive(0);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [text, selected]);

  function choose(o: Option | null) {
    setSelected(o);
    setText(o?.name ?? "");
    setOpen(false);
    onChange?.(o);
  }

  return (
    <div className="relative grid content-start gap-1 sm:col-span-2">
      <label htmlFor={inputId} className="text-xs text-muted">
        {label}
      </label>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <input type="hidden" name={`${name}_label`} value={selected?.name ?? ""} />
      <div className="flex gap-1">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className={clsx("input flex-1", error && "border-bad")}
          placeholder={placeholder ?? "Type 2 or more letters"}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (selected) onChange?.(null);
            setSelected(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || options.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(options[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {(selected || text) && (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Clear ${label.toLowerCase()}`}
            title={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              choose(null);
              setOptions([]);
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {!selected && text.trim().length > 0 && <span className="text-xs text-warn">Pick from the list, or clear the box.</span>}
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute top-full z-20 mt-1 max-h-72 w-full overflow-auto rounded-md bg-surface py-1 shadow-lg ring-1 ring-line">
          {options.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              className={clsx("cursor-pointer px-3 py-1.5 text-sm", i === active ? "bg-[#eef5fc]" : "hover:bg-page")}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
            >
              {o.name}
              {o.detail && o.detail !== o.name && <span className="ml-2 text-xs text-muted">{o.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CompanyPicker(p: Omit<LookupProps, "name" | "label" | "search"> & { name?: string; label?: string }) {
  return <Lookup name="company_id" label="Company" search={findCompanies} placeholder="Type 2 or more letters of the name or domain" {...p} />;
}

export function ContactPicker({ companyId, ...p }: Omit<LookupProps, "name" | "label" | "search"> & { companyId?: string | null }) {
  return (
    <Lookup
      name="primary_contact_id"
      label="Main contact"
      search={(q) => findContacts(q, companyId)}
      placeholder="Type 2 or more letters of the name or email"
      {...p}
    />
  );
}
