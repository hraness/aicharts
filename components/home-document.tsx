import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import { homeDocumentModel, type HomeDocumentModel } from "@/lib/site-markdown";

function checkedSnapshot(): CodingAgentSnapshot {
  const parsed = parseCodingAgentSnapshot(codingAgentData);
  if (!parsed.ok) {
    throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.value;
}

export function HomeDocument({
  document,
  snapshot,
}: Readonly<{
  document?: HomeDocumentModel;
  snapshot?: CodingAgentSnapshot;
}>) {
  const resolvedDocument = document ?? homeDocumentModel(snapshot ?? checkedSnapshot());

  return (
    <section className="home-document" aria-label={resolvedDocument.heading}>
      {resolvedDocument.paragraphs.map(paragraph => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <nav aria-label="AI Charts pages">
        <ul>
          {resolvedDocument.links.map(link => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
              <span> {link.note}</span>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
