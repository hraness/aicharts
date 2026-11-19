"use client";
import { useEffect, useRef } from "react";
import { createAnalytics, type Analytics } from "@hraness/analytics/browser";

let client: Analytics<"article cta viewed"> | undefined;
const seen = new Set<string>();
function analytics() {
  return (client ??= createAnalytics<"article cta viewed">({
    token: "phc_xqEpQgmKxZDYda3DvForfnKDuVL6urqD2YTtqDPmUL4u",
    hosts: ["aicharts.io"],
    siteId: "aicharts",
    apiHost: "https://us.i.posthog.com",
    regionUrl: false,
    preset: "app",
    surface: "site",
    pageKind: "product_guide",
    privacyHref: "/blog#privacy",
    replaySampleRate: 0,
    words: {
      allBody:
        "May aicharts remember your visits to the guide on this browser?",
      adsBody: "May aicharts remember your measurement preference?",
      allow: "Allow",
      decline: "Decline",
      privacy: "Privacy",
      on: "Visit measurement is on.",
      off: "Visits are counted without cookies.",
      adsOff: "Your preference is saved.",
    },
  }));
}
export function ArticleAction({
  slug,
  href,
  heading,
  description,
  label,
}: {
  slug: string;
  href: string;
  heading: string;
  description: string;
  label: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const api = analytics();
    const element = ref.current;
    if (!element || !window.IntersectionObserver || seen.has(slug)) return;
    let visible = false;
    function impression() {
      if (!visible || document.visibilityState !== "visible" || seen.has(slug))
        return;
      seen.add(slug);
      api.track("article cta viewed", {
        article_slug: slug,
        placement: "article_end",
        cta: "open",
      });
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry && entry.intersectionRatio >= 0.5;
        impression();
      },
      { threshold: 0.5 },
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", impression);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", impression);
    };
  }, [slug]);
  return (
    <aside
      ref={ref}
      className="article-action"
      data-pj-article-cta
      data-pj-slug={slug}
      data-pj-action="open"
    >
      <h2>{heading}</h2>
      <p>{description}</p>
      <a
        data-pj-cta-link
        href={href}
        onClick={() =>
          analytics().track("cta clicked", {
            article_slug: slug,
            placement: "article_end",
            cta: "open",
          })
        }
      >
        {label}
        <span aria-hidden="true"> ↗</span>
      </a>
    </aside>
  );
}
export function PrivacyChoices() {
  return (
    <button
      className="privacy-choice"
      onClick={() => analytics().privacyChoices()}
    >
      Privacy choices
    </button>
  );
}
