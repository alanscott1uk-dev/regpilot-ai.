package regpilot.control

# One assessment covers every enabled connection mapped to the selected control.
# Multiple healthy connections to the same provider count as one source type.
healthy_providers := {s.provider | some s in input.observations; s.status == "OBSERVED"}
failed := {s.connectorId | some s in input.observations; s.status == "FAILED"}
unknown := {s.connectorId | some s in input.observations; s.status == "UNKNOWN"}

state := "FINDINGS" if count(failed) > 0
else := "INSUFFICIENT_EVIDENCE" if input.limited
else := "INSUFFICIENT_EVIDENCE" if count(input.observations) == 0
else := "INSUFFICIENT_EVIDENCE" if count(unknown) > 0
else := "BELOW_TARGET" if count(healthy_providers) < input.minimumProviders
else := "MEETS_TARGET"

decision := {
 "state": state,
 "providers": sort(healthy_providers),
 "failingConnections": sort(failed),
 "unverifiedConnections": sort(unknown),
}
