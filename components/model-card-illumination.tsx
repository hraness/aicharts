import type { ModelCardPresentation } from "@/lib/model-card-presentation";

export type ModelCardIlluminationMode = "full" | "gallery";

const providerCourts = {
  alibaba_cloud: "cloud-gate",
  anthropic: "aureole-book",
  cursor: "quill-spine",
  deepseek: "boustrophedon-tide",
  google: "quatrefoil-window",
  meta: "lemniscate-knot",
  moonshot_ai: "lunar-pillars",
  openai: "hex-interlace",
  xai: "broken-compass",
  z_ai: "folding-fan",
} as const;

export type ModelCardProviderCourt = typeof providerCourts[keyof typeof providerCourts];

const courtNames = Object.values(providerCourts);

const familyArchetypes = {
  composer: "interlaced-stave",
  "deepseek-v": "abyssal-eye",
  fable: "illuminated-initial",
  gemini: "twin-vesica",
  glm: "seal-tablet",
  gpt: "labyrinth-knot",
  grok: "astrolabe-cross",
  "kimi-k": "lunar-ladder",
  "muse-spark": "lantern-spark",
  opus: "cathedral-window",
  qwen: "paired-gate",
  sonnet: "lyre",
} as const;

export type ModelCardFamilyArchetype = typeof familyArchetypes[keyof typeof familyArchetypes];

const archetypeNames = Object.values(familyArchetypes);

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

export function modelCardProviderCourt(providerId: string): ModelCardProviderCourt {
  return providerCourts[providerId as keyof typeof providerCourts]
    ?? courtNames[stableHash(providerId) % courtNames.length]
    ?? "hex-interlace";
}

export function modelCardFamilyArchetype(familyId: string): ModelCardFamilyArchetype {
  return familyArchetypes[familyId as keyof typeof familyArchetypes]
    ?? archetypeNames[stableHash(familyId) % archetypeNames.length]
    ?? "seal-tablet";
}

