"""Print a fresh ChatGPT (Codex OAuth) access token from Hermes' auth store as JSON.

Run with Hermes' bundled python. Hermes refreshes the token when it is close to
expiry and writes the rotated pair back, so this never hands out a stale token.
Output: {"access_token": ..., "headers": {"ChatGPT-Account-ID": ..., ...}}
"""
import json
import os
import sys

sys.path.insert(0, os.path.expanduser(os.environ.get("HERMES_AGENT_DIR", "~/.hermes/hermes-agent")))
sys._hermes_pin_default_home = True
import hermes_bootstrap  # noqa: E402,F401
os.environ.setdefault("HERMES_HOME", os.path.expanduser("~/.hermes"))

from hermes_cli.auth_codex import resolve_codex_runtime_credentials  # noqa: E402
from agent.codex_headers import codex_account_headers  # noqa: E402

creds = resolve_codex_runtime_credentials()
token = creds["api_key"]
print(json.dumps({"access_token": token, "headers": codex_account_headers(token)}))
