"use client";
import { CompactPicker } from "./compact-picker";
import { useEffect, useState } from "react";
import { dateLabel, type entries as notes } from "@/journal/content";

const empty = { q: "", category: "", surface: "" };
export function Changelog({ entries }: { entries: typeof notes }) {
  const [filters, setFilters] = useState(empty);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    function read() {
      const params = new URLSearchParams(location.search);
      setFilters({
        q: params.get("q") ?? "",
        category: params.get("category") ?? "",
        surface: params.get("surface") ?? "",
      });
    }
    read();
    setReady(true);
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  function change(next: typeof empty) {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(next)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    history.replaceState(history.state, "", url);
    setFilters(next);
  }
  const filtered = entries.filter(
    (e) =>
      (!filters.category || filters.category === e.category) &&
      (!filters.surface || e.surfaces.includes(filters.surface)) &&
      [e.title, e.summary, e.category, ...e.surfaces]
        .join(" ")
        .toLowerCase()
        .includes(filters.q.trim().toLowerCase()),
  );
  const active = Object.values(filters).some(Boolean);
  return (
    <>
      <form
        hidden={!ready}
        role="search"
        className="filters"
        onSubmit={(e) => e.preventDefault()}
      >
        <input
          aria-label="Search updates"
          placeholder="Search updates"
          type="search"
          value={filters.q}
          onChange={(e) => change({ ...filters, q: e.target.value })}
        />
        <CompactPicker label="Category" value={filters.category} options={[{value:"",label:"All categories"}, ...[...new Set(entries.map(e => e.category))].sort().map(v => ({value:v,label:v}))]} onChange={v => change({...filters,category:v})} />
        <CompactPicker label="Surface" value={filters.surface} options={[{value:"",label:"All surfaces"}, ...[...new Set(entries.flatMap(e => e.surfaces))].sort().map(v => ({value:v,label:v}))]} onChange={v => change({...filters,surface:v})} />
      </form>
      {active && (
        <p className="filter-result">
          <span role="status">
            {filtered.length
              ? `${filtered.length} matching ${filtered.length === 1 ? "update" : "updates"}`
              : "No matching updates."}
          </span>{" "}
          <button onClick={() => change(empty)}>Clear filters</button>
        </p>
      )}
      {filtered.map((e) => (
        <article key={e.slug} id={e.slug} className="note" data-pj-entry>
          <time dateTime={e.date}>{dateLabel(e.date)}</time>
          <div>
            <div className="entry-meta">
              {[e.category, ...e.surfaces].join(" · ")}
            </div>
            <h2>
              <a href={`#${e.slug}`}>{e.title}</a>
            </h2>
            <p>{e.summary}</p>
            <a className="inline-link" href={e.link.href}>
              {e.link.label}
            </a>
          </div>
        </article>
      ))}
    </>
  );
}
