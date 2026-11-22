import argparse
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4


spec = importlib.util.spec_from_file_location("database_bridge", "public/database-bridge/collect.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class DatabaseBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        folder = Path(self.temp.name)
        self.definition = str(uuid4())
        self.digest = "sha256:" + "a" * 64
        self.plan = {"format":"regpilot-airbyte-source-v1", "definitionId":self.definition,
                     "image":"airbyte/source-postgres", "version":"3.8.11", "artifactDigest":self.digest}
        self.args = argparse.Namespace(plan=folder/"plan",source=self.definition,digest=self.digest,
                 network="source-network",config=folder/"config", check_access=False,list_streams=False,
                 stream="release_gate",namespace="quality",field="approved",expected="true",control=str(uuid4()),output=folder/"receipt")
        self.args.plan.write_text(json.dumps({"format":"regpilot-airbyte-manifest-v1","plans":[self.plan]}))
        self.args.config.write_text('{"password":"local-fixture-secret"}')

    def collect(self, rows, incomplete=False):
        def emit(image, network, config, command, callback, catalog=None):
            if command == "discover":
                callback({"type":"CATALOG","catalog":{"streams":[{"name":"release_gate","namespace":"quality",
                          "supported_sync_modes":["full_refresh"],"json_schema":{"properties":{"approved":{}}}}]}})
            else:
                for row in rows:
                    callback({"type":"RECORD","record":{"data":row,"stream":"release_gate","namespace":"quality"}})
                if incomplete:
                    raise bridge.CollectionError("incomplete")
        with patch.object(bridge,"pin_image",return_value="airbyte/source-postgres@"+self.digest), patch.object(bridge,"protocol",side_effect=emit):
            return bridge.run(self.args)

    def test_empty_and_missing_evidence(self):
        self.assertEqual(self.collect([])["status"],"UNKNOWN")
        self.args.output.unlink()
        self.assertEqual(self.collect([{"other":True}])["counts"]["missing"],1)

    def test_json_boolean_and_number_differ_and_raw_rows_stay_local(self):
        result=self.collect([{"approved":True,"notes":"private test note"},{"approved":1}])
        self.assertEqual(result["status"],"FAIL")
        self.assertEqual(result["counts"],{"matched":1,"different":1,"missing":0})
        receipt=self.args.output.read_text()
        self.assertNotIn("private test note",receipt)
        self.assertNotIn("local-fixture-secret",receipt)
        with self.assertRaises(FileExistsError):
            self.collect([])
        self.assertEqual(self.args.output.read_text(),receipt)

    def test_interrupted_read_does_not_publish_a_partial_pass(self):
        with self.assertRaises(bridge.CollectionError):
            self.collect([{"approved":True}],incomplete=True)
        self.assertFalse(self.args.output.exists())

    def test_digest_and_manifest_definition_are_bound(self):
        with patch.object(bridge.subprocess,"run") as docker, self.assertRaises(bridge.CollectionError):
            bridge.pin_image(self.plan,"sha256:"+"b"*64)
        docker.assert_not_called()
        self.args.source=str(uuid4())
        with self.assertRaises(bridge.CollectionError):
            self.collect([])


if __name__ == "__main__":
    unittest.main()
