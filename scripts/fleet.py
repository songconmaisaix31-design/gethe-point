#!/usr/bin/env python3
"""Directory-owned multi-agent control plane built on Orca CLI."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Mapping

sys.dont_write_bytecode = True

from common import (  # noqa: E402
    FleetError,
    JsonSnapshot,
    changed_files,
    command_exists,
    commit_subject,
    commit_subjects,
    find_branch,
    find_key,
    find_prefixed,
    git_branch,
    git_root,
    git_sha,
    integration_analysis,
    json_bytes,
    load_config,
    load_json,
    load_json_snapshot,
    now,
    parse_json,
    run,
    run_state_lock,
    save_bytes,
    save_json,
    save_new_bytes,
    save_new_json,
    scope_violations,
    slug,
    timestamp,
    validate_plan,
    walk,
)


AMENDMENT_FIELDS = {
    "schema_version",
    "amendment_id",
    "description",
    "plan_status",
    "launch_authorized",
    "run_id",
    "parent_plan_sha256",
    "state_sha256",
    "automation",
    "workspace_suffix",
    "append_waves",
    "update_waves",
    "update_tasks",
    "resolutions",
}
NEW_WAVE_FIELDS = {"id", "description", "depends_on", "base", "tasks"}
NEW_TASK_FIELDS = {
    "id",
    "title",
    "track",
    "write_paths",
    "spec",
    "acceptance",
    "checks",
    "agent",
    "setup",
    "worktree_mode",
    "model",
    "effort",
}
WAVE_PATCH_FIELDS = {"id", "description", "depends_on", "base"}
TASK_PATCH_FIELDS = {"id", "title", "spec", "acceptance", "checks", "write_paths"}
UNDISPATCHED_TASK_FIELDS = (
    "orca_task_id",
    "dispatch_id",
    "branch",
    "base_ref",
    "base_sha",
    "head_sha",
    "summary",
    "dispatched_at",
    "completed_at",
    "last_dispatch_id",
    "last_dispatch_error",
)


def cli() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", type=Path)
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("doctor")
    d.add_argument("--plan", type=Path)
    d.add_argument("--json", action="store_true")

    v = sub.add_parser("validate")
    v.add_argument("plan", type=Path)
    v.add_argument("--json", action="store_true")

    c = sub.add_parser("start-coordinator")
    c.add_argument("--objective", required=True)
    c.add_argument("--agent")
    c.add_argument("--setup", choices=("run", "skip", "inherit"))
    c.add_argument("--name")
    c.add_argument("--dry-run", action="store_true")
    c.add_argument("--json", action="store_true")

    launch = sub.add_parser("launch")
    launch.add_argument("plan", type=Path)
    launch.add_argument("--dry-run", action="store_true")
    launch.add_argument("--json", action="store_true")

    amend = sub.add_parser("amend")
    amend.add_argument("--state", type=Path, required=True)
    amend.add_argument("--amendment", type=Path, required=True)
    amend.add_argument("--dry-run", action="store_true")
    amend.add_argument("--json", action="store_true")

    i = sub.add_parser("inbox")
    i.add_argument("--state", type=Path, required=True)
    i.add_argument("--wait", action="store_true")
    i.add_argument("--types", default="worker_done,escalation,question")
    i.add_argument("--timeout-ms", type=int, default=900000)
    i.add_argument("--ack")
    i.add_argument("--peek", action="store_true")
    i.add_argument("--json", action="store_true")

    a = sub.add_parser("accept")
    a.add_argument("--state", type=Path, required=True)
    a.add_argument("--task", required=True)
    a.add_argument("--branch")
    a.add_argument("--sha")
    a.add_argument("--outcome", choices=("succeeded", "failed"), required=True)
    a.add_argument("--summary", required=True)
    a.add_argument("--retain", action="store_true")
    a.add_argument("--advance", action="store_true")
    a.add_argument("--dry-run", action="store_true")
    a.add_argument("--json", action="store_true")

    adv = sub.add_parser("advance")
    adv.add_argument("--state", type=Path, required=True)
    adv.add_argument("--dry-run", action="store_true")
    adv.add_argument("--json", action="store_true")

    s = sub.add_parser("status")
    s.add_argument("--state", type=Path, required=True)
    s.add_argument("--json", action="store_true")

    f = sub.add_parser("finalize")
    f.add_argument("--state", type=Path, required=True)
    f.add_argument("--allow-incomplete", action="store_true")
    f.add_argument("--json", action="store_true")
    return p


def orca(
    root: Path,
    args: list[str],
    label: str,
    dry_run: bool = False,
    *,
    allow_nonzero: bool = False,
) -> dict[str, Any]:
    cmd = ["orca", *args]
    if "--json" not in cmd:
        cmd.append("--json")
    cp = run(cmd, cwd=root, check=False, dry_run=dry_run, echo=True)
    if dry_run:
        return {"ok": True, "dry_run": True, "command": cmd}
    try:
        value = parse_json(cp.stdout, label)
    except FleetError:
        if cp.returncode:
            detail = cp.stderr.strip() or cp.stdout.strip() or "no output"
            raise FleetError(f"command failed ({cp.returncode}): {' '.join(cmd)}\n{detail}")
        raise
    if not isinstance(value, dict):
        raise FleetError(f"{label} must return a JSON object")
    if value.get("ok") is False:
        raise FleetError(f"{label} failed: {json.dumps(value, ensure_ascii=False)}")
    if cp.returncode and not allow_nonzero:
        detail = cp.stderr.strip() or cp.stdout.strip() or "no output"
        raise FleetError(f"command failed ({cp.returncode}): {' '.join(cmd)}\n{detail}")
    return value


def dispatch_id_from_receipt(receipt: Mapping[str, Any]) -> str | None:
    """Read an actual Dispatch ID without mistaking `dispatch_input` for one."""
    exact = find_key(receipt, {"dispatchId", "dispatch_id"})
    candidates = [exact, find_prefixed(receipt, "ctx_"), find_prefixed(receipt, "dispatch_")]
    for candidate in candidates:
        if isinstance(candidate, str) and re.fullmatch(r"(?:ctx|dispatch)_[0-9a-fA-F]{6,}", candidate):
            return candidate
    return None


def dispatch_status_from_receipt(receipt: Mapping[str, Any]) -> str | None:
    result = receipt.get("result")
    if not isinstance(result, Mapping):
        return None
    dispatch = result.get("dispatch")
    if not isinstance(dispatch, Mapping):
        return None
    status = dispatch.get("status")
    return str(status) if isinstance(status, str) else None


def settle_worker(root: Path, action: str, dispatch: str, dry_run: bool = False) -> dict[str, Any]:
    """Record cleanup failures without losing an otherwise valid task acceptance."""
    try:
        return orca(root, ["orchestration", action, "--dispatch", dispatch], action, dry_run)
    except FleetError as exc:
        return {
            "ok": False,
            "action": action,
            "dispatch_id": dispatch,
            "error": str(exc),
        }


def repo_selector(root: Path, cfg: Mapping[str, Any], dry_run: bool = False) -> str:
    configured = cfg.get("repo_selector", "auto")
    if isinstance(configured, str) and configured not in ("", "auto"):
        return configured
    if dry_run:
        return "id:<auto-repo-id>"
    listing = orca(root, ["repo", "list"], "orca repo list")
    target = str(root.resolve()).replace("\\", "/")
    for item in walk(listing):
        if not isinstance(item, dict):
            continue
        path = find_key(item, {"path", "repoPath", "repo_path", "root", "directory"})
        rid = find_key(item, {"id", "repoId", "repo_id"})
        if isinstance(path, str) and isinstance(rid, str):
            if str(Path(path).expanduser().resolve()).replace("\\", "/") == target:
                return "id:" + rid.removeprefix("id:")
    added = orca(root, ["repo", "add", "--path", str(root)], "orca repo add")
    rid = find_prefixed(added, "repo_") or find_key(added, {"repoId", "repo_id", "id"})
    if isinstance(rid, str) and rid:
        return "id:" + rid.removeprefix("id:")
    raise FleetError("could not resolve Orca repo ID; set repo_selector explicitly in .agents/fleet.json")


def canonical_repo_selector(root: Path, selector: str, dry_run: bool = False) -> str:
    """Resolve portable repo selectors to the runtime's stable repository ID."""
    if selector.startswith("id:") or dry_run:
        return selector
    receipt = orca(root, ["repo", "show", "--repo", selector], "resolve repo selector")
    result = receipt.get("result")
    repo = result.get("repo") if isinstance(result, dict) else None
    rid = repo.get("id") if isinstance(repo, dict) else None
    if not isinstance(rid, str) or not rid:
        raise FleetError(f"could not canonicalize Orca repo selector: {selector}")
    return "id:" + rid.removeprefix("id:")


def run_coordinator_handle(root: Path, run_id: str, dry_run: bool = False) -> str:
    """Resolve the current coordinator explicitly after a Run binding recovery."""
    if dry_run:
        return "term_dry_coordinator"
    receipt = orca(root, ["orchestration", "run-show", "--id", run_id], "resolve Run coordinator")
    result = receipt.get("result")
    run_record = result.get("run") if isinstance(result, dict) else None
    handle = run_record.get("coordinator_handle") if isinstance(run_record, dict) else None
    if not isinstance(handle, str) or not handle.startswith("term_"):
        raise FleetError(f"Run {run_id} has no current coordinator handle")
    return handle


def fetch(root: Path, cfg: Mapping[str, Any], dry_run: bool = False) -> None:
    if cfg.get("fetch_before_launch", True):
        run(["git", "fetch", "--prune", "origin"], cwd=root, dry_run=dry_run, echo=True)


def resolve_sha(root: Path, ref: str, dry_run: bool = False) -> str:
    return "0" * 40 if dry_run else git_sha(root, ref)