function providerCourtPath(court: ModelCardProviderCourt): string {
  if (court === "cloud-gate") {
    return "M18 158C42 157 49 135 42 120C35 104 50 88 67 93C81 97 84 114 73 123C64 131 53 123 59 114C64 107 75 112 70 118M382 158C358 157 351 135 358 120C365 104 350 88 333 93C319 97 316 114 327 123C336 131 347 123 341 114C336 107 325 112 330 118M111 44H151V29H249V44H289M116 187H155V201H245V187H284";
  }
  if (court === "aureole-book") {
    const rays = Array.from({ length: 14 }, (_, index) => {
      const angle = -78 + index * 12;
      const radians = angle * Math.PI / 180;
      const innerX = rounded(200 + Math.cos(radians) * 78);
      const innerY = rounded(115 + Math.sin(radians) * 62);
      const outerX = rounded(200 + Math.cos(radians) * (index % 2 === 0 ? 112 : 102));
      const outerY = rounded(115 + Math.sin(radians) * (index % 2 === 0 ? 91 : 82));
      return `M${innerX} ${innerY}L${outerX} ${outerY}`;
    }).join("");
    return `${rays}M46 185Q112 169 168 193L200 205L232 193Q288 169 354 185M168 193Q184 184 200 193Q216 184 232 193`;
  }
  if (court === "quill-spine") {
    return "M42 198Q92 119 174 68Q245 24 356 28M65 172L98 170L88 144M100 135L137 132L124 103M143 94L181 91L170 63M236 73L257 47L281 52M279 54L300 35L325 40M326 41L346 29L356 28M44 198L49 174L67 193Z";
  }
  if (court === "boustrophedon-tide") {
    return "M16 50C47 30 78 70 110 50S173 30 194 50M206 50C227 70 290 70 322 50S353 30 384 50M16 82C48 62 80 102 116 82L134 72M266 158L284 148C320 128 352 168 384 148M16 180C50 158 79 198 111 178S171 158 194 179M206 179C229 158 289 158 321 178S350 198 384 176";
  }
  if (court === "quatrefoil-window") {
    return "M200 18C232 18 253 41 247 70C276 64 300 85 300 115C300 145 276 166 247 160C253 189 232 212 200 212C168 212 147 189 153 160C124 166 100 145 100 115C100 85 124 64 153 70C147 41 168 18 200 18ZM64 50C72 42 83 44 89 54C79 59 73 66 66 76C59 67 57 57 64 50ZM336 50C328 42 317 44 311 54C321 59 327 66 334 76C341 67 343 57 336 50ZM64 180C72 188 83 186 89 176C79 171 73 164 66 154C59 163 57 173 64 180ZM336 180C328 188 317 186 311 176C321 171 327 164 334 154C341 163 343 173 336 180Z";
  }
  if (court === "lemniscate-knot") {
    return "M24 115C71 43 133 43 200 115C267 187 329 187 376 115C329 43 267 43 200 115C133 187 71 187 24 115ZM40 115C78 65 124 67 180 115C124 163 78 165 40 115ZM360 115C322 65 276 67 220 115C276 163 322 165 360 115M53 84L34 70L52 57M347 146L366 160L348 173";
  }
  if (court === "lunar-pillars") {
    return "M74 37C37 59 37 171 74 193C48 161 48 69 74 37ZM112 50C81 68 81 162 112 180C92 150 92 80 112 50ZM326 37C363 59 363 171 326 193C352 161 352 69 326 37ZM288 50C319 68 319 162 288 180C308 150 308 80 288 50M74 37L112 50M74 193L112 180M326 37L288 50M326 193L288 180";
  }
  if (court === "hex-interlace") {
    return "M200 17L285 66L285 164L200 213L115 164L115 66ZM200 33L271 74V156L200 197L129 156V74ZM115 66L150 86M285 66L250 86M115 164L150 144M285 164L250 144M200 17V56M200 213V174";
  }
  if (court === "broken-compass") {
    return "M200 16L211 46L200 68L189 46ZM200 214L189 184L200 162L211 184ZM16 115L46 104L68 115L46 126ZM384 115L354 126L332 115L354 104ZM63 37L103 77M337 193L297 153M337 37L297 77M63 193L103 153M32 72L51 72L51 53M368 158L349 158L349 177";
  }
  return "M46 190Q200 8 354 190M75 190Q200 37 325 190M105 190Q200 66 295 190M135 190Q200 91 265 190M200 190V35M200 190L112 70M200 190L288 70M48 190H352M82 201H318";
}

