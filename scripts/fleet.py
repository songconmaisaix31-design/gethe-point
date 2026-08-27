#!/usr/bin/env python3
"""Directory-owned multi-agent control plane built on Orca CLI."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping

sys.dont_write_bytecode = True

from common import (
    FleetError,
    branch_context,
    branch_matches_workspace,
    canonical_hash,
    changed_files,
    command_exists,
    commit_subject,
    commit_subjects,
    find_branch,
    find_key,
    find_prefixed,
    git_branch,
    git_out,
    git_root,
    git_sha,
    integration_analysis,
    is_ancestor,
    load_config,
    load_json,
    now,
    parse_json,
    run,
    run_checks,
    save_json,
    scope_violations,
    slug,
    timestamp,
    validate_plan,
    walk,
    worktree_identity,
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
    c.add_argument("--objective")
    c.add_argument("--plan", type=Path, default=Path(".agents/plans/current.json"))
    c.add_argument("--agent")
    c.add_argument("--setup", choices=("run", "skip", "inherit"))
    c.add_argument("--name")
    c.add_argument("--dry-run", action="store_true")
    c.add_argument("--json", action="store_true")

    l = sub.add_parser("launch")
    l.add_argument("plan", type=Path)
    l.add_argument("--dry-run", action="store_true")
    l.add_argument("--json", action="store_true")

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
    a.add_argument("--dispatch-id")
    a.add_argument("--contract-hash")
    a.add_argument("--workspace-name")
    a.add_argument("--attempt", type=int)
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

    retry = sub.add_parser("retry")
    retry.add_argument("--state", type=Path, required=True)
    retry.add_argument("--task", required=True)
    retry.add_argument("--reason", required=True)
    retry.add_argument("--force", action="store_true", help="replace a still-dispatched/stalled worker")
    retry.add_argument("--agent")
    retry.add_argument("--model")
    retry.add_argument("--effort")
    retry.add_argument("--dry-run", action="store_true")
    retry.add_argument("--json", action="store_true")

    s = sub.add_parser("status")
    s.add_argument("--state", type=Path, required=True)
    s.add_argument("--json", action="store_true")

    brief = sub.add_parser("brief")
    brief.add_argument("--state", type=Path, required=True)
    brief.add_argument("--json", action="store_true")

    f = sub.add_parser("finalize")
    f.add_argument("--state", type=Path, required=True)
    f.add_argument("--allow-incomplete", action="store_true")
    f.add_argument("--json", action="store_true")
    return p


def orca(root: Path, args: list[str], label: str, dry_run: bool = False) -> dict[str, Any]:
    cmd = ["orca", *args]
    if "--json" not in cmd:
        cmd.append("--json")
    cp = run(cmd, cwd=root, dry_run=dry_run, echo=True)
    if dry_run:
        return {"ok": True, "dry_run": True, "command": cmd}
    value = parse_json(cp.stdout, label)
    if not isinstance(value, dict):
        raise FleetError(f"{label} must return a JSON object")
    if value.get("ok") is False:
        raise FleetError(f"{label} failed: {json.dumps(value, ensure_ascii=False)}")
    return value


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


def fetch(root: Path, cfg: Mapping[str, Any], dry_run: bool = False) -> None:
    if cfg.get("fetch_before_launch", True):
        run(["git", "fetch", "--prune", "origin"], cwd=root, dry_run=dry_run, echo=True)


def resolve_sha(root: Path, ref: str, dry_run: bool = False) -> str:
    return "0" * 40 if dry_run else git_sha(root, ref)


CONTROL_PLANE_PATHS = [
    ".agents/fleet.json",
    ".agents/plans/current.json",
    ".agents/plans/DEVELOPMENT_PLAN.md",
    ".agents/prompts/coordinator.md",
    ".agents/prompts/worker.md",
    ".agents/prompts/integrator.md",
    ".agents/decisions/0001-mvp-engineering-freeze.md",
    ".agents/decisions/0002-worktree-isolation-completion.md",
    "docs/product/PRD.md",
    "docs/operations/WORKTREE_EXECUTION.md",
    "scripts/common.py",
    "scripts/fleet.py",
    "scripts/gate.py",
    "scripts/worker_finish.py",
    "scripts/start_fleet.py",
    "AGENTS.md",
    "PRINCIPLES.md",
]


def ensure_control_plane_published(root: Path, base_ref: str) -> None:
    dirty = git_out(root, "status", "--porcelain", check=False)
    if dirty:
        raise FleetError(
            "host workspace is dirty; commit or stash all changes before delegating the Run\n" + dirty[:2000]
        )
    missing: list[str] = []
    for path in CONTROL_PLANE_PATHS:
        cp = run(["git", "cat-file", "-e", f"{base_ref}:{path}"], cwd=root, check=False)
        if cp.returncode:
            missing.append(path)
    if missing:
        raise FleetError(
            f"base {base_ref} does not contain the control plane; commit and push:\n- " + "\n- ".join(missing)
        )
    diff = run(["git", "diff", "--quiet", base_ref, "--", *CONTROL_PLANE_PATHS], cwd=root, check=False)
    if diff.returncode:
        raise FleetError(
            f"working control plane differs from {base_ref}; commit and push it before starting child Agents"
        )


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


def do_start_coordinator(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    plan_path = args.plan.resolve()
    try:
        plan_rel = plan_path.relative_to(root)
    except ValueError as exc:
        raise FleetError("coordinator plan must be inside the repository") from exc
    plan = load_json(plan_path)
    plan_errors = validate_plan(plan, cfg)
    if plan_errors:
        raise FleetError("plan errors:\n- " + "\n- ".join(plan_errors))
    if plan.get("launch_authorized") is not True:
        raise FleetError("plan launch is disabled; review the shared base and set launch_authorized=true explicitly")
    objective = (args.objective or str(plan.get("objective") or "")).strip()
    if not objective:
        raise FleetError("objective is empty and the plan has no objective")
    defaults = cfg.get("coordinator", {})
    agent = args.agent or defaults.get("agent") or "codex"
    setup = args.setup or defaults.get("setup") or "run"
    prefix = defaults.get("worktree_prefix") or "fleet-control"
    name = args.name or f"{prefix}-{slug(objective, 24)}-{timestamp().lower()}"
    if not name.startswith("fleet-control"):
        raise FleetError("coordinator worktree name must start with fleet-control")
    selector = repo_selector(root, cfg, args.dry_run)
    fetch(root, cfg, args.dry_run)
    base_ref = str(cfg.get("base_ref", "origin/main"))
    if not args.dry_run:
        ensure_control_plane_published(root, base_ref)
    orca(root, ["repo", "set-base-ref", "--repo", selector, "--ref", base_ref], "set base ref", args.dry_run)
    prompt = (root / ".agents" / "prompts" / "coordinator.md").read_text(encoding="utf-8")
    prompt += (
        "\n\n# Current objective\n\n" + objective +
        f"\n\nRepository: `{root}`\nInitial base ref: `{base_ref}`\n" +
        f"Executable plan: `{plan_rel.as_posix()}`\n\n" +
        "You are already a delegated coordinator child Agent in a dedicated linked worktree. "
        "The user's/main Agent must remain a thin launcher and must not absorb implementation context.\n\n"
        "Immediately execute the following control loop without doing any product implementation yourself:\n\n"
        "```bash\n"
        f"python scripts/fleet.py doctor --plan {plan_rel.as_posix()}\n"
        f"python scripts/fleet.py validate {plan_rel.as_posix()}\n"
        f"python scripts/fleet.py launch {plan_rel.as_posix()}\n"
        "```\n\n"
        "After launch, keep this same coordinator session alive until strict finalize succeeds. "
        "Use only structured inbox messages, state.json, CONTEXT_BRIEF.md, decisions and machine evidence. "
        "Never read or paste full Worker transcripts into your context. Every implementation, repair, test, "
        "integration and release task must run in a fresh child-Agent worktree. On failure or stall, use "
        "`fleet.py retry`; never repair code in the coordinator worktree.\n"
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
    result = {
        "ok": True,
        "name": name,
        "agent": agent,
        "repo_selector": selector,
        "plan": plan_rel.as_posix(),
        "objective": objective,
        "execution_mode": "child-agents-only",
        "receipt": receipt,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"coordinator started: {name} ({agent})")
    return 0


def build_state(
    plan: Mapping[str, Any],
    cfg: Mapping[str, Any],
    run_id: str,
    run_dir: Path,
    selector: str,
    base_ref: str,
    base_sha: str,
    branch: str,
) -> dict[str, Any]:
    policy = cfg.get("execution_policy", {}) if isinstance(cfg.get("execution_policy"), dict) else {}
    required_mode = str(policy.get("required_worktree_mode") or "new-top-level")
    max_attempts = int(policy.get("max_attempts_per_task") or 3)
    execution = plan.get("execution") if isinstance(plan.get("execution"), dict) else {}
    tasks: dict[str, Any] = {}
    waves: list[dict[str, Any]] = []
    for wave in plan["waves"]:
        ids = []
        for task in wave["tasks"]:
            tid = task["id"]
            ids.append(tid)
            tasks[tid] = {
                **task,
                "wave": wave["id"],
                "status": "planned",
                "attempt": 0,
                "max_attempts": max_attempts,
                "attempt_history": [],
                "workspace_name": None,
                "worktree_mode": required_mode,
                "worktree_id": None,
                "worktree_path": None,
                "contract_hash": None,
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
        "execution": execution,
        "completion_task": execution.get("completion_task") or policy.get("completion_task"),
        "execution_policy": {
            "delegate_all_tasks": bool(policy.get("delegate_all_tasks")),
            "required_worktree_mode": required_mode,
            "unique_worktree_per_attempt": bool(policy.get("unique_worktree_per_attempt")),
            "strict_completion": bool(policy.get("strict_completion")),
            "max_attempts_per_task": max_attempts,
        },
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


def workspace_name_for(state: Mapping[str, Any], task: Mapping[str, Any], attempt: int) -> str:
    token = slug(str(state["run_id"]).removeprefix("run_"), 12)
    return f"trk-{task['track']}-{str(task['id']).lower()}--{token}-a{attempt}"


def task_contract(task: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": task["id"],
        "wave": task["wave"],
        "track": task["track"],
        "title": task["title"],
        "spec": task["spec"],
        "acceptance": list(task.get("acceptance", [])),
        "write_paths": list(task.get("write_paths", [])),
        "checks": list(task.get("checks", [])),
        "base_ref": task.get("base_ref"),
        "base_sha": task.get("base_sha"),
        "attempt": task.get("attempt"),
        "workspace_name": task.get("workspace_name"),
        "worktree_mode": task.get("worktree_mode"),
    }


def archive_attempt(task: dict[str, Any], *, outcome: str, reason: str | None = None) -> None:
    if not task.get("attempt"):
        return
    history = task.setdefault("attempt_history", [])
    marker = (task.get("attempt"), task.get("dispatch_id"))
    if any((x.get("attempt"), x.get("dispatch_id")) == marker for x in history if isinstance(x, dict)):
        return
    history.append({
        "attempt": task.get("attempt"),
        "outcome": outcome,
        "reason": reason,
        "workspace_name": task.get("workspace_name"),
        "worktree_mode": task.get("worktree_mode"),
        "worktree_id": task.get("worktree_id"),
        "worktree_path": task.get("worktree_path"),
        "orca_task_id": task.get("orca_task_id"),
        "dispatch_id": task.get("dispatch_id"),
        "branch": task.get("branch"),
        "base_ref": task.get("base_ref"),
        "base_sha": task.get("base_sha"),
        "head_sha": task.get("head_sha"),
        "contract_hash": task.get("contract_hash"),
        "dispatched_at": task.get("dispatched_at"),
        "completed_at": task.get("completed_at"),
        "summary": task.get("summary"),
    })


def load_state(path: Path) -> tuple[Path, dict[str, Any]]:
    path = path.resolve()
    state = load_json(path)
    if not isinstance(state, dict) or state.get("schema_version") != 1:
        raise FleetError(f"invalid state file: {path}")
    return path, state


def save_state(path: Path, state: dict[str, Any]) -> None:
    state["updated_at"] = now()
    save_json(path, state)
    (path.parent / "STATUS.md").write_text(status_markdown(state), encoding="utf-8")
    (path.parent / "CONTEXT_BRIEF.md").write_text(context_brief_markdown(state), encoding="utf-8")


def wave_ready(wave: Mapping[str, Any], state: Mapping[str, Any]) -> bool:
    return all(state["tasks"][x]["status"] == "completed" for x in wave["depends_on"])


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
        f"--run-id {state['run_id']}",
        f"--attempt {task['attempt']}",
        f"--workspace-name {quote_arg(str(task['workspace_name']))}",
        f"--contract-hash {task['contract_hash']}",
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
        f"Attempt: {task['attempt']} / {task['max_attempts']}",
        f"Required worktree mode: {task['worktree_mode']}",
        f"Expected dedicated workspace/branch: {task['workspace_name']}",
        f"Task contract hash: {task['contract_hash']}", "",
        "## Isolation contract", "",
        "- You are a child Agent. The coordinator/main Agent must not implement any part of this task.",
        "- This Dispatch owns exactly one linked Git worktree, one branch and one mutable context.",
        "- Never reuse another task's worktree or ask the coordinator to patch product code.",
        "- A repair is a new attempt in a new worktree; do not resurrect a released/failed workspace.", "",
        "## Specification", "", str(task["spec"]), "",
        "## Acceptance", "", *[f"- {x}" for x in task.get("acceptance", [])], "",
        "## Exact write paths", "", *[f"- `{x}`" for x in task.get("write_paths", [])], "",
        "## Required checks", "", *([f"- `{x}`" for x in task.get("checks", [])] or ["- Track checks only"]), "",
        "## Dependency evidence", "", *(deps or ["- None"]), "",
        "## Mandatory first commands", "", "```bash", " \\\n  ".join(init),
        "python scripts/gate.py check --preflight", "```", "",
        "The Orca worker preamble contains the actual task_... and dispatch_... IDs. Use those exact IDs in worker_finish.py.",
        "When reporting completion, include the exact attempt, workspace name and contract hash from this prompt.",
        "", "---", "", contract,
    ]
    return "\n".join(lines)


def dispatch_wave(root: Path, cfg: Mapping[str, Any], state: dict[str, Any], wave: dict[str, Any], state_path: Path, dry_run: bool) -> None:
    planned = [state["tasks"][tid] for tid in wave["tasks"] if state["tasks"][tid]["status"] == "planned"]
    if not planned:
        return
    if not wave_ready(wave, state):
        return
    base_ref, base_sha = resolve_wave_base(root, state, wave, dry_run)
    selector = state["repo_selector"]
    orca(root, ["repo", "set-base-ref", "--repo", selector, "--ref", base_ref], f"set base for {wave['id']}", dry_run)
    evidence = Path(state["run_dir"]) / "evidence"
    defaults = cfg.get("worker_defaults", {})
    policy = cfg.get("execution_policy", {}) if isinstance(cfg.get("execution_policy"), dict) else {}
    required_mode = str(policy.get("required_worktree_mode") or "new-top-level")

    for task in planned:
        tid = task["id"]
        next_attempt = int(task.get("attempt") or 0) + 1
        max_attempts = int(task.get("max_attempts") or policy.get("max_attempts_per_task") or 3)
        if next_attempt > max_attempts:
            task["status"] = "exhausted"
            task["summary"] = f"maximum attempts exhausted ({max_attempts})"
            save_state(state_path, state)
            raise FleetError(f"task {tid} exhausted {max_attempts} isolated attempts")

        requested_mode = task.get("worktree_mode") or defaults.get("worktree_mode") or required_mode
        if requested_mode != required_mode:
            raise FleetError(f"task {tid}: worktree mode override forbidden; required {required_mode}")

        task["attempt"] = next_attempt
        task["base_ref"], task["base_sha"] = base_ref, base_sha
        task["worktree_mode"] = required_mode
        task["workspace_name"] = workspace_name_for(state, task, next_attempt)
        task["worktree_id"] = None
        task["worktree_path"] = None
        task["branch"] = None
        task["head_sha"] = None
        task["summary"] = None
        task["completed_at"] = None
        task["contract_hash"] = canonical_hash(task_contract(task))

        workspace = str(task["workspace_name"])
        for other_id, other in state["tasks"].items():
            if other_id != tid and other.get("workspace_name") == workspace:
                raise FleetError(f"duplicate workspace name: {workspace}")
            for attempt in other.get("attempt_history", []):
                if isinstance(attempt, dict) and attempt.get("workspace_name") == workspace:
                    raise FleetError(f"workspace name was already used by {other_id}: {workspace}")

        task["status"] = "starting"
        save_state(state_path, state)
        create = orca(
            root,
            ["orchestration", "task-create", "--task-title", f"[{tid}] {task['title']}", "--spec", render_spec(root, cfg, state, task)],
            f"create task {tid}",
            dry_run,
        )
        task_id = find_prefixed(create, "task_") or (f"task_dry_{tid.lower()}_a{next_attempt}" if dry_run else None)
        if not task_id:
            task["status"] = "failed"
            task["summary"] = "task-create receipt missing task ID"
            save_state(state_path, state)
            raise FleetError(f"task-create receipt missing task_ ID for {tid}")
        task["orca_task_id"] = task_id
        save_json(evidence / f"{tid}-a{next_attempt}-task-create.json", create)
        save_state(state_path, state)

        agent = task.get("agent") or defaults.get("agent") or "codex"
        setup = task.get("setup") or defaults.get("setup") or "run"
        cmd = [
            "orchestration", "worker-start", "--task", task_id,
            "--worktree", required_mode, "--repo", selector, "--name", workspace,
            "--agent", str(agent), "--setup", str(setup),
        ]
        if task.get("model"):
            cmd += ["--model", str(task["model"])]
            if task.get("effort"):
                cmd += ["--effort", str(task["effort"])]
        elif task.get("effort"):
            raise FleetError(f"task {tid}: effort requires model")

        try:
            started = orca(root, cmd, f"start worker {tid} attempt {next_attempt}", dry_run)
        except FleetError as exc:
            task["status"] = "failed"
            task["summary"] = f"worker-start failed: {exc}"
            archive_attempt(task, outcome="launch_failed", reason=str(exc))
            save_state(state_path, state)
            raise

        dispatch = find_prefixed(started, "dispatch_") or (f"dispatch_dry_{tid.lower()}_a{next_attempt}" if dry_run else None)
        if not dispatch:
            task["status"] = "failed"
            task["summary"] = "worker-start receipt missing dispatch ID"
            archive_attempt(task, outcome="launch_failed", reason=task["summary"])
            save_state(state_path, state)
            raise FleetError(f"worker-start receipt missing dispatch_ ID for {tid}")

        returned_branch = find_branch(started)
        if dry_run and not returned_branch:
            returned_branch = workspace
        if not returned_branch:
            task["status"] = "failed"
            task["summary"] = "worker-start receipt missing branch identity"
            archive_attempt(task, outcome="launch_failed", reason=task["summary"])
            save_state(state_path, state)
            raise FleetError(f"worker-start receipt missing branch for {tid}; cannot prove worktree isolation")
        branch = clean_branch(returned_branch)
        if not branch_matches_workspace(branch, workspace):
            task["status"] = "failed"
            task["summary"] = f"worker branch {branch} != expected dedicated workspace {workspace}"
            archive_attempt(task, outcome="launch_failed", reason=task["summary"])
            save_state(state_path, state)
            raise FleetError(task["summary"])
        inferred_track, inferred_task = branch_context(cfg, branch)
        if inferred_track != task["track"] or (inferred_task or "").upper() != tid:
            task["status"] = "failed"
            task["summary"] = f"worker branch identity does not match task: {branch}"
            archive_attempt(task, outcome="launch_failed", reason=task["summary"])
            save_state(state_path, state)
            raise FleetError(task["summary"])

        worktree_path = find_key(started, {"worktreePath", "worktree_path", "workspacePath", "workspace_path", "path"})
        task["dispatch_id"] = dispatch
        task["branch"] = branch
        task["worktree_id"] = find_prefixed(started, "worktree_")
        task["worktree_path"] = worktree_path if isinstance(worktree_path, str) else None
        task["status"] = "dispatched"
        task["dispatched_at"] = now()
        save_json(evidence / f"{tid}-a{next_attempt}-worker-start.json", started)
        save_state(state_path, state)

    wave["status"] = "dispatched"
    wave["dispatched_at"] = wave.get("dispatched_at") or now()
    save_state(state_path, state)

def update_waves(state: dict[str, Any]) -> None:
    for wave in state["waves"]:
        statuses = [state["tasks"][x]["status"] for x in wave["tasks"]]
        if all(x == "completed" for x in statuses):
            wave["status"] = "completed"
            wave["completed_at"] = wave.get("completed_at") or now()
        elif any(x in ("failed", "exhausted") for x in statuses):
            wave["status"] = "failed"
        elif any(x in ("starting", "dispatched") for x in statuses):
            wave["status"] = "dispatched"
        elif any(state["tasks"][x]["status"] in ("failed", "exhausted") for x in wave["depends_on"]):
            wave["status"] = "blocked"
        else:
            wave["status"] = "planned"


def dispatch_ready(root: Path, cfg: Mapping[str, Any], state: dict[str, Any], state_path: Path, dry_run: bool) -> list[str]:
    update_waves(state)
    sent: list[str] = []
    for wave in state["waves"]:
        planned_before = sum(state["tasks"][tid]["status"] == "planned" for tid in wave["tasks"])
        if planned_before and wave_ready(wave, state):
            dispatch_wave(root, cfg, state, wave, state_path, dry_run)
            sent.append(wave["id"])
    save_state(state_path, state)
    return sent


def do_launch(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    plan = load_json(args.plan.resolve())
    errors = validate_plan(plan, cfg)
    if errors:
        raise FleetError("plan errors:\n- " + "\n- ".join(errors))
    if plan.get("launch_authorized") is not True:
        raise FleetError("plan launch is disabled; review the shared base and set launch_authorized=true explicitly")
    branch = git_branch(root)
    if not args.dry_run and branch_context(cfg, branch)[0] != "control":
        raise FleetError(f"launch must run in fleet-control worktree, not {branch}")
    if not args.dry_run:
        identity = worktree_identity(root)
        if not identity["linked"]:
            raise FleetError("launch must run from the dedicated linked coordinator worktree")
    selector = repo_selector(root, cfg, args.dry_run)
    fetch(root, cfg, args.dry_run)
    base_ref = str(plan.get("base_ref") or cfg.get("base_ref") or "origin/main")
    base_sha = resolve_sha(root, base_ref, args.dry_run)
    orca(root, ["repo", "set-base-ref", "--repo", selector, "--ref", base_ref], "set initial base", args.dry_run)
    receipt = orca(root, ["orchestration", "run-create", "--objective", plan["objective"]], "run-create", args.dry_run)
    run_id = find_prefixed(receipt, "run_") or ("run_dry_run" if args.dry_run else None)
    if not run_id:
        raise FleetError("run-create receipt missing run_ ID")
    run_dir = root / ".agents" / "runs" / f"{timestamp()}-{slug(plan['objective'])}"
    run_dir.mkdir(parents=True, exist_ok=True)
    save_json(run_dir / "plan.json", plan)
    save_json(run_dir / "evidence" / "run-create.json", receipt)
    state = build_state(plan, cfg, run_id, run_dir, selector, base_ref, base_sha, branch)
    state_path = run_dir / "state.json"
    save_state(state_path, state)
    dispatched = dispatch_ready(root, cfg, state, state_path, args.dry_run)
    result = {"ok": True, "run_id": run_id, "state": str(state_path), "dispatched_waves": dispatched}
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"run {run_id} created; state={state_path}; dispatched={dispatched}")
    return 0


def do_inbox(root: Path, args: argparse.Namespace) -> int:
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


def clean_branch(branch: str) -> str:
    for prefix in ("refs/heads/", "refs/remotes/origin/", "origin/"):
        if branch.startswith(prefix):
            return branch[len(prefix):]
    return branch


def do_accept(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    state_path, state = load_state(args.state)
    if args.task not in state["tasks"]:
        raise FleetError(f"unknown task: {args.task}")
    task = state["tasks"][args.task]
    if task["status"] != "dispatched":
        raise FleetError(f"task {args.task} is not awaiting a Worker result: {task['status']}")

    policy = cfg.get("execution_policy", {}) if isinstance(cfg.get("execution_policy"), dict) else {}
    strict_identity = policy.get("strict_worker_identity", True)
    if strict_identity:
        required = {
            "--dispatch-id": args.dispatch_id,
            "--contract-hash": args.contract_hash,
            "--workspace-name": args.workspace_name,
            "--attempt": args.attempt,
        }
        missing = [name for name, value in required.items() if value is None or value == ""]
        if missing:
            raise FleetError("strict acceptance requires " + ", ".join(missing))
        if args.dispatch_id != task.get("dispatch_id"):
            raise FleetError(f"dispatch identity mismatch: {args.dispatch_id} != {task.get('dispatch_id')}")
        if args.contract_hash != task.get("contract_hash"):
            raise FleetError("task contract hash mismatch")
        if args.workspace_name != task.get("workspace_name"):
            raise FleetError("workspace identity mismatch")
        if args.attempt != task.get("attempt"):
            raise FleetError(f"attempt mismatch: {args.attempt} != {task.get('attempt')}")

    branch = args.branch
    if not branch:
        raise FleetError("acceptance requires --branch from the structured worker_done payload")
    branch = clean_branch(str(branch))
    if branch != task.get("branch") or not branch_matches_workspace(branch, str(task.get("workspace_name") or "")):
        raise FleetError(f"branch {branch} is not the task's dedicated worktree branch")
    inferred_track, inferred_task = branch_context(cfg, branch)
    if inferred_track != task["track"] or (inferred_task or "").upper() != args.task:
        raise FleetError(f"branch identity does not match logical task: {branch}")

    evidence: dict[str, Any] = {
        "recorded_at": now(),
        "logical_task_id": args.task,
        "attempt": task.get("attempt"),
        "outcome": args.outcome,
        "summary": args.summary,
        "dispatch_id": args.dispatch_id,
        "contract_hash": args.contract_hash,
        "workspace_name": args.workspace_name,
        "worktree_mode": task.get("worktree_mode"),
        "branch": branch,
        "provided_sha": args.sha,
    }

    if args.outcome == "succeeded":
        sha_pattern = r"[0-9a-fA-F]{40}" if strict_identity else r"[0-9a-fA-F]{7,40}"
        if not args.sha or not re.fullmatch(sha_pattern, args.sha):
            raise FleetError("successful strict acceptance requires the full 40-character remote SHA")
        run(["git", "fetch", "origin", branch], cwd=root, dry_run=args.dry_run, echo=True)
        remote_sha = args.sha.lower() if args.dry_run else git_sha(root, f"origin/{branch}")
        if not args.dry_run and remote_sha != args.sha.lower():
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
            "status": "completed",
            "branch": branch,
            "head_sha": remote_sha,
            "summary": args.summary,
            "completed_at": now(),
        })
        archive_attempt(task, outcome="completed")
        evidence.update({
            "remote_sha": remote_sha,
            "files": files,
            "commit_subjects": subjects,
            "integration": integration,
        })
    else:
        task.update({"status": "failed", "summary": args.summary, "completed_at": now()})
        archive_attempt(task, outcome="failed", reason=args.summary)

    dispatch = task.get("dispatch_id")
    if dispatch:
        action = "worker-retain" if args.retain else "worker-release"
        evidence["settlement"] = orca(root, ["orchestration", action, "--dispatch", dispatch], action, args.dry_run)
    evidence_path = Path(state["run_dir"]) / "evidence" / f"{args.task}-a{task.get('attempt')}-accepted.json"
    save_json(evidence_path, evidence)
    update_waves(state)
    save_state(state_path, state)
    dispatched = dispatch_ready(root, cfg, state, state_path, args.dry_run) if args.advance else []
    result = {
        "ok": True,
        "task": args.task,
        "attempt": task.get("attempt"),
        "status": task["status"],
        "evidence": str(evidence_path),
        "dispatched_waves": dispatched,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"accepted {args.task} attempt {task.get('attempt')}: {task['status']}; dispatched={dispatched}")
    return 0


def do_retry(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    state_path, state = load_state(args.state)
    if args.task not in state["tasks"]:
        raise FleetError(f"unknown task: {args.task}")
    task = state["tasks"][args.task]
    allowed = {"failed", "exhausted"}
    if args.force:
        allowed.update({"starting", "dispatched"})
    if task["status"] not in allowed:
        raise FleetError(
            f"task {args.task} cannot be retried from {task['status']}; "
            "use --force only for a genuinely stalled active Dispatch"
        )

    max_attempts = int(task.get("max_attempts") or 3)
    if int(task.get("attempt") or 0) >= max_attempts:
        raise FleetError(f"task {args.task} exhausted the configured {max_attempts} attempts")

    settlement = None
    if args.force and task.get("dispatch_id") and task["status"] in ("starting", "dispatched"):
        settlement = orca(
            root,
            ["orchestration", "worker-release", "--dispatch", str(task["dispatch_id"])],
            "release stalled worker",
            args.dry_run,
        )
        archive_attempt(task, outcome="replaced", reason=args.reason)
    elif task["status"] in ("failed", "exhausted"):
        archive_attempt(task, outcome="failed", reason=args.reason)

    previous = {
        "attempt": task.get("attempt"),
        "dispatch_id": task.get("dispatch_id"),
        "workspace_name": task.get("workspace_name"),
        "branch": task.get("branch"),
        "status": task.get("status"),
    }
    task.update({
        "status": "planned",
        "workspace_name": None,
        "worktree_id": None,
        "worktree_path": None,
        "contract_hash": None,
        "orca_task_id": None,
        "dispatch_id": None,
        "branch": None,
        "head_sha": None,
        "summary": f"retry requested: {args.reason}",
        "dispatched_at": None,
        "completed_at": None,
    })
    if args.agent:
        task["agent"] = args.agent
    if args.model:
        task["model"] = args.model
    if args.effort:
        task["effort"] = args.effort
    elif args.model is None and "effort" in task and not task.get("model"):
        task.pop("effort", None)

    evidence_path = Path(state["run_dir"]) / "evidence" / f"{args.task}-retry-after-a{previous['attempt']}.json"
    save_json(evidence_path, {
        "recorded_at": now(),
        "logical_task_id": args.task,
        "reason": args.reason,
        "previous": previous,
        "settlement": settlement,
        "next_attempt": int(task.get("attempt") or 0) + 1,
        "agent": task.get("agent"),
        "model": task.get("model"),
        "effort": task.get("effort"),
    })
    update_waves(state)
    save_state(state_path, state)
    dispatched = dispatch_ready(root, cfg, state, state_path, args.dry_run)
    result = {
        "ok": True,
        "task": args.task,
        "previous_attempt": previous["attempt"],
        "next_attempt": task.get("attempt"),
        "workspace_name": task.get("workspace_name"),
        "status": task.get("status"),
        "evidence": str(evidence_path),
        "dispatched_waves": dispatched,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else (
        f"retried {args.task}: attempt {task.get('attempt')} in {task.get('workspace_name')}"
    ))
    return 0

def do_advance(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    state_path, state = load_state(args.state)
    dispatched = dispatch_ready(root, cfg, state, state_path, args.dry_run)
    result = {"ok": True, "dispatched_waves": dispatched, "state": str(state_path)}
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else (f"dispatched: {dispatched}" if dispatched else "no wave ready"))
    return 0


def context_brief_markdown(state: Mapping[str, Any]) -> str:
    tasks = state["tasks"]
    counts: dict[str, int] = {}
    for task in tasks.values():
        status = str(task.get("status"))
        counts[status] = counts.get(status, 0) + 1
    lines = [
        f"# Coordinator Context Brief — {state['run_id']}", "",
        f"- Objective: {state['objective']}",
        f"- Completion task: `{state.get('completion_task') or '—'}`",
        f"- Updated: {state.get('updated_at')}",
        "- Execution: every plan task is delegated to a fresh child-Agent linked worktree; coordinator is control-only.",
        "- Status counts: " + ", ".join(f"{key}={value}" for key, value in sorted(counts.items())), "",
        "## Active child worktrees", "",
        "| Task | Status | Attempt | Workspace | Dispatch |",
        "|---|---|---:|---|---|",
    ]
    active = False
    for tid, task in tasks.items():
        if task.get("status") in ("starting", "dispatched", "failed", "exhausted"):
            active = True
            lines.append(
                f"| {tid} | {task.get('status')} | {task.get('attempt') or 0} | "
                f"`{task.get('workspace_name') or '—'}` | `{task.get('dispatch_id') or '—'}` |"
            )
    if not active:
        lines.append("| — | none | — | — | — |")

    lines += ["", "## Next control actions", ""]
    actions: list[str] = []
    for tid, task in tasks.items():
        if task.get("status") in ("failed", "exhausted"):
            actions.append(
                f"- Repair `{tid}` only via a new worktree: `python scripts/fleet.py retry --state <STATE> "
                f"--task {tid} --reason \"<root cause and correction>\"`."
            )
    if any(task.get("status") in ("starting", "dispatched") for task in tasks.values()):
        actions.append("- Wait for structured `worker_done`, `question`, or `escalation`; do not inspect full Worker transcripts.")
    if any(task.get("status") == "planned" for task in tasks.values()):
        actions.append("- After accepting dependencies, run `fleet.py advance`; only ready tasks will receive fresh worktrees.")
    if tasks and all(task.get("status") == "completed" for task in tasks.values()):
        actions.append("- Run strict `fleet.py finalize`; it re-fetches the release branch, proves ancestry, and reruns release checks in a detached verification worktree.")
    lines += actions or ["- No action recorded."]
    lines += ["", "Do not paste source code or Worker transcripts into the coordinator context. Use state, machine evidence, decisions and concise handoffs only.", ""]
    return "\n".join(lines)


def status_markdown(state: Mapping[str, Any]) -> str:
    lines = [
        f"# Fleet Run Status — {state['run_id']}", "",
        f"- Objective: {state['objective']}",
        f"- Coordinator branch: `{state.get('coordinator_branch')}`",
        f"- Initial base: `{state['initial_base_ref']}` / `{state['initial_base_sha']}`",
        f"- Created: {state['created_at']}", f"- Updated: {state['updated_at']}", "",
        "## Waves", "", "| Wave | Status | Depends on | Base |", "|---|---|---|---|",
    ]
    for wave in state["waves"]:
        base = wave["base"]
        base_text = base.get("value") if base["type"] == "ref" else f"task:{base.get('task')}"
        lines.append(f"| {wave['id']} | {wave['status']} | {', '.join(wave['depends_on']) or '—'} | `{base_text}` |")
    lines += ["", "## Tasks", "", "| Task | Track | Status | Attempt | Worktree mode | Orca Task | Dispatch | Branch | SHA |", "|---|---|---|---:|---|---|---|---|---|"]
    for tid, task in state["tasks"].items():
        sha = str(task.get("head_sha") or "—")
        if sha != "—": sha = sha[:12]
        lines.append(
            f"| {tid} | {task['track']} | {task['status']} | {task.get('attempt') or 0} | "
            f"`{task.get('worktree_mode') or '—'}` | `{task.get('orca_task_id') or '—'}` | "
            f"`{task.get('dispatch_id') or '—'}` | `{task.get('branch') or '—'}` | `{sha}` |"
        )
    lines += ["", f"Evidence: `{state['run_dir']}/evidence/`", ""]
    return "\n".join(lines)


def do_status(args: argparse.Namespace) -> int:
    _, state = load_state(args.state)
    print(json.dumps(state, ensure_ascii=False, indent=2) if args.json else status_markdown(state))
    return 0


def do_brief(args: argparse.Namespace) -> int:
    _, state = load_state(args.state)
    if args.json:
        compact = {
            "run_id": state["run_id"],
            "objective": state["objective"],
            "completion_task": state.get("completion_task"),
            "tasks": {
                tid: {
                    "track": task.get("track"),
                    "status": task.get("status"),
                    "attempt": task.get("attempt"),
                    "workspace_name": task.get("workspace_name"),
                    "dispatch_id": task.get("dispatch_id"),
                    "branch": task.get("branch"),
                    "head_sha": task.get("head_sha"),
                    "summary": task.get("summary"),
                }
                for tid, task in state["tasks"].items()
            },
        }
        print(json.dumps(compact, ensure_ascii=False, indent=2))
    else:
        print(context_brief_markdown(state))
    return 0


def verify_checks_at_sha(root: Path, sha: str, commands: list[str]) -> list[dict[str, Any]]:
    if not commands:
        raise FleetError("strict completion requires non-empty release verification checks")
    parent = Path(tempfile.mkdtemp(prefix="fleet-release-verify-"))
    worktree = parent / "candidate"
    added = False
    try:
        run(["git", "worktree", "add", "--detach", str(worktree), sha], cwd=root, echo=True)
        added = True
        return run_checks(worktree, commands)
    finally:
        if added:
            run(["git", "worktree", "remove", "--force", str(worktree)], cwd=root, check=False, echo=True)
        shutil.rmtree(parent, ignore_errors=True)
        run(["git", "worktree", "prune"], cwd=root, check=False)


def do_finalize(root: Path, cfg: Mapping[str, Any], args: argparse.Namespace) -> int:
    state_path, state = load_state(args.state)
    policy = cfg.get("execution_policy", {}) if isinstance(cfg.get("execution_policy"), dict) else {}
    strict = bool(policy.get("strict_completion", True))
    incomplete = [tid for tid, task in state["tasks"].items() if task["status"] != "completed"]
    if args.allow_incomplete and strict:
        raise FleetError("--allow-incomplete is disabled by strict_completion")
    if incomplete and not args.allow_incomplete:
        raise FleetError("incomplete tasks: " + ", ".join(incomplete))
    if incomplete:
        raise FleetError("a release manifest cannot be produced from incomplete delegated work")

    completion_task_id = state.get("completion_task") or policy.get("completion_task")
    if not completion_task_id or completion_task_id not in state["tasks"]:
        raise FleetError("completion task is missing from Run state")
    completion_task = state["tasks"][completion_task_id]
    if completion_task.get("status") != "completed" or completion_task.get("track") != "integration":
        raise FleetError("completion task must be a completed integration task")
    branch = clean_branch(str(completion_task.get("branch") or ""))
    final_sha = str(completion_task.get("head_sha") or "")
    if not branch or not re.fullmatch(r"[0-9a-f]{40}", final_sha):
        raise FleetError("completion task lacks a full remote branch/SHA proof")
    if not branch_matches_workspace(branch, str(completion_task.get("workspace_name") or "")):
        raise FleetError("completion branch is not its dedicated worktree branch")

    run(["git", "fetch", "origin", branch], cwd=root, echo=True)
    remote_sha = git_sha(root, f"origin/{branch}")
    if remote_sha != final_sha:
        raise FleetError(f"release branch drifted: recorded={final_sha}, remote={remote_sha}")

    ancestry: dict[str, bool] = {}
    for tid, task in state["tasks"].items():
        sha = str(task.get("head_sha") or "")
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise FleetError(f"task {tid} lacks a full verified SHA")
        included = is_ancestor(root, sha, final_sha)
        ancestry[tid] = included
        if not included:
            raise FleetError(f"release candidate does not contain accepted task {tid}@{sha}")

    wave = next(w for w in state["waves"] if w["id"] == completion_task["wave"])
    dependency_shas = [
        state["tasks"][dep_id]["head_sha"]
        for dep_id in wave["depends_on"]
    ]
    integration = integration_analysis(
        root,
        cfg,
        "integration",
        completion_task["base_sha"],
        final_sha,
        completion_task["write_paths"],
        dependency_shas,
    )
    if integration["violations"]:
        raise FleetError("final integration proof failed:\n- " + "\n- ".join(integration["violations"]))

    commands: list[str] = []
    for command in list(cfg["tracks"]["integration"].get("checks", [])) + list(completion_task.get("checks", [])):
        text = str(command)
        if text and text not in commands:
            commands.append(text)
    check_receipts = verify_checks_at_sha(root, final_sha, commands)

    proof = {
        "schema_version": 1,
        "verified_at": now(),
        "run_id": state["run_id"],
        "completion_task": completion_task_id,
        "branch": branch,
        "remote_sha": remote_sha,
        "all_tasks_are_ancestors": ancestry,
        "integration": integration,
        "checks": check_receipts,
    }
    proof["proof_hash"] = canonical_hash(proof)
    proof_path = Path(state["run_dir"]) / "evidence" / "FINAL_COMPLETION_PROOF.json"
    save_json(proof_path, proof)

    manifest = {
        "schema_version": 2,
        "generated_at": now(),
        "verified": True,
        "completion_proof": str(proof_path),
        "completion_proof_hash": proof["proof_hash"],
        "run_id": state["run_id"],
        "objective": state["objective"],
        "initial_base_ref": state["initial_base_ref"],
        "initial_base_sha": state["initial_base_sha"],
        "coordinator_branch": state.get("coordinator_branch"),
        "execution_mode": "child-agents-only",
        "completion_task": completion_task_id,
        "release_branch": branch,
        "release_sha": final_sha,
        "tasks": {
            tid: {
                "track": task["track"],
                "status": task["status"],
                "attempt": task.get("attempt"),
                "attempt_history": task.get("attempt_history", []),
                "orca_task_id": task.get("orca_task_id"),
                "dispatch_id": task.get("dispatch_id"),
                "worktree_mode": task.get("worktree_mode"),
                "workspace_name": task.get("workspace_name"),
                "contract_hash": task.get("contract_hash"),
                "base_sha": task.get("base_sha"),
                "branch": task.get("branch"),
                "head_sha": task.get("head_sha"),
                "summary": task.get("summary"),
                "completed_at": task.get("completed_at"),
            }
            for tid, task in state["tasks"].items()
        },
        "incomplete_tasks": [],
        "evidence_directory": str(Path(state["run_dir"]) / "evidence"),
    }
    path = state_path.parent / "RELEASE_MANIFEST.json"
    save_json(path, manifest)
    state["status"] = "completed"
    state["finalized_at"] = now()
    state["release_manifest"] = str(path)
    state["release_sha"] = final_sha
    state["completion_proof_hash"] = proof["proof_hash"]
    save_state(state_path, state)
    print(json.dumps(manifest, ensure_ascii=False, indent=2) if args.json else (
        f"verified release manifest: {path}\nrelease: {branch}@{final_sha}\nproof: {proof_path}"
    ))
    return 0

def main() -> int:
    args = cli().parse_args()
    try:
        root = git_root()
        cfg = load_config(root, args.config.resolve() if args.config else None)
        if args.cmd == "doctor": return do_doctor(root, cfg, args)
        if args.cmd == "validate": return do_validate(cfg, args)
        if args.cmd == "start-coordinator": return do_start_coordinator(root, cfg, args)
        if args.cmd == "launch": return do_launch(root, cfg, args)
        if args.cmd == "inbox": return do_inbox(root, args)
        if args.cmd == "accept": return do_accept(root, cfg, args)
        if args.cmd == "retry": return do_retry(root, cfg, args)
        if args.cmd == "advance": return do_advance(root, cfg, args)
        if args.cmd == "status": return do_status(args)
        if args.cmd == "brief": return do_brief(args)
        if args.cmd == "finalize": return do_finalize(root, cfg, args)
    except FleetError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
