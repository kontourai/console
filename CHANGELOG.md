# Changelog

## [2.3.0](https://github.com/kontourai/console/compare/v2.2.0...v2.3.0) (2026-07-11)


### Features

* **console:** per-session revocation — logout invalidates server-side ([#104](https://github.com/kontourai/console/issues/104)) ([#161](https://github.com/kontourai/console/issues/161)) ([d3687f7](https://github.com/kontourai/console/commit/d3687f71f1dfd8297c6650ceef541828a1f01b0c))

## [2.2.0](https://github.com/kontourai/console/compare/v2.1.0...v2.2.0) (2026-07-10)


### Features

* **console-server:** durable Postgres-backed economics store in hosted mode ([#155](https://github.com/kontourai/console/issues/155)) ([bbc73ab](https://github.com/kontourai/console/commit/bbc73ab1cf3fd593c7b8d93e4a83b8b801d26a2e))
* **console-server:** durable Postgres-backed economics store in hosted mode ([#155](https://github.com/kontourai/console/issues/155)) ([718ee52](https://github.com/kontourai/console/commit/718ee52413a6bdde48b3078a5c31232b9ce7de93))

## [2.1.0](https://github.com/kontourai/console/compare/v2.0.1...v2.1.0) (2026-07-10)


### Features

* **console:** fleet coordination pills — session-id join + fresh/reclaimable tri-state ([#125](https://github.com/kontourai/console/issues/125)) ([3905376](https://github.com/kontourai/console/commit/390537650cc1a9018c39cf7a60fc091b5f1febc0))
* **console:** fleet coordination pills — session-id join + fresh/reclaimable tri-state ([#125](https://github.com/kontourai/console/issues/125)) ([1906e15](https://github.com/kontourai/console/commit/1906e150f874f48157289fc7a1a9737c0f94bf94))


### Bug Fixes

* **console:** fail closed on missing migrations dir; resolve published dist layout ([#151](https://github.com/kontourai/console/issues/151)) ([d321c08](https://github.com/kontourai/console/commit/d321c08f911530083e3bb54b5efd614ad0482139))
* **console:** fail closed on missing migrations dir; resolve published dist layout ([#151](https://github.com/kontourai/console/issues/151)) ([5a08c93](https://github.com/kontourai/console/commit/5a08c93b83bc7e23768c052fc4cf75464a2a55a8))

## [2.0.1](https://github.com/kontourai/console/compare/v2.0.0...v2.0.1) (2026-07-10)


### Bug Fixes

* **console:** liveness robustness — forced session ids, fail-closed timestamps, no resurrection ([#139](https://github.com/kontourai/console/issues/139)) ([f2ded59](https://github.com/kontourai/console/commit/f2ded59bb020486d755ec16129b117416b83efb7))
* **console:** liveness robustness — forced session ids, fail-closed timestamps, no resurrection after release ([#139](https://github.com/kontourai/console/issues/139)) ([e988583](https://github.com/kontourai/console/commit/e9885834430fd621cdb87239107900386263695c))

## [2.0.0](https://github.com/kontourai/console/compare/v1.12.0...v2.0.0) (2026-07-10)


### ⚠ BREAKING CHANGES

* move Console runtime state under .kontourai

### Features

* **console:** fold kontour.console.liveness into the OperatingState projection ([417fa4b](https://github.com/kontourai/console/commit/417fa4b51b33b770c49b6a8b6f346768b095e988))
* **console:** live-session (liveness) actors in the operating-state projection ([ec28708](https://github.com/kontourai/console/commit/ec28708666a8bcdbe5d64339274b322709d7fec1))
* move Console runtime state under .kontourai ([0b4aa8f](https://github.com/kontourai/console/commit/0b4aa8fd3487462e725c55b6af727bf7b0c116a5))


### Bug Fixes

* **console:** expire liveness actors at read time + collapse to one row per session ([b43c03d](https://github.com/kontourai/console/commit/b43c03dcd0acafa9ed1734d485adf9380b401b55))
* follow Flow runtime root hard cut ([#143](https://github.com/kontourai/console/issues/143)) ([48e0008](https://github.com/kontourai/console/commit/48e0008e97b6a175c0ebf9f0b551fbec302e592c))

## [1.12.0](https://github.com/kontourai/console/compare/v1.11.1...v1.12.0) (2026-07-06)


### Features

* **console-server:** stamp tenant from principal on record ingest, reject mismatch ([#123](https://github.com/kontourai/console/issues/123)) ([#127](https://github.com/kontourai/console/issues/127)) ([9888106](https://github.com/kontourai/console/commit/9888106ee084a9ea3d24ef65ea15d172fc7d91a3))
* **console-server:** verified ConsolePrincipal + M2M client-credentials + per-route scopes ([#98](https://github.com/kontourai/console/issues/98)) ([#129](https://github.com/kontourai/console/issues/129)) ([688e843](https://github.com/kontourai/console/commit/688e8433ee0616ffa70761f75c663d9201b788a8))
* **console-ui:** unified Overview home leading with "Needs you" triage (redesign slice 1) ([#124](https://github.com/kontourai/console/issues/124)) ([c4ce986](https://github.com/kontourai/console/commit/c4ce98662ad6846fa25a09768d48f4b02ed9c43a))
* **console:** delegation efficiency panel — per role×model, honest coverage ([#415](https://github.com/kontourai/console/issues/415)) ([#133](https://github.com/kontourai/console/issues/133)) ([b3ee13c](https://github.com/kontourai/console/commit/b3ee13c4cec20a442ae9b1fa8384ce712fedb5e2))
* **console:** economics + value views (the ROI surface) ([#117](https://github.com/kontourai/console/issues/117)) ([#132](https://github.com/kontourai/console/issues/132)) ([73aac49](https://github.com/kontourai/console/commit/73aac495831b4b1237c48e8924819460479c219d))

## [1.11.1](https://github.com/kontourai/console/compare/v1.11.0...v1.11.1) (2026-07-03)


### Bug Fixes

* **console:** declare runtime deps so console-inspect (and all bins) resolve cold ([#120](https://github.com/kontourai/console/issues/120)) ([ef9a474](https://github.com/kontourai/console/commit/ef9a47428400cb889d6dc2a6e98584574f4827ed))
* **console:** declare runtime deps so console-inspect resolves cold ([#120](https://github.com/kontourai/console/issues/120)) ([1879f7c](https://github.com/kontourai/console/commit/1879f7cf2b230bb5f6f257d4426089bb60589d81))

## [1.11.0](https://github.com/kontourai/console/compare/v1.10.0...v1.11.0) (2026-07-01)


### Features

* **console:** authenticated MCP server over telemetry/cost analytics (ADR 0003, Phase 3) ([#107](https://github.com/kontourai/console/issues/107)) ([fe8ae45](https://github.com/kontourai/console/commit/fe8ae45a9e7bf54b758420dcc65123e1491142f0))
* **console:** dedicated session secret, decoupled from auth tokens (part of [#104](https://github.com/kontourai/console/issues/104)) ([#111](https://github.com/kontourai/console/issues/111)) ([1e14649](https://github.com/kontourai/console/commit/1e1464961dfaab76ed9d2a272b9dccb62594f6f5))
* **console:** dynamically generated OpenAPI 3.1 spec served at /openapi.json ([#108](https://github.com/kontourai/console/issues/108)) ([763f1d8](https://github.com/kontourai/console/commit/763f1d83a74849d4e3912e58d5bbd135e0f637a8))
* **console:** M2M tenant binding via ordered tenant-claim resolution (ADR 0003, Phase 2b) ([#102](https://github.com/kontourai/console/issues/102)) ([83b2b27](https://github.com/kontourai/console/commit/83b2b27be7ec4f39967474d2c16ae676b0355d60))
* **console:** OAuth 2.1 / OIDC Resource-Server spike — vendor-neutral (ADR 0003, Phase 1) ([#96](https://github.com/kontourai/console/issues/96)) ([11258d7](https://github.com/kontourai/console/commit/11258d71e26c20f3a8ec4bfdb862909d93b5e706))
* **console:** OIDC Authorization-Code + PKCE login + runbook (ADR 0003, Phase 2c) ([#103](https://github.com/kontourai/console/issues/103)) ([e3831e5](https://github.com/kontourai/console/commit/e3831e5ceb6a4135e33bbc8a43652f68fa40ca46))
* **console:** OIDC id_token + nonce + at_hash validation at login (closes [#105](https://github.com/kontourai/console/issues/105)) ([#110](https://github.com/kontourai/console/issues/110)) ([d4b5b12](https://github.com/kontourai/console/commit/d4b5b12cf405ef926fb2b2a603db3d48b7b5c4db))
* **console:** per-route OAuth scope authorization (ADR 0003, Phase 2a) ([#101](https://github.com/kontourai/console/issues/101)) ([0cb8525](https://github.com/kontourai/console/commit/0cb8525860f7cac6194df0d98468cc05c5c4790e))
* **console:** persist hub connection + connection/auth regression coverage ([#91](https://github.com/kontourai/console/issues/91)) ([a93a841](https://github.com/kontourai/console/commit/a93a841aa728e7a748f52ef6990fa03f9253663f))
* **dev:** turnkey local full-stack with Postgres + mock OIDC (verified) ([#114](https://github.com/kontourai/console/issues/114)) ([09b5d73](https://github.com/kontourai/console/commit/09b5d73f008623951e39bae43b779e86d1598262))
* **telemetry:** cost-by-dimension breakdowns (project / agent / runtime) ([#89](https://github.com/kontourai/console/issues/89)) ([0d5bf43](https://github.com/kontourai/console/commit/0d5bf43c016ca389240ea4c98ac4d87c7c03d5ae))


### Bug Fixes

* **console:** incremental operating-state projection for the hosted hub (ops[#34](https://github.com/kontourai/console/issues/34)) ([#97](https://github.com/kontourai/console/issues/97)) ([80dd28f](https://github.com/kontourai/console/commit/80dd28f75b1aa0ff664c637d813627ae7cf98faa))
* **console:** validate id_token at_hash only when present (OIDC Core code-flow) ([#113](https://github.com/kontourai/console/issues/113)) ([e4a0084](https://github.com/kontourai/console/commit/e4a0084dd3dd36a8bd88b86f6a48dcd03d19daf3))

## [1.10.0](https://github.com/kontourai/console/compare/v1.9.0...v1.10.0) (2026-06-28)


### Features

* **telemetry:** @kontourai/console-telemetry contract package + pricing API ([#86](https://github.com/kontourai/console/issues/86)) ([73bbec2](https://github.com/kontourai/console/commit/73bbec282664605adccc3372049a4af762cfd6df))
* **telemetry:** aggregate token usage + cost, cost-by-model dashboard ([#84](https://github.com/kontourai/console/issues/84)) ([67cb698](https://github.com/kontourai/console/commit/67cb6980380d7ab6e8687fcb8d83ca96ee06952b))

## [1.9.0](https://github.com/kontourai/console/compare/v1.8.0...v1.9.0) (2026-06-24)


### Features

* **console:** add authenticated ApiSink + route flow-bridge through the Sink layer ([#80](https://github.com/kontourai/console/issues/80)) ([4a8e13b](https://github.com/kontourai/console/commit/4a8e13bea4d9d49b3f47183efe6fc0f4130c3bf6))


### Bug Fixes

* **console-server:** define console-owned FlowIngestRequest envelope (typecheck gate) ([#81](https://github.com/kontourai/console/issues/81)) ([6ad56b9](https://github.com/kontourai/console/commit/6ad56b909baa6bf68fb5f0d36cfea07f565999db))

## [1.8.0](https://github.com/kontourai/console/compare/v1.7.0...v1.8.0) (2026-06-18)


### Features

* **console:** mount hosted Flow ingest endpoint + live child drill-in fetch ([#78](https://github.com/kontourai/console/issues/78)) ([63f864d](https://github.com/kontourai/console/commit/63f864d45ad7aac087787f273fe802728e64d538))

## [1.7.0](https://github.com/kontourai/console/compare/v1.6.0...v1.7.0) (2026-06-17)


### Features

* typed flow-bridge — consume Flow's exported console-contract ([#76](https://github.com/kontourai/console/issues/76)) ([19b4135](https://github.com/kontourai/console/commit/19b4135168a842edc8739de4aac5a801817ebe6b))

## [1.6.0](https://github.com/kontourai/console/compare/v1.5.0...v1.6.0) (2026-06-16)


### Features

* bridge reads Flow trust.bundle evidence into the trust panel ([#72](https://github.com/kontourai/console/issues/72)) ([9a1d976](https://github.com/kontourai/console/commit/9a1d976c52826eb1b63cf7cd0337b7a8f9fbaa64))
* **console-ui:** migrate to @kontourai/ui and adopt Console product mark ([#68](https://github.com/kontourai/console/issues/68)) ([0c4d362](https://github.com/kontourai/console/commit/0c4d362a37376802163b0e577718ba6b156e00e1))

## [1.5.0](https://github.com/kontourai/console/compare/v1.4.0...v1.5.0) (2026-06-15)


### Features

* embed Surface trust panel in the pipeline gate drill-in ([#65](https://github.com/kontourai/console/issues/65)) ([a54dd67](https://github.com/kontourai/console/commit/a54dd67684ef6b3576320a2f716312b525dc63df))


### Bug Fixes

* **console-ui:** de-duplicate claim/expects in the stage drawer ([#67](https://github.com/kontourai/console/issues/67)) ([ac81301](https://github.com/kontourai/console/commit/ac81301a7d3b859c38fa735c3d9d8597e7f5233e))

## [1.4.0](https://github.com/kontourai/console/compare/v1.3.1...v1.4.0) (2026-06-15)


### Features

* stage-status reasons, config warnings, and fixed gate chips ([#61](https://github.com/kontourai/console/issues/61)) ([0bfbd2b](https://github.com/kontourai/console/commit/0bfbd2bab7f4b0d61d958c7b8e0583ff4fd12abe))

## [1.3.1](https://github.com/kontourai/console/compare/v1.3.0...v1.3.1) (2026-06-15)


### Bug Fixes

* **console-ui:** stage detail as a full-height slide-over, not bounded by the pipeline card ([#59](https://github.com/kontourai/console/issues/59)) ([b3ff8d6](https://github.com/kontourai/console/commit/b3ff8d6e3aa64e3a61a7f3df7f934b0f6ace10ac))

## [1.3.0](https://github.com/kontourai/console/compare/v1.2.1...v1.3.0) (2026-06-15)


### Features

* render dependency-DAG pipelines in the operate view ([#57](https://github.com/kontourai/console/issues/57)) ([390e8fa](https://github.com/kontourai/console/commit/390e8fab4e64b7c05926ab93fa697e98920d9fd9))

## [1.2.1](https://github.com/kontourai/console/compare/v1.2.0...v1.2.1) (2026-06-15)


### Bug Fixes

* **console-server:** import buildPipeline from package (fixes v1.2.0 publish) ([#55](https://github.com/kontourai/console/issues/55)) ([d771b77](https://github.com/kontourai/console/commit/d771b77907abb76192471d995074b8b00257be55))

## [1.2.0](https://github.com/kontourai/console/compare/v1.1.0...v1.2.0) (2026-06-15)


### Features

* **console-ui:** editorial Kontour visual overhaul ([305d380](https://github.com/kontourai/console/commit/305d3802692cc42c9b02758c2e6720a80ac05cf3))
* honest Flow pipeline view in the operate tab ([#54](https://github.com/kontourai/console/issues/54)) ([57e9c30](https://github.com/kontourai/console/commit/57e9c3099dce848e00bc5e303267c18ebc2cad07))

## [1.1.0](https://github.com/kontourai/console/compare/v1.0.0...v1.1.0) (2026-06-12)


### Features

* persist hosted core records in postgres (survives redeploys) ([#50](https://github.com/kontourai/console/issues/50)) ([680fe0a](https://github.com/kontourai/console/commit/680fe0a0329124dc698624870b40a539416bfeb7))

## [1.0.0](https://github.com/kontourai/console/compare/v0.2.1...v1.0.0) (2026-06-12)


### Features

* hosted session gate for the bundled UI ([#49](https://github.com/kontourai/console/issues/49)) ([a08736d](https://github.com/kontourai/console/commit/a08736d7293020e7d2193c0550a0b2f918845dda))
* serve bundled console-ui from the hub at its origin ([#46](https://github.com/kontourai/console/issues/46)) ([11bf95a](https://github.com/kontourai/console/commit/11bf95a9af320cff46c807d57ef5386ed6cc12a7))


### Miscellaneous Chores

* cut v1.0.0 ([52e044e](https://github.com/kontourai/console/commit/52e044ec24e438d4d1b4ffe557e42eebedb0cf03))

## [0.2.1](https://github.com/kontourai/console/compare/v0.2.0...v0.2.1) (2026-06-12)


### Bug Fixes

* construct pg client for postgres telemetry storage when none injected ([#44](https://github.com/kontourai/console/issues/44)) ([798d108](https://github.com/kontourai/console/commit/798d108c1835e37be0c3d4d611587a8d815e7ed6))

## [0.2.0](https://github.com/kontourai/console/compare/v0.1.0...v0.2.0) (2026-06-12)


### Features

* **console-ui:** add Environment dashboard view ([#39](https://github.com/kontourai/console/issues/39)) ([97cc850](https://github.com/kontourai/console/commit/97cc850eec585da046c68177744ebcda0b522e04))
* **console-ui:** interactive flow canvas, theme toggle, node detail drawer ([f5e700d](https://github.com/kontourai/console/commit/f5e700d6fcaf998261536a9618e6616455c19be9))


### Bug Fixes

* CI node matrix 22/24; engines &gt;=22 for node:sqlite ([#37](https://github.com/kontourai/console/issues/37)) ([a4fc9ae](https://github.com/kontourai/console/commit/a4fc9ae584f1bd655d6c6ff717a1c8dc132bf65b))
* register console-db-migrate bin so npx can invoke it ([#40](https://github.com/kontourai/console/issues/40)) ([7ec7645](https://github.com/kontourai/console/commit/7ec7645092e4642ee04d6d63fe46557cf8d10a8e))
* register console-db-migrate in the published package's bin map ([#41](https://github.com/kontourai/console/issues/41)) ([4fb9457](https://github.com/kontourai/console/commit/4fb9457952c89d241d37b991993fa64e5495ce07))