function familyRadicalPath(archetype: ModelCardFamilyArchetype): string {
  if (archetype === "paired-gate") {
    return "M137 166V75L158 54H178V75H222V54H242L263 75V166M137 89H171M229 89H263M152 166V136C152 122 166 115 178 122C189 128 185 145 173 145C164 145 160 136 166 131M248 166V136C248 122 234 115 222 122C211 128 215 145 227 145C236 145 240 136 234 131M130 176H270";
  }
  if (archetype === "illuminated-initial") {
    return "M139 177V57H213Q240 57 240 81Q240 104 211 104H162M162 104V174M162 135H206M126 184Q163 166 199 188Q237 166 274 184L246 199Q220 185 199 197Q178 185 152 199Z";
  }
  if (archetype === "cathedral-window") {
    return "M200 42C158 70 148 129 200 184C252 129 242 70 200 42ZM200 58C174 82 172 127 200 164C228 127 226 82 200 58ZM200 58V164M176 92Q200 76 224 92M169 124Q200 106 231 124M184 169L200 184L216 169";
  }
  if (archetype === "lyre") {
    return "M158 61C135 91 139 137 174 157L187 166V184M242 61C265 91 261 137 226 157L213 166V184M158 61L178 76M242 61L222 76M178 76C166 110 175 143 200 157C225 143 234 110 222 76M185 80V153M200 75V157M215 80V153M172 189H228";
  }
  if (archetype === "interlaced-stave") {
    return "M142 174L244 55L266 72L165 191ZM146 81L165 58L258 166L238 190ZM155 166L178 164M171 145L194 143M188 124L211 122M205 103L228 101M222 82L245 80";
  }
  if (archetype === "abyssal-eye") {
    return "M127 115Q161 69 200 76Q239 69 273 115Q239 161 200 154Q161 161 127 115ZM146 115Q173 90 200 96Q227 90 254 115Q227 140 200 134Q173 140 146 115ZM176 115C176 98 190 86 207 91C222 96 228 114 220 128C212 142 190 143 180 130M133 91L113 78L124 105M267 139L287 152L276 125";
  }
  if (archetype === "twin-vesica") {
    return "M200 45C145 72 145 158 200 185C255 158 255 72 200 45ZM200 45C173 76 173 154 200 185C227 154 227 76 200 45ZM159 115C177 91 223 91 241 115C223 139 177 139 159 115M200 61V169";
  }
  if (archetype === "lantern-spark") {
    return "M200 45L239 84V146L200 185L161 146V84ZM200 62L222 92V138L200 168L178 138V92ZM161 84L139 65M239 84L261 65M161 146L139 165M239 146L261 165M200 45V27M200 185V203M153 115H128M247 115H272";
  }
  if (archetype === "lunar-ladder") {
    return "M179 48C149 68 149 162 179 182C160 151 160 79 179 48ZM221 48C251 68 251 162 221 182C240 151 240 79 221 48ZM179 70H221M170 93H230M168 115H232M170 137H230M179 160H221M188 48L200 35L212 48M188 182L200 195L212 182";
  }
  if (archetype === "labyrinth-knot") {
    return "M200 43L246 69L246 105L274 121L246 137V167L200 193L154 167V137L126 121L154 105V69ZM200 61L230 78V112L257 127L230 143V158L200 175L170 158V130L145 115L170 100V78ZM200 61V91L174 106M226 106L200 121L174 106M200 121V151L226 136";
  }
  if (archetype === "astrolabe-cross") {
    return "M200 43L214 92L263 78L222 107L263 136L214 122L200 187L186 122L137 136L178 107L137 78L186 92ZM200 66V164M159 107H241M151 66Q200 45 249 66M151 148Q200 169 249 148";
  }
  return "M154 51H246L264 69V161L246 179H154L136 161V69ZM154 69H246V161H154ZM171 88H229M171 104H215M171 126H229M171 142H205M145 60L160 75M255 60L240 75M145 170L160 155M255 170L240 155";
}

const runeSegments = {
  a: "M0 12L4 0L8 12M2 7H6",
  k: "M0 0V12M0 7L8 0M2 6L8 12",
  v: "M0 0L4 12L8 0",
  "0": "M1 2L4 0L7 2V10L4 12L1 10Z",
  "1": "M1 3L4 0V12M1 12H7",
  "2": "M1 2L4 0L7 2V5L1 12H7",
  "3": "M1 1H6L3 6L7 8V11L5 12H1",
  "4": "M6 12V0L1 8H8",
  "5": "M7 0H1V5H5L7 7V10L5 12H1",
  "6": "M7 1L5 0L1 4V10L3 12H6L7 10V7L5 5H1",
  "7": "M0 0H8L3 12",
  "8": "M4 6L1 4V2L3 0H5L7 2V4L4 6L7 8V10L5 12H3L1 10V8Z",
  "9": "M7 7H3L1 5V2L3 0H6L7 2V8L3 12L1 11",
} as const;

function syntheticRuneSegment(character: string): string {
  const hash = stableHash(`generation-rune/${character}`);
  const crown = sample(hash, 1) > .5 ? 1 : -1;
  const foot = sample(hash, 2) > .5 ? 1 : -1;
  const bowl = sample(hash, 3) > .5;
  return `M4 0V12M4 3L${4 + crown * 4} 0M4 9L${4 + foot * 4} 12${bowl ? `M4 5L${4 - crown * 4} 7L4 9` : `M1 6H7`}M${crown > 0 ? 7 : 1} 4L${crown > 0 ? 8 : 0} 5`;
}

