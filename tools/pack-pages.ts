// flow/tools/pack-pages.ts — the shell that turns the ten packs into ten pages.
//
// `just docs-packs` writes them; `just docs-packs --check` regenerates into memory and compares,
// which is what the commit gate runs. Everything it decides is in tools/domain.ts and everything it
// reads out of a pack's source is in tools/parse.ts; this file loads, joins and writes, and that is
// the whole split.
//
// TWO READERS OF ONE PACK, and they answer different halves:
//
//   · THE LOADER — `loadConfig(defineConfig([pack(x, params)]))`, the same call the engine makes.
//     Every fact the engine runs on comes from here: the ids, the moments, the globs, the
//     categories, the message or text verbatim, the cases. Nothing on the page is a paraphrase of
//     something the loader could have said.
//   · THE PARSER — tools/parse.ts, over the pack's source. It reads the two things a loaded pack
//     cannot carry: the doc comments, and the name of the check the entry asks.
//
// PARAMETERS ARE A STRANGER'S, and they are the shared `EXAMPLE` list — the same values the machine
// test binds in a throwaway repo, so a page never documents a binding nothing has driven.

import { existsSync, readFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadConfig, pack, type PackBinding } from "../index.ts";
import { docs, fcis, flow, git, justfile, node, secrets, tdd, typescript, work } from "../packs/index.ts";
import {
  bindLine,
  caseLines,
  checkName,
  EXAMPLE,
  fenceFault,
  kebab,
  renderPackPage,
  renderPacksIndex,
  says,
  settingsJson,
  type EntryDoc,
  type PackDoc,
} from "./domain.ts";
import { parse } from "./parse.ts";

/** Where the pages are written, under the user docs. */
const OUT = join("docs", "user", "packs");

/** The stock checks with a reference page. A pack's own check gets no link — there is no page. */
const REFERENCED = new Set(
  existsSync(join("docs", "user", "checks")) ? readdirSync(join("docs", "user", "checks")).map((file) => file.replace(/\.html$/, "")) : [],
);

/** One pack, and the example parameters every entry on its page is rendered with. */
interface Shipped {
  readonly name: string;
  /** The binding itself, written out — so the compiler checks the example against the pack. */
  readonly binding: PackBinding;
  /** The same parameters as data, for the config line the page prints. */
  readonly params: Readonly<Record<string, unknown>> | undefined;
}

// EVERY PACK, BOUND WITH THE SHARED EXAMPLE. Bound so the compiler proves the example is a legal
// binding for that pack, and handed over as data too so the page prints exactly what was bound.
const SHIPPED: readonly Shipped[] = [
  { name: "docs", binding: pack(docs, EXAMPLE.docs), params: EXAMPLE.docs },
  { name: "fcis", binding: pack(fcis, EXAMPLE.fcis), params: EXAMPLE.fcis },
  { name: "flow", binding: pack(flow, EXAMPLE.flow), params: EXAMPLE.flow },
  { name: "git", binding: pack(git, EXAMPLE.git), params: EXAMPLE.git },
  { name: "justfile", binding: pack(justfile, EXAMPLE.justfile), params: EXAMPLE.justfile },
  { name: "node", binding: pack(node), params: undefined },
  { name: "secrets", binding: pack(secrets, EXAMPLE.secrets), params: EXAMPLE.secrets },
  { name: "tdd", binding: pack(tdd, EXAMPLE.tdd), params: EXAMPLE.tdd },
  { name: "typescript", binding: pack(typescript, EXAMPLE.typescript), params: EXAMPLE.typescript },
  { name: "work", binding: pack(work), params: undefined },
];

/** One pack, read both ways and joined into the model the page is rendered from. */
function read(shipped: Shipped): PackDoc {
  const parsed = parse(join("packs", `${shipped.name}.ts`));
  const load = loadConfig(defineConfig([shipped.binding]));
  if (!load.ok) throw new Error(`${shipped.name} does not load: ${load.refusals.map((r) => r.detail).join("; ")}`);

  const entries: EntryDoc[] = load.entries.map((entry) => {
    const named = checkName(parsed.check.get(entry.key) ?? "");
    return {
      id: entry.id,
      key: entry.key,
      kind: entry.spec.kind,
      description: entry.spec.description ?? "",
      why: parsed.why.get(entry.key) ?? "",
      at: entry.spec.at ?? [],
      on: entry.spec.on ?? [],
      ignore: entry.spec.ignore ?? [],
      categories: entry.categories,
      settings: settingsJson(entry.settings),
      checkName: named,
      reference: REFERENCED.has(kebab(named)),
      says: says(entry.spec),
      cases: caseLines(entry.spec.kind === "guardrail" ? entry.spec.test : undefined),
      disabled: entry.spec.disabled === undefined ? "" : (entry.spec.disabled.reason ?? "no reason given"),
    };
  });

  const doc: PackDoc = {
    name: shipped.name,
    lead: parsed.lead,
    blocks: parsed.blocks,
    params: parsed.params,
    bind: bindLine(shipped.name, shipped.params),
    entries,
  };
  // REFUSED RATHER THAN RENDERED. A doc comment cut in half writes a page that looks finished, and
  // the drift gate then compares the truncated page against itself forever, green.
  const fault = fenceFault(doc);
  if (fault !== "") throw new Error(fault);
  return doc;
}

// ── writing, and refusing drift ──────────────────────────────────────────────

/** Every page this command owns, by filename — the whole of what `--check` compares. */
function pages(): Map<string, string> {
  const read_ = SHIPPED.map(read);
  const out = new Map<string, string>();
  for (const doc of read_) out.set(`${doc.name}.html`, renderPackPage(doc));
  out.set("index.html", renderPacksIndex(read_));
  return out;
}

const written = pages();
const checking = process.argv.includes("--check");

if (checking) {
  // A MISSING FOLDER IS DRIFT, not a crash: `docs-packs --check` runs at the commit gate, and the
  // one thing it must never do is fail in a way that reads as a broken tool rather than as a page
  // nobody generated.
  const onDisk = new Set(
    existsSync(OUT)
      ? readdirSync(OUT, { withFileTypes: true })
          .filter((f) => f.isFile())
          .map((f) => f.name)
      : [],
  );
  const stale = [...written].filter(([name, html]) => !onDisk.has(name) || readFileSync(join(OUT, name), "utf8") !== html).map(([name]) => name);
  const orphans = [...onDisk].filter((name) => !written.has(name));
  if (stale.length === 0 && orphans.length === 0) {
    process.stdout.write(`docs-packs — ${written.size} pages, all current with packs/\n`);
  } else {
    for (const name of stale) process.stderr.write(`  ✗ ${join(OUT, name)} has drifted from its pack\n`);
    for (const name of orphans) process.stderr.write(`  ✗ ${join(OUT, name)} belongs to no pack\n`);
    process.stderr.write("Run `just docs-packs` and commit the regenerated pages — the pack is the source, the page is the print.\n");
    process.exitCode = 1;
  }
} else {
  mkdirSync(OUT, { recursive: true });
  for (const [name, html] of written) writeFileSync(join(OUT, name), html);
  process.stdout.write(`docs-packs — ${written.size} pages written to ${OUT}/\n`);
}
