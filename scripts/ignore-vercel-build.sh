#!/bin/sh
# Git automatic deployment remains disabled for the development branch.
# Permit only the recorded staging release commits on the development branch.
if [ "$VERCEL_GIT_COMMIT_REF" = "feature/traceability-benchmark-batch-20261106" ]; then
  if [ "$VERCEL_ENV" = "preview" ]; then
    case "$(git log -1 --format='%s|%P')" in
      'Release custom monitoring tests and resource findings to staging|21f0f9f96a2c09358a0a271b17689de660aaae1d'|'Release competitive gap improvements to RegPilot staging|eea0b63108246ccf2b68bcef68b99cb4d1fa00b0'|'Release the verified questionnaire handoff to RegPilot staging|27c50df9a9591763b29bf072ada23c17f420ab2f'|'Release monitored sync diagnostics, audit and pharma assessment tools to staging|260f232918364794076111952f66d719516c776e'|'Release expanded monitoring, site evidence and UK legislation coverage to staging|687732167b7b28e985a655e5908e19b4bf261184'|'Release printable qualification evidence and verified legislation publishing to staging|6520fd8ca9c44bce980e90663c1beb08560f23e7'|'Release source-verified territorial application to RegPilot staging|856960cf51f70dce5026f5f668509a304ca0c04b'|'Release database recovery, excursion inspection and comparative audit evidence to staging|2140798aff1f0f0e5f30b49913bcf1c4bae2339c'|'Release twelve source-linked audit programmes and joint evidence search to staging|af12c5f61c56f937ffea56027aacfe5288a42166'|'Release timed database monitoring and recovery receipts for all seven engines to staging|997aac8b4894efbfd748b6b3abb52e735e29fb97'|'Bind index coverage and scheduled evidence to the deployed release|040107a6b9b6f5fce2e099c4624ea73b482dd5c8'|'Deliver customer monitoring recovery, signed cold-chain inspection packs and buyer-first questionnaires|798edbf3b285472ba0bf89704341fac5c57f101d'|'Release a combined SOC 2 and ISO audit plan and verify EMA publications|a27a9088b5f4a2ddc59b507d3e58404db675dd55'|'Verify medicines-only alert routing against independent MHRA category indexes|e4d3ac6fc5b84c9294ee1a0991cb60b5bdc64aec'|'Retain buyer questionnaire transfers across mobile navigation and sign-in|7a4692398f85c44b331960aeededf869a9b8cf0d'|'Verify hosted account renewal and resume customer control monitoring|bccb25bd9776935eaf68eea64c238e5e479e3407') exit 1 ;;
      'Add authenticated alert monitoring, excursion histories and audit evidence filters|9606e78720c9aa317295899af93195e2ed834816') exit 1 ;;
      'Publish scoped hosted recovery evidence and reject superseded renewals|e47246fec69fccc8a7f809937bcab0dec4a1261a') exit 1 ;;
      'Recover slow live publication reads and verify the resulting workspace follow-up|6611019b6b97a3fcefb0324172c17359a072a4a8') exit 1 ;;
      'Add buyer-scoped SOC 2 categories to the combined ISO audit programme|af7c0a4d374afa7ffa9c40cfc6f0e3eaaacd48e6') exit 1 ;;
      'Release calibrated T&D excursions and thirty-day monitoring evidence|3786752e772853a6b1159fdc8878bcf27ef8d457') exit 1 ;;
      'Release hourly customer monitors, historical excursions and buyer form filling|bc396a6375bd1aa6910a844c9d32374e3127cee5') exit 1 ;;
      'Connect native database monitoring to pharmaceutical quality investigations|04de1ea0322b4d08b885c815860e984e1f712060'|'Verify site database recovery inside pharmaceutical quality cases|640cabe3fac267370fe564867e59b445e86489e5'|'Scale connector dispatch and benchmark five hundred monitored targets|fc0d3802dfd0439e317600fe741d194a1d6e2e8b') exit 1 ;;
      'Scale connector ingestion and verify hourly upstream freshness|f52b9c40d2966b328485453628e6ec4ef0261fb1') exit 1 ;;
      'Run pinned infrastructure policies against exact customer source revisions|5cacdc2adfbb1672d8930088e46581a5a0748330') exit 1 ;;
      'Authenticate infrastructure monitors to the approved staging origin|da466c9de0e391955a322f832aa59ef52dea5bfc') exit 1 ;;
      'Fence receipt writes by workspace across independent collector workers|9eb2ed7c37fbee310dbf46935344febe9ab37eaf') exit 1 ;;
      'Collect authenticated MQTT logger windows and inspect release infrastructure|36de4b78258cc117a4f3a9bfc7d26880a1f6476e') exit 1 ;;
      'Forward closed MQTT windows with durable recovery on customer sites|d0e115f1543430ca3e238466a7c48e08f7c3907e') exit 1 ;;
      'Verify automatic logger delivery with the pinned Eclipse broker image|36f034a48ac2958f845cd0b377cf1d614a07c974') exit 1 ;;
      'Run verified paid product reads and cloud controls hourly|149b0b4a57e784ce2a8d37ccb7731e9caf794d82') exit 1 ;;
      'Authenticate the staging product broker with a project-scoped signing key|272bd75c5360be21f3b5f24c571afa82dbd72143') exit 1 ;;
      'Use the read-only GitHub scope profile for inventory monitoring|2f17fcfa1f6ba13d5cfed3d26576f16d70b33145') exit 1 ;;
      'Verify scoped customer product reads on the staging worker|3a09aacf9ce3c7a5aeb7caee1c17e26ea23f3a05') exit 1 ;;
      'Verify live inventory when hosted grant health lags authorisation|88ec48ffc01bf90a03ba85a7074680e3b34f1d0c') exit 1 ;;
      'Show verified hourly product reads to the owning workspace|de88a9b7e8fe04322fe1d15abb6b01cee76934bb') exit 1 ;;
      'Evaluate repository security settings on each live GitHub inventory read|5a6b4ac72d9f4d3498645066b74db493f9a9a028') exit 1 ;;
      'Read scoped repository details for GitHub settings omitted from inventory|82301bbb998bc4ba709c61bf586f593a5ec7be7c') exit 1 ;;
      'Release 314 audit frameworks and regulatory programmes to staging|c3205ca9daa85a38e66460c2bb797110b631b022') exit 1 ;;
      'Preserve executable staging release checks for the audit catalogue|9b3842fca1c50cdc687eb1437a4c5cd11c89a2d9') exit 1 ;;
      'Release HITRUST preparation and scoped MyCSF integration to staging|41040594c78feb549fc704ba7ab4204fab188f2a') exit 1 ;;
      'Release HITRUST evidence matching and reviewed batch export to staging|c231e5cc89cdb6177331766bcc86656d08756b3a') exit 1 ;;
      'Monitor the two private MyCSF assessment tables on staging|98645934ddc6222af9ebf0334b3fd46624fa19a4') exit 1 ;;
      'Release independent staging collection and cross-programme evidence checks|c9f86a7edf1b2d1bd295dc3724517edaaf7d3587') exit 1 ;;
      'Export joint audit mappings and verify the consolidated REACH edition|a543696f4ed06635e1c7c5e0c86aa0ed40275fb5') exit 1 ;;
      'Run approved resource controls on hosted product inventory|f3cc2170668a305be42e059dd7f56264c6eb3843') exit 1 ;;
      'Verify exported cold-chain readings against the approved excursion|69be3db19ef6fc79f8ec334ae70b07c743712c1c') exit 1 ;;
      'Dispatch approved hosted hourly monitors on the independent staging clock|a1aa3666507e9e208fc318433f4c6d38b95c158c') exit 1 ;;
    esac
  fi
  exit 0
fi

# Preserve the existing operational-commit guard for other branches.
git log -1 --format=%s | grep -Ex 'Activate pinned RegPilot public source watch|Activate RegPilot private automation worker'
