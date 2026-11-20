import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { deviceBenchmarks } from "@/lib/local-hardware-data";
import { type Suite } from "@/lib/local-hardware-format";
import { PhoneStudy } from "@/components/phone-study";
import { pageMetadata } from "@/journal/content";
import "../local.css";

const path = "/local/mobile";
export const metadata = pageMetadata("Mobile AI benchmarks by everyday task",
  "Compare measured times for offline dictation, transcription, summaries, translation, reading aloud and image generation on Android phones, iPhones and iPads.", path);

const sections = [
  {id:"record", title:"Transcribe a recording", answer:"On a Galaxy S10, Moonshine Tiny transcribed a 30-second English clip in 1.36 seconds. Whisper Small took 12.33 seconds on the same recording.", ids:["voiceping-s10-recording","qvac-phone-transcript"]},
  {id:"dictate", title:"Dictate live", answer:"With Moonshine Small, the final words arrived 234 ms after the Pixel 10a detected the end of the phrase. The same test took 95 ms on an A16 iPad.", ids:["moonshine-final-transcript"]},
  {id:"summarize", title:"Summarize text", answer:"On the Galaxy S25 Ultra CPU, Qwen2.5 1.5B wrote a 100-token summary in 4.37 seconds. Gemma 2 9B took 20.15 seconds and earned a higher summary score from the study’s judge. Both used Q4_K_M weights.", ids:["galaxy-summary"]},
  {id:"speak", title:"Read aloud", answer:"A Pixel 8a started speaking in about 370 ms with KittenTTS and a short opening sentence. The Galaxy S10 study measures how much English text each engine can synthesize per second.", ids:["pixel-streaming-tts","galaxy-read-aloud"]},
  {id:"translate", title:"Translate a message", answer:"LiveChatBench timed complete Korean–English chat translations on 1,000 message pairs. On an iPhone 16 Pro Max, its Gemma 3 270M fine-tune averaged 0.16 seconds per translation using Metal.", ids:["livechat-mobile-translation"]},
  {id:"image", title:"Generate an image", answer:"On a Galaxy S23 Ultra, a 50-step Stable Diffusion 1.5 image took 24.4 seconds with caching off and 6.2 seconds at cache interval five. The faster setting also scored worse on image quality in the same test.", ids:["ddimcache-mobile","coreml"]},
  {id:"reply", title:"Generate a reply", answer:"Across four Galaxy devices, the same CPU test put Qwen3 0.6B at 12.15 tokens per second on a Tab S7+ and 36.83 on an S24 Ultra. Search the separate community results for phones from Motorola, OnePlus, Xiaomi and other makers.", ids:["galaxy-litert-chat","tokforge-mobile"]},
];

const suites = new Map((deviceBenchmarks.suites as Suite[]).map(suite => [suite.id, suite]));

export default function MobilePage() {
  return <article className="catalog-page">
    <Breadcrumbs trail={[{name:"Local benchmarks",href:"/local"},{name:"Mobile AI benchmarks",href:path}]} />
    <header className="page-head"><h1>Mobile AI benchmarks</h1><p>How long will a task take on a phone or tablet? Compare results from the same study to keep the input, timing method and model settings in view.</p></header>
    <nav className="local-section-links" aria-label="Phone tasks">{sections.map(s=><a key={s.id} href={"#"+s.id}>{s.title}</a>)}</nav>
    {sections.map(section=><section key={section.id} id={section.id}><h2>{section.title}</h2><p>{section.answer}</p>
      {section.ids.map(id=>{const suite=suites.get(id)!;return <div key={id}><PhoneStudy suite={suite}/><a className="phone-source" href={suite.source}>Source · {suite.title}</a></div>;})}
    </section>)}
    <p><a href="/local/devices">Find all benchmarks for a device</a></p>
  </article>;
}