def do_doctor(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    for name in ("git", "orca"):
        if not command_exists(name):
            raise FleetError(f"required command not found: {name}")
    merge_tree_help = run(["git", "merge-tree", "-h"], cwd=root, check=False)
    if "--write-tree" not in (merge_tree_help.stdout + merge_tree_help.stderr):
        raise FleetError("Git is too old for the integration gate: git merge-tree --write-tree is required")
    status = orca(root, ["status"], "orca status")
    skill = run(["orca", "skills", "get", "orchestration", "--full"], cwd=root, check=False)
    if skill.returncode:
        raise FleetError("orchestration skill missing; run: orca skills install --skill orca-cli --skill orchestration")
    plan_errors: list[str] = []
    if args.plan:
        plan_errors = validate_plan(load_json(args.plan.resolve()), cfg)
        if plan_errors:
            raise FleetError("plan errors:\n- " + "\n- ".join(plan_errors))
    result = {
        "ok": True,
        "root": str(root),
        "branch": git_branch(root),
        "tracks": sorted(cfg["tracks"]),
        "orca_status": status,
        "plan_errors": plan_errors,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("fleet doctor passed")
        print(f"repo: {root}")
        print(f"branch: {git_branch(root)}")
        print("tracks: " + ", ".join(sorted(cfg["tracks"])))
    return 0


def do_validate(cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    plan = load_json(args.plan.resolve())
    errors = validate_plan(plan, cfg)
    if args.json:
        print(json.dumps({"ok": not errors, "errors": errors}, ensure_ascii=False, indent=2))
    elif errors:
        print("plan invalid:\n- " + "\n- ".join(errors))
    else:
        count = sum(len(w["tasks"]) for w in plan["waves"])
        print(f"plan valid: {len(plan['waves'])} waves, {count} tasks")
    return 2 if errors else 0


def require_launch_authorization(plan: Mapping[str, Any]) -> None:
    """Fail closed before launch can fetch, mutate Orca state, or create files."""
    status = plan.get("plan_status")
    if status != "approved":
        raise FleetError(f"plan_status must be approved for launch, got {status!r}")
    if plan.get("launch_authorized") is not True:
        raise FleetError("launch_authorized must be true for launch")


def do_start_coordinator(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    defaults = cfg.get("coordinator", {})
    agent = args.agent or defaults.get("agent") or "codex"
    setup = args.setup or defaults.get("setup") or "run"
    prefix = defaults.get("worktree_prefix") or "fleet-control"
    name = args.name or f"{prefix}-{slug(args.objective, 24)}-{timestamp().lower()}"
    if not name.startswith("fleet-control"):
        raise FleetError("coordinator worktree name must start with fleet-control")
    selector = repo_selector(root, cfg, args.dry_run)
    fetch(root, cfg, args.dry_run)
    base_ref = str(cfg.get("base_ref", "origin/main"))
    orca(root, ["repo", "set-base-ref", "--repo", selector, "--ref", base_ref], "set base ref", args.dry_run)
    prompt = (root / ".agents" / "prompts" / "coordinator.md").read_text(encoding="utf-8")
    prompt += (
        "\n\n# Current objective\n\n" + args.objective.strip() +
        f"\n\nRepository: `{root}`\nInitial base ref: `{base_ref}`\n" +
        "Keep this same coordinator session alive while the Run is active.\n"
    )
    receipt = orca(
        root,
        [
            "worktree", "create", "--repo", selector, "--name", name,
            "--agent", str(agent), "--prompt", prompt, "--setup", str(setup),
        ],
        "create coordinator",
        args.dry_run,
    )
    result = {"ok": True, "name": name, "agent": agent, "repo_selector": selector, "receipt": receipt}
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"coordinator started: {name} ({agent})")
    return 0


def build_state(plan: Mapping[str, Any], run_id: str, run_dir: Path, selector: str, base_ref: str, base_sha: str, branch: str) -> dict[str, Any]:
    tasks: dict[str, Any] = {}
    waves: list[dict[str, Any]] = []
    workspace_suffix = str(plan.get("workspace_suffix") or "").strip()
    for wave in plan["waves"]:
        ids = []
        for task in wave["tasks"]:
            tid = task["id"]
            ids.append(tid)
            workspace_name = f"trk-{task['track']}-{tid.lower()}"
            if workspace_suffix:
                workspace_name += f"-{workspace_suffix}"
            tasks[tid] = {
                **task,
                "wave": wave["id"],
                "status": "planned",
                "workspace_name": workspace_name,
                "orca_task_id": None,
                "dispatch_id": None,
                "branch": None,
                "base_ref": None,
                "base_sha": None,
                "head_sha": None,
                "summary": None,
                "dispatched_at": None,
                "completed_at": None,
            }
        waves.append({
            "id": wave["id"],
            "description": wave.get("description", ""),
            "depends_on": list(wave.get("depends_on", [])),
            "base": dict(wave["base"]),
            "tasks": ids,
            "status": "planned",
            "dispatched_at": None,
            "completed_at": None,
        })
    return {
        "schema_version": 1,
        "run_id": run_id,
        "objective": plan["objective"],
        "created_at": now(),
        "updated_at": now(),
        "run_dir": str(run_dir),
        "repo_selector": selector,
        "coordinator_branch": branch,
        "initial_base_ref": base_ref,
        "initial_base_sha": base_sha,
        "waves": waves,
        "tasks": tasks,
    }


def load_state_snapshot(path: Path) -> tuple[Path, dict[str, Any], JsonSnapshot]:
    """Load one state snapshot whose parsed value and hash share exact bytes."""
    snapshot = load_json_snapshot(path.resolve())
    state = snapshot.value
    if not isinstance(state, dict) or state.get("schema_version") != 1:
        raise FleetError(f"invalid state file: {snapshot.path}")
    return snapshot.path, state, snapshot


def load_state(path: Path) -> tuple[Path, dict[str, Any]]:
    state_path, state, _ = load_state_snapshot(path)
    return state_path, state


def status_bytes(state: Mapping[str, Any]) -> bytes:
    return status_markdown(state).encode("utf-8")


def save_state(path: Path, state: dict[str, Any]) -> None:
    state["updated_at"] = now()
    save_json(path, state)
    save_bytes(path.parent / "STATUS.md", status_bytes(state))


def require_amendment_authorization(amendment: Mapping[str, Any]) -> None:
    """Reject an amendment before it can write state or touch Orca."""
    status = amendment.get("plan_status")
    if status != "approved":
        raise FleetError(f"amendment plan_status must be approved, got {status!r}")
    if amendment.get("launch_authorized") is not True:
        raise FleetError("amendment launch_authorized must be true")


def amendment_id(amendment: Mapping[str, Any]) -> str:
    unknown = sorted(set(amendment) - AMENDMENT_FIELDS)
    if unknown:
        raise FleetError("unknown amendment fields: " + ", ".join(unknown))
    if amendment.get("schema_version") != 1:
        raise FleetError("amendment schema_version must be 1")
    value = amendment.get("amendment_id")
    if not isinstance(value, str) or re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9_-]{0,63})", value) is None:
        raise FleetError("amendment_id must be 1-64 letters, digits, underscores, or hyphens")
    run_id = amendment.get("run_id")
    if not isinstance(run_id, str) or re.fullmatch(r"run_[0-9a-zA-Z]+", run_id) is None:
        raise FleetError("amendment run_id must be explicit")
    for field in ("parent_plan_sha256", "state_sha256"):
        digest = amendment.get(field)
        if not isinstance(digest, str) or re.fullmatch(r"[0-9a-fA-F]{64}", digest) is None:
            raise FleetError(f"amendment {field} must be a full SHA-256")
    automation = amendment.get("automation")
    if not isinstance(automation, dict) or set(automation) != {"branch", "sha"}:
        raise FleetError("amendment automation must contain only branch and sha")
    if not isinstance(automation["branch"], str) or not automation["branch"].strip():
        raise FleetError("amendment automation.branch must be non-empty")
    if not isinstance(automation["sha"], str) or re.fullmatch(r"[0-9a-fA-F]{40}", automation["sha"]) is None:
        raise FleetError("amendment automation.sha must be a full Git SHA")
    suffix = amendment.get("workspace_suffix")
    if suffix is not None and (
        not isinstance(suffix, str)
        or re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,23})", suffix) is None
    ):
        raise FleetError("amendment workspace_suffix must be 1-24 lowercase letters, digits, or hyphens")
    return value


