import base from "@/data/local-hardware.json";
import language from "@/data/local-hardware-language.json";

import nonlanguage from "@/data/local-hardware-nonlanguage.json";

export const deviceBenchmarks = { ...base, suites: [...base.suites, ...language.suites, ...nonlanguage.suites] };
