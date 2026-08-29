import Image from "next/image";

import type { BlogEditorialImage } from "./editorial-images";

export function EditorialFigure({
  image,
  preload = false,
  variant = "article",
}: Readonly<{
  image: BlogEditorialImage;
  preload?: boolean;
  variant?: "article" | "card";
}>) {
  if (variant === "card") {
    return (
      <Image
        alt={image.alt}
        height={image.height}
        sizes="(max-width: 42rem) calc(100vw - 2rem), 20rem"
        src={image.src}
        width={image.width}
      />
    );
  }

  return (
    <figure className="plain-publication__editorial-figure">
      <Image
        alt={image.alt}
        height={image.height}
        preload={preload}
        sizes="(max-width: 42rem) calc(100vw - 2rem), 43rem"
        src={image.src}
        width={image.width}
      />
      <figcaption>
        {image.caption} <span>{image.credit}</span>
      </figcaption>
    </figure>
  );
}
