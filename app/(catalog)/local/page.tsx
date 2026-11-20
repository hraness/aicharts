import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import benchmarks from "@/data/local-benchmarks.json";
import { pageMetadata } from "@/journal/content";
import "./local.css";

export const metadata = pageMetadata(
  "Local AI benchmarks by workload",
  "Find downloadable AI models and compare published quality, model sizes and device speeds for language, music, images, video and other workloads.",
  "/local",
);

export default function LocalBenchmarksPage() {
  return (
    <article className="catalog-page">
      <Breadcrumbs trail={[{ name: "Local benchmarks", href: "/local" }]} />
      <header className="page-head"><h1>Local AI benchmarks</h1></header>
      <p className="lead">Compare published scores by workload, or search the Hub for model weights and runtime formats.</p>
      <p><a href="/local/models">Find downloadable models →</a> · <a href="#hardware">Device speeds and memory</a></p>
      <div className="local-charts">
        {benchmarks.workloads.map((group) => (
          <section key={group.name}>
            <h2>{group.name}</h2>
            <p><strong>{group.metric}</strong> · {group.lowerIsBetter ? "Lower" : "Higher"} is better</p>
            <ol aria-label={group.metric}>
              {group.models.map((model) => (
                <li key={model.name}>
                  <span>{model.repository ? <a href={"https://huggingface.co/" + model.repository}>{model.name}</a> : model.name}
                    {"storedParameters" in model && model.storedParameters && <small className="local-size"> {Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(model.storedParameters)} stored parameters</small>}
                  </span><strong>{model.score}{group.unit}</strong>
                  <div className="local-track" aria-hidden="true"><i style={{ width: (100 * model.score / group.maximum) + "%" }} /></div>
                </li>
              ))}
            </ol>
            <p>{group.description}</p>
            <a href={group.source}>{group.publisher}</a>
          </section>
        ))}
      </div>
      <section id="hardware">
        <h2>Device speeds and memory</h2>
        <div className="table-scroll"><table className="data-table"><caption>Published measurements under the listed settings. Time per output and tokens per second use different scales.</caption>
          <thead><tr><th>Model</th><th>Device</th><th>Output and settings</th><th>Speed</th></tr></thead>
          <tbody>{benchmarks.hardware.flatMap(group => group.runs.map(([device, time]) => <tr key={group.model + group.work + device}><th><a href={group.source}>{group.model}</a></th><td>{device}</td><td>{group.work}</td><td>{time}</td></tr>))}</tbody>
        </table></div>
        <p>Weight storage depends on precision. One billion parameters take roughly 2 GB at 16 bits or 0.5 GB at 4 bits before format overhead. Runtime memory also includes activations and, for language models, the context cache. Meta specifies at least 16 GB of GPU memory for medium MusicGen inference. <a href="https://github.com/facebookresearch/audiocraft/blob/main/docs/MUSICGEN.md">AudioCraft requirements</a></p>
        <p>For Apple silicon, look for an MLX conversion. For CPU or GPU inference with llama.cpp, check its supported architectures and GGUF files. ONNX device support depends on the execution provider. <a href="https://github.com/ml-explore/mlx">MLX</a> · <a href="https://github.com/ggml-org/llama.cpp">llama.cpp</a> · <a href="https://onnxruntime.ai/docs/execution-providers/">ONNX providers</a></p>
      </section>
      <p><a href="/api/local">Download scores and sources (JSON)</a></p>
    </article>
  );
}
