"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

// Top-bar search. A plain GET form to /search (works without JavaScript); "/" focuses it from anywhere.
export function SearchBox() {
  const input = useRef<HTMLInputElement>(null);
  const q = useSearchParams().get("q") ?? "";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form action="/search" role="search" className="relative hidden items-center md:flex">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-nav-ink/60" aria-hidden />
      <input
        ref={input}
        key={q}
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Search  ( / )"
        aria-label="Search companies, contacts and deals"
        className="w-56 rounded border border-nav-hover bg-nav-hover py-1.5 pr-2 pl-8 text-sm text-nav-ink placeholder:text-nav-ink/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 lg:w-72"
      />
    </form>
  );
}