function runePath(value: string, centerX = 200, baselineY = 205): string {
  const characters = [...value.toLocaleLowerCase("en-US")]
    .filter(character => /^[a-z0-9.-]$/u.test(character))
    .slice(0, 12);
  const widths = characters.map(character => character === "." ? 4 : character === "-" ? 7 : 10);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, characters.length - 1) * 3;
  let cursor = centerX - totalWidth / 2;
  return characters.map((character, index) => {
    const width = widths[index] ?? 0;
    let path: string;
    if (character === ".") path = "M2 10L3 11L2 12L1 11Z";
    else if (character === "-") path = "M0 7H7";
    else path = runeSegments[character as keyof typeof runeSegments]
      ?? syntheticRuneSegment(character);
    const translated = path.replace(/([MLHV])(-?\d+(?:\.\d+)?)(?: (-?\d+(?:\.\d+)?))?/gu, (match, command: string, first: string, second?: string) => {
      if (command === "H") return `H${rounded(cursor + Number(first))}`;
      if (command === "V") return `V${rounded(baselineY - 12 + Number(first))}`;
      if (second === undefined) return match;
      return `${command}${rounded(cursor + Number(first))} ${rounded(baselineY - 12 + Number(second))}`;
    });
    cursor += width + 3;
    return translated;
  }).join("");
}

function generationSignaturePath(
  generation: readonly string[],
  revision: string | null,
): string {
  const generationLabel = generation.join(".");
  const majorDigits = generation[0]?.match(/\d+/u)?.[0] ?? "3";
  const cuspCount = Math.max(3, Math.min(7, Number.parseInt(majorDigits, 10) || 3));
  const topBand = Array.from({ length: cuspCount }, (_, index) => {
    const x = rounded(151 + index * 98 / Math.max(1, cuspCount - 1));
    const direction = index % 2 === 0 ? -1 : 1;
    return `M${rounded(x - 5)} 39L${x} ${39 + direction * 5}L${rounded(x + 5)} 39`;
  }).join("");
  const revisionMark = revision === null
    ? ""
    : runePath(revision.slice(-4), 321, 203);
  return `${topBand}${runePath(generationLabel)}${revisionMark}`;
}

function editionSignaturePath(editionId: string): string {
  if (editionId === "plus") return "M200 24V44M190 34H210M194 28L206 40M206 28L194 40";
  if (editionId === "max") return "M180 45L184 25L195 36L200 20L205 36L216 25L220 45ZM184 49H216";
  if (editionId === "fast") return "M172 35L190 25L184 38M204 35L222 25L216 38M229 28L239 23";
  if (editionId === "flash") return "M205 20L185 39H199L193 52L218 31H204Z";
  if (editionId === "pro") return "M190 23H210V31H216V43H184V31H190ZM195 43V51M205 43V51";
  if (editionId === "luna") return "M207 21C188 24 184 45 200 52C190 41 195 28 207 21Z";
  if (editionId === "sol") return "M200 22A12 12 0 1 1 199.9 22M200 17V10M200 58V51M179 34H172M228 34H221M185 19L180 14M220 54L215 49M215 19L220 14M180 54L185 49";
  if (editionId === "terra") return "M174 46Q187 27 200 45Q214 19 226 46M174 46H226M185 51Q200 43 215 51";
  if (editionId === "base") return "M200 24L208 34L200 44L192 34ZM200 28V40M196 34H204";
  const hash = stableHash(editionId);
  const lean = sample(hash, 1) > .5 ? 1 : -1;
  return `M200 22L${rounded(211 + lean * 3)} 34L200 49L${rounded(189 + lean * 3)} 34ZM200 27V44M${rounded(190 + lean * 2)} 34H${rounded(210 + lean * 2)}`;
}

