PLAN ?= .agents/plans/current.json
OBJECTIVE ?= 按 current.json 完成《都记得》MVP，并生成严格完成证明

.PHONY: fleet-doctor fleet-validate fleet-test fleet-start fleet-gate fleet-status fleet-dry-run

fleet-doctor:
	python scripts/fleet.py doctor --plan $(PLAN)

fleet-validate:
	python scripts/fleet.py validate $(PLAN)

fleet-test:
	python -B -m unittest discover -s scripts/tests -v

fleet-start:
	python scripts/start_fleet.py --plan $(PLAN) --objective "$(OBJECTIVE)"

fleet-gate:
	python scripts/gate.py check --run-checks

fleet-status:
	@echo "Usage: python scripts/fleet.py status --state .agents/runs/<RUN>/state.json"

fleet-dry-run:
	python scripts/fleet.py launch $(PLAN) --dry-run
