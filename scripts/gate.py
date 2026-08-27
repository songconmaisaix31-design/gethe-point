#!/usr/bin/env python3
"""Machine gate for branch, directory ownership, task scope and checks."""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

sys.dont_write_bytecode = True

from common import (
    FleetError,
    branch_context,
    branch_matches_workspace,
    changed_files,
    commit_subject,
    commit_subjects,
    context_path,
    git_branch,
    git_root,
    git_sha,
    integration_analysis,
    load_config,
    load_context,
    now,
    run_checks,
    save_json,
    scope_violations,
    worktree_identity,
    worktree_files,
)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    init = sub.add_parser("init", help="Bind this worktree to one logical task")
    init.add_argument("--track", required=True)
    init.add_argument("--task", required=True)
    init.add_argument("--base", required=True)
    init.add_argument("--run-id", required=True)
    init.add_argument("--attempt", type=int, required=True)
    init.add_argument("--workspace-name", required=True)
    init.add_argument("--contract-hash", required=True)
    init.add_argument("--write-path", action="append", required=True, dest="write_paths")
    init.add_argument("--check", action="append", default=[], dest="checks")
    init.add_argument("--dependency-sha", action="append", default=[], dest="dependency_shas")
    init.add_argument("--force", action="store_true")

    check = sub.add_parser("check", help="Run scope and optional quality gates")
    check.add_argument("--track")
    check.add_argument("--task")
    check.add_argument("--base")
    check.add_argument("--head", default="HEAD")
    check.add_argument("--branch")
    check.add_argument("--preflight", action="store_true")
    check.add_argument("--pre-commit", action="store_true")
    check.add_argument("--run-checks", action="store_true")
    check.add_argument("--check-commits", action="store_true")
    check.add_argument("--committed-only", action="store_true")
    check.add_argument("--json", action="store_true")

    sub.add_parser("show", help="Print current worktree context")
    sub.add_parser("track", help="Print current track")
    return p


def do_init(args: argparse.Namespace) -> int:
    root = git_root()
    cfg = load_config(root)
    branch = git_branch(root)
    identity = worktree_identity(root)
    policy = cfg.get("execution_policy", {}) if isinstance(cfg.get("execution_policy"), dict) else {}
    if policy.get("delegate_all_tasks") is True and not identity["linked"]:
        raise FleetError("task initialization is forbidden outside a linked child-Agent worktree")
    if not branch_matches_workspace(branch, args.workspace_name):
        raise FleetError(f"current branch {branch} != assigned workspace {args.workspace_name}")
    inferred_track, inferred_task = branch_context(cfg, branch)
    if inferred_track and inferred_track != args.track:
        raise FleetError(f"branch {branch} belongs to {inferred_track}, not {args.track}")
    if args.track not in cfg["tracks"]:
        raise FleetError(f"unknown track: {args.track}")
    if not re.fullmatch(r"[A-Z][A-Z0-9_-]*-\d+", args.task):
        raise FleetError("--task must look like WEB-001")
    if not args.run_id.startswith("run_"):
        raise FleetError("--run-id must be the injected Orca run_... ID")
    if args.attempt < 1:
        raise FleetError("--attempt must be >= 1")
    if not re.fullmatch(r"[0-9a-f]{64}", args.contract_hash):
        raise FleetError("--contract-hash must be a full SHA-256")
    base_sha = git_sha(root, args.base)
    dependency_shas = [git_sha(root, ref) for ref in args.dependency_shas]
    value = {
        "schema_version": 1,
        "track": args.track,
        "logical_task_id": args.task,
        "run_id": args.run_id,
        "attempt": args.attempt,
        "workspace_name": args.workspace_name,
        "contract_hash": args.contract_hash,
        "worktree_mode": str(policy.get("required_worktree_mode") or "new-top-level"),
        "base_sha": base_sha,
        "write_paths": args.write_paths,
        "checks": args.checks,
        "dependency_shas": dependency_shas,
        "branch": branch,
        "worktree": identity,
        "created_at": now(),
    }
    path = context_path(root)
    if path.exists() and not args.force:
        old = json.loads(path.read_text(encoding="utf-8"))
        keys = (
            "track", "logical_task_id", "run_id", "attempt", "workspace_name", "contract_hash",
            "worktree_mode", "base_sha", "write_paths", "checks", "dependency_shas", "branch",
        )
        if any(old.get(k) != value.get(k) for k in keys):
            raise FleetError(f"different task context already exists at {path}; coordinator approval required")
        print(f"context already initialized: {path}")
        return 0
    save_json(path, value)
    print(f"context initialized: track={args.track} task={args.task} base={base_sha}")
    if not inferred_task or inferred_task.upper() != args.task:
        raise FleetError(f"branch task identity {inferred_task or '-'} differs from {args.task}")
    return 0


