// .versionrc.mjs — what `just release` computes, and over which files.
//
// The tool is commit-and-tag-version, the local-only successor of standard-version: it reads the
// conventional commits since the last `v*` tag, computes the next version from what those headers
// already declare, writes CHANGELOG.md, stamps the version files, and makes ONE
// `chore(release): x.y.z` commit with a matching `vx.y.z` tag. It never pushes and never
// publishes — both stay a human's to type.
//
// That last sentence is the whole reason it is here and semantic-release is not. semantic-release
// welds tagging to pushing: its git plugin refuses a no-push option, its auth check is deliberate,
// and `--dry-run` suppresses the changelog and the stamp along with the push — so there is no way
// to ask it for a local release. Keeping it would have meant releases happen only in CI, and this
// repo has no CI.
//
// ONE PRODUCT, ONE HISTORY, ONE NUMBER — which is what the split bought. In the repo this package
// came out of, the release recipe had to exclude two other packages' version files from the bump,
// because one history cannot honestly compute three numbers. Nothing is excluded below.
//
// Everything not named here is the preset default (conventional-changelog-conventionalcommits):
// `feat` and `fix` are the changelog's two sections, breaking changes head it, and the other types
// are hidden. Below 1.0.0 the tool forces `preMajor`, which demotes every bump one level — a
// breaking change is a minor, a feature is a patch. That is not configurable, and it is right:
// 0.x makes no compatibility promise there would be anything to demote from.
//
// THE FIRST RELEASE WAS THE ONE EXCEPTION, and it is worth knowing exactly which kind. 0.1.0 was
// cut with `npx commit-and-tag-version --release-as 0.1.0`, the number STATED rather than left to
// be computed, because a first release has no previous tag to bound the commit range: what the
// headers add up to is the whole history's, and nobody wants the first published version to be an
// archaeology result. It would have landed on 0.1.0 unaided — preMajor demotes that range's
// breaking changes to a minor, and 0.0.1 plus a minor is 0.1.0 — so the flag pinned the number and
// overrode nothing. Every release after it has a tag to count from and is computed: `just
// release`, no argument, and `git/node/no-hand-edited-version` blocks the alternative.

export default {
  // The defaults also name bower.json and manifest.json (packageFiles), plus npm-shrinkwrap.json
  // (bumpFiles). None exist here, so naming ours is not a narrowing — it is closing the door on
  // three filenames that would silently start mattering the day one of them appeared.
  packageFiles: ['package.json'],
  bumpFiles: ['package.json', 'package-lock.json'],
};
