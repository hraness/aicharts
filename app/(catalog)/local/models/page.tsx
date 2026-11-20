import "../local.css";

import { pageMetadata } from "@/journal/content";

export const metadata = {
  ...pageMetadata("Find downloadable models", "Search public Hugging Face model repositories by name, task and format.", "/local/models"),
  robots: { index: false, follow: true },
};

type Model = {
  id: string;
  library_name?: string;
  pipeline_tag?: string;
  safetensors?: { total?: number };
};

const tasks = ["text-generation", "text2text-generation", "feature-extraction", "sentence-similarity", "text-ranking", "text-to-image", "image-to-image", "image-to-video", "text-to-video", "image-text-to-text", "automatic-speech-recognition", "text-to-speech", "text-to-audio", "audio-to-audio", "audio-classification", "translation", "object-detection", "image-segmentation", "depth-estimation", "image-classification", "image-to-3d", "robotics"];
const formats = ["gguf", "mlx", "coreml", "onnx", "transformers", "diffusers"];

export default async function Models({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const read = (key: string, limit: number) => typeof params[key] === "string" ? params[key].slice(0, limit) : "";
  const query = read("q", 160).trim();
  const task = read("task", 80);
  const format = read("format", 32);
  const cursor = read("cursor", 4000);
  const api = new URL("https://huggingface.co/api/models");
  api.searchParams.set("limit", "24");
  api.searchParams.set("sort", "downloads");
  for (const field of ["safetensors", "library_name", "pipeline_tag"]) api.searchParams.append("expand", field);
  if (query) api.searchParams.set("search", query);
  if (tasks.includes(task)) api.searchParams.set("pipeline_tag", task);
  if (formats.includes(format)) api.searchParams.set("filter", format);
  if (cursor) api.searchParams.set("cursor", cursor);
  let models: Model[] = [];
  let next: string | null = null;
  let failed = false;
  try {
    const response = await fetch(api, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error("Hub unavailable");
    models = await response.json();
    const link = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/);
    if (link?.[1]) next = new URL(link[1]).searchParams.get("cursor");
  } catch { failed = true; }

  return <article className="catalog-page">
    <a href="/local">← Local AI benchmarks</a>
    <h1>Find downloadable models</h1>
    <p>Search public Hugging Face repositories, including fine-tunes, conversions and gated releases. Results are ordered by downloads. Open Files for exact artifact sizes or the model card for setup and license terms.</p>
    <form className="local-search" action="/local/models">
      <label>Model or publisher <input name="q" defaultValue={query} maxLength={160} /></label>
      <label>Task <select name="task" defaultValue={task}><option value="">All tasks</option>{tasks.map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Library or format <select name="format" defaultValue={format}><option value="">Any</option>{formats.map(f => <option key={f}>{f}</option>)}</select></label>
      <button>Search</button>
    </form>
    {failed ? <p>The Hub could not return results. <a href={"https://huggingface.co/models?search=" + encodeURIComponent(query)}>Search on Hugging Face</a>.</p> : models.length === 0 ? <p>No matching repositories.</p> :
      <div className="table-scroll"><table className="data-table"><caption>Parameters counted in Safetensors files when available.</caption><thead><tr><th>Model</th><th>Parameters</th><th>Library</th><th>Weights</th></tr></thead>
      <tbody>{models.map(m => <tr key={m.id}><th><a href={"https://huggingface.co/" + m.id}>{m.id}</a></th><td>{m.safetensors?.total ? Intl.NumberFormat("en", {notation:"compact",maximumFractionDigits:2}).format(m.safetensors.total) : "Unreported"}</td><td>{m.library_name || "Unreported"}</td><td><a href={"https://huggingface.co/" + m.id + "/tree/main"}>Files</a></td></tr>)}</tbody></table></div>}
    {next && <p><a href={"?"+new URLSearchParams({q:query,task,format,cursor:next})}>Next 24 models →</a></p>}
  </article>;
}
