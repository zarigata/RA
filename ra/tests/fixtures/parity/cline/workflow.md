# Release workflow — invoke as /release.md

## Library release

Go through the steps in order. After each step, report the result briefly.
If a step fails, stop and ask me what to do.

1. Make sure the working tree is clean: run `git status --short`. If there are uncommitted changes, stop.
2. Ask me which version we are releasing (patch, minor or major).
3. Bump the version in `package.json` and `CHANGELOG.md`.
4. Run `npm test` and `npm run build`.
5. Collect commits since the last tag and add them to the new version section of `CHANGELOG.md`.
6. Create a commit `release: <version>` and a tag. Do not push: show me the command.
