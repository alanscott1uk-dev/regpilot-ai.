import argparse
import importlib.util
from decimal import Decimal
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
                 stream="release_gate",namespace="quality",field="approved",pointer=None,minimum=None,maximum=None,expected="true",control=str(uuid4()),output=folder/"receipt")
        self.args.plan.write_text(json.dumps({"format":"regpilot-airbyte-manifest-v1","plans":[self.plan]}))
        self.args.config.write_text('{"password":"local-fixture-secret"}')

    def collect(self, rows, incomplete=False):
        def emit(image, network, config, command, callback, catalog=None, decimal_records=False):
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

    def test_nested_numeric_limits_preserve_decimal_precision(self):
        self.args.field=None
        self.args.pointer="/sensor~1A/readings/0/value"
        self.args.minimum,self.args.maximum,self.args.expected="2","8",None
        def row(value):
            return {"sensor/A":{"readings":[{"value":value}]}}
        result=self.collect([row(2),row(8),row(Decimal("8.00000000000000001")),row("7"),row(True),row(None),{}])
        self.assertEqual(result["counts"],{"matched":2,"different":1,"invalid":2,"missing":2})
        self.assertEqual(result["status"],"FAIL")
        self.args.output.unlink()
        self.assertEqual(self.collect([row(Decimal("2.01")),row("5")])["status"],"UNKNOWN")

    def test_range_and_selector_validation(self):
        for bounds in [("NaN","9"),("10","1"),(None,"8")]:
            with self.assertRaises(bridge.CollectionError):
                bridge.numeric_bounds(*bounds)
        with self.assertRaises(bridge.CollectionError):
            bridge.rule_path(None,"/bad~3key")

    def test_interrupted_read_does_not_publish_a_partial_pass(self):
        with self.assertRaises(bridge.CollectionError):
            self.collect([{"approved":True}],incomplete=True)
        self.assertFalse(self.args.output.exists())

    def configure_findings(self):
        self.args.resource_pointer = "/id"
        self.args.instance = "quality-test"
        self.args.track = ['3']

    def test_resource_evidence_recovers_only_on_positive_identified_read(self):
        self.configure_findings()
        keys = []
        series = []
        for rows, expected in [([{"id":3,"approved":False}],"FAIL"),
                               ([{"id":4,"approved":True}],"UNKNOWN"),
                               ([{"id":3,"approved":True}],"PASS")]:
            self.assertEqual(self.collect(rows)["status"], expected)
            body = json.loads(self.args.output.read_text())["body"]
            tracked = next(c for c in body["checks"] if c["label"] == "Resource 3")
            self.assertEqual(tracked["status"], expected)
            keys.append(tracked["key"])
            series.append(body["externalId"].rsplit("/", 1)[0])
            self.args.output.unlink()
        self.assertEqual(len(set(keys)), 1)
        self.assertEqual(len(set(series)), 1)
        self.args.instance = "other-site"
        self.collect([{"id":3,"approved":True}])
        self.assertNotEqual(json.loads(self.args.output.read_text())["body"]["externalId"].rsplit("/",1)[0],series[0])

    def test_resource_limit_is_visible_and_ids_are_type_sensitive(self):
        self.configure_findings()
        rows = [{"id":n,"approved":True} for n in range(35)] + [{"id":"3","approved":False}]
        self.collect(rows)
        checks = json.loads(self.args.output.read_text())["body"]["checks"]
        self.assertEqual(len(checks), 20)
        self.assertEqual(json.loads(checks[3]["observed"])["omitted"], 20)
        self.assertEqual([c["label"] for c in checks if c["key"].startswith("item-") and c["status"]=="FAIL"], ['Resource "3"'])
        self.assertEqual(checks[4]["status"], "PASS")

    def test_duplicate_or_missing_identity_stays_unknown(self):
        self.configure_findings()
        self.assertEqual(self.collect([{"id":3,"approved":True},{"id":3,"approved":True},{"approved":True}])["status"],"UNKNOWN")
        checks = json.loads(self.args.output.read_text())["body"]["checks"]
        self.assertEqual([c["status"] for c in checks if c["label"]=="Resource 3"], ["UNKNOWN"])
        self.assertEqual(json.loads(checks[3]["observed"])["unidentifiedRows"], 1)

    def test_saved_definition_binds_source_version_and_runs_resource_rule(self):
        self.args.test_definition = self.args.output.parent / "test.json"
        self.args.test_definition.write_text(json.dumps({"format":"regpilot-source-test-v1",
            "definitionId":self.definition,"version":"3.8.11","name":"Release approval",
            "control":self.args.control,"stream":"release_gate","namespace":"quality","pointer":"/approved",
            "expected":"true","instance":"quality-test","resourcePointer":"/id"}))
        self.args.stream = self.args.namespace = self.args.field = self.args.expected = self.args.control = None
        self.assertEqual(self.collect([{"id":3,"approved":False}])["status"], "FAIL")
        self.assertIn("Release approval", json.loads(self.args.output.read_text())["body"]["summary"])
        self.args.output.unlink()
        changed = json.loads(self.args.test_definition.read_text())
        changed["version"] = "4.0.0"
        self.args.test_definition.write_text(json.dumps(changed))
        with self.assertRaisesRegex(bridge.CollectionError, "source and version"):
            self.collect([])
        self.assertFalse(self.args.output.exists())

    def test_decimal_equality_does_not_round_distinct_values_or_accept_booleans(self):
        self.args.expected = "1.00000000000000001"
        result = self.collect([{"approved":Decimal("1.00000000000000001")},{"approved":1},{"approved":True}])
        self.assertEqual(result["counts"], {"matched":1,"different":2,"missing":0})

    def test_digest_and_manifest_definition_are_bound(self):
        with patch.object(bridge.subprocess,"run") as docker, self.assertRaises(bridge.CollectionError):
            bridge.pin_image(self.plan,"sha256:"+"b"*64)
        docker.assert_not_called()
        self.args.source=str(uuid4())
        with self.assertRaises(bridge.CollectionError):
            self.collect([])


if __name__ == "__main__":
    unittest.main()
