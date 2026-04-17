# fips-agents CLI Audit

Audit of `fips-agents` v0.5.1 against the tool-calling-demo project
(calculus-agent + calculus-gateway + calculus-ui), identifying bugs, missing
features, and recommendations.

CLI source: `~/Developer/AGENTS/fips-agents-cli/` (v0.5.1)

---

## 1. Bugs

### BUG-1: Go import paths not updated in .go source files [HIGH]

`customize_go_project()` in `tools/project.py` replaces the sentinel string
(e.g. `gateway-template`) in `go.mod` and a handful of config files, but does
**not** process any `.go` source files.

The gateway template has 9 import statements across `.go` files that reference
`github.com/redhat-ai-americas/gateway-template/internal/...`. After
`fips-agents create gateway calculus-gateway`, `go.mod` says
`github.com/redhat-ai-americas/calculus-gateway` but every `.go` file still
imports from `gateway-template`. The project cannot compile.

The UI template has the same issue (2 import references to `ui-template/static`).

**Root cause:** `customize_go_project()` has a hardcoded list of `optional_files`
that only includes config/build files. It needs to walk all `.go` files and
replace the full module path.

**Fix:** Add a recursive walk of `*.go` files in `customize_go_project()`:
```python
for go_file in project_path.rglob("*.go"):
    _replace_in_file(go_file, sentinel, new_name)
```

**Test gap:** The test fixture `_create_go_template()` in `test_project.py`
does not create any `.go` source files, so this bug is invisible to tests.

### BUG-2: Helm template YAML files not updated for Go projects [HIGH]

`customize_go_project()` updates `_helpers.tpl` but **not**
`deployment.yaml`, `service.yaml`, `route.yaml`, or `configmap.yaml`.

The gateway template has 13 references to `gateway-template.fullname`,
`gateway-template.labels`, and `gateway-template.selectorLabels` across these
four files. After scaffolding, `_helpers.tpl` defines
`calculus-gateway.fullname` but the deployment/service/route/configmap YAML
still calls `{{ include "gateway-template.fullname" . }}`. Helm rendering
fails with "template not found".

The UI template has the same issue (17 references across 4 YAML files).

**Root cause:** The `optional_files` list in `customize_go_project()` is
missing these files. By contrast, `customize_agent_project()` does include
them.

**Fix:** Add these to the `optional_files` list in `customize_go_project()`:
```python
project_path / "chart" / "templates" / "deployment.yaml",
project_path / "chart" / "templates" / "service.yaml",
project_path / "chart" / "templates" / "route.yaml",
project_path / "chart" / "templates" / "configmap.yaml",
project_path / "chart" / "templates" / "NOTES.txt",
```

Or, more robustly, glob all files under `chart/templates/` rather than
maintaining a hardcoded list.

**Test gap:** `_create_go_template()` does not create these Helm YAML files.

### BUG-3: ImagePullPolicy defaults to IfNotPresent [LOW]

All three templates (gateway, UI, agent) default `image.pullPolicy` to
`IfNotPresent` and `image.tag` to `latest` in `chart/values.yaml`. When
iterating on a build (push new image with `latest` tag, re-deploy),
Kubernetes won't pull the new image because the tag hasn't changed and the
policy says don't re-pull.

This is arguably a Helm chart issue rather than a CLI issue, but it bites
every first-time user of the three-component stack.

---

## 2. Missing Features

### FEAT-1: No server entry point for agent template

The agent template scaffolds a CLI agent (`CMD ["python", "-m", "src.agent"]`)
with a Containerfile comment saying "No port exposed -- the agent loop is not
a web server." But when used in a three-component stack (UI -> gateway ->
agent), the agent needs an HTTP endpoint.

The `fipsagents` package already has `OpenAIChatServer` in
`fipsagents.server`, but the template does not scaffold a `src/server.py` or
offer a `--server` flag to generate one.

We had to manually create:
- `src/server.py` (7 lines: import, instantiate `OpenAIChatServer`, call `.run()`)
- Update the Containerfile CMD to `["python", "-m", "src.server"]`
- Add `EXPOSE 8080`

**Recommendation:** Add a `--server` flag to `fips-agents create agent` that:
1. Generates `src/server.py`
2. Updates the Containerfile CMD and adds `EXPOSE 8080`
3. Adds `fipsagents[server]` to dependencies in `pyproject.toml`

### FEAT-2: No multi-component wiring

Each `fips-agents create` call is completely independent. For the
three-component stack, we had to manually:
- Set `BACKEND_URL` in the gateway's `chart/values.yaml` to point to the agent
  service name
- Set `API_URL` in the UI's `chart/values.yaml` to point to the gateway
  service name
- Deploy all three to the same namespace
- Coordinate build order