function coronaPath(
  accentFamily: ModelCardPresentation["accentFamily"],
  visualClass: ModelCardPresentation["visualClass"],
  density: number,
): string {
  if (accentFamily === "fast" || visualClass === "fast") {
    return "M102 165Q135 137 151 106M113 173L104 157L122 159M298 65Q265 93 249 124M287 57L296 73L278 71M83 149L96 146M304 84L317 81";
  }
  if (accentFamily === "thinking" || visualClass === "thinking") {
    return "M112 115C133 69 175 64 200 102C225 140 267 135 288 89M112 141C133 95 175 90 200 128C225 166 267 161 288 115";
  }
  if (accentFamily === "elevated") {
    const pearls = Array.from({ length: density }, (_, index) => {
      const x = rounded(153 + index * 94 / Math.max(1, density - 1));
      return `M${rounded(x - 2.5)} 177L${x} 173L${rounded(x + 2.5)} 177L${x} 181Z`;
    }).join("");
    return `M126 91Q146 57 175 52M274 91Q254 57 225 52M126 139Q146 173 175 178M274 139Q254 173 225 178${pearls}`;
  }
  return "M119 115L127 107L135 115L127 123ZM281 115L273 107L265 115L273 123Z";
}

function acanthusSprigPath(index: number, hash: number): string {
  const y = rounded(71 + index * 144 / 6 + (sample(hash, 30 + index) - .5) * 7);
  const curl = rounded(18 + sample(hash, 40 + index) * 11);
  const scale = rounded(.78 + index * .055);
  const left = `M30 ${y}C${rounded(52 + curl)} ${rounded(y - 21)} ${rounded(71 + curl)} ${rounded(y + 22)} 101 ${rounded(y - 3)}C88 ${rounded(y + 1)} 82 ${rounded(y + 15)} 96 ${rounded(y + 18)}C83 ${rounded(y + 24)} 72 ${rounded(y + 16)} 74 ${rounded(y + 5)}C62 ${rounded(y + 15)} 52 ${rounded(y + 7)} 57 ${rounded(y - 3)}`;
  return `${left}M370 ${y}C${rounded(348 - curl)} ${rounded(y - 21)} ${rounded(329 - curl)} ${rounded(y + 22)} 299 ${rounded(y - 3)}C312 ${rounded(y + 1)} 318 ${rounded(y + 15)} 304 ${rounded(y + 18)}C317 ${rounded(y + 24)} 328 ${rounded(y + 16)} 326 ${rounded(y + 5)}C338 ${rounded(y + 15)} 348 ${rounded(y + 7)} 343 ${rounded(y - 3)}M${rounded(92 - scale * 4)} ${rounded(y - 1)}L${rounded(99 - scale * 2)} ${rounded(y - 10)}M${rounded(308 + scale * 4)} ${rounded(y - 1)}L${rounded(301 + scale * 2)} ${rounded(y - 10)}`;
}

function scribeGlyphPath(token: string): string {
  const hash = stableHash(token);
  return [0, 1, 2].map((index) => {
    const x = 61 + index * 139;
    const y = 104 + (index % 2) * 18;
    const branch = sample(hash, index) > .5 ? 1 : -1;
    const bowl = sample(hash, 10 + index) > .5;
    return `M${x} ${y - 11}V${y + 11}M${x} ${y - 5}L${x + branch * 8} ${y - 10}${bowl ? `M${x} ${y + 1}Q${x + branch * 10} ${y + 5} ${x} ${y + 9}` : `M${x} ${y + 3}L${x - branch * 7} ${y + 9}`}M${x + branch * 10} ${y - 12}L${x + branch * 12} ${y - 10}`;
  }).join("");
}

function identityValue(card: Pick<ModelCardPresentation, "emblemIdentity" | "profileSlug" | "providerId">): string {
  const identity = card.emblemIdentity;
  return [
    card.providerId,
    identity.familyId,
    identity.generation.join("."),
    identity.revision ?? "none",
    identity.editionId,
    identity.role,
    card.profileSlug,
  ].join("/");
}

