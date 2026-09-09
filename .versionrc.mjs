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
// THE FIRST RELEASE WAS THE ONE EXCEPTION, and it is worth knowing why it will not recur. preMajor
// demotes from the CURRENT version, so a repo sitting at 0.0.1 computes 0.0.2 for a feature and
// 0.0.2 for a breaking change alike — there was no commit header that could reach 0.1.0. It was cut
// once with `npx commit-and-tag-version --release-as 0.1.0`, naming the number by hand because
// nothing else could name it. Every release after it is computed: `just release`, no argument.

export default {
  // The defaults also name bower.json and manifest.json (packageFiles), plus npm-shrinkwrap.json
  // (bumpFiles). None exist here, so naming ours is not a narrowing — it is closing the door on
  // three filenames that would silently start mattering the day one of them appeared.
  packageFiles: ['package.json'],
  bumpFiles: ['package.json', 'package-lock.json'],
};
