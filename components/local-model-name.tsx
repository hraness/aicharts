import { ProviderLogo } from "./brand-icon";
import "./local-model-name.css";

// Icons identify the repository publisher. Community fine-tunes keep the
// identity of their publisher even when the checkpoint mentions another lab.
const publisherMarks: Record<string, string> = {
  "01-ai": "yi-color",
  "alibaba-nlp": "alibaba-color",
  "alibaba-pai": "alibaba-color",
  allenai: "ai2-color",
  "arcee-ai": "arcee-color",
  baai: "baai",
  "black-forest-labs": "bfl",
  bytedance: "bytedance-color",
  cohereforai: "cohere-color",
  "deepseek-ai": "deepseek-color",
  facebook: "meta-color",
  huggingfacetb: "huggingface-color",
  "ibm-granite": "ibm",
  internlm: "internlm-color",
  jinaai: "jina",
  "meta-llama": "meta-color",
  microsoft: "microsoft-color",
  minimaxai: "minimax-color",
  mistralai: "mistral-color",
  nousresearch: "nousresearch",
  nvidia: "nvidia-color",
  openchat: "openchat-color",
  qwen: "qwen-color",
  stabilityai: "stability-color",
  tencent: "tencent-color",
  tiiuae: "tii-color",
  upstage: "upstage-color",
};

// Keep version numbers and names such as Llama-3.2 with their family.
// Split only at a known configuration boundary. Unfamiliar names stay whole.
const configuration = /[ ·._-]+(?=(?:E?\d+(?:\.\d+)?[BM](?:[-_ ]?A\d+(?:\.\d+)?B)?|\d+x\d+(?:\.\d+)?B|A\d+(?:\.\d+)?B|Q\d+(?:_[A-Z\d]+)*|I?Q\d[A-Z0-9_]*|BF16|FP(?:8|16|32)|INT[48]|GGUF|AWQ|GPTQ|MLX|Instruct|Thinking|Distill|Chat|Base|Turbo|Small|Medium|Large)(?=$|[ ._()/-]))/i;

function PublisherMark({ publisher }: { publisher: string }) {
  const key = publisher.toLowerCase();
  if (key === "openai" || key === "google" || key === "anthropic") {
    return <ProviderLogo provider={key} size={19} />;
  }
  const mark = publisherMarks[key];
  if (mark) {
    const url = "/model-marks/" + mark + ".svg";
    if (mark.endsWith("-color")) return <img src={url} width={19} height={19} alt="" loading="lazy" />;
    return <span className="local-model-mark-mask" style={{ maskImage: "url(" + url + ")" }} />;
  }
  const parts = publisher.split(/[-_\s]+/).filter(Boolean);
  const initials = parts.length > 1
    ? (parts[0]![0]! + parts[1]![0]!).toUpperCase()
    : publisher.slice(0, 2).toUpperCase();
  return <span className="local-model-mark-initials">{initials}</span>;
}

export function LocalModelName({ name, repository }: { name: string; repository?: string }) {
  const publisher = repository?.split("/")[0];
  const label = repository === name ? name.slice(name.indexOf("/") + 1) : name;
  const match = configuration.exec(label);
  const splitAt = match && match.index > 0 ? match.index : label.length;
  const family = label.slice(0, splitAt);
  const variant = match && splitAt < label.length ? label.slice(splitAt + match[0].length) : "";
  const identity = <>
    <span aria-hidden="true" className="local-model-mark"><PublisherMark publisher={publisher || label} /></span>
    <span className="local-model-words"><span>{family}</span>{variant && <small>{variant}</small>}</span>
  </>;
  return repository
    ? <a className="local-model-name" href={"https://huggingface.co/" + repository} title={repository} aria-label={name}>{identity}</a>
    : <span className="local-model-name" title={name}>{identity}</span>;
}
