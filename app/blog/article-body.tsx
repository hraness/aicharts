import type { ReactNode } from "react";

import {
  headingId,
  type BlogBlock,
  type InlineContent,
  type InlinePart,
} from "./articles";

function renderPart(part: InlinePart, key: number): ReactNode {
  if (typeof part === "string") return part;

  let content: ReactNode = part.text;
  if (part.emphasis === "strong") {
    content = <strong>{content}</strong>;
  } else if (part.emphasis === "em") {
    content = <em>{content}</em>;
  }

  if (part.href !== undefined) {
    content = <a href={part.href}>{content}</a>;
  }

  return <span key={key}>{content}</span>;
}

function RichText({ content }: Readonly<{ content: InlineContent }>) {
  return content.map(renderPart);
}

function ArticleBlock({ block }: Readonly<{ block: BlogBlock }>) {
  if (block.type === "heading") {
    const id = headingId(block.text);
    return block.level === 2
      ? <h2 id={id}>{block.text}</h2>
      : <h3 id={id}>{block.text}</h3>;
  }

  if (block.type === "paragraph") {
    return <p><RichText content={block.content} /></p>;
  }

  if (block.type === "callout") {
    return (
      <aside className="plain-publication__callout">
        <strong>{block.label}</strong>
        <p><RichText content={block.content} /></p>
      </aside>
    );
  }

  if (block.type === "table") {
    return (
      <div className="plain-publication__table-scroll">
        <table className="plain-publication__table">
          <caption>{block.caption}</caption>
          <thead>
            <tr>
              {block.columns.map(column => (
                <th key={column} scope="col">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th key={cellIndex} scope="row">
                      <RichText content={cell} />
                    </th>
                  ) : (
                    <td key={cellIndex}>
                      <RichText content={cell} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const List = block.style === "ordered" ? "ol" : "ul";
  return (
    <List>
      {block.items.map((item, index) => (
        <li key={index}><RichText content={item} /></li>
      ))}
    </List>
  );
}

export function ArticleBody({
  blocks,
}: Readonly<{ blocks: readonly BlogBlock[] }>) {
  return (
    <div className="plain-publication__article-body">
      {blocks.map((block, index) => (
        <ArticleBlock block={block} key={index} />
      ))}
    </div>
  );
}
