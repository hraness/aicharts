import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import measurements from "@/data/local-benchmarks.json";
import { pageMetadata } from "@/journal/content";
import { formatFullDate } from "@/lib/format";

const formatThroughput = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const metadata: Metadata = pageMetadata(
  "Local AI benchmarks for speed and model size",
  "Compare local language model speed on Apple M5 Max. See prompt processing, text generation, model sizes, and the exact llama.cpp command and weights.",
  "/local",
);

export default function LocalBenchmarksPage() {
  const {
    date, hardware, memoryGiB, os, conditions, runtime, quantization, tests, repetitions, models,
    arguments: benchmarkArgs,
  } = measurements;

  return (
    <article className="catalog-page">
      <Breadcrumbs trail={[{ name: "Local benchmarks", href: "/local" }]} />
      <header className="page-head">
        <h1>Local AI benchmarks</h1>
        <p className="page-meta">
          <span>{hardware} · {memoryGiB} GiB unified memory</span>
          <span><time dateTime={date}>{formatFullDate(date)}</time></span>
        </p>
      </header>
      <p className="lead">
        See how fast local models read a prompt and write a reply. All models below ran on the same Mac with Metal and {quantization} GGUF weights.
      </p>

      <section aria-labelledby="throughput">
        <h2 id="throughput">Tokens per second</h2>
        <div className="table-scroll" role="region" aria-labelledby="throughput" tabIndex={0}>
          <table className="data-table">
            <caption>Mean ± standard deviation across {repetitions} runs. Sizes are the weights on disk.</caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Weights</th>
                {tests.map((test) => <th scope="col" key={test.id}>{test.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.name}>
                  <th scope="row"><a href={model.source}>{model.name}</a></th>
                  <td>{(model.bytes / 1024 ** 3).toFixed(2)} GiB</td>
                  {model.results.map((result) => (
                    <td key={result.test}>
                      {formatThroughput.format(result.meanTokensPerSecond)} ± {formatThroughput.format(result.stddevTokensPerSecond)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Prompt processing covers reading the input. Generation covers writing the reply, measured here from an empty context. The tests use synthetic tokens and measure throughput after the model loads.
        </p>
        <p>
          Budget memory for the weights, working buffers and conversation. Try a model that fits on the task you care about before deciding whether its answers are good enough.
        </p>
      </section>

      <section aria-labelledby="reproduce">
        <h2 id="reproduce">Reproduce the test</h2>
        <p>
          The runs used {os} and llama.cpp {runtime.version} (build {runtime.build}, ggml {runtime.ggmlVersion}, {runtime.backend}). {conditions}
        </p>
        <p>
          Each column times a separate test. Download the exact GGUF from a model link and replace <code>MODEL.gguf</code> with its path. Use <code>-d 4096</code> to measure with a 4,096-token context already loaded.
        </p>
        <pre className="code-block" tabIndex={0}><code>{`llama-bench -m MODEL.gguf ${benchmarkArgs.join(" ")}`}</code></pre>
        <p>
          The JSON includes SHA-256 checksums, individual runs and standard deviations. <a href="/api/local">Benchmark measurements (JSON)</a> · <a href={runtime.documentation}>llama-bench documentation</a>
        </p>
      </section>
    </article>
  );
}
