import { homeDocumentModel, type HomeDocumentModel } from "@/lib/site-markdown";

export function HomeDocument({
  document = homeDocumentModel(),
}: Readonly<{ document?: HomeDocumentModel }>) {
  return (
    <section className="home-document" aria-labelledby="home-document-heading">
      <h1 id="home-document-heading">{document.heading}</h1>
      {document.paragraphs.map(paragraph => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <nav aria-label="AI Charts pages">
        <ul>
          {document.links.map(link => (
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
