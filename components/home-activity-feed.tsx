import Link from "next/link";

import {
  HOME_ACTIVITY_FEED,
  HOME_ACTIVITY_SOURCE_LABEL,
  type HomeActivityItem,
} from "@/lib/home-activity-feed";
import { formatUpdateDate } from "@/lib/coding-agent-updates";

function kindLabel(kind: HomeActivityItem["kind"]): string {
  return kind === "model" ? "Model" : "Note";
}

export function HomeActivityFeed() {
  if (HOME_ACTIVITY_FEED.length === 0) return null;
  return (
    <section
      aria-labelledby="home-activity-title"
      className="home-activity"
      data-analytics-surface="home_activity"
    >
      <div className="home-activity__heading">
        <h2 id="home-activity-title">Recent models and notes</h2>
        <p>
          Compact Index listings and published analysis. Model scores come from
          {" "}{HOME_ACTIVITY_SOURCE_LABEL}.
        </p>
      </div>
      <ol className="home-activity__list">
        {HOME_ACTIVITY_FEED.map(item => (
          <li key={item.id}>
            <Link href={item.href}>
              <span className="home-activity__kind">{kindLabel(item.kind)}</span>
              <strong>{item.title}</strong>
              <span className="home-activity__detail">{item.detail}</span>
              <time dateTime={item.occurredOn}>{formatUpdateDate(item.occurredOn)}</time>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