def object_list(value: Any, label: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise FleetError(f"amendment {label} must be an object list")
    return [dict(item) for item in value]


def task_never_dispatched(task: Mapping[str, Any]) -> bool:
    return task.get("status") == "planned" and all(task.get(field) is None for field in UNDISPATCHED_TASK_FIELDS)


def wave_never_dispatched(wave: Mapping[str, Any], state: Mapping[str, Any]) -> bool:
    task_ids = wave.get("tasks")
    return (
        wave.get("status") in ("planned", "blocked")
        and wave.get("dispatched_at") is None
        and wave.get("completed_at") is None
        and isinstance(task_ids, list)
        and all(task_id in state["tasks"] and task_never_dispatched(state["tasks"][task_id]) for task_id in task_ids)
    )


def topological_waves(state: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    waves = state.get("waves")
    tasks = state.get("tasks")
    if not isinstance(waves, list) or not isinstance(tasks, dict):
        raise FleetError("state waves and tasks must be materialized")
    wave_by_id: dict[str, Mapping[str, Any]] = {}
    task_wave: dict[str, str] = {}
    order: list[str] = []
    for wave in waves:
        if not isinstance(wave, dict) or not isinstance(wave.get("id"), str):
            raise FleetError("state contains an invalid wave")
        wid = str(wave["id"])
        if wid in wave_by_id:
            raise FleetError(f"duplicate wave id: {wid}")
        wave_by_id[wid] = wave
        order.append(wid)
        task_ids = wave.get("tasks")
        if not isinstance(task_ids, list) or not all(isinstance(item, str) for item in task_ids):
            raise FleetError(f"wave {wid}: tasks must be a string list")
        for tid in task_ids:
            if tid not in tasks:
                raise FleetError(f"wave {wid}: unknown task {tid}")
            if tid in task_wave:
                raise FleetError(f"task {tid} belongs to more than one wave")
            task_wave[tid] = wid
    missing = sorted(set(tasks) - set(task_wave))
    if missing:
        raise FleetError("tasks missing from waves: " + ", ".join(missing))

    dependencies: dict[str, set[str]] = {}
    for wid in order:
        deps: set[str] = set()
        raw = wave_by_id[wid].get("depends_on", [])
        if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
            raise FleetError(f"wave {wid}: depends_on must be a string list")
        for tid in raw:
            owner = task_wave.get(tid)
            if owner is None:
                raise FleetError(f"wave {wid}: unknown dependency {tid}")
            if owner == wid:
                raise FleetError(f"wave {wid}: dependency {tid} is in the same wave")
            deps.add(owner)
        dependencies[wid] = deps

    resolved: set[str] = set()
    result: list[Mapping[str, Any]] = []
    while len(result) < len(order):
        ready = [wid for wid in order if wid not in resolved and dependencies[wid] <= resolved]
        if not ready:
            blocked = [wid for wid in order if wid not in resolved]
            raise FleetError("amended wave graph contains a cycle: " + ", ".join(blocked))
        for wid in ready:
            resolved.add(wid)
            result.append(wave_by_id[wid])
    return result


def validate_materialized_state(state: Mapping[str, Any], cfg: Mapping[str, Any]) -> None:
    workspaces: dict[str, str] = {}
    for tid, task in state["tasks"].items():
        workspace = task.get("workspace_name")
        if not isinstance(workspace, str) or not workspace:
            raise FleetError(f"task {tid}: workspace_name must be non-empty")
        if workspace in workspaces:
            raise FleetError(f"duplicate workspace {workspace}: {workspaces[workspace]} and {tid}")
        workspaces[workspace] = tid

    ordered = topological_waves(state)
    plan = {
        "schema_version": 1,
        "objective": state.get("objective"),
        "waves": [
            {
                "id": wave["id"],
                "description": wave.get("description", ""),
                "depends_on": list(wave.get("depends_on", [])),
                "base": dict(wave.get("base", {})),
                "tasks": [state["tasks"][tid] for tid in wave["tasks"]],
            }
            for wave in ordered
        ],
    }
    errors = validate_plan(plan, cfg)
    if errors:
        raise FleetError("amended DAG errors:\n- " + "\n- ".join(errors))


def transitive_downstream(
    state: Mapping[str, Any], sources: list[str]
) -> dict[str, tuple[set[str], set[str]]]:
    """Return original task/wave descendants for each resolution source."""
    topological_waves(state)
    task_wave = {
        str(task_id): str(wave["id"])
        for wave in state["waves"]
        for task_id in wave["tasks"]
    }
    dependents: dict[str, set[str]] = {str(task_id): set() for task_id in state["tasks"]}
    for wave in state["waves"]:
        for dependency in wave["depends_on"]:
            dependents[str(dependency)].update(str(task_id) for task_id in wave["tasks"])

    result: dict[str, tuple[set[str], set[str]]] = {}
    for source in sources:
        pending = [source]
        visited = {source}
        downstream_tasks: set[str] = set()
        while pending:
            current = pending.pop()
            for dependent in dependents.get(current, set()):
                if dependent in visited:
                    continue
                visited.add(dependent)
                downstream_tasks.add(dependent)
                pending.append(dependent)
        downstream_waves = {task_wave[task_id] for task_id in downstream_tasks}
        result[source] = downstream_tasks, downstream_waves
    return result


def materialize_amendment(
    state: Mapping[str, Any],
    amendment: Mapping[str, Any],
    cfg: Mapping[str, Any],
    applied_at: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    candidate = copy.deepcopy(dict(state))
    append_waves = object_list(amendment.get("append_waves"), "append_waves")
    if not append_waves:
        raise FleetError("amendment append_waves must contain at least one fresh wave")
    update_wave_items = object_list(amendment.get("update_waves"), "update_waves")
    update_task_items = object_list(amendment.get("update_tasks"), "update_tasks")
    resolution_items = object_list(amendment.get("resolutions"), "resolutions")
    suffix = str(amendment.get("workspace_suffix") or "")
    suffix_text = f"-{suffix}" if suffix else ""
    amendment_name = str(amendment["amendment_id"])

    existing_wave_ids = {str(wave["id"]) for wave in candidate["waves"]}
    existing_task_ids = set(candidate["tasks"])
    appended_wave_ids: list[str] = []
    appended_task_ids: list[str] = []
    for wave in append_waves:
        unknown = sorted(set(wave) - NEW_WAVE_FIELDS)
        if unknown:
            raise FleetError(f"new wave has forbidden fields: {', '.join(unknown)}")
        wid = wave.get("id")
        if not isinstance(wid, str) or not wid:
            raise FleetError("new wave id must be non-empty")
        if wid in existing_wave_ids or wid in appended_wave_ids:
            raise FleetError(f"duplicate wave id: {wid}")
        raw_tasks = wave.get("tasks")
        if not isinstance(raw_tasks, list) or not raw_tasks or not all(isinstance(item, dict) for item in raw_tasks):
            raise FleetError(f"new wave {wid}: tasks must be a non-empty object list")
        wave_task_ids: list[str] = []
        for raw_task in raw_tasks:
            task = dict(raw_task)
            unknown_task = sorted(set(task) - NEW_TASK_FIELDS)
            if unknown_task:
                raise FleetError(f"new task has forbidden fields: {', '.join(unknown_task)}")
            tid = task.get("id")
            if not isinstance(tid, str):
                raise FleetError(f"new wave {wid}: task id must be a string")
            if tid in existing_task_ids or tid in appended_task_ids:
                raise FleetError(f"existing Task mutation is forbidden: {tid}")
            track = task.get("track")
            workspace_name = f"trk-{track}-{tid.lower()}{suffix_text}"
            candidate["tasks"][tid] = {
                **copy.deepcopy(task),
                "wave": wid,
                "status": "planned",
                "workspace_name": workspace_name,
                "orca_task_id": None,
                "dispatch_id": None,
                "branch": None,
                "base_ref": None,
                "base_sha": None,
                "head_sha": None,
                "summary": None,
                "dispatched_at": None,
                "completed_at": None,
            }
            appended_task_ids.append(tid)
            wave_task_ids.append(tid)
        candidate["waves"].append(
            {
                "id": wid,
                "description": wave.get("description", ""),
                "depends_on": copy.deepcopy(wave.get("depends_on", [])),
                "base": copy.deepcopy(wave.get("base", {})),
                "tasks": wave_task_ids,
                "status": "planned",
                "dispatched_at": None,
                "completed_at": None,
            }
        )
        appended_wave_ids.append(wid)

    resolutions = candidate.get("resolutions", {})
    if not isinstance(resolutions, dict):
        raise FleetError("state resolutions must be an object")
    candidate["resolutions"] = resolutions
    validated_resolutions: list[tuple[str, str, str]] = []
    seen_resolution_sources: set[str] = set()
    for item in resolution_items:
        unknown = sorted(set(item) - {"task", "corrected_by", "superseded_by"})
        if unknown:
            raise FleetError("resolution has forbidden fields: " + ", ".join(unknown))
        source = item.get("task")
        relations = [name for name in ("corrected_by", "superseded_by") if name in item]
        if not isinstance(source, str) or source not in state["tasks"]:
            raise FleetError(f"resolution source must be an existing task: {source}")
        if len(relations) != 1:
            raise FleetError(f"resolution {source} must contain exactly one of corrected_by or superseded_by")
        relation = relations[0]
        replacement = item.get(relation)
        if not isinstance(replacement, str) or replacement not in appended_task_ids:
            raise FleetError(f"resolution {source} must point to a fresh appended task")
        if source in resolutions or source in seen_resolution_sources:
            raise FleetError(f"resolution for {source} is immutable")
        source_status = state["tasks"][source].get("status")
        if relation == "superseded_by" and source_status != "failed":
            raise FleetError(f"superseded task {source} must already be failed")
        if relation == "corrected_by" and source_status != "completed":
            raise FleetError(f"corrected task {source} must already be completed")
        seen_resolution_sources.add(source)
        validated_resolutions.append((source, relation, replacement))

    downstream = transitive_downstream(state, sorted(seen_resolution_sources))
    allowed_task_updates = {
        task_id
        for task_ids, _ in downstream.values()
        for task_id in task_ids
    }
    allowed_wave_updates = {
        wave_id
        for _, wave_ids in downstream.values()
        for wave_id in wave_ids
    }

    original_waves = {str(wave["id"]): wave for wave in state["waves"]}
    updated_wave_ids: list[str] = []
    for patch in update_wave_items:
        unknown = sorted(set(patch) - WAVE_PATCH_FIELDS)
        if unknown:
            raise FleetError("existing wave mutation is forbidden: " + ", ".join(unknown))
        wid = patch.get("id")
        if not isinstance(wid, str) or wid not in original_waves:
            raise FleetError(f"unknown existing wave: {wid}")
        if wid in updated_wave_ids:
            raise FleetError(f"duplicate wave update: {wid}")
        if not wave_never_dispatched(original_waves[wid], state):
            raise FleetError(f"downstream wave {wid} has already been dispatched")
        if wid not in allowed_wave_updates:
            raise FleetError(f"existing wave {wid} is not downstream of any resolved source")
        if len(patch) == 1:
            raise FleetError(f"wave update {wid} has no contract changes")
        target = next(wave for wave in candidate["waves"] if wave["id"] == wid)
        for field in WAVE_PATCH_FIELDS - {"id"}:
            if field in patch:
                target[field] = copy.deepcopy(patch[field])
        updated_wave_ids.append(wid)

    updated_task_ids: list[str] = []
    for patch in update_task_items:
        unknown = sorted(set(patch) - TASK_PATCH_FIELDS)
        if unknown:
            raise FleetError("existing Task or Dispatch mutation is forbidden: " + ", ".join(unknown))
        tid = patch.get("id")
        if not isinstance(tid, str) or tid not in state["tasks"]:
            raise FleetError(f"unknown existing task: {tid}")
        if tid in updated_task_ids:
            raise FleetError(f"duplicate task update: {tid}")
        if not task_never_dispatched(state["tasks"][tid]):
            raise FleetError(f"downstream task {tid} has already been dispatched")
        if tid not in allowed_task_updates:
            raise FleetError(f"existing task {tid} is not downstream of any resolved source")
        if len(patch) == 1:
            raise FleetError(f"task update {tid} has no contract changes")
        for field in TASK_PATCH_FIELDS - {"id"}:
            if field in patch:
                candidate["tasks"][tid][field] = copy.deepcopy(patch[field])
        updated_task_ids.append(tid)

    recorded_resolutions: list[dict[str, str]] = []
    for source, relation, replacement in validated_resolutions:
        record = {
            relation: replacement,
            "amendment_id": amendment_name,
            "recorded_at": applied_at,
        }
        resolutions[source] = record
        recorded_resolutions.append({"task": source, relation: replacement})

    validate_materialized_state(candidate, cfg)
    changes = {
        "appended_waves": appended_wave_ids,
        "appended_tasks": appended_task_ids,
        "updated_waves": updated_wave_ids,
        "updated_tasks": updated_task_ids,
        "resolutions": recorded_resolutions,
        "requested_changes": {
            "append_waves": copy.deepcopy(append_waves),
            "update_waves": copy.deepcopy(update_wave_items),
            "update_tasks": copy.deepcopy(update_task_items),
            "resolutions": copy.deepcopy(resolution_items),
        },
    }
    return candidate, changes


AMENDMENT_CHANGE_KEYS = {
    "appended_waves",
    "appended_tasks",
    "updated_waves",
    "updated_tasks",
    "resolutions",
    "requested_changes",
}
AMENDMENT_REQUEST_KEYS = {"append_waves", "update_waves", "update_tasks", "resolutions"}


def bytes_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def amendment_artifact_paths(state_path: Path, aid: str, source_hash: str) -> tuple[Path, Path, Path]:
    stem = f"amendment-{aid}-{source_hash[:12]}"
    evidence = state_path.parent / "evidence"
    return evidence / f"{stem}.journal.json", evidence / f"{stem}.json", state_path.parent / "STATUS.md"


def amendment_receipt_from_journal(journal: Mapping[str, Any]) -> dict[str, Any]:
    state_identity = journal["state"]
    parent_plan = journal["parent_plan"]
    expected_status = journal["expected_status"]
    changes = copy.deepcopy(journal["changes"])
    return {
        "schema_version": 1,
        "kind": "fleet_amendment_receipt",
        "ok": True,
        "dry_run": False,
        "amendment_id": journal["amendment_id"],
        "already_applied": False,
        "state": state_identity["path"],
        "parent_plan_sha256": parent_plan["sha256"],
        "state_before_sha256": state_identity["before_sha256"],
        **changes,
        "applied_at": journal["applied_at"],
        "amendment_source": journal["amendment_source"],
        "amendment_sha256": journal["amendment_sha256"],
        "automation": copy.deepcopy(journal["automation"]),
        "state_after_sha256": state_identity["after_sha256"],
        "journal": journal["journal_path"],
        "status": expected_status["path"],
        "status_sha256": expected_status["sha256"],
    }


def amendment_record_from_journal(journal: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": journal["amendment_id"],
        "source": journal["amendment_source"],
        "source_sha256": journal["amendment_sha256"],
        "parent_plan_sha256": journal["parent_plan"]["sha256"],
        "state_before_sha256": journal["state"]["before_sha256"],
        "automation": copy.deepcopy(journal["automation"]),
        "applied_at": journal["applied_at"],
        "changes": copy.deepcopy(journal["changes"]),
        "journal": journal["journal_path"],
        "receipt": journal["expected_receipt"]["path"],
        "status": journal["expected_status"]["path"],
    }


def prepare_amendment_transaction(
    state_path: Path,
    state: Mapping[str, Any],
    state_before_hash: str,
    amendment: Mapping[str, Any],
    amendment_source: str,
    amendment_hash: str,
    plan_path: Path,
    parent_plan_hash: str,
    cfg: Mapping[str, Any],
    applied_at: str,
) -> dict[str, Any]:
    candidate, changes = materialize_amendment(state, amendment, cfg, applied_at)
    aid = str(amendment["amendment_id"])
    journal_path, receipt_path, status_path = amendment_artifact_paths(state_path, aid, amendment_hash)
    record = {
        "id": aid,
        "source": amendment_source,
        "source_sha256": amendment_hash,
        "parent_plan_sha256": parent_plan_hash,
        "state_before_sha256": state_before_hash,
        "automation": copy.deepcopy(amendment["automation"]),
        "applied_at": applied_at,
        "changes": copy.deepcopy(changes),
        "journal": str(journal_path),
        "receipt": str(receipt_path),
        "status": str(status_path),
    }
    candidate.setdefault("amendments", []).append(record)
    candidate["updated_at"] = applied_at
    state_data = json_bytes(candidate)
    state_after_hash = bytes_sha256(state_data)
    derived_status = status_bytes(candidate)
    journal: dict[str, Any] = {
        "schema_version": 1,
        "kind": "fleet_amendment_journal",
        "journal_path": str(journal_path),
        "amendment_id": aid,
        "run_id": state["run_id"],
        "amendment_source": amendment_source,
        "amendment_sha256": amendment_hash,
        "parent_plan": {"path": str(plan_path), "sha256": parent_plan_hash},
        "state": {
            "path": str(state_path),
            "before_sha256": state_before_hash,
            "after_sha256": state_after_hash,
        },
        "applied_at": applied_at,
        "automation": copy.deepcopy(amendment["automation"]),
        "changes": copy.deepcopy(changes),
        "expected_status": {
            "path": str(status_path),
            "sha256": bytes_sha256(derived_status),
            "size": len(derived_status),
            "state_sha256": state_after_hash,
        },
        "expected_receipt": {},
    }
    receipt = amendment_receipt_from_journal(journal)
    receipt_data = json_bytes(receipt)
    journal["expected_receipt"] = {
        "path": str(receipt_path),
        "sha256": bytes_sha256(receipt_data),
        "size": len(receipt_data),
    }
    if record != amendment_record_from_journal(journal):
        raise FleetError("internal amendment record does not match prepared journal")
    return {
        "candidate": candidate,
        "changes": changes,
        "journal": journal,
        "journal_data": json_bytes(journal),
        "journal_path": journal_path,
        "receipt": receipt,
        "receipt_data": receipt_data,
        "receipt_path": receipt_path,
        "status_data": derived_status,
        "status_path": status_path,
        "state_data": state_data,
        "state_after_sha256": state_after_hash,
    }


def _exact_fields(value: Any, fields: set[str], label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise FleetError(f"{label} fields conflict")
    return value


def _full_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise FleetError(f"{label} must be a lowercase SHA-256")
    return value


def validate_amendment_journal(
    journal: Any,
    *,
    state_path: Path,
    run_id: str,
    aid: str,
    amendment_hash: str,
    expected_state_before_hash: str,
    automation: Mapping[str, Any],
    plan_path: Path,
    parent_plan_hash: str,
    journal_path: Path,
    receipt_path: Path,
    status_path: Path,
) -> bytes:
    journal = _exact_fields(
        journal,
        {
            "schema_version", "kind", "journal_path", "amendment_id", "run_id",
            "amendment_source", "amendment_sha256", "parent_plan", "state",
            "applied_at", "automation", "changes", "expected_status", "expected_receipt",
        },
        "amendment journal",
    )
    if journal["schema_version"] != 1 or journal["kind"] != "fleet_amendment_journal":
        raise FleetError("amendment journal schema or kind conflicts")
    if journal["journal_path"] != str(journal_path):
        raise FleetError("amendment journal path conflicts")
    if journal["amendment_id"] != aid or journal["run_id"] != run_id:
        raise FleetError("amendment journal identity conflicts")
    if journal["amendment_sha256"] != amendment_hash:
        raise FleetError("amendment journal source hash conflicts")
    if journal["automation"] != automation:
        raise FleetError("amendment journal automation identity conflicts")
    if not isinstance(journal["amendment_source"], str) or not journal["amendment_source"]:
        raise FleetError("amendment journal source path conflicts")
    if not isinstance(journal["applied_at"], str) or not journal["applied_at"]:
        raise FleetError("amendment journal applied_at conflicts")

    parent_plan = _exact_fields(journal["parent_plan"], {"path", "sha256"}, "journal parent plan")
    if parent_plan["path"] != str(plan_path) or parent_plan["sha256"] != parent_plan_hash:
        raise FleetError("amendment journal parent plan conflicts")
    state_identity = _exact_fields(
        journal["state"], {"path", "before_sha256", "after_sha256"}, "journal state"
    )
    if state_identity["path"] != str(state_path):
        raise FleetError("amendment journal state path conflicts")
    before_hash = _full_sha256(state_identity["before_sha256"], "journal state before hash")
    if before_hash != expected_state_before_hash.lower():
        raise FleetError("amendment journal state precondition conflicts")
    _full_sha256(state_identity["after_sha256"], "journal state after hash")

    changes = _exact_fields(journal["changes"], AMENDMENT_CHANGE_KEYS, "journal change summary")
    for field in AMENDMENT_CHANGE_KEYS - {"requested_changes"}:
        if not isinstance(changes[field], list):
            raise FleetError(f"journal change summary {field} must be a list")
    requested = _exact_fields(changes["requested_changes"], AMENDMENT_REQUEST_KEYS, "journal requested changes")
    if not all(isinstance(requested[field], list) for field in AMENDMENT_REQUEST_KEYS):
        raise FleetError("journal requested changes must be object lists")

    expected_status = _exact_fields(
        journal["expected_status"], {"path", "sha256", "size", "state_sha256"}, "journal STATUS identity"
    )
    if expected_status["path"] != str(status_path):
        raise FleetError("amendment journal STATUS path conflicts")
    _full_sha256(expected_status["sha256"], "journal STATUS hash")
    if expected_status["state_sha256"] != state_identity["after_sha256"]:
        raise FleetError("amendment journal STATUS state identity conflicts")
    if not isinstance(expected_status["size"], int) or expected_status["size"] < 0:
        raise FleetError("amendment journal STATUS size conflicts")

    expected_receipt = _exact_fields(
        journal["expected_receipt"], {"path", "sha256", "size"}, "journal receipt identity"
    )
    if expected_receipt["path"] != str(receipt_path):
        raise FleetError("amendment journal receipt path conflicts")
    _full_sha256(expected_receipt["sha256"], "journal receipt hash")
    if not isinstance(expected_receipt["size"], int) or expected_receipt["size"] < 0:
        raise FleetError("amendment journal receipt size conflicts")
    receipt_data = json_bytes(amendment_receipt_from_journal(journal))
    if expected_receipt["sha256"] != bytes_sha256(receipt_data) or expected_receipt["size"] != len(receipt_data):
        raise FleetError("amendment journal receipt content identity conflicts")
    return receipt_data


def validate_applied_amendment_state(state: Mapping[str, Any], journal: Mapping[str, Any]) -> None:
    """Prove that the committed state still contains every amendment identity."""
    changes = journal["changes"]
    wave_ids = [wave.get("id") for wave in state.get("waves", []) if isinstance(wave, Mapping)]
    for wave_id in changes["appended_waves"]:
        if wave_ids.count(wave_id) != 1:
            raise FleetError(f"applied amendment wave identity is missing or duplicated: {wave_id}")
    tasks = state.get("tasks")
    if not isinstance(tasks, Mapping):
        raise FleetError("applied amendment state tasks are invalid")
    for task_id in [*changes["appended_tasks"], *changes["updated_tasks"]]:
        if task_id not in tasks:
            raise FleetError(f"applied amendment task identity is missing: {task_id}")
    for wave_id in changes["updated_waves"]:
        if wave_id not in wave_ids:
            raise FleetError(f"applied amendment updated wave identity is missing: {wave_id}")
    resolutions = state.get("resolutions")
    if not isinstance(resolutions, Mapping):
        raise FleetError("applied amendment resolutions are invalid")
    for summary in changes["resolutions"]:
        source = summary.get("task") if isinstance(summary, Mapping) else None
        relations = [name for name in ("corrected_by", "superseded_by") if isinstance(summary, Mapping) and name in summary]
        if not isinstance(source, str) or len(relations) != 1:
            raise FleetError("applied amendment resolution summary conflicts")
        relation = relations[0]
        expected = {
            relation: summary[relation],
            "amendment_id": journal["amendment_id"],
            "recorded_at": journal["applied_at"],
        }
        if resolutions.get(source) != expected:
            raise FleetError(f"applied amendment resolution conflicts: {source}")
    topological_waves(state)


def publish_amendment_journal(path: Path, data: bytes) -> None:
    save_new_bytes(path, data)


def replace_amendment_state(path: Path, data: bytes) -> None:
    save_bytes(path, data)


def publish_amendment_receipt(path: Path, data: bytes) -> None:
    save_new_bytes(path, data)


def publish_amendment_status(path: Path, data: bytes) -> None:
    save_bytes(path, data)


def ensure_amendment_receipt(path: Path, expected: bytes, dry_run: bool) -> None:
    if not path.exists():
        if dry_run:
            raise FleetError(f"amendment receipt is missing and dry-run cannot repair it: {path}")
        publish_amendment_receipt(path, expected)
    snapshot = load_json_snapshot(path)
    if snapshot.data != expected or snapshot.sha256 != bytes_sha256(expected):
        raise FleetError(f"amendment receipt content conflicts: {path}")


def ensure_amendment_status(path: Path, expected: bytes, dry_run: bool) -> None:
    current = path.read_bytes() if path.exists() else None
    if current != expected:
        if dry_run:
            raise FleetError(f"derived STATUS is missing or stale and dry-run cannot repair it: {path}")
        publish_amendment_status(path, expected)
    if path.read_bytes() != expected:
        raise FleetError(f"derived STATUS content conflicts after repair: {path}")


def amendment_result(
    journal: Mapping[str, Any], *, dry_run: bool, already_applied: bool
) -> dict[str, Any]:
    return {
        "ok": True,
        "dry_run": dry_run,
        "amendment_id": journal["amendment_id"],
        "already_applied": already_applied,
        "state": journal["state"]["path"],
        "parent_plan_sha256": journal["parent_plan"]["sha256"],
        "state_before_sha256": journal["state"]["before_sha256"],
        **copy.deepcopy(journal["changes"]),
        "applied_at": journal["applied_at"],
        "state_after_sha256": journal["state"]["after_sha256"],
        "journal": journal["journal_path"],
        "receipt": journal["expected_receipt"]["path"],
        "status": journal["expected_status"]["path"],
    }


def _do_amend_locked(_root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    state_path, state, state_snapshot = load_state_snapshot(args.state)
    amendment_snapshot = load_json_snapshot(args.amendment.resolve())
    amendment = amendment_snapshot.value
    if not isinstance(amendment, dict):
        raise FleetError("amendment must be a JSON object")
    require_amendment_authorization(amendment)
    aid = amendment_id(amendment)
    if amendment["run_id"] != state.get("run_id"):
        raise FleetError(f"amendment run_id {amendment['run_id']} != state {state.get('run_id')}")

    plan_path = (state_path.parent / "plan.json").resolve()
    plan_snapshot = load_json_snapshot(plan_path)
    parent_plan_hash = plan_snapshot.sha256
    if parent_plan_hash.lower() != str(amendment["parent_plan_sha256"]).lower():
        raise FleetError("parent plan SHA-256 precondition failed")
    amendment_hash = amendment_snapshot.sha256
    journal_path, receipt_path, status_path = amendment_artifact_paths(state_path, aid, amendment_hash)

    records = state.get("amendments", [])
    if not isinstance(records, list) or not all(isinstance(record, dict) for record in records):
        raise FleetError("state amendments must be an object list")
    matches = [record for record in records if record.get("id") == aid]
    if len(matches) > 1:
        raise FleetError(f"state contains duplicate amendment records for {aid}")
    existing = matches[0] if matches else None

    if existing is not None:
        if existing.get("source_sha256") != amendment_hash:
            raise FleetError(f"amendment id {aid} was already applied with different content")
        if not journal_path.exists():
            raise FleetError(f"applied amendment journal is missing: {journal_path}")
        journal_snapshot = load_json_snapshot(journal_path)
        journal = journal_snapshot.value
        if journal_snapshot.data != json_bytes(journal):
            raise FleetError(f"applied amendment journal bytes conflict: {journal_path}")
        receipt_data = validate_amendment_journal(
            journal,
            state_path=state_path,
            run_id=str(state["run_id"]),
            aid=aid,
            amendment_hash=amendment_hash,
            expected_state_before_hash=str(amendment["state_sha256"]),
            automation=amendment["automation"],
            plan_path=plan_path,
            parent_plan_hash=parent_plan_hash,
            journal_path=journal_path,
            receipt_path=receipt_path,
            status_path=status_path,
        )
        if existing != amendment_record_from_journal(journal):
            raise FleetError(f"state amendment record conflicts with journal: {aid}")
        validate_applied_amendment_state(state, journal)
        current_status = status_bytes(state)
        if state_snapshot.sha256 == journal["state"]["after_sha256"]:
            expected_status = journal["expected_status"]
            if expected_status["sha256"] != bytes_sha256(current_status) or expected_status["size"] != len(current_status):
                raise FleetError("amendment journal STATUS identity conflicts with committed state")
        ensure_amendment_receipt(receipt_path, receipt_data, bool(args.dry_run))
        ensure_amendment_status(status_path, current_status, bool(args.dry_run))
        result = amendment_result(journal, dry_run=bool(args.dry_run), already_applied=True)
        print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"amendment already applied: {aid}")
        return 0

    if journal_path.exists():
        journal_snapshot = load_json_snapshot(journal_path)
        journal = journal_snapshot.value
        if journal_snapshot.data != json_bytes(journal):
            raise FleetError(f"amendment journal bytes conflict: {journal_path}")
        validate_amendment_journal(
            journal,
            state_path=state_path,
            run_id=str(state["run_id"]),
            aid=aid,
            amendment_hash=amendment_hash,
            expected_state_before_hash=str(amendment["state_sha256"]),
            automation=amendment["automation"],
            plan_path=plan_path,
            parent_plan_hash=parent_plan_hash,
            journal_path=journal_path,
            receipt_path=receipt_path,
            status_path=status_path,
        )
        if state_snapshot.sha256 != journal["state"]["before_sha256"]:
            raise FleetError("journal exists but state matches neither a recoverable before-state nor an applied record")
        transaction = prepare_amendment_transaction(
            state_path,
            state,
            state_snapshot.sha256,
            amendment,
            str(journal["amendment_source"]),
            amendment_hash,
            plan_path,
            parent_plan_hash,
            cfg,
            str(journal["applied_at"]),
        )
        if journal != transaction["journal"]:
            raise FleetError("amendment journal content conflicts with deterministic replay")
        if receipt_path.exists():
            raise FleetError("amendment receipt exists before state replacement")
    else:
        if receipt_path.exists():
            raise FleetError(f"amendment receipt exists without a journal: {receipt_path}")
        if state_snapshot.sha256.lower() != str(amendment["state_sha256"]).lower():
            raise FleetError("state SHA-256 precondition failed")
        transaction = prepare_amendment_transaction(
            state_path,
            state,
            state_snapshot.sha256,
            amendment,
            str(amendment_snapshot.path),
            amendment_hash,
            plan_path,
            parent_plan_hash,
            cfg,
            now(),
        )
        journal = transaction["journal"]

    result = amendment_result(journal, dry_run=bool(args.dry_run), already_applied=False)
    if args.dry_run:
        result["materialized"] = {
            "waves": transaction["candidate"]["waves"],
            "tasks": transaction["candidate"]["tasks"],
            "resolutions": transaction["candidate"].get("resolutions", {}),
            "amendments": transaction["candidate"].get("amendments", []),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"amendment dry-run valid: {aid}")
        return 0

    if not journal_path.exists():
        publish_amendment_journal(journal_path, transaction["journal_data"])
    committed_journal = load_json_snapshot(journal_path)
    if committed_journal.data != transaction["journal_data"] or committed_journal.value != journal:
        raise FleetError("published amendment journal conflicts with prepared transaction")

    current_state = load_json_snapshot(state_path)
    if current_state.data != state_snapshot.data or current_state.sha256 != state_snapshot.sha256:
        raise FleetError("state changed while amendment lock was held")
    current_plan = load_json_snapshot(plan_path)
    if current_plan.data != plan_snapshot.data or current_plan.sha256 != plan_snapshot.sha256:
        raise FleetError("parent plan changed while amendment lock was held")
    replace_amendment_state(state_path, transaction["state_data"])
    committed_state = load_json_snapshot(state_path)
    if committed_state.data != transaction["state_data"] or committed_state.sha256 != transaction["state_after_sha256"]:
        raise FleetError("amendment state replacement did not commit the prepared bytes")
    ensure_amendment_receipt(receipt_path, transaction["receipt_data"], False)
    ensure_amendment_status(status_path, transaction["status_data"], False)
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"amendment applied: {aid}; receipt={receipt_path}")
    return 0


def do_amend(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    state_path = args.state.resolve()
    with run_state_lock(state_path):
        return _do_amend_locked(root, cfg, args)


def wave_ready(wave: Mapping[str, Any], state: Mapping[str, Any]) -> bool:
    return wave["status"] == "planned" and all(state["tasks"][x]["status"] == "completed" for x in wave["depends_on"])


def resolve_wave_base(root: Path, state: Mapping[str, Any], wave: Mapping[str, Any], dry_run: bool) -> tuple[str, str]:
    base = wave["base"]
    if base["type"] == "ref":
        ref = str(base["value"])
        return ref, resolve_sha(root, ref, dry_run)
    task = state["tasks"][base["task"]]
    if task["status"] != "completed" or not task.get("branch") or not task.get("head_sha"):
        raise FleetError(f"base task {base['task']} is not verified complete")
    branch = clean_branch(str(task["branch"]))
    ref = f"origin/{branch}"
    run(["git", "fetch", "origin", branch], cwd=root, dry_run=dry_run, echo=True)
    if not dry_run and git_sha(root, ref) != task["head_sha"]:
        raise FleetError(f"base task remote ref drifted: {base['task']}")
    return ref, str(task["head_sha"])


def quote_arg(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_spec(root: Path, cfg: Mapping[str, Any], state: Mapping[str, Any], task: Mapping[str, Any]) -> str:
    wave = next(w for w in state["waves"] if w["id"] == task["wave"])
    deps = []
    for dep_id in wave["depends_on"]:
        dep = state["tasks"][dep_id]
        deps.append(f"- {dep_id}: branch={dep.get('branch')}; sha={dep.get('head_sha')}; track={dep.get('track')}")
    init = [
        "python scripts/gate.py init",
        f"--track {task['track']}",
        f"--task {task['id']}",
        f"--base {task['base_sha']}",
    ]
    init += [f"--write-path {quote_arg(str(x))}" for x in task.get("write_paths", [])]
    init += [f"--check {quote_arg(str(x))}" for x in task.get("checks", [])]
    if task["track"] == "integration":
        for dep_id in wave["depends_on"]:
            dep_sha = state["tasks"][dep_id].get("head_sha")
            if dep_sha:
                init.append(f"--dependency-sha {dep_sha}")
    template = "integrator.md" if task["track"] == "integration" else "worker.md"
    contract = (root / ".agents" / "prompts" / template).read_text(encoding="utf-8")
    lines = [
        f"# Logical task {task['id']}", "",
        f"Title: {task['title']}",
        f"Track: {task['track']}",
        f"Orca Run: {state['run_id']}",
        f"Frozen BASE_REF: {task['base_ref']}",
        f"Frozen BASE_SHA: {task['base_sha']}",
        f"Expected workspace/branch: {task['workspace_name']}", "",
        "## Specification", "", str(task["spec"]), "",
        "## Acceptance", "", *[f"- {x}" for x in task.get("acceptance", [])], "",
        "## Exact write paths", "", *[f"- `{x}`" for x in task.get("write_paths", [])], "",
        "## Required checks", "", *([f"- `{x}`" for x in task.get("checks", [])] or ["- Track checks only"]), "",
        "## Dependency evidence", "", *(deps or ["- None"]), "",
        "## Mandatory first commands", "", "```bash", " \\\n  ".join(init),
        "python scripts/gate.py check --preflight", "```", "",
        "The Orca worker preamble contains the actual task_... and dispatch_... IDs. Use those exact IDs in worker_finish.py.",
        "", "---", "", contract,
    ]
    return "\n".join(lines)


def dispatch_wave(root: Path, cfg: Mapping[str, Any], state: dict[str, Any], wave: dict[str, Any], state_path: Path, dry_run: bool) -> None:
    base_ref, base_sha = resolve_wave_base(root, state, wave, dry_run)
    selector = canonical_repo_selector(root, state["repo_selector"], dry_run)
    coordinator = run_coordinator_handle(root, state["run_id"], dry_run)
    dependency_task_ids: list[str] = []
    for dependency in wave["depends_on"]:
        task_id = state["tasks"][dependency].get("orca_task_id")
        if not isinstance(task_id, str) or not task_id.startswith("task_"):
            raise FleetError(f"dependency {dependency} has no explicit Orca Task identity")
        dependency_task_ids.append(task_id)
    dependency_json = json.dumps(dependency_task_ids, separators=(",", ":"))
    orca(root, ["repo", "set-base-ref", "--repo", selector, "--ref", base_ref], f"set base for {wave['id']}", dry_run)
    evidence = Path(state["run_dir"]) / "evidence"
    defaults = cfg.get("worker_defaults", {})
    launch_failures: list[str] = []
    for tid in wave["tasks"]:
        task = state["tasks"][tid]
        task["base_ref"], task["base_sha"] = base_ref, base_sha
        task_receipt_path = evidence / f"{tid}-task-create.json"
        task_id = task.get("orca_task_id")
        if not task_id and task_receipt_path.exists() and not dry_run:
            task_id = find_prefixed(load_json(task_receipt_path), "task_")
        if not task_id:
            create = orca(
                root,
                [
                    "orchestration", "task-create",
                    "--task-title", f"[{tid}] {task['title']}",
                    "--spec", render_spec(root, cfg, state, task),
                    "--deps", dependency_json,
                    "--run", state["run_id"],
                    "--from", coordinator,
                ],
                f"create task {tid}",
                dry_run,
            )
            task_id = find_prefixed(create, "task_") or (f"task_dry_{tid.lower()}" if dry_run else None)
            if not task_id:
                raise FleetError(f"task-create receipt missing task_ ID for {tid}")
            save_json(task_receipt_path, create)
        task["orca_task_id"] = task_id
        # Persist the external Task identity before worker-start so an explicit
        # launch failure can be retried without creating a duplicate Orca Task.
        save_state(state_path, state)
        agent = task.get("agent") or defaults.get("agent") or "codex"
        setup = task.get("setup") or defaults.get("setup") or "run"
        mode = task.get("worktree_mode") or defaults.get("worktree_mode") or "new-top-level"
        existing = orca(
            root,
            ["orchestration", "dispatch-show", "--task", task_id, "--from", coordinator],
            f"inspect dispatch {tid}",
            dry_run,
        )
        dispatch = dispatch_id_from_receipt(existing)
        existing_status = dispatch_status_from_receipt(existing)
        if dispatch and existing_status not in (None, "dispatched", "completed"):
            task["last_dispatch_id"] = dispatch
            task["last_dispatch_error"] = existing_status
            save_json(evidence / f"{tid}-dispatch-show-failed.json", existing)
            save_state(state_path, state)
            launch_failures.append(f"{tid}={existing_status}")
            continue
        started = existing
        if not dispatch:
            cmd = [
                "orchestration", "worker-start", "--task", task_id,
                "--run", state["run_id"], "--from", coordinator,
                "--worktree", str(mode), "--repo", selector, "--name", task["workspace_name"],
                "--base-branch", base_sha,
                "--agent", str(agent), "--setup", str(setup),
            ]
            if task.get("model"):
                cmd += ["--model", str(task["model"])]
                if task.get("effort"):
                    cmd += ["--effort", str(task["effort"])]
            elif task.get("effort"):
                raise FleetError(f"task {tid}: effort requires model")
            started = orca(root, cmd, f"start worker {tid}", dry_run, allow_nonzero=True)
            dispatch = dispatch_id_from_receipt(started)
            result = started.get("result")
            worker_state = result.get("state") if isinstance(result, Mapping) else None
            if worker_state == "failed":
                task["last_dispatch_id"] = dispatch
                error = result.get("lastError") or result.get("last_error") or "worker-start failed"
                task["last_dispatch_error"] = str(error)
                save_json(evidence / f"{tid}-worker-start-failed.json", started)
                save_state(state_path, state)
                launch_failures.append(f"{tid}={error}")
                continue
        dispatch = dispatch or (f"dispatch_dry_{tid.lower()}" if dry_run else None)
        if not dispatch:
            raise FleetError(f"worker-start receipt missing dispatch_ ID for {tid}")
        task["dispatch_id"] = dispatch
        task["branch"] = find_branch(started) or task["workspace_name"]
        task["status"] = "dispatched"
        task["dispatched_at"] = now()
        save_json(evidence / f"{tid}-worker-start.json", started)
        save_state(state_path, state)
    if launch_failures:
        wave["status"] = "planned"
        save_state(state_path, state)
        raise FleetError("worker launches require exact retry: " + ", ".join(launch_failures))
    wave["status"] = "dispatched"
    wave["dispatched_at"] = now()
    save_state(state_path, state)


def update_waves(state: dict[str, Any]) -> None:
    for wave in state["waves"]:
        statuses = [state["tasks"][x]["status"] for x in wave["tasks"]]
        if all(x == "completed" for x in statuses):
            wave["status"] = "completed"
            wave["completed_at"] = wave.get("completed_at") or now()
        elif any(x == "failed" for x in statuses):
            wave["status"] = "failed"
        elif all(x in ("dispatched", "completed") for x in statuses):
            wave["status"] = "dispatched"
        elif any(state["tasks"][x]["status"] == "failed" for x in wave["depends_on"]):
            wave["status"] = "blocked"
        else:
            # Keep a partially dispatched wave resumable after worker-start
            # fails for one of its remaining tasks.
            wave["status"] = "planned"


def dispatch_ready(root: Path, cfg: Mapping[str, Any], state: dict[str, Any], state_path: Path, dry_run: bool) -> list[str]:
    update_waves(state)
    sent: list[str] = []
    for wave in state["waves"]:
        if wave_ready(wave, state):
            dispatch_wave(root, cfg, state, wave, state_path, dry_run)
            sent.append(wave["id"])
    save_state(state_path, state)
    return sent


def do_launch(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    plan = load_json(args.plan.resolve())
    require_launch_authorization(plan)
    errors = validate_plan(plan, cfg)
    if errors:
        raise FleetError("plan errors:\n- " + "\n- ".join(errors))
    branch = git_branch(root)
    if not args.dry_run and not branch.startswith("fleet-control"):
        raise FleetError(f"launch must run in fleet-control worktree, not {branch}")
    selector = repo_selector(root, cfg, args.dry_run)
    fetch(root, cfg, args.dry_run)
    base_ref = str(plan.get("base_ref") or cfg.get("base_ref") or "origin/main")
    base_sha = resolve_sha(root, base_ref, args.dry_run)
    run_dir = root / ".agents" / "runs" / f"{timestamp()}-{slug(plan['objective'])}"
    state_path = run_dir / "state.json"
    with run_state_lock(state_path):
        plan_copy = run_dir / "plan.json"
        run_receipt_path = run_dir / "evidence" / "run-create.json"
        if state_path.exists() or plan_copy.exists() or run_receipt_path.exists():
            raise FleetError(f"Run directory identity already contains immutable files: {run_dir}")
        orca(root, ["repo", "set-base-ref", "--repo", selector, "--ref", base_ref], "set initial base", args.dry_run)
        receipt = orca(root, ["orchestration", "run-create", "--objective", plan["objective"]], "run-create", args.dry_run)
        run_id = find_prefixed(receipt, "run_") or ("run_dry_run" if args.dry_run else None)
        if not run_id:
            raise FleetError("run-create receipt missing run_ ID")
        save_new_json(plan_copy, plan)
        save_new_json(run_receipt_path, receipt)
        state = build_state(plan, run_id, run_dir, selector, base_ref, base_sha, branch)
        save_state(state_path, state)
        dispatched = dispatch_ready(root, cfg, state, state_path, args.dry_run)
        result = {"ok": True, "run_id": run_id, "state": str(state_path), "dispatched_waves": dispatched}
        print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"run {run_id} created; state={state_path}; dispatched={dispatched}")
        return 0


def _do_inbox_locked(root: Path, args: argparse.Namespace) -> int:
    state_path, state = load_state(args.state)
    cmd = ["orchestration", "check"]
    if args.ack:
        cmd += ["--ack", args.ack]
    if args.wait:
        cmd += ["--wait", "--types", args.types, "--timeout-ms", str(args.timeout_ms)]
    if args.peek:
        cmd.append("--peek")
    receipt = orca(root, cmd, "orchestration check")
    evidence = Path(state["run_dir"]) / "evidence" / f"inbox-{timestamp()}.json"
    save_json(evidence, receipt)
    state["last_inbox_at"] = now()
    state["last_inbox_evidence"] = str(evidence)
    save_state(state_path, state)
    print(json.dumps(receipt, ensure_ascii=False, indent=2))
    if not args.json:
        print(f"saved: {evidence}")
    return 0


def do_inbox(root: Path, args: argparse.Namespace) -> int:
    with run_state_lock(args.state.resolve()):
        return _do_inbox_locked(root, args)


def clean_branch(branch: str) -> str:
    for prefix in ("refs/heads/", "refs/remotes/origin/", "origin/"):
        if branch.startswith(prefix):
            return branch[len(prefix):]
    return branch


def acceptance_evidence_path(state: Mapping[str, Any], task_id: str, dispatch_id: str) -> Path:
    safe_dispatch = re.sub(r"[^A-Za-z0-9_.-]+", "-", dispatch_id).strip("-")
    if not safe_dispatch:
        raise FleetError(f"task {task_id} has an invalid Dispatch identity")
    return Path(state["run_dir"]) / "evidence" / f"{task_id}-acceptance-{safe_dispatch}.json"


def _do_accept_locked(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    state_path, state = load_state(args.state)
    if args.task not in state["tasks"]:
        raise FleetError(f"unknown task: {args.task}")
    task = state["tasks"][args.task]
    if task["status"] == "failed":
        raise FleetError(f"failed task {args.task} is immutable; append a fresh replacement task")
    if task["status"] != "dispatched":
        raise FleetError(f"task {args.task} is not awaiting completion: {task['status']}")
    dispatch = task.get("dispatch_id")
    if not isinstance(dispatch, str) or not dispatch:
        raise FleetError(f"task {args.task} has no Dispatch identity")
    evidence_path = acceptance_evidence_path(state, args.task, dispatch)
    if evidence_path.exists():
        raise FleetError(f"acceptance evidence already exists for this Attempt: {evidence_path}")
    branch = args.branch or task.get("branch")
    evidence: dict[str, Any] = {
        "recorded_at": now(), "logical_task_id": args.task, "outcome": args.outcome,
        "orca_task_id": task.get("orca_task_id"), "dispatch_id": dispatch,
        "summary": args.summary, "branch": branch, "provided_sha": args.sha,
    }
    if args.outcome == "succeeded":
        if not branch or not args.sha or not re.fullmatch(r"[0-9a-fA-F]{7,40}", args.sha):
            raise FleetError("successful acceptance requires --branch and valid --sha")
        branch = clean_branch(str(branch))
        run(["git", "fetch", "origin", branch], cwd=root, dry_run=args.dry_run, echo=True)
        remote_sha = args.sha.lower() if args.dry_run else git_sha(root, f"origin/{branch}")
        if not args.dry_run and not remote_sha.startswith(args.sha.lower()):
            raise FleetError(f"provided SHA {args.sha} != remote {remote_sha}")
        files = [] if args.dry_run else changed_files(root, task["base_sha"], remote_sha)
        integration = None
        if task["track"] == "integration" and not args.dry_run:
            wave = next(w for w in state["waves"] if w["id"] == task["wave"])
            dependency_shas = [
                state["tasks"][dep_id].get("head_sha")
                for dep_id in wave["depends_on"]
                if state["tasks"][dep_id].get("head_sha")
            ]
            integration = integration_analysis(
                root, cfg, task["track"], task["base_sha"], remote_sha,
                task["write_paths"], dependency_shas,
            )
            violations = list(integration["violations"])
            subjects = [commit_subject(root, commit) for commit in integration["first_parent_commits"]]
        else:
            violations = scope_violations(cfg, task["track"], files, task["write_paths"])
            subjects = [] if args.dry_run else commit_subjects(root, task["base_sha"], remote_sha)
        if violations:
            raise FleetError("remote scope/integration violation:\n- " + "\n- ".join(str(x) for x in violations))
        expected = f"[{args.task}]"
        invalid = [x for x in subjects if expected not in x]
        if invalid:
            raise FleetError(f"remote authored commits missing {expected}:\n- " + "\n- ".join(invalid))
        task.update({
            "status": "completed", "branch": branch, "head_sha": remote_sha,
            "summary": args.summary, "completed_at": now(),
        })
        evidence.update({
            "remote_sha": remote_sha, "files": files, "commit_subjects": subjects,
            "integration": integration,
        })
    else:
        task.update({"status": "failed", "summary": args.summary, "completed_at": now()})
    action = "worker-retain" if args.retain else "worker-release"
    evidence["settlement"] = settle_worker(root, action, dispatch, args.dry_run)
    save_json(evidence_path, evidence)
    update_waves(state)
    save_state(state_path, state)
    dispatched = dispatch_ready(root, cfg, state, state_path, args.dry_run) if args.advance else []
    result = {"ok": True, "task": args.task, "status": task["status"], "evidence": str(evidence_path), "dispatched_waves": dispatched}
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"accepted {args.task}: {task['status']}; dispatched={dispatched}")
    return 0


def do_accept(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    with run_state_lock(args.state.resolve()):
        return _do_accept_locked(root, cfg, args)


def _do_advance_locked(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    state_path, state = load_state(args.state)
    dispatched = dispatch_ready(root, cfg, state, state_path, args.dry_run)
    result = {"ok": True, "dispatched_waves": dispatched, "state": str(state_path)}
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else (f"dispatched: {dispatched}" if dispatched else "no wave ready"))
    return 0


def do_advance(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    with run_state_lock(args.state.resolve()):
        return _do_advance_locked(root, cfg, args)


def resolution_view(state: Mapping[str, Any], task_id: str) -> dict[str, Any] | None:
    resolutions = state.get("resolutions", {})
    if not isinstance(resolutions, Mapping):
        return None
    resolution = resolutions.get(task_id)
    if not isinstance(resolution, Mapping):
        return None
    relations = [name for name in ("corrected_by", "superseded_by") if name in resolution]
    if len(relations) != 1 or not isinstance(resolution.get(relations[0]), str):
        return {
            "accepted": False,
            "error": "resolution must contain exactly one relationship",
        }
    relation = relations[0]
    replacement_id = str(resolution[relation])
    replacement = state.get("tasks", {}).get(replacement_id)
    replacement_sha = replacement.get("head_sha") if isinstance(replacement, Mapping) else None
    accepted = (
        isinstance(replacement, Mapping)
        and replacement.get("status") == "completed"
        and isinstance(replacement_sha, str)
        and re.fullmatch(r"[0-9a-fA-F]{40}", replacement_sha) is not None
    )
    return {
        "relation": relation,
        "replacement_task": replacement_id,
        "replacement_sha": replacement_sha,
        "accepted": accepted,
        "amendment_id": resolution.get("amendment_id"),
    }


def effective_task_status(state: Mapping[str, Any], task_id: str) -> str:
    task = state["tasks"][task_id]
    if task.get("status") != "failed":
        return str(task.get("status"))
    resolution = resolution_view(state, task_id)
    return "resolved_failure" if resolution and resolution.get("accepted") is True else "unresolved_failure"


def effective_wave_status(state: Mapping[str, Any], wave: Mapping[str, Any]) -> str:
    statuses = [effective_task_status(state, task_id) for task_id in wave["tasks"]]
    if any(status == "unresolved_failure" for status in statuses):
        return "unresolved_failure"
    if statuses and all(status in ("completed", "resolved_failure") for status in statuses):
        return "resolved_failure" if "resolved_failure" in statuses else "completed"
    return str(wave.get("status"))


def status_view(state: Mapping[str, Any]) -> dict[str, Any]:
    view = copy.deepcopy(dict(state))
    unresolved_failures: list[str] = []
    resolved_failures: list[dict[str, Any]] = []
    for task_id, task in view["tasks"].items():
        effective = effective_task_status(state, task_id)
        task["effective_status"] = effective
        resolution = resolution_view(state, task_id)
        if resolution is not None:
            task["resolution"] = resolution
        if effective == "unresolved_failure":
            unresolved_failures.append(task_id)
        elif effective == "resolved_failure":
            resolved_failures.append({"task": task_id, **(resolution or {})})
    for wave in view["waves"]:
        source = next(item for item in state["waves"] if item["id"] == wave["id"])
        wave["effective_status"] = effective_wave_status(state, source)
    unresolved_resolutions = [
        task_id
        for task_id in state.get("resolutions", {})
        if not (resolution_view(state, task_id) or {}).get("accepted")
    ] if isinstance(state.get("resolutions", {}), Mapping) else []
    view["unresolved_failures"] = unresolved_failures
    view["resolved_failures"] = resolved_failures
    view["unresolved_resolutions"] = unresolved_resolutions
    return view


def status_markdown(state: Mapping[str, Any]) -> str:
    view = status_view(state)
    lines = [
        f"# Fleet Run Status — {state['run_id']}", "",
        f"- Objective: {state['objective']}",
        f"- Coordinator branch: `{state.get('coordinator_branch')}`",
        f"- Initial base: `{state['initial_base_ref']}` / `{state['initial_base_sha']}`",
        f"- Created: {state['created_at']}", f"- Updated: {state['updated_at']}", "",
        "## Waves", "", "| Wave | Outcome | Effective | Depends on | Base |", "|---|---|---|---|---|",
    ]
    for wave in view["waves"]:
        base = wave["base"]
        base_text = base.get("value") if base["type"] == "ref" else f"task:{base.get('task')}"
        lines.append(
            f"| {wave['id']} | {wave['status']} | {wave['effective_status']} | "
            f"{', '.join(wave['depends_on']) or '—'} | `{base_text}` |"
        )
    lines += [
        "", "## Tasks", "",
        "| Task | Track | Outcome | Effective | Resolution | Orca Task | Dispatch | Branch | SHA |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for tid, task in view["tasks"].items():
        sha = str(task.get("head_sha") or "—")
        if sha != "—":
            sha = sha[:12]
        resolution = task.get("resolution")
        resolution_text = "—"
        if isinstance(resolution, Mapping) and resolution.get("relation"):
            replacement_sha = str(resolution.get("replacement_sha") or "pending")[:12]
            resolution_text = f"{resolution['relation']}:{resolution['replacement_task']}@{replacement_sha}"
        lines.append(
            f"| {tid} | {task['track']} | {task['status']} | {task['effective_status']} | `{resolution_text}` | "
            f"`{task.get('orca_task_id') or '—'}` | "
            f"`{task.get('dispatch_id') or '—'}` | `{task.get('branch') or '—'}` | `{sha}` |"
        )
    if view["unresolved_failures"]:
        lines += ["", "Unresolved failures: " + ", ".join(view["unresolved_failures"])]
    if view["resolved_failures"]:
        lines += ["", "Resolved failures: " + ", ".join(item["task"] for item in view["resolved_failures"])]
    lines += ["", f"Evidence: `{state['run_dir']}/evidence/`", ""]
    return "\n".join(lines)


def do_status(args: argparse.Namespace) -> int:
    _, state = load_state(args.state)
    print(json.dumps(status_view(state), ensure_ascii=False, indent=2) if args.json else status_markdown(state))
    return 0


def _do_finalize_locked(args: argparse.Namespace) -> int:
    state_path, state = load_state(args.state)
    view = status_view(state)
    unresolved_failures = list(view["unresolved_failures"])
    unresolved_resolutions = list(view["unresolved_resolutions"])
    if unresolved_failures:
        raise FleetError("unresolved failures: " + ", ".join(unresolved_failures))
    if unresolved_resolutions:
        raise FleetError("resolutions without an accepted replacement SHA: " + ", ".join(unresolved_resolutions))
    incomplete = [
        tid
        for tid, task in view["tasks"].items()
        if task["effective_status"] not in ("completed", "resolved_failure")
    ]
    if incomplete and not args.allow_incomplete:
        raise FleetError("incomplete tasks: " + ", ".join(incomplete))
    manifest = {
        "schema_version": 1,
        "generated_at": now(),
        "run_id": state["run_id"],
        "objective": state["objective"],
        "initial_base_ref": state["initial_base_ref"],
        "initial_base_sha": state["initial_base_sha"],
        "coordinator_branch": state.get("coordinator_branch"),
        "tasks": {
            tid: {
                "track": task["track"], "status": task["status"],
                "effective_status": task["effective_status"],
                "orca_task_id": task.get("orca_task_id"), "dispatch_id": task.get("dispatch_id"),
                "base_sha": task.get("base_sha"), "branch": task.get("branch"),
                "head_sha": task.get("head_sha"), "summary": task.get("summary"),
                "completed_at": task.get("completed_at"),
                "resolution": task.get("resolution"),
            }
            for tid, task in view["tasks"].items()
        },
        "integration_candidates": [
            {"task": tid, "branch": task.get("branch"), "sha": task.get("head_sha")}
            for tid, task in state["tasks"].items()
            if task["track"] == "integration" and task["status"] == "completed"
        ],
        "amendments": copy.deepcopy(state.get("amendments", [])),
        "resolved_failures": view["resolved_failures"],
        "unresolved_failures": unresolved_failures,
        "unresolved_resolutions": unresolved_resolutions,
        "incomplete_tasks": incomplete,
        "evidence_directory": str(Path(state["run_dir"]) / "evidence"),
    }
    path = state_path.parent / "RELEASE_MANIFEST.json"
    save_json(path, manifest)
    print(json.dumps(manifest, ensure_ascii=False, indent=2) if args.json else f"release manifest: {path}")
    return 0


def do_finalize(args: argparse.Namespace) -> int:
    with run_state_lock(args.state.resolve()):
        return _do_finalize_locked(args)


def main() -> int:
    args = cli().parse_args()
    try:
        root = git_root()
        cfg = load_config(root, args.config.resolve() if args.config else None)
        if args.cmd == "doctor":
            return do_doctor(root, cfg, args)
        if args.cmd == "validate":
            return do_validate(cfg, args)
        if args.cmd == "start-coordinator":
            return do_start_coordinator(root, cfg, args)
        if args.cmd == "launch":
            return do_launch(root, cfg, args)
        if args.cmd == "amend":
            return do_amend(root, cfg, args)
        if args.cmd == "inbox":
            return do_inbox(root, args)
        if args.cmd == "accept":
            return do_accept(root, cfg, args)
        if args.cmd == "advance":
            return do_advance(root, cfg, args)
        if args.cmd == "status":
            return do_status(args)
        if args.cmd == "finalize":
            return do_finalize(args)
    except FleetError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
