import json
import argparse
import contextlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from common import run as common_run, worktree_identity  # noqa: E402
from fleet import (  # noqa: E402
    build_state,
    context_brief_markdown,
    dispatch_ready,
    do_retry,
    ensure_control_plane_published,
    save_state,
    verify_checks_at_sha,
    workspace_name_for,
)
import worker_finish  # noqa: E402


def git(root: Path, *args: str) -> str:
    cp = subprocess.run(
        ["git", *args], cwd=root, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if cp.returncode:
        raise AssertionError(f"git {' '.join(args)} failed:\n{cp.stderr}\n{cp.stdout}")
    return cp.stdout.strip()


class WorktreeIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        git(self.root, "init", "-b", "main")
        git(self.root, "config", "user.name", "Fleet Test")
        git(self.root, "config", "user.email", "fleet@example.test")
        kit = Path(__file__).resolve().parents[2]
        (self.root / "scripts").mkdir(parents=True, exist_ok=True)
        shutil.copy2(kit / "scripts" / "common.py", self.root / "scripts" / "common.py")
        shutil.copy2(kit / "scripts" / "gate.py", self.root / "scripts" / "gate.py")
        shutil.copy2(kit / "scripts" / "worker_finish.py", self.root / "scripts" / "worker_finish.py")
        (self.root / ".agents").mkdir(parents=True, exist_ok=True)
        shutil.copy2(kit / ".agents" / "fleet.json", self.root / ".agents" / "fleet.json")
        (self.root / "seed.txt").write_text("base\n", encoding="utf-8")
        git(self.root, "add", ".")
        git(self.root, "commit", "-m", "base")
        self.sha = git(self.root, "rev-parse", "HEAD")

    def tearDown(self):
        self.temp.cleanup()

    def test_linked_worktree_is_detected(self):
        linked = self.root.parent / f"{self.root.name}-worker"
        git(self.root, "worktree", "add", "-b", "trk-test-test-001--run-a-a1", str(linked), self.sha)
        try:
            self.assertFalse(worktree_identity(self.root)["linked"])
            identity = worktree_identity(linked)
            self.assertTrue(identity["linked"])
            self.assertEqual(identity["branch"], "trk-test-test-001--run-a-a1")
        finally:
            git(self.root, "worktree", "remove", "--force", str(linked))

    def test_workspace_name_changes_for_every_attempt(self):
        state = {"run_id": "run_abc-123"}
        task = {"track": "care", "id": "CARE-001"}
        first = workspace_name_for(state, task, 1)
        second = workspace_name_for(state, task, 2)
        self.assertNotEqual(first, second)
        self.assertTrue(first.endswith("-a1"))
        self.assertTrue(second.endswith("-a2"))

    def test_retry_uses_a_fresh_worktree_attempt(self):
        kit = Path(__file__).resolve().parents[2]
        cfg = json.loads((kit / ".agents" / "fleet.json").read_text(encoding="utf-8"))
        plan = {
            "objective": "retry isolation",
            "execution": {"completion_task": "CARE-001"},
            "waves": [{
                "id": "care",
                "depends_on": [],
                "base": {"type": "ref", "value": "origin/main"},
                "tasks": [{
                    "id": "CARE-001",
                    "title": "care",
                    "track": "care",
                    "write_paths": ["packages/care/**"],
                    "spec": "implement care",
                    "acceptance": ["done"],
                    "checks": [],
                }],
            }],
        }
        run_dir = Path(self.temp.name) / "run-state"
        state = build_state(plan, cfg, "run_retry", run_dir, "id:dry", "origin/main", "0" * 40, "fleet-control-test")
        state_path = run_dir / "state.json"
        save_state(state_path, state)
        with contextlib.redirect_stdout(io.StringIO()):
            dispatch_ready(kit, cfg, state, state_path, True)
        first = state["tasks"]["CARE-001"]["workspace_name"]
        state["tasks"]["CARE-001"]["status"] = "failed"
        save_state(state_path, state)
        args = argparse.Namespace(
            state=state_path,
            task="CARE-001",
            reason="retry test",
            force=False,
            agent=None,
            model=None,
            effort=None,
            dry_run=True,
            json=True,
        )
        with contextlib.redirect_stdout(io.StringIO()):
            do_retry(kit, cfg, args)
        refreshed = json.loads(state_path.read_text(encoding="utf-8"))
        second = refreshed["tasks"]["CARE-001"]["workspace_name"]
        self.assertNotEqual(first, second)
        self.assertTrue(first.endswith("-a1"))
        self.assertTrue(second.endswith("-a2"))

    def test_gate_binds_task_to_linked_worktree(self):
        branch = "trk-care-care-001--run-test-a1"
        linked = self.root.parent / f"{self.root.name}-care"
        git(self.root, "worktree", "add", "-b", branch, str(linked), self.sha)
        try:
            cp = subprocess.run(
                [
                    sys.executable, "scripts/gate.py", "init",
                    "--track", "care",
                    "--task", "CARE-001",
                    "--base", self.sha,
                    "--run-id", "run_test",
                    "--attempt", "1",
                    "--workspace-name", branch,
                    "--contract-hash", "a" * 64,
                    "--write-path", "packages/care/**",
                ],
                cwd=linked,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(cp.returncode, 0, cp.stderr)
            cp = subprocess.run(
                [sys.executable, "scripts/gate.py", "check", "--preflight"],
                cwd=linked,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(cp.returncode, 0, cp.stderr)
        finally:
            git(self.root, "worktree", "remove", "--force", str(linked))

    def test_gate_rejects_main_worktree(self):
        cp = subprocess.run(
            [
                sys.executable, "scripts/gate.py", "init",
                "--track", "care",
                "--task", "CARE-001",
                "--base", self.sha,
                "--run-id", "run_test",
                "--attempt", "1",
                "--workspace-name", "main",
                "--contract-hash", "a" * 64,
                "--write-path", "packages/care/**",
            ],
            cwd=self.root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertNotEqual(cp.returncode, 0)
        self.assertIn("linked child-Agent worktree", cp.stderr)

    def test_release_checks_run_in_detached_worktree(self):
        receipts = verify_checks_at_sha(
            self.root,
            self.sha,
            ["python -c \"from pathlib import Path; assert Path('seed.txt').read_text() == 'base\\n'\""],
        )
        self.assertEqual(receipts[0]["returncode"], 0)
        self.assertEqual(git(self.root, "worktree", "list", "--porcelain").count("worktree "), 1)

    def test_control_plane_must_be_published_and_clean(self):
        kit = Path(__file__).resolve().parents[2]
        paths = [
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
        for rel in paths:
            target = self.root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(kit / rel, target)
        git(self.root, "add", ".")
        git(self.root, "commit", "-m", "publish control plane")
        published = git(self.root, "rev-parse", "HEAD")
        ensure_control_plane_published(self.root, published)
        (self.root / "AGENTS.md").write_text("drift\n", encoding="utf-8")
        with self.assertRaisesRegex(Exception, "dirty"):
            ensure_control_plane_published(self.root, published)

    def test_worker_finish_emits_structured_identity_proof(self):
        bare = self.root.parent / f"{self.root.name}-remote.git"
        subprocess.run(["git", "init", "--bare", str(bare)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        git(self.root, "remote", "add", "origin", str(bare))
        git(self.root, "push", "-u", "origin", "main")

        branch = "trk-care-care-001--run-test-a1"
        linked = self.root.parent / f"{self.root.name}-finish"
        git(self.root, "worktree", "add", "-b", branch, str(linked), self.sha)
        try:
            init = [
                sys.executable, "scripts/gate.py", "init",
                "--track", "care",
                "--task", "CARE-001",
                "--base", self.sha,
                "--run-id", "run_test",
                "--attempt", "1",
                "--workspace-name", branch,
                "--contract-hash", "b" * 64,
                "--write-path", "packages/care/**",
            ]
            cp = subprocess.run(init, cwd=linked, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertEqual(cp.returncode, 0, cp.stderr)
            target = linked / "packages" / "care" / "done.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("done\n", encoding="utf-8")
            git(linked, "add", "packages/care/done.txt")
            git(linked, "commit", "-m", "feat(care): complete [CARE-001]")
            git(linked, "push", "-u", "origin", "HEAD")

            sent: list[str] = []

            def run_with_fake_orca(command, **kwargs):
                if command and command[0] == "orca":
                    sent.extend(command[1:])
                    return subprocess.CompletedProcess(command, 0, json.dumps({"ok": True, "message_id": "msg_test"}), "")
                return common_run(command, **kwargs)

            finish_args = argparse.Namespace(
                logical_task="CARE-001",
                task_id="task_test",
                dispatch_id="dispatch_test",
                base=self.sha,
                outcome="succeeded",
                summary="care implementation complete",
                risks="none",
                allow_empty=False,
                no_run_checks=False,
                json=False,
            )
            with contextlib.chdir(linked), mock.patch.object(worker_finish, "run", side_effect=run_with_fake_orca):
                with contextlib.redirect_stdout(io.StringIO()):
                    returncode = worker_finish.finish(finish_args)
            self.assertEqual(returncode, 0)
            args = sent
            body = json.loads(args[args.index("--body") + 1])
            self.assertEqual(body["attempt"], 1)
            self.assertEqual(body["workspace_name"], branch)
            self.assertEqual(body["contract_hash"], "b" * 64)
            self.assertEqual(body["dispatch_id"], "dispatch_test")
            self.assertEqual(len(body["proof_hash"]), 64)
            self.assertTrue(body["worktree"]["linked"])
        finally:
            git(self.root, "worktree", "remove", "--force", str(linked))
            shutil.rmtree(bare, ignore_errors=True)

    def test_context_brief_omits_task_specification(self):
        state = {
            "run_id": "run_test",
            "objective": "objective",
            "completion_task": "INT-001",
            "updated_at": "now",
            "run_dir": ".agents/runs/test",
            "tasks": {
                "A-001": {
                    "track": "care",
                    "status": "dispatched",
                    "attempt": 1,
                    "workspace_name": "trk-care-a-001--test-a1",
                    "dispatch_id": "dispatch_1",
                    "spec": "VERY LARGE SECRET IMPLEMENTATION CONTEXT",
                }
            },
        }
        brief = context_brief_markdown(state)
        self.assertIn("trk-care-a-001--test-a1", brief)
        self.assertNotIn("VERY LARGE SECRET", brief)


if __name__ == "__main__":
    unittest.main()
