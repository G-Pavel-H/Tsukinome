# E2B code-sandbox template for Tsukinome — Node 22 + Python 3, one image for every language pack.
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
#   e2b template build --name tsukinome-sandbox --dockerfile e2b.Dockerfile
# Then set the printed template id/name in the app's env:
#   E2B_TEMPLATE=tsukinome-sandbox
# (The old name was `tsukinome-node22`, from when this image was Node-only. Rebuilding under
# either name works — just keep E2B_TEMPLATE pointing at whichever you built.)
FROM node:22

# Python 3 + pip for the Phase 13b Python pack (`pip install …` / `pytest`). One multi-toolchain
# image carries every supported language — the per-pack `Toolchain.sandboxTemplate` override exists
# but is deliberately unused. `python-is-python3` matters: the pack's install command invokes
# `python`, and Debian ships only `python3` by default (the 2026-08-01 `python: command not found`
# incident). `--break-system-packages` is what lets pip install into the system env on
# bookworm (PEP 668); the sandbox is an ephemeral microVM, so there is nothing to protect.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv python-is-python3 \
    && rm -rf /var/lib/apt/lists/*
ENV PIP_BREAK_SYSTEM_PACKAGES=1

# Fail the build loudly if the base ever regresses below what the code needs.
RUN node --version && git --version && python --version && pip --version
