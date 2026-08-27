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

const providerLineHands = {
  alibaba_cloud: "cloud-burin",
  anthropic: "radiant-drypoint",
  cursor: "quill-engraving",
  deepseek: "tidal-wrigglework",
  google: "cloisonne-hatch",
  meta: "ribbon-blackwork",
  moonshot_ai: "lunar-ruling",
  openai: "engine-turning",
  xai: "bright-cut",
  z_ai: "pochoir-fan",
} as const;

export type ModelCardProviderLineHand = typeof providerLineHands[keyof typeof providerLineHands];

const lineHandNames = Object.values(providerLineHands);

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

export function modelCardProviderLineHand(providerId: string): ModelCardProviderLineHand {
  return providerLineHands[providerId as keyof typeof providerLineHands]
    ?? lineHandNames[stableHash(`line-hand/${providerId}`) % lineHandNames.length]
    ?? "engine-turning";
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

type OrnamentPoint = Readonly<{ x: number; y: number }>;

function smoothClosedPath(points: readonly OrnamentPoint[]): string {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return "";
  const startX = rounded((last.x + first.x) / 2);
  const startY = rounded((last.y + first.y) / 2);
  return `M${startX} ${startY}${points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    if (next === undefined) return "";
    return `Q${rounded(point.x)} ${rounded(point.y)} ${rounded((point.x + next.x) / 2)} ${rounded((point.y + next.y) / 2)}`;
  }).join("")}Z`;
}

function harmonicLoopPath(
  seed: number,
  phase: number,
  radiusX: number,
  radiusY: number,
  sampleCount = 36,
): string {
  const primaryFrequency = 3 + seed % 5;
  const secondaryFrequency = primaryFrequency + 2 + (seed >>> 4) % 3;
  const points = Array.from({ length: sampleCount }, (_, index) => {
    const angle = index * Math.PI * 2 / sampleCount;
    const harmonic = 1
      + Math.cos(angle * primaryFrequency + phase) * .105
      + Math.cos(angle * secondaryFrequency - phase * .7) * .045;
    return {
      x: 200 + Math.cos(angle) * radiusX * harmonic,
      y: 115 + Math.sin(angle) * radiusY * harmonic,
    };
  });
  return smoothClosedPath(points);
}

function safeCartouchePath(court: ModelCardProviderCourt): string {
  const index = Math.max(0, courtNames.indexOf(court));
  const topBreak = 105 + index % 4 * 12;
  const sideBreak = 83 + index % 3 * 16;
  return [
    `M18 ${sideBreak}V31Q18 18 31 18H${topBreak}`,
    `M${topBreak + 42} 18H${358 - topBreak / 5}`,
    `M${390 - topBreak / 5} 18H369Q382 18 382 31V${sideBreak - 9}`,
    `M382 ${sideBreak + 35}V199Q382 212 369 212H${278 - index * 2}`,
    `M${232 - index * 2} 212H31Q18 212 18 199V${151 - index * 2}`,
    `M18 ${119 - index * 2}V${sideBreak + 18}`,
  ].join("");
}

function providerFieldPath(court: ModelCardProviderCourt): string {
  const seed = stableHash(`provider-field/${court}`);
  return [
    harmonicLoopPath(seed, sample(seed, 3) * Math.PI, 121, 88),
    harmonicLoopPath(seed ^ 0x9e3779b9, sample(seed, 7) * Math.PI, 105, 75),
  ].join("");
}

function providerReliefPath(court: ModelCardProviderCourt): string {
  if (court === "cloud-gate") {
    return "M31 166C44 143 65 146 70 162C77 151 94 153 98 166C88 177 43 179 31 166ZM302 166C306 153 323 151 330 162C335 146 356 143 369 166C357 179 312 177 302 166Z";
  }
  if (court === "aureole-book") {
    return "M72 74L116 84L92 102ZM328 74L284 84L308 102ZM109 178Q151 164 191 184L174 196Q141 181 109 190ZM291 178Q249 164 209 184L226 196Q259 181 291 190Z";
  }
  if (court === "quill-spine") {
    return "M41 186L52 159L66 180ZM67 159L80 130L92 151ZM92 132L108 103L119 124ZM284 58L310 42L303 67ZM316 43L344 28L335 54Z";
  }
  if (court === "boustrophedon-tide") {
    return "M24 65Q47 47 70 65Q47 59 24 65ZM330 65Q353 47 376 65Q353 59 330 65ZM24 174Q47 156 70 174Q47 168 24 174ZM330 174Q353 156 376 174Q353 168 330 174Z";
  }
  if (court === "quatrefoil-window") {
    return "M200 24Q225 48 200 73Q175 48 200 24ZM291 115Q266 140 241 115Q266 90 291 115ZM200 206Q175 182 200 157Q225 182 200 206ZM109 115Q134 90 159 115Q134 140 109 115Z";
  }
  if (court === "lemniscate-knot") {
    return "M33 115Q91 55 160 111Q94 100 33 115ZM367 115Q309 175 240 119Q306 130 367 115Z";
  }
  if (court === "lunar-pillars") {
    return "M67 42C42 69 42 161 67 188C55 147 55 83 67 42ZM333 42C358 69 358 161 333 188C345 147 345 83 333 42Z";
  }
  if (court === "hex-interlace") {
    return "M200 23L225 38L225 67L200 82L175 67L175 38ZM200 207L175 192L175 163L200 148L225 163L225 192Z";
  }
  if (court === "broken-compass") {
    return "M200 19L212 52L200 67L188 52ZM200 211L188 178L200 163L212 178ZM22 115L55 103L70 115L55 127ZM378 115L345 127L330 115L345 103Z";
  }
  return "M200 202L151 190L200 43L249 190ZM200 202L177 190L200 74L223 190Z";
}

function providerHatchPath(hand: ModelCardProviderLineHand): string {
  if (hand === "cloud-burin") return "M31 151Q52 132 73 151M38 158Q57 141 76 158M324 158Q343 141 362 158M327 151Q348 132 369 151";
  if (hand === "radiant-drypoint") return Array.from({ length: 9 }, (_, index) => `M${104 + index * 24} 41L${116 + index * 21} ${55 + index % 2 * 7}`).join("");
  if (hand === "quill-engraving") return "M47 176L75 181M56 159L84 165M68 141L96 147M82 122L109 129M301 55L329 61M320 41L347 47";
  if (hand === "tidal-wrigglework") return "M32 89Q44 80 56 89T80 89M320 89Q332 98 344 89T368 89M32 142Q44 133 56 142T80 142M320 142Q332 151 344 142T368 142";
  if (hand === "cloisonne-hatch") return "M81 61L108 88M75 72L101 98M292 88L319 61M299 98L325 72M81 169L108 142M75 158L101 132M292 142L319 169M299 132L325 158";
  if (hand === "ribbon-blackwork") return "M47 101L70 124M47 124L70 101M330 101L353 124M330 124L353 101M72 67L88 83M312 83L328 67M72 163L88 147M312 147L328 163";
  if (hand === "lunar-ruling") return "M81 61V169M93 68V162M307 68V162M319 61V169M72 91H101M299 139H328";
  if (hand === "engine-turning") return "M83 79Q112 45 151 56M317 79Q288 45 249 56M83 151Q112 185 151 174M317 151Q288 185 249 174";
  if (hand === "bright-cut") return "M68 68L91 91M71 91L94 68M306 68L329 91M309 91L332 68M68 162L91 139M71 139L94 162M306 162L329 139M309 139L332 162";
  return "M68 187L112 74M89 190L132 58M111 190L151 48M249 48L289 190M268 58L311 190M288 74L332 187";
}

function familyMattePath(archetype: ModelCardFamilyArchetype): string {
  if (archetype === "paired-gate") return "M132 174V79L153 57H180L200 77L220 57H247L268 79V174L247 193H153ZM149 95V164L169 177H231L251 164V95L231 77H220L200 96L180 77H169Z";
  if (archetype === "illuminated-initial") return "M137 54H224Q250 54 258 74L247 100Q265 117 250 137L260 162Q247 188 218 185L198 199L178 185Q149 188 136 162L146 137Q131 117 149 100L138 74Z";
  if (archetype === "cathedral-window") return "M200 36Q154 62 145 114Q140 157 177 187L200 205L223 187Q260 157 255 114Q246 62 200 36Z";
  if (archetype === "lyre") return "M151 52Q123 101 146 150Q155 170 181 180L175 197H225L219 180Q245 170 254 150Q277 101 249 52L223 70Q235 105 218 143L200 160L182 143Q165 105 177 70Z";
  if (archetype === "interlaced-stave") return "M131 77L164 46L200 86L236 46L269 77L226 116L271 162L238 194L200 151L162 194L129 162L174 116Z";
  if (archetype === "abyssal-eye") return "M119 115Q151 63 200 70Q249 63 281 115Q249 167 200 160Q151 167 119 115ZM154 115Q176 87 200 92Q224 87 246 115Q224 143 200 138Q176 143 154 115Z";
  if (archetype === "twin-vesica") return "M200 35Q137 73 147 125Q151 164 200 195Q249 164 253 125Q263 73 200 35ZM200 60Q170 85 170 125Q173 156 200 175Q227 156 230 125Q230 85 200 60Z";
  if (archetype === "lantern-spark") return "M200 31L251 79V151L200 199L149 151V79ZM200 56L229 91V139L200 174L171 139V91Z";
  if (archetype === "lunar-ladder") return "M168 38Q124 70 143 124Q125 173 168 196L183 177H217L232 196Q275 173 257 124Q276 70 232 38L217 56H183Z";
  if (archetype === "labyrinth-knot") return "M200 32L254 63L254 96L286 115L254 134V167L200 198L146 167V134L114 115L146 96V63Z";
  if (archetype === "astrolabe-cross") return "M200 29L219 87L278 67L239 115L278 163L219 143L200 201L181 143L122 163L161 115L122 67L181 87Z";
  return "M150 47H250L273 70V160L250 183H150L127 160V70ZM155 70V160H245V70Z";
}

function familyInlayPath(archetype: ModelCardFamilyArchetype): string {
  const index = Math.max(0, archetypeNames.indexOf(archetype));
  const points = 3 + index % 5;
  return Array.from({ length: points }, (_, pointIndex) => {
    const angle = -Math.PI / 2 + pointIndex * Math.PI * 2 / points;
    const x = rounded(200 + Math.cos(angle) * (74 + index % 3 * 5));
    const y = rounded(115 + Math.sin(angle) * (57 + index % 4 * 3));
    const tangentX = rounded(Math.cos(angle + Math.PI / 2) * 7);
    const tangentY = rounded(Math.sin(angle + Math.PI / 2) * 7);
    return `M${x - tangentX} ${y - tangentY}L${rounded(x + Math.cos(angle) * 9)} ${rounded(y + Math.sin(angle) * 9)}L${x + tangentX} ${y + tangentY}L${rounded(x - Math.cos(angle) * 4)} ${rounded(y - Math.sin(angle) * 4)}Z`;
  }).join("");
}

function leafPath(
  baseX: number,
  baseY: number,
  angleDegrees: number,
  length: number,
  width: number,
): string {
  const angle = angleDegrees * Math.PI / 180;
  const tangentX = Math.cos(angle);
  const tangentY = Math.sin(angle);
  const normalX = -tangentY;
  const normalY = tangentX;
  const tipX = baseX + tangentX * length;
  const tipY = baseY + tangentY * length;
  const shoulderX = baseX + tangentX * length * .48;
  const shoulderY = baseY + tangentY * length * .48;
  return `M${rounded(baseX)} ${rounded(baseY)}C${rounded(shoulderX + normalX * width)} ${rounded(shoulderY + normalY * width)} ${rounded(tipX - tangentX * length * .18 + normalX * width * .5)} ${rounded(tipY - tangentY * length * .18 + normalY * width * .5)} ${rounded(tipX)} ${rounded(tipY)}C${rounded(tipX - tangentX * length * .18 - normalX * width * .5)} ${rounded(tipY - tangentY * length * .18 - normalY * width * .5)} ${rounded(shoulderX - normalX * width)} ${rounded(shoulderY - normalY * width)} ${rounded(baseX)} ${rounded(baseY)}Z`;
}

function leafVeinPath(
  baseX: number,
  baseY: number,
  angleDegrees: number,
  length: number,
): string {
  const angle = angleDegrees * Math.PI / 180;
  return `M${rounded(baseX)} ${rounded(baseY)}L${rounded(baseX + Math.cos(angle) * length * .82)} ${rounded(baseY + Math.sin(angle) * length * .82)}`;
}

type FamilyOrganism = Readonly<{
  ghost: string;
  leaves: readonly Readonly<{ angle: number; length: number; path: string; vein: string }>[];
  ribbons: readonly string[];
  spine: string;
}>;

function familyOrganism(archetype: ModelCardFamilyArchetype): FamilyOrganism {
  const hash = stableHash(`family-organism/${archetype}`);
  const archFamilies = new Set<ModelCardFamilyArchetype>([
    "cathedral-window",
    "paired-gate",
  ]);
  const tideFamilies = new Set<ModelCardFamilyArchetype>([
    "abyssal-eye",
    "lunar-ladder",
    "lyre",
  ]);
  const climbingFamilies = new Set<ModelCardFamilyArchetype>([
    "illuminated-initial",
    "lantern-spark",
    "twin-vesica",
  ]);
  const interlacedFamilies = new Set<ModelCardFamilyArchetype>([
    "astrolabe-cross",
    "interlaced-stave",
    "labyrinth-knot",
  ]);
  let ghost: string;
  let leafSpecs: readonly Readonly<{
    angle: number;
    baseX: number;
    baseY: number;
    length: number;
    width: number;
  }>[];
  let ribbons: readonly string[];
  let spine: string;

  if (tideFamilies.has(archetype)) {
    const rise = rounded(88 + sample(hash, 1) * 15);
    const left = `M20 135C55 ${rise} 89 ${rounded(rise - 8)} 117 116C134 129 139 151 153 170`;
    const right = `M380 131C345 ${rounded(rise + 4)} 311 ${rounded(rise - 5)} 283 113C266 126 261 148 247 168`;
    spine = `${left}${right}`;
    ribbons = [
      `${left}C135 148 130 124 115 122C88 ${rounded(rise - 1)} 55 ${rise + 8} 23 142Z`,
      `${right}C265 145 270 121 285 119C312 ${rounded(rise + 2)} 345 ${rise + 12} 377 138Z`,
    ];
    ghost = `M21 128C57 ${rise - 6} 89 ${rise - 14} 120 109C138 123 143 145 157 166M379 124C343 ${rise - 2} 311 ${rise - 11} 280 106C262 120 257 142 243 164`;
    leafSpecs = [
      { angle: -48, baseX: 61, baseY: rise + 3, length: 25, width: 6.5 },
      { angle: 34, baseX: 111, baseY: 113, length: 25, width: 6.5 },
      { angle: -132, baseX: 339, baseY: rise + 7, length: 25, width: 6.5 },
      { angle: 146, baseX: 289, baseY: 111, length: 25, width: 6.5 },
    ];
  } else if (climbingFamilies.has(archetype)) {
    const crown = rounded(48 + sample(hash, 2) * 15);
    const left = `M45 196C35 153 61 105 103 86C119 79 132 65 151 ${crown}`;
    const right = `M355 196C365 153 339 105 297 86C281 79 268 65 249 ${crown + 2}`;
    spine = `${left}${right}`;
    ribbons = [
      `${left}C133 73 121 86 106 93C67 113 45 155 53 198Z`,
      `${right}C267 73 279 86 294 93C333 113 355 155 347 198Z`,
    ];
    ghost = `M39 192C30 150 57 99 100 80C117 73 130 59 149 ${crown - 6}M361 192C370 150 343 99 300 80C283 73 270 59 251 ${crown - 4}`;
    leafSpecs = [
      { angle: -18, baseX: 58, baseY: 147, length: 26, width: 7 },
      { angle: -56, baseX: 101, baseY: 87, length: 27, width: 7 },
      { angle: 198, baseX: 342, baseY: 147, length: 26, width: 7 },
      { angle: 236, baseX: 299, baseY: 87, length: 27, width: 7 },
    ];
  } else if (interlacedFamilies.has(archetype)) {
    const skew = rounded((sample(hash, 3) - .5) * 12);
    const left = `M27 184C66 161 95 116 151 ${58 + skew}`;
    const right = `M373 184C334 161 305 116 249 ${58 - skew}`;
    spine = `${left}${right}M61 77L131 165M339 77L269 165`;
    ribbons = [
      `${left}L158 ${66 + skew}C103 126 72 169 30 192Z`,
      `${right}L242 ${66 - skew}C297 126 328 169 370 192Z`,
    ];
    ghost = `M24 176C64 153 91 108 147 ${51 + skew}M376 176C336 153 309 108 253 ${51 - skew}`;
    leafSpecs = [
      { angle: -76, baseX: 64, baseY: 154, length: 22, width: 5.5 },
      { angle: 12, baseX: 99, baseY: 113, length: 24, width: 6 },
      { angle: -104, baseX: 336, baseY: 154, length: 22, width: 5.5 },
      { angle: 168, baseX: 301, baseY: 113, length: 24, width: 6 },
    ];
  } else if (archFamilies.has(archetype)) {
    const shoulder = rounded(67 + sample(hash, 1) * 17);
    const belly = rounded(151 + sample(hash, 2) * 16);
    const left = `M23 188C55 174 65 ${belly} 101 ${belly - 9}C126 ${belly - 15} 125 ${shoulder + 30} 148 ${shoulder}`;
    const right = `M377 184C344 171 333 ${belly - 4} 298 ${belly - 12}C274 ${belly - 18} 276 ${shoulder + 25} 251 ${shoulder - 3}`;
    spine = `${left}${right}`;
    ribbons = [
      `${left}C134 ${shoulder + 31} 130 ${belly - 7} 101 ${belly - 3}C66 ${belly + 7} 56 184 26 195Z`,
      `${right}C266 ${shoulder + 29} 270 ${belly - 9} 298 ${belly - 6}C333 ${belly + 3} 345 177 374 191Z`,
    ];
    ghost = `M26 183C57 172 67 ${belly - 4} 102 ${belly - 13}C126 ${belly - 18} 129 ${shoulder + 26} 151 ${shoulder - 4}M374 179C343 168 331 ${belly - 8} 297 ${belly - 16}C273 ${belly - 22} 272 ${shoulder + 21} 248 ${shoulder - 7}`;
    leafSpecs = [
      { angle: -68, baseX: 64, baseY: belly - 6, length: 25, width: 6.5 },
      { angle: -38, baseX: 103, baseY: belly - 12, length: 27, width: 7 },
      { angle: -112, baseX: 336, baseY: belly - 11, length: 24, width: 6 },
      { angle: -142, baseX: 297, baseY: belly - 15, length: 28, width: 7.5 },
    ];
  } else {
    const left = "M58 192V73Q58 55 76 55H139";
    const right = "M342 192V73Q342 55 324 55H261";
    spine = `${left}${right}M58 104H117M342 126H283`;
    ribbons = [
      `${left}V63H80Q67 63 67 76V192Z`,
      `${right}V63H320Q333 63 333 76V192Z`,
    ];
    ghost = "M51 192V70Q51 48 74 48H137M349 192V70Q349 48 326 48H263";
    leafSpecs = [
      { angle: -28, baseX: 66, baseY: 147, length: 23, width: 6 },
      { angle: 31, baseX: 66, baseY: 101, length: 23, width: 6 },
      { angle: 208, baseX: 334, baseY: 147, length: 23, width: 6 },
      { angle: 149, baseX: 334, baseY: 101, length: 23, width: 6 },
    ];
  }
  const leaves = leafSpecs.map(spec => ({
    angle: spec.angle,
    length: spec.length,
    path: leafPath(spec.baseX, spec.baseY, spec.angle, spec.length, spec.width),
    vein: leafVeinPath(spec.baseX, spec.baseY, spec.angle, spec.length),
  }));
  return {
    ghost,
    leaves,
    ribbons,
    spine,
  };
}

function editionCellPath(editionId: string): string {
  if (editionId === "max") return "M181 44L186 24L196 34L200 17L204 34L214 24L219 44L211 51H189Z";
  if (editionId === "fast") return "M172 28L191 21L184 39L199 33L218 24L211 43L228 36L218 53L195 48L179 51Z";
  if (editionId === "flash") return "M205 18L181 40H198L191 55L222 29H204Z";
  if (editionId === "pro") return "M190 21H210V29H217V44H210V51H190V44H183V29H190Z";
  if (editionId === "luna") return "M210 19C187 21 178 43 194 55C187 42 193 27 210 19Z";
  if (editionId === "sol") return "M200 17L207 28L220 30L211 40L214 53L200 47L186 53L189 40L180 30L193 28Z";
  if (editionId === "terra") return "M174 48Q186 25 200 44Q214 17 228 48L218 55H182Z";
  if (editionId === "plus") return "M194 21H206V30H215V42H206V51H194V42H185V30H194Z";
  return "M200 21L211 34L200 48L189 34Z";
}

function roleTotemPath(role: ModelCardPresentation["emblemIdentity"]["role"]): string {
  if (role === "speed") return "M111 184L130 176L123 190ZM289 184L270 176L277 190Z";
  if (role === "reasoning") return "M102 181Q116 166 130 181Q116 196 102 181ZM298 181Q284 166 270 181Q284 196 298 181Z";
  if (role === "flagship") return "M103 187L108 170L117 179L126 168L131 187ZM269 187L274 168L283 179L292 170L297 187Z";
  return "M108 172L120 184L108 196L96 184ZM292 172L304 184L292 196L280 184Z";
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

function generationTopologyPath(generation: readonly string[]): string {
  const token = generation.join(".");
  const hash = stableHash(`generation-topology/${token}`);
  const lobeCount = 3 + hash % 5;
  const phase = sample(hash, 21) * Math.PI * 2;
  const points = Array.from({ length: lobeCount * 2 }, (_, index) => {
    const angle = -Math.PI / 2 + phase * .08 + index * Math.PI / lobeCount;
    const radiusX = index % 2 === 0 ? 84 : 69 + sample(hash, 30 + index) * 5;
    const radiusY = index % 2 === 0 ? 66 : 53 + sample(hash, 50 + index) * 4;
    return {
      x: 200 + Math.cos(angle) * radiusX,
      y: 115 + Math.sin(angle) * radiusY,
    };
  });
  const axialCount = Math.min(4, Math.max(1, generation.length));
  const axes = Array.from({ length: axialCount }, (_, index) => {
    const angle = phase + index * Math.PI / axialCount;
    const x1 = rounded(200 + Math.cos(angle) * 66);
    const y1 = rounded(115 + Math.sin(angle) * 49);
    const x2 = rounded(200 + Math.cos(angle) * 80);
    const y2 = rounded(115 + Math.sin(angle) * 61);
    return `M${x1} ${y1}L${x2} ${y2}`;
  }).join("");
  return `${smoothClosedPath(points)}${axes}`;
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
  return `${generationTopologyPath(generation)}${topBand}${runePath(generationLabel)}${revisionMark}`;
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

function profileDetailLeafPath(index: number, hash: number): string {
  const isLeft = index % 2 === 0;
  const row = Math.floor(index / 2);
  const baseX = isLeft ? 39 + row * 8 : 361 - row * 8;
  const baseY = 60 + row * 38 + (sample(hash, 70 + index) - .5) * 8;
  const angle = isLeft
    ? -18 + sample(hash, 80 + index) * 37
    : 161 + sample(hash, 80 + index) * 37;
  return leafPath(baseX, baseY, angle, 17 + row * 2, 4.5 + row * .5);
}

function profileTallyPath(profileSlug: string): string {
  const hash = stableHash(`profile-tally/${profileSlug}`);
  return Array.from({ length: 12 }, (_, index) => {
    const x = 43 + index * 6;
    const high = (hash >>> (index % 24)) & 1;
    return `M${x} ${high === 1 ? 194 : 199}V205`;
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
  const lineHand = modelCardProviderLineHand(card.providerId);
  const archetype = modelCardFamilyArchetype(identity.familyId);
  const density = card.illuminationDensity;
  const isGallery = mode === "gallery";
  const modelHash = stableHash(card.canonicalModelId);
  const organism = familyOrganism(archetype);
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
      data-ornament-line-hand={lineHand}
      data-ornament-medium="deterministic-svg-engraving"
      focusable="false"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      style={{ inset: 0, pointerEvents: "none", position: "absolute" }}
      viewBox="0 0 400 230"
      width="100%"
    >
      <g data-ornament-depth="background">
        <g
          data-emblem-signature="provider"
          data-illumination-signature="provider"
          fill="none"
          opacity=".3"
          stroke={card.providerColor}
          strokeLinecap="butt"
          strokeLinejoin="miter"
          strokeWidth=".82"
        >
          <path d={`${safeCartouchePath(court)}${providerCourtPath(court)}${providerFieldPath(court)}`} />
        </g>
        <path
          d={providerReliefPath(court)}
          data-ornament-mark="painted-relief"
          fill={card.providerColor}
          fillOpacity=".13"
          stroke={card.providerColor}
          strokeOpacity=".25"
          strokeWidth=".6"
        />
        <path
          d={providerHatchPath(lineHand)}
          data-ornament-mark="engraving-hatch"
          fill="none"
          opacity=".23"
          stroke={card.secondaryColor}
          strokeLinecap="butt"
          strokeWidth=".7"
        />
      </g>

      <g data-ornament-depth="midground">
        <path
          d={familyMattePath(archetype)}
          data-emblem-signature="family-matte"
          fill="#050609"
          fillOpacity=".82"
          stroke={card.providerColor}
          strokeOpacity=".32"
          strokeWidth=".85"
        />
        <path
          d={familyInlayPath(archetype)}
          data-ornament-mark="cloisonne-inlay"
          fill={card.secondaryColor}
          fillOpacity=".24"
        />
        <path
          d={organism.ribbons.join("")}
          data-ornament-mark="calligraphic-ribbon"
          fill={card.providerColor}
          fillOpacity={isGallery ? ".22" : ".28"}
          stroke={card.providerColor}
          strokeOpacity=".42"
          strokeWidth=".45"
        />
        <path
          d={organism.leaves.map(leaf => leaf.path).join("")}
          data-ornament-mark="botanical-inlay"
          fill={card.secondaryColor}
          fillOpacity={isGallery ? ".31" : ".4"}
          stroke={card.secondaryColor}
          strokeOpacity=".54"
          strokeWidth=".55"
        />
        <path
          d={`${organism.spine}${organism.leaves.map(leaf => leaf.vein).join("")}`}
          data-ornament-mark="burin-contour"
          fill="none"
          opacity=".52"
          stroke={card.secondaryColor}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.18"
        />
        {!isGallery ? (
          <path
            d={organism.ghost}
            data-ornament-mark="drypoint-ghost"
            fill="none"
            opacity=".17"
            stroke={card.providerColor}
            strokeLinecap="round"
            strokeWidth=".72"
          />
        ) : null}
        <g
          data-emblem-signature="family"
          fill="none"
          opacity=".84"
          stroke={card.secondaryColor}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.62"
        >
          <path d={familyRadicalPath(archetype)} />
        </g>
      </g>

      <g data-ornament-depth="foreground">
        <g
          data-emblem-signature="generation"
          fill="none"
          opacity=".62"
          stroke={card.secondaryColor}
          strokeLinecap="butt"
          strokeLinejoin="miter"
          strokeWidth="1.08"
        >
          <path d={generationSignaturePath(identity.generation, identity.revision)} />
        </g>
        <path
          d={editionCellPath(identity.editionId)}
          data-ornament-mark="edition-inlay"
          fill={card.providerColor}
          fillOpacity=".43"
          stroke={card.secondaryColor}
          strokeOpacity=".72"
          strokeWidth=".7"
        />
        <g
          data-emblem-signature="edition"
          fill="none"
          opacity=".86"
          stroke={card.providerColor}
          strokeLinecap="butt"
          strokeLinejoin="miter"
          strokeWidth="1.42"
        >
          <path d={editionSignaturePath(identity.editionId)} />
        </g>
        <g
          data-emblem-signature="role"
          fill={card.secondaryColor}
          fillOpacity=".48"
          stroke={card.providerColor}
          strokeOpacity=".7"
          strokeWidth=".65"
        >
          <path d={roleTotemPath(identity.role)} />
        </g>
        <g
          data-emblem-signature="class"
          data-illumination-signature="class"
          fill="none"
          opacity=".38"
          stroke={card.secondaryColor}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.05"
        >
          <path d={coronaPath(card.accentFamily, card.visualClass, density)} />
        </g>
        <g
          data-emblem-signature="profile"
          fill={card.secondaryColor}
          fillOpacity=".38"
          stroke={card.providerColor}
          strokeOpacity=".62"
          strokeWidth=".65"
        >
          <path d={profileTallyPath(card.profileSlug)} fill="none" />
          {Array.from({ length: density }, (_, index) => (
            <path d={profileDetailLeafPath(index, modelHash)} key={`profile-leaf-${index}`} />
          ))}
        </g>
        {!isGallery ? (
          <path
            d={profileDetailLeafPath(density + 1, modelHash ^ 0x85ebca6b)}
            data-ornament-mark="bright-cut-detail"
            fill={card.providerColor}
            fillOpacity=".3"
            stroke={card.secondaryColor}
            strokeOpacity=".55"
            strokeWidth=".55"
          />
        ) : null}
      </g>
    </svg>
  );
}