export function ModelCardIllumination({
  card,
  mode = "full",
}: Readonly<{
  card: Pick<ModelCardPresentation,
    | "accentFamily"
    | "canonicalModelId"
    | "emblemIdentity"
    | "illuminationDensity"
    | "profileSlug"
    | "providerColor"
    | "providerId"
    | "secondaryColor"
    | "visualClass">;
  mode?: ModelCardIlluminationMode;
}>) {
  const identity = card.emblemIdentity;
  const court = modelCardProviderCourt(card.providerId);
  const archetype = modelCardFamilyArchetype(identity.familyId);
  const density = card.illuminationDensity;
  const isGallery = mode === "gallery";
  const modelHash = stableHash(card.canonicalModelId);
  const flourishCount = isGallery ? density : density + 1;
  const jewelCount = density * 2;
  const fingerprint = identityValue(card);

  return (
    <svg
      aria-hidden="true"
      className="model-card-illumination"
      data-emblem-archetype={archetype}
      data-emblem-edition={identity.editionId}
      data-emblem-family={identity.familyId}
      data-emblem-fingerprint={fingerprint}
      data-emblem-generation={identity.generation.join(".")}
      data-emblem-role={identity.role}
      data-illumination-accent={card.accentFamily}
      data-illumination-class={card.visualClass}
      data-illumination-density={density}
      data-illumination-mode={mode}
      data-illumination-motif={court}
      focusable="false"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      style={{ inset: 0, pointerEvents: "none", position: "absolute" }}
      viewBox="0 0 400 230"
      width="100%"
    >
      <g
        data-emblem-signature="provider"
        data-illumination-signature="provider"
        fill="none"
        opacity=".49"
        stroke={card.providerColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.15"
      >
        <path d={providerCourtPath(court)} />
      </g>

      <g
        data-emblem-signature="family"
        fill="none"
        opacity=".64"
        stroke={card.secondaryColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      >
        <path d={familyRadicalPath(archetype)} />
      </g>

      <g
        data-emblem-signature="generation"
        fill="none"
        opacity=".72"
        stroke={card.secondaryColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      >
        <path d={generationSignaturePath(identity.generation, identity.revision)} />
      </g>

      <g
        data-emblem-signature="edition"
        fill="none"
        opacity=".78"
        stroke={card.providerColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      >
        <path d={editionSignaturePath(identity.editionId)} />
      </g>

      <g
        data-emblem-signature="class"
        data-illumination-signature="class"
        fill="none"
        opacity=".34"
        stroke={card.secondaryColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.15"
      >
        <path d={coronaPath(card.accentFamily, card.visualClass, density)} />
      </g>

      <g
        data-emblem-signature="profile"
        fill={card.secondaryColor}
        fillOpacity=".58"
        stroke={card.providerColor}
        strokeOpacity=".58"
        strokeWidth=".8"
      >
        {Array.from({ length: jewelCount }, (_, index) => {
          const angle = (-156 + index * 312 / Math.max(1, jewelCount - 1)) * Math.PI / 180;
          const x = rounded(200 + Math.cos(angle) * 83);
          const y = rounded(115 + Math.sin(angle) * 67);
          return <circle cx={x} cy={y} key={`jewel-${index}`} r={rounded(1.85 + density * .1)} />;
        })}
      </g>

      <g
        fill="none"
        opacity={isGallery ? ".32" : ".39"}
        stroke={card.providerColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.05"
      >
        {Array.from({ length: flourishCount }, (_, index) => (
          <path d={acanthusSprigPath(index, modelHash)} key={`acanthus-${index}`} />
        ))}
      </g>

      {!isGallery && (
        <g
          data-emblem-signature="scribe"
          fill="none"
          opacity=".27"
          stroke={card.secondaryColor}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1"
        >
          <path d={scribeGlyphPath(`${card.providerId}/${identity.familyId}/${identity.editionId}`)} />
        </g>
      )}

      <ellipse
        cx="200"
        cy="115"
        fill="#050609"
        fillOpacity=".78"
        rx="64"
        ry="54"
      />
    </svg>
  );
}
