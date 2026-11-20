import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { JsonLd } from "@/components/catalog/json-ld";
import { pageMetadata } from "@/journal/content";
import { API_OBJECTS, RELEASES_HEADERS, RELEASES_URL, type ApiObject } from "@/lib/api";
import { catalog, SITE_URL } from "@/lib/catalog";
import { formatFullDate } from "@/lib/format";

const { dataset } = catalog;

export const metadata: Metadata = pageMetadata(
  "Free AI model benchmark API: Terminal-Bench scores and prices as JSON",
  "One free JSON endpoint with no key: Terminal-Bench scores, cost per task, Epoch AI scores and API prices for every Anthropic, OpenAI and Google model on aicharts, with each source's license.",
  "/api",
);

const SHELL_EXAMPLE = `curl -s ${RELEASES_URL} | jq '
  .releases[]
  | select(.deprecated | not)
  | {name, score: .terminalBench.accuracy, costPerTask: .terminalBench.costPerTaskUsd}'`;

const JS_EXAMPLE = `const res = await fetch("${RELEASES_URL}");
const { releases } = await res.json();

// Current models with a Terminal-Bench run, best score first
const ranked = releases
  .filter((r) => !r.deprecated && r.terminalBench)
  .sort((a, b) => b.terminalBench.accuracy - a.terminalBench.accuracy);

for (const r of ranked) {
  const { agent, accuracy, costPerTaskUsd } = r.terminalBench;
  console.log(r.name, agent, accuracy + "%", costPerTaskUsd);
}`;

// A current model with every kind of data, so the example shows each object.
const sample = dataset.releases.find(
  (r) => !r.deprecated && r.terminalBench?.costPerTaskUsd != null && r.pricing && r.epoch.length > 0,
);

function FieldTable({ object }: Readonly<{ object: ApiObject }>) {
  const captionId = `fields-${object.id}`;
  return (
    <div className="table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="data-table data-table--fields">
        <caption id={captionId}>{object.caption}</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {object.fields.map((f) => (
            <tr key={f.name}>
              <th scope="row">
                {/* Long dotted names may wrap after a dot on phones. */}
                <code>
                  {f.name
                    .split(".")
                    .flatMap((part, i) => (i === 0 ? [part] : [".", <wbr key={i} />, part]))}
                </code>
                <span className="field-type">{f.type}</span>
              </th>
              <td>{f.about}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ApiPage() {
  return (
    <article className="catalog-page api-page">
      <Breadcrumbs trail={[{ name: "API", href: "/api" }]} />
      <header className="page-head">
        <h1>aicharts API</h1>
        <p className="page-meta">
          <span>Free, no key</span>
          <span>JSON over HTTPS</span>
          <span>
            Data updated{" "}
            <time dateTime={dataset.updatedAt}>{formatFullDate(dataset.snapshotDate)}</time>
          </span>
        </p>
      </header>
      <p className="lead">
        One endpoint returns the data behind every chart on aicharts: each Anthropic, OpenAI and
        Google model with its run on the official Terminal-Bench leaderboard, Epoch AI&apos;s
        benchmark scores and its list API prices, plus each source&apos;s license. It needs no key
        or sign-up and answers requests from any website.
      </p>
      <section aria-labelledby="endpoint">
        <h2 id="endpoint">Endpoint</h2>
        <pre className="code-block" tabIndex={0}>
          <code>GET {RELEASES_URL}</code>
        </pre>
        <p>
          The response is JSON. Pages on any site can call it from the browser, since it sends{" "}
          <code>Access-Control-Allow-Origin: {RELEASES_HEADERS["Access-Control-Allow-Origin"]}</code>.
        </p>
      </section>
      <section aria-labelledby="examples">
        <h2 id="examples">Examples</h2>
        <p>Current models with their score and cost per task, in a shell with jq:</p>
        <pre className="code-block" tabIndex={0}>
          <code>{SHELL_EXAMPLE}</code>
        </pre>
        <p>The same in JavaScript, in a browser or Node:</p>
        <pre className="code-block" tabIndex={0}>
          <code>{JS_EXAMPLE}</code>
        </pre>
      </section>
      <section aria-labelledby="fields">
        <h2 id="fields">Fields</h2>
        <p>
          The response is one object. Percentages run from 0 to 100, prices are in US dollars and
          dates are UTC. A value that a source does not publish is null.
        </p>
        {API_OBJECTS.map((object) => (
          <FieldTable key={object.id} object={object} />
        ))}
      </section>
      {sample && (
        <section aria-labelledby="example">
          <h2 id="example">One release</h2>
          <p>
            {sample.name} in the current data
            {sample.epoch.length > 1 ? `, showing one of its ${sample.epoch.length} Epoch AI scores` : ""}:
          </p>
          <pre className="code-block" tabIndex={0}>
            <code>{JSON.stringify({ ...sample, epoch: sample.epoch.slice(0, 1) }, null, 2)}</code>
          </pre>
        </section>
      )}
      <section aria-labelledby="licenses">
        <h2 id="licenses">Licenses and credit</h2>
        <p>
          Each part of the data keeps its source&apos;s license, and every response lists them in{" "}
          <code>sources</code>. Keep that list, or the credits below, with any copy you publish.
        </p>
        <ul className="source-list">
          {dataset.sources.map((s) => (
            <li key={s.id}>
              <a href={s.url}>{s.name}</a> · <a href={s.licenseUrl}>{s.license}</a>
              <span>{s.covers}</span>
              <span className="source-credit">Credit: {s.attribution}</span>
            </li>
          ))}
        </ul>
        <p>
          The code that builds the data is open source under the MIT license, on{" "}
          <a href="https://github.com/hraness/aicharts">GitHub</a>.
        </p>
      </section>
      <section aria-labelledby="updates">
        <h2 id="updates">Updates and caching</h2>
        <p>
          A scheduled job reads the three sources five times a day and rebuilds the data only when
          a release, score or price changed; <code>updatedAt</code> records when. Browsers may keep
          a response for five minutes and shared caches for up to an hour, so asking more often
          returns the same data:
        </p>
        <pre className="code-block" tabIndex={0}>
          <code>Cache-Control: {RELEASES_HEADERS["Cache-Control"]}</code>
        </pre>
        <p>
          Agents can start from <a href="/llms.txt">llms.txt</a>, which summarizes the site and
          links every page.
        </p>
      </section>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: "aicharts AI model release data",
          description:
            "Terminal-Bench leaderboard runs, Epoch AI benchmark scores and list API prices for each Anthropic, OpenAI and Google model on aicharts, one item per model release, with each source's license and credit.",
          url: `${SITE_URL}/api`,
          isAccessibleForFree: true,
          creator: { "@type": "Organization", name: "Hraness", url: "https://hraness.com" },
          dateModified: dataset.updatedAt,
          isBasedOn: dataset.sources.map((s) => s.url),
          distribution: [
            { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: RELEASES_URL },
          ],
        }}
      />
    </article>
  );
}
