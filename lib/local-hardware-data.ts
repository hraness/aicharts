import base from "@/data/local-hardware.json";
import language from "@/data/local-hardware-language.json";
import nonlanguage from "@/data/local-hardware-nonlanguage.json";
import phones from "@/data/local-hardware-iphone-studies.json";
import llmExtra from "@/data/local-hardware-llm-extra.json";
import modelExtra from "@/data/local-hardware-model-extra.json";

export const deviceBenchmarks = { ...base, suites: [...base.suites, ...language.suites, ...nonlanguage.suites, ...phones.suites, ...llmExtra.suites, ...modelExtra.suites] };
