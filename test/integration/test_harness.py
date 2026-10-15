"""Regressions in redaction, correlation and recovery, without a live fixture."""
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import Mock
from client import Http, RequestFailure
from harness import Harness


class HarnessSafetyTests(unittest.TestCase):
    def test_http_error_with_empty_database_password_keeps_diagnostic_and_redacts_key(self):
        client=Http(["", "synthetic-secret-at-least-32-characters"])
        error=urllib.error.HTTPError("https://demo.invalid",500,"failed",{},
            io.BytesIO(json.dumps({"message":"No item to return was found synthetic-secret-at-least-32-characters"}).encode()))
        client.opener=Mock();client.opener.open.side_effect=error
        with self.assertRaises(RequestFailure) as caught:client.call("POST","https://demo.invalid",{})
        self.assertIn("No item to return was found",str(caught.exception))
        self.assertNotIn("synthetic-secret",str(caught.exception))

    def test_ledger_collects_generated_direct_and_agent_observation_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            h=Harness.__new__(Harness);h.path=Path(folder)/"state.private.json"
            h.state={"commands":[]}
            h.collect_commands({"intermediateSteps":[{"observation":json.dumps({"_ldo":{"command_id":"actual-direct-id"}})}]})
            h.collect_commands({"_ldo":{"command_id":"actual-direct-id"}})
            self.assertEqual(h.state["commands"],["actual-direct-id"])
            self.assertEqual(json.loads(h.path.read_text())["commands"],["actual-direct-id"])
            self.assertEqual(h.path.stat().st_mode & 0o777,0o600)

    def test_cleanup_reads_owned_queue_with_public_api_cursor(self):
        with tempfile.TemporaryDirectory() as folder:
            h=Harness.__new__(Harness);h.path=Path(folder)/"state.private.json";h.pool=Mock()
            h.state={"commands":[],"tables":["owned-table"],"workflows":[],"credentials":[]}
            h.n8n=Mock()
            def api(method,path):
                if method=="DELETE":return {}
                if "cursor=" not in path:
                    self.assertEqual(path,"/data-tables/owned-table/rows?limit=100")
                    return {"data":[{"kind":"command","command_id":"first"}],"nextCursor":"abc+="}
                self.assertEqual(path,"/data-tables/owned-table/rows?limit=100&cursor=abc%2B%3D")
                return {"data":[{"kind":"command","command_id":"second"}],"nextCursor":None}
            h.n8n.api.side_effect=api
            h.cleanup()
            self.assertEqual(h.state["commands"],["first","second"])
            self.assertTrue(h.state["cleaned"])

    def test_completed_recovery_does_not_overwrite_later_user_settings(self):
        h=Harness.__new__(Harness);h.state={"cleaned":True};h.bridge=Mock();h.n8n=Mock();h.pool=Mock()
        h.cleanup()
        h.bridge.fixture.assert_not_called();h.n8n.api.assert_not_called()
        h.pool.shutdown.assert_called_once_with(wait=True)


if __name__=="__main__":unittest.main()
