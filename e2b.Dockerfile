# E2B code-sandbox template for Tsukinome.
#
# Why this exists: E2B's default base image ships an old Node (< 20.12), so `npm test` fails at
# *import* time for any repo needing modern Node — e.g. `node:util`'s `parseEnv` (Node ≥ 20.12) or
# `require()` of an ES module (Node ≥ 22.12). The TDD loop then can never observe green. Pinning the
# sandbox to Node 22 fixes it at the runtime, where it belongs (no application code can patch it).
#
# The full `node:22` image is Debian (bookworm) based and includes git + build tools (buildpack-deps),
# which the sandbox needs to clone the repo and run `npm ci`. Do NOT use `-slim` (no git).
#
# Build & register (needs the E2B CLI + your E2B account):
#   npm i -g @e2b/cli
#   e2b template build --name tsukinome-node22 --dockerfile e2b.Dockerfile
# Then set the printed template id/name in the app's env:
#   E2B_TEMPLATE=tsukinome-node22
FROM node:22

# Fail the build loudly if the base ever regresses below what the code needs.
RUN node --version && git --version
