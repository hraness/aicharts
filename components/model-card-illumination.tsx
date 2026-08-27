import type { ModelCardPresentation } from "@/lib/model-card-presentation";

export type ModelCardIlluminationMode = "full" | "gallery";

const providerMotifs = {
  alibaba_cloud: "cloud-scroll",
  anthropic: "sunburst",
  cursor: "quill",
  deepseek: "tide",
  google: "quatrefoil",
  meta: "infinity",
  moonshot_ai: "lunar",
  openai: "rosette",
  xai: "astral",
  z_ai: "fan",
} as const;

const motifNames = Object.values(providerMotifs);
type ProviderMotif = typeof motifNames[number];

const classTopologies = {
  fast: { leafVariant: 3, petalVariant: 3, phaseOffset: -18, ringStep: 47, ringX: 1.16, ringY: .78 },
  max: { leafVariant: 1, petalVariant: 1, phaseOffset: 45, ringStep: 19, ringX: .98, ringY: 1.08 },
  standard: { leafVariant: 0, petalVariant: 0, phaseOffset: 0, ringStep: 31, ringX: 1, ringY: 1 },
  thinking: { leafVariant: 2, petalVariant: 2, phaseOffset: 24, ringStep: 37, ringX: .87, ringY: 1.2 },
} as const;

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function sample(hash: number, salt: number): number {
  let value = (hash + Math.imul(salt, 2_654_435_761)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2_246_822_507);
  value ^= value >>> 13;
  value = Math.imul(value, 3_266_489_909);
  value ^= value >>> 16;
  return (value >>> 0) / 4_294_967_295;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function providerMotif(providerId: string): ProviderMotif {
  return providerMotifs[providerId as keyof typeof providerMotifs]
    ?? motifNames[stableHash(providerId) % motifNames.length]
    ?? "rosette";
}

function polarPoint(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
): readonly [number, number] {
  const radians = angle * Math.PI / 180;
  return [
    rounded(centerX + Math.cos(radians) * radius),
    rounded(centerY + Math.sin(radians) * radius),
  ];
}

/** A single compound path gives every provider a legible heraldic signature. */
function motifSignaturePath(
  motif: ProviderMotif,
  centerX: number,
  centerY: number,
): string {
  if (motif === "cloud-scroll") {
    return `M24 ${rounded(centerY + 36)}C58 ${rounded(centerY - 8)} 98 ${rounded(centerY - 17)} 119 ${rounded(centerY + 7)}C135 ${rounded(centerY + 25)} 113 ${rounded(centerY + 42)} 96 ${rounded(centerY + 28)}C83 ${rounded(centerY + 18)} 94 ${rounded(centerY + 4)} 108 ${rounded(centerY + 13)}M376 ${rounded(centerY + 36)}C342 ${rounded(centerY - 8)} 302 ${rounded(centerY - 17)} 281 ${rounded(centerY + 7)}C265 ${rounded(centerY + 25)} 287 ${rounded(centerY + 42)} 304 ${rounded(centerY + 28)}C317 ${rounded(centerY + 18)} 306 ${rounded(centerY + 4)} 292 ${rounded(centerY + 13)}`;
  }
  if (motif === "sunburst") {
    return Array.from({ length: 16 }, (_, index) => {
      const angle = index * 22.5;
      const [startX, startY] = polarPoint(centerX, centerY, index % 2 === 0 ? 73 : 78, angle);
      const [endX, endY] = polarPoint(centerX, centerY, index % 2 === 0 ? 111 : 98, angle);
      return `M${startX} ${startY}L${endX} ${endY}`;
    }).join("");
  }
  if (motif === "quill") {
    return `M42 ${rounded(centerY + 70)}Q112 ${rounded(centerY - 54)} ${rounded(centerX - 8)} ${rounded(centerY - 58)}M63 ${rounded(centerY + 38)}L91 ${rounded(centerY + 27)}M79 ${rounded(centerY + 11)}L109 ${centerY}M98 ${rounded(centerY - 15)}L128 ${rounded(centerY - 22)}M358 ${rounded(centerY + 70)}Q288 ${rounded(centerY - 54)} ${rounded(centerX + 8)} ${rounded(centerY - 58)}M337 ${rounded(centerY + 38)}L309 ${rounded(centerY + 27)}M321 ${rounded(centerY + 11)}L291 ${centerY}M302 ${rounded(centerY - 15)}L272 ${rounded(centerY - 22)}`;
  }
  if (motif === "tide") {
    return Array.from({ length: 4 }, (_, index) => {
      const y = rounded(centerY - 55 + index * 37);
      return `M16 ${y}C56 ${rounded(y - 24)} 86 ${rounded(y + 24)} 126 ${y}S196 ${rounded(y - 24)} 236 ${y}S306 ${rounded(y + 24)} 384 ${y}`;
    }).join("");
  }
  if (motif === "quatrefoil") {
    return `M${centerX} ${rounded(centerY - 86)}C${rounded(centerX + 27)} ${rounded(centerY - 86)} ${rounded(centerX + 43)} ${rounded(centerY - 66)} ${rounded(centerX + 37)} ${rounded(centerY - 39)}C${rounded(centerX + 66)} ${rounded(centerY - 45)} ${rounded(centerX + 86)} ${rounded(centerY - 27)} ${rounded(centerX + 86)} ${centerY}C${rounded(centerX + 86)} ${rounded(centerY + 27)} ${rounded(centerX + 66)} ${rounded(centerY + 45)} ${rounded(centerX + 37)} ${rounded(centerY + 39)}C${rounded(centerX + 43)} ${rounded(centerY + 66)} ${rounded(centerX + 27)} ${rounded(centerY + 86)} ${centerX} ${rounded(centerY + 86)}C${rounded(centerX - 27)} ${rounded(centerY + 86)} ${rounded(centerX - 43)} ${rounded(centerY + 66)} ${rounded(centerX - 37)} ${rounded(centerY + 39)}C${rounded(centerX - 66)} ${rounded(centerY + 45)} ${rounded(centerX - 86)} ${rounded(centerY + 27)} ${rounded(centerX - 86)} ${centerY}C${rounded(centerX - 86)} ${rounded(centerY - 27)} ${rounded(centerX - 66)} ${rounded(centerY - 45)} ${rounded(centerX - 37)} ${rounded(centerY - 39)}C${rounded(centerX - 43)} ${rounded(centerY - 66)} ${rounded(centerX - 27)} ${rounded(centerY - 86)} ${centerX} ${rounded(centerY - 86)}Z`;
  }
  if (motif === "infinity") {
    return `M42 ${centerY}C82 ${rounded(centerY - 62)} 135 ${rounded(centerY - 62)} ${centerX} ${centerY}C265 ${rounded(centerY + 62)} 318 ${rounded(centerY + 62)} 358 ${centerY}C318 ${rounded(centerY - 62)} 265 ${rounded(centerY - 62)} ${centerX} ${centerY}C135 ${rounded(centerY + 62)} 82 ${rounded(centerY + 62)} 42 ${centerY}Z`;
  }
  if (motif === "lunar") {
    return `M94 ${rounded(centerY - 72)}A76 76 0 0 0 94 ${rounded(centerY + 72)}A58 58 0 0 1 94 ${rounded(centerY - 72)}M306 ${rounded(centerY - 72)}A76 76 0 0 1 306 ${rounded(centerY + 72)}A58 58 0 0 0 306 ${rounded(centerY - 72)}`;
  }
  if (motif === "rosette") {
    return Array.from({ length: 25 }, (_, index) => {
      const pointIndex = index % 24;
      const radius = pointIndex % 2 === 0 ? 99 : 83;
      const [x, y] = polarPoint(centerX, centerY, radius, pointIndex * 15 - 90);
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    }).join("") + "Z";
  }
  if (motif === "astral") {
    return Array.from({ length: 17 }, (_, index) => {
      const pointIndex = index % 16;
      const radius = pointIndex % 2 === 0 ? 109 : pointIndex % 4 === 1 ? 39 : 57;
      const [x, y] = polarPoint(centerX, centerY, radius, pointIndex * 22.5 - 90);
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    }).join("") + "Z";
  }
  return `M48 ${rounded(centerY + 88)}Q${centerX} ${rounded(centerY - 102)} 352 ${rounded(centerY + 88)}M75 ${rounded(centerY + 88)}Q${centerX} ${rounded(centerY - 72)} 325 ${rounded(centerY + 88)}M104 ${rounded(centerY + 88)}Q${centerX} ${rounded(centerY - 42)} 296 ${rounded(centerY + 88)}M${centerX} ${rounded(centerY + 88)}L${centerX} ${rounded(centerY - 72)}M${centerX} ${rounded(centerY + 88)}L112 ${rounded(centerY - 22)}M${centerX} ${rounded(centerY + 88)}L288 ${rounded(centerY - 22)}`;
}

function classSignaturePath(
  visualClass: ModelCardPresentation["visualClass"],
  centerX: number,
  centerY: number,
): string {
  if (visualClass === "fast") {
    return `M18 ${rounded(centerY - 62)}C92 ${rounded(centerY - 105)} 128 ${rounded(centerY - 73)} ${rounded(centerX - 25)} ${rounded(centerY - 26)}M382 ${rounded(centerY + 62)}C308 ${rounded(centerY + 105)} 272 ${rounded(centerY + 73)} ${rounded(centerX + 25)} ${rounded(centerY + 26)}`;
  }
  if (visualClass === "thinking") {
    return `M44 ${rounded(centerY + 46)}C61 ${rounded(centerY - 31)} 151 ${rounded(centerY - 91)} ${rounded(centerX - 21)} ${rounded(centerY - 17)}C${rounded(centerX - 8)} ${rounded(centerY + 10)} ${rounded(centerX - 42)} ${rounded(centerY + 22)} ${rounded(centerX - 49)} ${centerY}M356 ${rounded(centerY - 46)}C339 ${rounded(centerY + 31)} 249 ${rounded(centerY + 91)} ${rounded(centerX + 21)} ${rounded(centerY + 17)}C${rounded(centerX + 8)} ${rounded(centerY - 10)} ${rounded(centerX + 42)} ${rounded(centerY - 22)} ${rounded(centerX + 49)} ${centerY}`;
  }
  if (visualClass === "max") {
    return `M${rounded(centerX - 58)} ${rounded(centerY - 78)}L${rounded(centerX - 30)} ${rounded(centerY - 91)}L${centerX} ${rounded(centerY - 72)}L${rounded(centerX + 30)} ${rounded(centerY - 91)}L${rounded(centerX + 58)} ${rounded(centerY - 78)}M${rounded(centerX - 58)} ${rounded(centerY + 78)}L${rounded(centerX - 30)} ${rounded(centerY + 91)}L${centerX} ${rounded(centerY + 72)}L${rounded(centerX + 30)} ${rounded(centerY + 91)}L${rounded(centerX + 58)} ${rounded(centerY + 78)}`;
  }
  return `M${centerX} ${rounded(centerY - 93)}L${rounded(centerX + 8)} ${rounded(centerY - 85)}L${centerX} ${rounded(centerY - 77)}L${rounded(centerX - 8)} ${rounded(centerY - 85)}ZM${centerX} ${rounded(centerY + 93)}L${rounded(centerX + 8)} ${rounded(centerY + 85)}L${centerX} ${rounded(centerY + 77)}L${rounded(centerX - 8)} ${rounded(centerY + 85)}Z`;
}

function petalPath(
  centerX: number,
  centerY: number,
  length: number,
  width: number,
  variant: number,
): string {
  const tipY = centerY - length;
  if (variant === 1) {
    return `M${centerX} ${centerY}C${rounded(centerX - width)} ${rounded(centerY - length * .28)} ${rounded(centerX - width * .65)} ${rounded(centerY - length * .82)} ${centerX} ${rounded(tipY)}C${rounded(centerX + width * .65)} ${rounded(centerY - length * .82)} ${rounded(centerX + width)} ${rounded(centerY - length * .28)} ${centerX} ${centerY}Z`;
  }
  if (variant === 2) {
    return `M${centerX} ${centerY}C${rounded(centerX - width * .35)} ${rounded(centerY - length * .28)} ${rounded(centerX - width)} ${rounded(centerY - length * .47)} ${rounded(centerX - width * .48)} ${rounded(centerY - length * .62)}C${rounded(centerX - width * .12)} ${rounded(centerY - length * .72)} ${rounded(centerX - width * .3)} ${rounded(centerY - length * .9)} ${centerX} ${rounded(tipY)}C${rounded(centerX + width * .3)} ${rounded(centerY - length * .9)} ${rounded(centerX + width * .12)} ${rounded(centerY - length * .72)} ${rounded(centerX + width * .48)} ${rounded(centerY - length * .62)}C${rounded(centerX + width)} ${rounded(centerY - length * .47)} ${rounded(centerX + width * .35)} ${rounded(centerY - length * .28)} ${centerX} ${centerY}Z`;
  }
  if (variant === 3) {
    return `M${centerX} ${centerY}C${rounded(centerX - width)} ${rounded(centerY - length * .38)} ${rounded(centerX - width * .24)} ${rounded(centerY - length * .72)} ${centerX} ${rounded(tipY)}C${rounded(centerX + width * .22)} ${rounded(centerY - length * .7)} ${rounded(centerX + width * .72)} ${rounded(centerY - length * .4)} ${centerX} ${centerY}Z`;
  }
  return `M${centerX} ${centerY}Q${rounded(centerX - width)} ${rounded(centerY - length * .55)} ${centerX} ${rounded(tipY)}Q${rounded(centerX + width)} ${rounded(centerY - length * .55)} ${centerX} ${centerY}Z`;
}

function leafPath(variant: number): string {
  if (variant === 1) return "M0 0C7-13 23-15 31-4C22 2 12 8 0 0Z";
  if (variant === 2) return "M0 0C7-9 14-18 30-12C27-3 18 1 0 0ZM9-3L24-10";
  if (variant === 3) return "M0 0C9-16 22-13 31-2C19-3 18 8 0 0Z";
  return "M0 0C9-11 22-10 30-1C20 2 10 9 0 0Z";
}

export function ModelCardIllumination({
  card,
  mode = "full",
}: Readonly<{
  card: Pick<ModelCardPresentation,
    | "accentFamily"
    | "illuminationDensity"
    | "providerColor"
    | "providerId"
    | "secondaryColor"
    | "seed"
    | "visualClass">;
  mode?: ModelCardIlluminationMode;
}>) {
  const hash = stableHash(card.seed);
  const providerHash = stableHash(card.providerId);
  const motif = providerMotif(card.providerId);
  const motifIndex = Math.max(0, motifNames.indexOf(motif));
  const density = card.illuminationDensity;
  const isGallery = mode === "gallery";
  const topology = classTopologies[card.visualClass];
  const handedness = sample(providerHash, 2) > .5 ? 1 : -1;
  const centerX = rounded(200 + (sample(hash, 1) - .5) * 9);
  const centerY = rounded(117 + (sample(hash, 2) - .5) * 7);
  const phase = rounded((motifIndex * 17 + topology.phaseOffset + sample(hash, 3) * 24 - 12) * handedness);
  const petalCount = isGallery
    ? 2 + density + (sample(hash, 4) > .56 ? 1 : 0)
    : 2 + density * 2 + (sample(hash, 4) > .56 ? 2 : 0);
  const petalLength = rounded(40 + density * 6 + sample(hash, 5) * 8);
  const petalWidth = rounded(10 + density * 1.6 + sample(providerHash, 6) * 5);
  const petal = petalPath(centerX, centerY, petalLength, petalWidth, topology.petalVariant);
  const vineLayerCount = isGallery ? 1 : density;
  const ringCount = density;
  const leafPairs = isGallery ? density : density + 1;
  const pearlCount = isGallery ? 0 : density >= 3 ? density * 4 : 0;
  const leaf = leafPath(topology.leafVariant);
  const primaryStroke = rounded(1.05 + density * .17);
  const secondaryStroke = rounded(.8 + density * .15);

  return (
    <svg
      aria-hidden="true"
      className="model-card-illumination"
      data-illumination-accent={card.accentFamily}
      data-illumination-class={card.visualClass}
      data-illumination-density={density}
      data-illumination-mode={mode}
      data-illumination-motif={motif}
      focusable="false"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      style={{ inset: 0, pointerEvents: "none", position: "absolute" }}
      viewBox="0 0 400 230"
      width="100%"
    >
      <ellipse
        cx={centerX}
        cy={centerY}
        fill="#050609"
        fillOpacity=".54"
        rx={rounded(49 + density * 4)}
        ry={rounded(45 + density * 3)}
        stroke={card.providerColor}
        strokeOpacity=".2"
        strokeWidth="1"
      />

      <g
        data-illumination-signature="provider"
        fill="none"
        opacity=".4"
        stroke={card.providerColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={rounded(Math.max(1.6, primaryStroke * 1.15))}
      >
        <path d={motifSignaturePath(motif, centerX, centerY)} />
      </g>

      <g
        data-illumination-signature="class"
        fill="none"
        opacity=".46"
        stroke={card.secondaryColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={rounded(Math.max(1.5, secondaryStroke * 1.2))}
      >
        <path d={classSignaturePath(card.visualClass, centerX, centerY)} />
      </g>

      <g fill="none" stroke={card.providerColor} strokeLinecap="round" strokeLinejoin="round">
        {Array.from({ length: vineLayerCount }, (_, layer) => {
          const startY = rounded(centerY + 77 - layer * 15 + (sample(hash, 20 + layer) - .5) * 9);
          const firstX = rounded(34 + motifIndex * 2 + layer * 7);
          const shoulderY = rounded(centerY + (34 - layer * 5) * handedness);
          const endY = rounded(centerY + (12 - layer * 3) * handedness);
          const path = `M-12 ${startY}C${firstX} ${rounded(startY - 34 * handedness)} ${rounded(42 + layer * 9)} ${shoulderY} ${rounded(91 + layer * 6)} ${shoulderY}S${rounded(139 + layer * 5)} ${rounded(centerY - (28 + motifIndex) * handedness)} ${rounded(centerX - 28 - layer * 3)} ${endY}`;
          return (
            <g key={`vine-${layer}`} opacity={rounded(.15 + layer * .045 + density * .03)}>
              <path d={path} strokeWidth={primaryStroke} />
              <path d={path} strokeWidth={primaryStroke} transform="translate(400 0) scale(-1 1)" />
            </g>
          );
        })}
      </g>

      <g fill="none" stroke={card.secondaryColor} strokeLinecap="round" strokeLinejoin="round">
        {Array.from({ length: ringCount }, (_, index) => (
          <ellipse
            cx={centerX}
            cy={centerY}
            key={`ring-${index}`}
            opacity={rounded(.23 + index * .045)}
            rx={rounded((64 + index * 20 + sample(hash, 30 + index) * 6) * topology.ringX)}
            ry={rounded((28 + index * 8 + sample(hash, 40 + index) * 5) * topology.ringY)}
            strokeDasharray={index === ringCount - 1 && density >= 3 ? "2 7" : undefined}
            strokeWidth={secondaryStroke}
            transform={`rotate(${rounded(phase + index * topology.ringStep)} ${centerX} ${centerY})`}
          />
        ))}
      </g>

      <g fill={card.secondaryColor} fillOpacity=".055" stroke={card.secondaryColor} strokeOpacity=".38" strokeWidth={secondaryStroke}>
        {Array.from({ length: petalCount }, (_, index) => (
          <path
            d={petal}
            key={`petal-${index}`}
            transform={`rotate(${rounded(phase + index * 360 / petalCount)} ${centerX} ${centerY})`}
          />
        ))}
      </g>

      <g fill={card.providerColor} fillOpacity=".07" stroke={card.providerColor} strokeOpacity=".42" strokeWidth={primaryStroke}>
        {Array.from({ length: leafPairs }, (_, index) => {
          const progress = (index + 1) / (leafPairs + 1);
          const x = rounded(23 + progress * 124);
          const y = rounded(centerY + 70 - progress * 83 + Math.sin((progress + motifIndex * .09) * Math.PI * 2) * 14);
          const rotation = rounded(-47 + progress * 72 + phase * .35);
          const scale = rounded(.62 + density * .055 + sample(hash, 50 + index) * .13);
          return (
            <g key={`leaf-${index}`}>
              <path d={leaf} transform={`translate(${x} ${y}) rotate(${rotation}) scale(${scale})`} />
              <path d={leaf} transform={`translate(${rounded(400 - x)} ${y}) rotate(${rounded(180 - rotation)}) scale(${scale})`} />
            </g>
          );
        })}
      </g>

      {pearlCount > 0 && (
        <g>
          {Array.from({ length: pearlCount }, (_, index) => {
            const angle = (phase + index * 360 / pearlCount) * Math.PI / 180;
            const radiusX = 91 + density * 11;
            const radiusY = 47 + density * 6;
            return (
              <circle
                cx={rounded(centerX + Math.cos(angle) * radiusX)}
                cy={rounded(centerY + Math.sin(angle) * radiusY)}
                fill={index % 2 === 0 ? card.secondaryColor : card.providerColor}
                key={`pearl-${index}`}
                opacity={rounded(.34 + sample(hash, 70 + index) * .2)}
                r={rounded(1.1 + density * .18 + sample(hash, 90 + index) * .5)}
              />
            );
          })}
        </g>
      )}

      {density >= 4 && (
        <g fill="none" opacity=".46" stroke={card.secondaryColor} strokeLinecap="round" strokeWidth="1.15">
          <path d={`M${rounded(centerX - 42)} 12Q${centerX} 34 ${rounded(centerX + 42)} 12Q${centerX} 2 ${rounded(centerX - 42)} 12Z`} />
          <path d={`M${rounded(centerX - 42)} 218Q${centerX} 196 ${rounded(centerX + 42)} 218Q${centerX} 228 ${rounded(centerX - 42)} 218Z`} />
        </g>
      )}
    </svg>
  );
}
