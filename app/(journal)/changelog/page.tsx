import { entries, pageMetadata } from "@/journal/content";
import { Changelog } from "@/components/changelog";
export const metadata = pageMetadata("aicharts changelog", "New features, product improvements, and documentation for the aicharts model explorer and public release feed.", "/changelog");
export default function Page() { return <><h1>Changelog</h1><Changelog entries={entries}/></>; }