def resolve(args: argparse.Namespace) -> tuple[Any, str, str | None, str, list[str] | None, str, dict[str, Any]]:
    root = git_root()
    cfg = load_config(root)
    ctx = load_context(root) or {}
    branch = args.branch or git_branch(root)
    inferred_track, inferred_task = branch_context(cfg, branch)
    track = args.track or ctx.get("track") or inferred_track
    if not track:
        raise FleetError(f"cannot infer track from branch {branch}; expected fleet-control-* or trk-<track>-<task>")
    task = args.task or ctx.get("logical_task_id") or (inferred_task.upper() if inferred_task else None)
    base = args.base or ctx.get("base_sha") or cfg.get("base_ref")
    if not base:
        raise FleetError("no base SHA/ref; run gate.py init or pass --base")
    base_sha = git_sha(root, str(base))
    task_allow = ctx.get("write_paths") if isinstance(ctx.get("write_paths"), list) else None
    return (root, track, task, base_sha, task_allow, branch, ctx)


def do_check(args: argparse.Namespace) -> int:
    root, track, task, base_sha, task_allow, branch, ctx = resolve(args)
    cfg = load_config(root)
    policy = cfg.get("execution_policy", {}) if isinstance(cfg.get("execution_policy"), dict) else {}
    if track not in cfg["tracks"]:
        raise FleetError(f"unknown track: {track}")
    identity = worktree_identity(root)
    if policy.get("delegate_all_tasks") is True:
        if not identity["linked"]:
            raise FleetError("all coordinator and Worker work must run in linked worktrees")
        if track != "control":
            if not ctx:
                raise FleetError("Worker worktree is missing its immutable task context")
            if branch != ctx.get("branch") or not branch_matches_workspace(branch, str(ctx.get("workspace_name") or "")):
                raise FleetError("Worker branch/workspace identity changed after Dispatch")
            if not re.fullmatch(r"[0-9a-f]{64}", str(ctx.get("contract_hash") or "")):
                raise FleetError("Worker task contract hash is missing or invalid")
        elif branch_context(cfg, branch)[0] != "control":
            raise FleetError("control writes are only legal in the delegated coordinator worktree")
    if args.preflight and git_sha(root) != base_sha:
        raise FleetError(f"preflight requires HEAD==BASE_SHA; HEAD={git_sha(root)} BASE={base_sha}")

    files = changed_files(
        root,
        base_sha,
        args.head,
        worktree=not args.committed_only and args.head == "HEAD",
    )
    integration: dict[str, Any] | None = None
    if track == "integration":
        dependencies = ctx.get("dependency_shas") if isinstance(ctx.get("dependency_shas"), list) else None
        integration = integration_analysis(
            root,
            cfg,
            track,
            base_sha,
            args.head,
            task_allow,
            dependencies,
            require_all_dependencies=args.check_commits,
        )
        violations = list(integration["violations"])
        if not args.committed_only and args.head == "HEAD":
            current = worktree_files(root)
            violations.extend(scope_violations(cfg, track, current, task_allow))
    else:
        violations = scope_violations(cfg, track, files, task_allow)
    if violations:
        raise FleetError("scope/integration gate failed:\n- " + "\n- ".join(violations))

    subjects: list[str] = []
    if args.check_commits:
        expected = f"[{task}]" if task else None
        if track == "integration" and integration is not None:
            subjects = [commit_subject(root, commit) for commit in integration["first_parent_commits"]]
        else:
            subjects = commit_subjects(root, base_sha, args.head)
        if expected:
            invalid = [s for s in subjects if expected not in s]
            if invalid:
                raise FleetError(f"authored commits missing {expected}:\n- " + "\n- ".join(invalid))

    receipts: list[dict[str, Any]] = []
    if args.run_checks:
        commands = list(cfg["tracks"][track].get("checks", [])) + list(ctx.get("checks", []))
        receipts = run_checks(root, [str(x) for x in commands])
    result = {
        "ok": True,
        "track": track,
        "logical_task_id": task,
        "branch": branch,
        "base_sha": base_sha,
        "head_sha": git_sha(root, args.head),
        "files": files,
        "commit_subjects": subjects,
        "checks": receipts,
        "integration": integration,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"gate passed: track={track} task={task or '-'} files={len(files)} base={base_sha[:12]}")
        if integration:
            print(
                f"  integration merges={len(integration['merge_commits'])} "
                f"authored_commits={len(integration['authored_commits'])}"
            )
        for path in files:
            print(f"  {path}")
    return 0


def main() -> int:
    args = parser().parse_args()
    try:
        if args.cmd == "init":
            return do_init(args)
        if args.cmd == "check":
            return do_check(args)
        root = git_root()
        cfg = load_config(root)
        ctx = load_context(root)
        if args.cmd == "show":
            if not ctx:
                raise FleetError("no task context in this worktree")
            print(json.dumps(ctx, ensure_ascii=False, indent=2))
            return 0
        if args.cmd == "track":
            branch = git_branch(root)
            inferred, _ = branch_context(cfg, branch)
            track = (ctx or {}).get("track") or inferred
            if not track:
                raise FleetError(f"cannot infer track from {branch}")
            print(track)
            return 0
    except FleetError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
