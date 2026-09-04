// flow/glob.ts — THE one shared file, and the only thing in flow that sits outside a layer.
//
//   globToRegExp / matchGlob  — match an entry's `.on()` / `.ignore()` globs against a path.
//   matchAny                  — the same, over a list.
//   expandTemplate            — fill {dir} {name} {base} {path} in a sibling template.
//   escapeRe                  — regex-escape a literal.
//
// WHY IT IS NOT IN A LAYER, when every other decision in this package lives in some layer's
// domain.ts. Three of the four stages genuinely need it and need the SAME one: the checks match
// a file against a sibling template and a changed-set glob; the engine matches an event's path
// against an entry's scope; and the load will one day want to say a glob is malformed. A glob
// that means one thing to a check and another to the engine is a rule that reports on files it
// never judged, which is precisely the class of failure flow exists to delete — so there is one
// engine and it sits above all of them, where the pipeline's one-way fences do not apply because
// it points at nothing.
//
// It is the ONLY file with that status, and the bar for a second one is a second thing that three
// layers must agree on exactly. Everything else that looked shared turned out to be one layer's
// business borrowed by another.
//
// Ported verbatim from signposts' src/util.mjs, by way of the old guard engine — the
// brace-supporting matcher, unchanged, because every glob already written against it must keep
// meaning what it meant.

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Minimal glob → RegExp: supports ** (across /), * (within a segment), ?, {a,b}.
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += "(" + glob.slice(i + 1, end).split(",").map(escapeRe).join("|") + ")";
      i = end;
    } else re += escapeRe(c ?? "");
  }
  return new RegExp("^" + re + "$");
}

export function matchGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

export function matchAny(path: string, globs: readonly string[] | null | undefined): boolean {
  return (globs || []).some((g) => matchGlob(path, g));
}

export interface FileParts {
  dir: string;
  base: string;
  name: string;
  path: string;
}

// file "a/b/x.ts" → {dir:"a/b", base:"x.ts", name:"x", path:"a/b/x"}
export function fileParts(file: string): FileParts {
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const name = dot > 0 ? base.slice(0, dot) : base;
  const path = dir === "." ? name : `${dir}/${name}`;
  return { dir, base, name, path };
}

export function expandTemplate(tpl: string, file: string): string {
  const p = fileParts(file);
  return tpl.replace(/\{(dir|base|name|path)\}/g, (_, k: string) => p[k as keyof FileParts]);
}
