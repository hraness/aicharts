import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { LocalHardware } from "@/components/local-hardware";
import { LocalQuality } from "@/components/local-quality";
import { workloads } from "@/lib/local-quality";
import { pageMetadata } from "@/journal/content";
import "./local.css";

export const metadata = pageMetadata(
  "Local AI and LLM Benchmarks | Speed and Memory by Device",
  "Compare local LLM tokens per second and memory on Apple Silicon, GPUs and mobile devices. See published tests for offline transcription and image generation.",
  "/local",
);

export default async function LocalBenchmarksPage() {
  const first = workloads[0]!;
  return <article className="catalog-page">
    <Breadcrumbs trail={[{ name: "Local benchmarks", href: "/local" }]} />
    <header className="page-head"><h1>Local AI benchmarks</h1><p>Compare local LLM quality, tokens per second and memory on Macs, GPUs and phones. See timings for offline transcription, summarization and image generation.</p></header>
    <nav className="local-section-links" aria-label="Explore local AI">
      <a href="#quality">Model quality</a>
      <a href="/local/mobile">Everyday phone tasks</a>
      <a href="/local/devices">Browse devices</a>
      <a href="/local/devices/apple-silicon-macs/apple-m4-pro">M4 Pro LLM benchmarks</a>
      <a href="#hardware">Device speeds and memory</a>
      <a href="/local/models">Find downloadable models</a>
    </nav>
    <LocalQuality workload={first} metric={first} />
    <section><h2>What can your phone do offline?</h2><p>On a Galaxy S10, Moonshine Tiny transcribed a 30-second recording in 1.36 seconds. On a Pixel 8a, KittenTTS started reading a short sentence aloud in about 370 ms.</p><a href="/local/mobile">Compare phone and tablet benchmarks by task</a></section>
    <LocalHardware />
    <section>
      <h2>How do you compare local LLM speed?</h2>
      <p>Prompt speed measures how quickly the model reads your input. Generation speed measures how quickly it writes the reply. For a hardware comparison, match the model, weight precision, runtime, prompt length and output length. Check model download size and peak runtime memory separately.</p>
      <p><a href="/local/devices/apple-silicon-macs/apple-m4-pro">Compare Apple M4 Pro MLX results</a> · <a href="/local/mobile#reply">Compare phone reply speeds</a></p>
    </section>
    <p><a href="/api/local">Download benchmarks and sources (JSON)</a></p>
  </article>;
}
