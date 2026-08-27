# Model-card sigil grammar

The model-card emblem is a deterministic identity system, not decorative noise. It compiles catalog identity into one shared SVG scene used by the live gallery, detail card, downloadable PNG, model Open Graph image, and collection atlas.

## Identity axes

| Axis | Visual responsibility | Stability rule |
| --- | --- | --- |
| Provider | Outer court, categorical color, and printmaking hand | Every provider has a unique court, hue, and line hand. |
| Family | Dominant sanctuary silhouette, chassis, and botanical growth species | Shared byte-for-byte across a family. |
| Generation | Large lobe/cusp topology plus an exact lower inscription | Changes coarsely between versions while preserving the family chassis. |
| Edition | Filled device at the crown | Shared by the edition name across families. |
| Role | Paired foreground totems | General, speed, reasoning, and flagship each have distinct topology. |
| Profile | Secondary ink, perimeter tally, and craftsmanship density | Enriches an existing core; it never replaces the core. |

## Composition

The plate is a `400 × 230` SVG with three explicit planes:

1. **Background:** inset broken cartouche, provider court, engine-turned field, relief cells, and sparse hatch. Its marks are broad, thin, and low-contrast.
2. **Midground:** family-specific dark sanctuary, painted inlay, one intentional organic growth species, filled leaves, and the family radical.
3. **Foreground:** generation topology and inscription, edition device, role totems, class corona, and exact profile tally.

The logo is a separate image above the SVG. The sanctuary is painted before the family radical, so it creates contrast without erasing family identity. All physical card corners remain clear; the internal cartouche is inset and broken before it reaches them.

## Material grammar

Each card combines one geometric hand, one organic hand, and one fill technique. Variation belongs across the collection rather than piling every technique into every emblem.

- Architectural lines use butt caps, miter joins, and engraving-scale strokes.
- Organic spines use rounded contours plus one faint deterministic drypoint echo.
- Calligraphic width is represented by closed filled ribbons rather than unsupported variable-width SVG strokes.
- Leaves, crown devices, relief cells, and role totems provide flat painted mass.
- Higher-density profiles add bounded botanical or bright-cut detail, not cloned line fields.
- The canonical print renderer uses explicit SVG paths and direct paint attributes only: no filters, masks, patterns, scripts, or font-dependent SVG text.

## Diffractive spot foil

The live card adds a progressive holographic finish above the canonical print geometry and below the provider logo. It is a material layer, not another identity layer: disabling it leaves every semantic shape intact.

The finish models three optical components:

1. **Zero-order metal:** a provider- and class-tinted silver reflection gives the stamped shapes material mass at rest.
2. **Diffracted orders:** one narrow spectral band traverses selected paths. Provider line hand biases the band axis; family selects the named diffraction field and groove cadence; generation and edition set its deterministic phase.
3. **Specular glint:** one pointer-centered highlight moves coherently across all stamped regions. Seeded perimeter diamonds provide stable microglints without frame-by-frame randomness.

Foil coverage is semantic and bounded. Every card stamps its generation inscription and edition device. Density two adds generation topology, density three adds the corona, density four adds a satin family edge and one profile stamp, and density five adds two more stamps. The provider court, organic underpainting, logo, typography, and statistics remain pigment rather than rainbow foil.

Interaction reuses the parent card's delegated `--foil-light-x`, `--foil-light-y`, and `--foil-spectrum-angle` variables. The resting pose is seeded by canonical model rather than profile, so profiles retain one material phase while coverage and secondary ink change. The 53-card gallery therefore retains one request-animation-frame controller, updates only the active card, runs no idle animation, creates no canvas or WebGL context, and adds no JavaScript dependency. Every SVG instance receives a hydration-stable React namespace so duplicate cards cannot collide through gradient fragment identifiers. Reduced-motion freezes the seeded pose, reduced-transparency and increased-contrast preferences suppress spectral intensity, and forced-colors removes the decorative illustration.

The live gallery keeps explicit structural budgets for total DOM elements and serialized markup as well as path geometry. Each card uses eighteen compact gradient stops and referenced shapes instead of duplicating stamped paths per optical pass; `content-visibility` and paint containment then keep off-screen cards out of active paint work.

Three.js is intentionally not part of this tier. A renderer per card would duplicate contexts and GPU state while forking live art from the SVG/ImageResponse pipeline. If a future single-card hero genuinely needs physical thin-film BRDF rendering, it should be one dynamically loaded low-power fragment-shader surface over the detail card, with the current SVG finish remaining the complete fallback.

## Growth rules

Current family growth species are intentionally finite and legible at thumbnail size:

- cathedral arch;
- tidal answering curves;
- climbing manuscript vines;
- interlaced diagonals;
- ruled tablet frame.

New families should first receive a one-color sanctuary silhouette, then a compatible growth species, and only then a radical. A family is ready when its silhouette is identifiable at `64 × 40` and remains distinct in grayscale. Generation changes should alter visible cusp, lobe, axis, or branch counts rather than relying on micro-runes.

## Density stages

1. **Seal:** core court, family, generation, and profile tally.
2. **Flourish:** one additional painted terminal.
3. **Illumination:** richer inlay and botanical detail.
4. **Marginalia:** stronger perimeter rhythm and bright-cut accents.
5. **Masterwork:** maximum bounded detail while retaining roughly one-third negative space.

The gallery mode omits drypoint echoes and tertiary bright-cut detail. Core semantic signatures remain identical between gallery and full rendering.

## References

The system combines the V&A's studies of [Rococo](https://www.vam.ac.uk/articles/the-rococo-style-an-introduction), [Art Nouveau](https://www.vam.ac.uk/articles/art-nouveau-an-international-style), the [whiplash line](https://www.vam.ac.uk/articles/the-whiplash), and [Art Deco](https://www.vam.ac.uk/articles/an-introduction-to-art-deco); Getty's analysis of [illuminated manuscript hierarchy](https://www.getty.edu/news/breaking-down-a-page-like-a-medievalist/); and Wong, Zongker, and Salesin's [hierarchical floral-ornament composition](https://grail.cs.washington.edu/projects/ornament/ornament-lowres.pdf).

The production medium remains SVG because the same explicit geometry can be inspected in the browser and rasterized by ImageResponse. The line-art approach follows the resolution-aware hierarchy in Winkenbach and Salesin's [Computer-Generated Pen-and-Ink Illustration](https://www.cs.ucdavis.edu/~ma/SIGGRAPH02/course23/notes/papers/Winkenbach.pdf): a few characteristic strokes, progressive detail, varied foreground/background weight, and tone created by the marks themselves.

The foil model is informed by Khronos's ratified [`KHR_materials_iridescence`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_iridescence/README.md) treatment of angle-dependent thin-film interference; Jos Stam's [Diffraction Shaders](https://doi.org/10.1145/311535.311546); Edmund Optics' [diffraction-grating overview](https://www.edmundoptics.com/knowledge-center/application-notes/optics/all-about-diffraction-gratings/); and Getty's documentation of [gilding and punchwork](https://www.getty.edu/art/exhibitions/making/). The implementation translates those ingredients into narrow, selectively stamped SVG gradients instead of pretending a flat full-card rainbow is a physical hologram.