**Recommendation:** Consider a `fips-agents create stack` command or a
`fips-agents wire` command that takes the three component directories and:
1. Updates each component's Helm values to point to the correct service names
2. Generates a top-level `deploy-all.sh` or Kustomize overlay
3. Documents the expected deployment topology

At minimum, the success message for `create gateway` could prompt: "Set
BACKEND_URL to your agent's service URL" (it currently shows
`BACKEND_URL=http://localhost:8080` which is only useful for local dev).

### FEAT-3: PyPI fipsagents package is stale (0.4.0 vs 0.6.0.dev0)

PyPI has `fipsagents==0.4.0`. The current source is at `0.6.0.dev0`.

Modules **missing from 0.4.0** that exist in source:
- `fipsagents.server` (entire module) -- required for HTTP serving
- `fipsagents.serialization` (entire module) -- SSE streaming support
- `fipsagents.baseagent.events` -- stream event types (ContentDelta, etc.)
- `fipsagents.baseagent.diagnostics` -- `probe_role_support()`
- `fipsagents.baseagent.reasoning` -- `ThinkTagParser`
- `fipsagents.baseagent.memory_llamastack` -- LlamaStack memory backend
- `fipsagents.baseagent.memory_markdown` -- Markdown memory backend

**Wait, correction:** The wheel for 0.4.0 was published 2026-04-15 and does
NOT contain `server/` or `serialization/`. The template's `pyproject.toml`
depends on bare `fipsagents` (no version pin), so `pip install` gets 0.4.0,
which lacks the server module entirely. Any `from fipsagents.server import
OpenAIChatServer` fails with `ImportError`.

The `astep_stream` method and the `events` module it depends on are also
missing from 0.4.0, making streaming non-functional even if someone writes
their own server wrapper.

**Impact:** Scaffolded agent projects cannot use HTTP serving, streaming, or
reasoning parsers when installing from PyPI. Users must vendor the package
source or install from git.

**Recommendation:** Publish fipsagents 0.5.0+ to PyPI with all current modules.

### FEAT-4: Air-gapped / disconnected build support

OpenShift build pods cannot reach GitHub. The agent template's `pyproject.toml`
depends on `fipsagents` from PyPI, which is fine when PyPI is reachable. But
some deployments also need to install from a git URL (e.g., for pre-release
versions), and `pip install fipsagents @ git+https://...` fails in air-gapped
builds.

We had to vendor the `packages/fipsagents/` source into the build context and
use a local path install in the Containerfile.

**Recommendation:** Either:
1. Keep PyPI up to date so air-gapped builds just need a PyPI mirror
2. Add a `--vendor-fipsagents` flag to `fips-agents create agent` that copies
   the package source into the project and adjusts the Containerfile
3. Document the vendoring pattern in the template's README

### FEAT-5: No `fips-agents create` for the full Go module path

`customize_go_project()` replaces `gateway-template` with the new name in
`go.mod`, which changes `github.com/redhat-ai-americas/gateway-template` to
`github.com/redhat-ai-americas/<new-name>`. But there's no way to customize
the GitHub org prefix (`redhat-ai-americas`). If the user's repo is at
`github.com/myorg/my-gateway`, the module path is wrong.

**Recommendation:** Accept `--module-path` or derive it from the `--org` flag.

---

## 3. Recommendations (Priority Order)

1. **Fix BUG-1 and BUG-2 immediately** -- these are build-breaking bugs that
   affect every `create gateway` and `create ui` user. The fix is small
   (extend the file list + add `.go` globbing). Add test cases that create
   `.go` files with import paths and Helm YAML files with helper references.

2. **Publish fipsagents 0.5.0+ to PyPI** -- the gap between published and
   actual is large enough that scaffolded projects fail at import time if
   they try to use server, streaming, or reasoning features.

3. **Add `--server` flag to `create agent`** -- the three-component stack is
   the primary use case and requiring manual server creation is unnecessary
   friction. The boilerplate is only 7 lines.

4. **Refactor `customize_go_project` to use globbing** instead of a hardcoded
   file list. The current approach is fragile -- any new file added to the
   template that contains the sentinel string will be missed. A better
   approach:
   ```python
   # Replace in all text files under chart/templates/
   for f in (project_path / "chart" / "templates").rglob("*"):
       if f.is_file():
           _replace_in_file(f, sentinel, new_name)
   ```

5. **Consider multi-component wiring** -- even if a full `create stack`
   command is out of scope, the individual `create` commands could accept a
   `--backend-service` or `--upstream-url` flag to pre-wire the Helm values.

6. **Change default `imagePullPolicy`** to `Always` in all three templates'
   `values.yaml`, or at least add a comment explaining the `IfNotPresent`
   tradeoff.

7. **Add `--module-path` flag** to `create gateway` and `create ui` for
   customizing the Go module prefix.
