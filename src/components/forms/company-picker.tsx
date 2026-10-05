"use client";

import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { findCompanies } from "@/app/(app)/actions";

type Option = { id: string; name: string; detail: string | null };

// Type-ahead company look-up (4,000+ companies is too many for a plain drop-down). Submits `company_id`.
export function CompanyPicker({ defaultId, defaultName, error }: { defaultId?: string | null; defaultName?: string | null; error?: string }) {
  const [selected, setSelected] = useState<Option | null>(defaultId ? { id: defaultId, name: defaultName ?? "", detail: null } : null);
  const [text, setText] = useState(defaultName ?? "");
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const seq = useRef(0);

  useEffect(() => {
    if (selected && text === selected.name) return;
    const q = text.trim();
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const found = q.length >= 2 ? await findCompanies(q) : [];
      if (n === seq.current) {
        setOptions(found);
        setActive(0);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [text, selected]);

  function choose(o: Option) {
    setSelected(o);
    setText(o.name);
    setOpen(false);
  }

  return (
    <div className="relative grid content-start gap-1 sm:col-span-2">
      <label htmlFor="company_search" className="text-xs text-muted">
        Company
      </label>
      <input type="hidden" name="company_id" value={selected?.id ?? ""} />
      <input type="hidden" name="company_name" value={selected?.name ?? ""} />
      <div className="flex gap-1">
        <input
          id="company_search"
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className={clsx("input flex-1", error && "border-bad")}
          placeholder="Type 2 or more letters of the name or domain"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
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
            aria-label="Clear company"
            title="Clear company"
            onClick={() => {
              setSelected(null);
              setText("");
              setOptions([]);
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {!selected && text.trim().length > 0 && <span className="text-xs text-warn">Pick a company from the list, or clear the box for no company.</span>}
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
