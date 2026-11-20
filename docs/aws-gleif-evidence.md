# AWS account evidence and UK supplier identity

## AWS

Each connection monitors one commercial AWS account and one supported region. London is the default. An administrator can add another account or region under the same workspace. Collection uses the AWS SDK and short-lived STS sessions.

1. In the AWS broker account, register the OIDC issuer that Vercel shows for this team. Configure the broker role to trust that issuer through `sts:AssumeRoleWithWebIdentity`. Match the exact audience and subject for the authorised team, project and environment. An operator can allow a separate staging identity for an approved sandbox.
2. Grant the broker `sts:AssumeRole` on the specific onboarded customer role ARNs. Set `REGPILOT_AWS_BROKER_ROLE_ARN` and enable `REGPILOT_AWS_ENABLED` in the chosen environment. The workspace and its evidence worker also need their usual connector configuration.
3. The workspace owner selects AWS in Operations → Connections, enters the account and region, and downloads the CloudFormation template. The customer's AWS administrator reviews and installs it using named IAM capability. Each role trusts the explicit broker with an external ID derived from the immutable workspace ID. RegPilot checks that the role rejects omitted and incorrect external IDs, then verifies the accepted caller's exact account and role.
4. Select a responsible control, enable collection and choose **Verify live connection now**. RegPilot reads account-level S3 Block Public Access and the regional CloudTrail inventory, trail status and event selectors. The template grants those four read permissions. It does not grant access to stored objects or log contents.

The results include separate checks for logging, management reads and writes, and log-file validation. One combined finding requires all three on the same trail. A delivery check also requires that the same trail delivered log files and integrity digests to S3 within 24 hours, with no reported delivery errors. This is a RegPilot evidence window. An old or absent timestamp leaves recent delivery unresolved. The collector examines up to ten visible trails, including organisation and multi-region trails where permitted. Results identify the coverage boundary and preserve unknowns. A reviewer can use the AWS console to investigate exceptions.

[Workload identity on Vercel](https://vercel.com/docs/oidc/aws) · [Third-party AWS roles and external IDs](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html) · [Regional CloudTrail status fields](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_GetTrailStatus.html)

## GLEIF

Enable `REGPILOT_GLEIF_ENABLED` with the normal workspace connector settings. GLEIF uses public data and requires no customer credential.

1. In Operations → Connections, select GLEIF and enter the full Companies House number, including leading zeros. Choose **Find matching LEIs**. Select the registered legal entity or enter a known LEI. The search checks up to 25 results and flags additional pages.
2. Collection verifies the LEI check digits, record identity, UK jurisdiction, registered number and GLEIF registration authority. It records the legal name, entity status, registration status and next renewal. The three supported authorities are Companies House for England and Wales, Northern Ireland and Scotland.
3. From the supplier's review, link the saved register connection and confirm the legal entity. A subsequent lapse, change or failed collection makes the previous review stale. The worker records an investigation for the supplier owner and preserves the accepted review. A supplier may have no LEI. Credit, sanctions and trading permissions each require additional evidence.

The live contract in GitHub Actions exercises both discovery and exact record retrieval for HSBC Bank plc and NatWest Group plc. It verifies identity separately from whether each reported indicator currently passes.

[GLEIF API](https://www.gleif.org/en/lei-data/gleif-api) · [GLEIF registration authorities](https://www.gleif.org/en/lei-data/code-lists/gleif-registration-authorities-list)
