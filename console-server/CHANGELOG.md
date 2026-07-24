# Changelog

## [1.1.0](https://github.com/kontourai/console/compare/console-server-v1.0.0...console-server-v1.1.0) (2026-07-24)


### Features

* **console-server:** bridge Surface trust projections into OperatingState ([#254](https://github.com/kontourai/console/issues/254)) ([#260](https://github.com/kontourai/console/issues/260)) ([eb95f67](https://github.com/kontourai/console/commit/eb95f674e980ed0c17a615a0bce6755056487d5d))
* **telemetry:** project repeated invocation signals ([#243](https://github.com/kontourai/console/issues/243)) ([7ed115e](https://github.com/kontourai/console/commit/7ed115edc75b1add2152adcecfeae39fc26800af))


### Bug Fixes

* **telemetry:** bound hosted retention ([#246](https://github.com/kontourai/console/issues/246)) ([237f9cb](https://github.com/kontourai/console/commit/237f9cb24a39731b3bb3f998bff4bb2557a1f64a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @kontourai/console-core bumped from 0.3.0 to 0.4.0

## [1.0.0](https://github.com/kontourai/console/compare/console-server-v0.1.0...console-server-v1.0.0) (2026-07-23)


### ⚠ BREAKING CHANGES

* move Console runtime state under .kontourai

### Features

* add Kontour suite CLI router ([#167](https://github.com/kontourai/console/issues/167)) ([26fe1c2](https://github.com/kontourai/console/commit/26fe1c27d61f1e8b480206204cedc1f79bea39b6))
* add telemetry console foundation ([#21](https://github.com/kontourai/console/issues/21)) ([ef7633c](https://github.com/kontourai/console/commit/ef7633c5b429f9d3feb2ffb6108a24a4235cc6de))
* add telemetry query controls ([#27](https://github.com/kontourai/console/issues/27)) ([da97113](https://github.com/kontourai/console/commit/da97113f4d8b39b30723b053992595a39e5710cb))
* bridge reads Flow trust.bundle evidence into the trust panel ([#72](https://github.com/kontourai/console/issues/72)) ([9a1d976](https://github.com/kontourai/console/commit/9a1d976c52826eb1b63cf7cd0337b7a8f9fbaa64))
* **console-server:** bridge flow-agents workflow-process projections onto the board ([#239](https://github.com/kontourai/console/issues/239)) ([#241](https://github.com/kontourai/console/issues/241)) ([22484e0](https://github.com/kontourai/console/commit/22484e0dca467458df0bfae0bb07a5614dbd97f2))
* **console-server:** durable Postgres-backed economics store in hosted mode ([#155](https://github.com/kontourai/console/issues/155)) ([bbc73ab](https://github.com/kontourai/console/commit/bbc73ab1cf3fd593c7b8d93e4a83b8b801d26a2e))
* **console-server:** durable Postgres-backed economics store in hosted mode ([#155](https://github.com/kontourai/console/issues/155)) ([718ee52](https://github.com/kontourai/console/commit/718ee52413a6bdde48b3078a5c31232b9ce7de93))
* **console-server:** stamp tenant from principal on record ingest, reject mismatch ([#123](https://github.com/kontourai/console/issues/123)) ([#127](https://github.com/kontourai/console/issues/127)) ([9888106](https://github.com/kontourai/console/commit/9888106ee084a9ea3d24ef65ea15d172fc7d91a3))
* **console-server:** verified ConsolePrincipal + M2M client-credentials + per-route scopes ([#98](https://github.com/kontourai/console/issues/98)) ([#129](https://github.com/kontourai/console/issues/129)) ([688e843](https://github.com/kontourai/console/commit/688e8433ee0616ffa70761f75c663d9201b788a8))
* **console-ui:** editorial Kontour visual overhaul ([305d380](https://github.com/kontourai/console/commit/305d3802692cc42c9b02758c2e6720a80ac05cf3))
* **console:** add authenticated ApiSink + route flow-bridge through the Sink layer ([#80](https://github.com/kontourai/console/issues/80)) ([4a8e13b](https://github.com/kontourai/console/commit/4a8e13bea4d9d49b3f47183efe6fc0f4130c3bf6))
* **console:** authenticated MCP server over telemetry/cost analytics (ADR 0003, Phase 3) ([#107](https://github.com/kontourai/console/issues/107)) ([fe8ae45](https://github.com/kontourai/console/commit/fe8ae45a9e7bf54b758420dcc65123e1491142f0))
* **console:** dedicated session secret, decoupled from auth tokens (part of [#104](https://github.com/kontourai/console/issues/104)) ([#111](https://github.com/kontourai/console/issues/111)) ([1e14649](https://github.com/kontourai/console/commit/1e1464961dfaab76ed9d2a272b9dccb62594f6f5))
* **console:** delegation efficiency panel — per role×model, honest coverage ([#415](https://github.com/kontourai/console/issues/415)) ([#133](https://github.com/kontourai/console/issues/133)) ([b3ee13c](https://github.com/kontourai/console/commit/b3ee13c4cec20a442ae9b1fa8384ce712fedb5e2))
* **console:** dynamically generated OpenAPI 3.1 spec served at /openapi.json ([#108](https://github.com/kontourai/console/issues/108)) ([763f1d8](https://github.com/kontourai/console/commit/763f1d83a74849d4e3912e58d5bbd135e0f637a8))
* **console:** economics + value views (the ROI surface) ([#117](https://github.com/kontourai/console/issues/117)) ([#132](https://github.com/kontourai/console/issues/132)) ([73aac49](https://github.com/kontourai/console/commit/73aac495831b4b1237c48e8924819460479c219d))
* **console:** fleet coordination pills — session-id join + fresh/reclaimable tri-state ([#125](https://github.com/kontourai/console/issues/125)) ([3905376](https://github.com/kontourai/console/commit/390537650cc1a9018c39cf7a60fc091b5f1febc0))
* **console:** fleet coordination pills — session-id join + fresh/reclaimable tri-state ([#125](https://github.com/kontourai/console/issues/125)) ([1906e15](https://github.com/kontourai/console/commit/1906e150f874f48157289fc7a1a9737c0f94bf94))
* **console:** fold kontour.console.liveness into the OperatingState projection ([417fa4b](https://github.com/kontourai/console/commit/417fa4b51b33b770c49b6a8b6f346768b095e988))
* **console:** live-session (liveness) actors in the operating-state projection ([ec28708](https://github.com/kontourai/console/commit/ec28708666a8bcdbe5d64339274b322709d7fec1))
* **console:** M2M tenant binding via ordered tenant-claim resolution (ADR 0003, Phase 2b) ([#102](https://github.com/kontourai/console/issues/102)) ([83b2b27](https://github.com/kontourai/console/commit/83b2b27be7ec4f39967474d2c16ae676b0355d60))
* **console:** mount hosted Flow ingest endpoint + live child drill-in fetch ([#78](https://github.com/kontourai/console/issues/78)) ([63f864d](https://github.com/kontourai/console/commit/63f864d45ad7aac087787f273fe802728e64d538))
* **console:** OAuth 2.1 / OIDC Resource-Server spike — vendor-neutral (ADR 0003, Phase 1) ([#96](https://github.com/kontourai/console/issues/96)) ([11258d7](https://github.com/kontourai/console/commit/11258d71e26c20f3a8ec4bfdb862909d93b5e706))
* **console:** OIDC Authorization-Code + PKCE login + runbook (ADR 0003, Phase 2c) ([#103](https://github.com/kontourai/console/issues/103)) ([e3831e5](https://github.com/kontourai/console/commit/e3831e5ceb6a4135e33bbc8a43652f68fa40ca46))
* **console:** OIDC id_token + nonce + at_hash validation at login (closes [#105](https://github.com/kontourai/console/issues/105)) ([#110](https://github.com/kontourai/console/issues/110)) ([d4b5b12](https://github.com/kontourai/console/commit/d4b5b12cf405ef926fb2b2a603db3d48b7b5c4db))
* **console:** OpenAPI first-class — info.version tracks the release + /version endpoint ([#191](https://github.com/kontourai/console/issues/191)) ([#193](https://github.com/kontourai/console/issues/193)) ([605021a](https://github.com/kontourai/console/commit/605021afe2e6451c594b8d4be2a1afb99ce1b7e3))
* **console:** per-route OAuth scope authorization (ADR 0003, Phase 2a) ([#101](https://github.com/kontourai/console/issues/101)) ([0cb8525](https://github.com/kontourai/console/commit/0cb8525860f7cac6194df0d98468cc05c5c4790e))
* **console:** per-session revocation — logout invalidates server-side ([#104](https://github.com/kontourai/console/issues/104)) ([#161](https://github.com/kontourai/console/issues/161)) ([d3687f7](https://github.com/kontourai/console/commit/d3687f71f1dfd8297c6650ceef541828a1f01b0c))
* **console:** per-tool latency+failure, activity timeline, cost rollup ([#181](https://github.com/kontourai/console/issues/181)) ([#224](https://github.com/kontourai/console/issues/224)) ([cda2195](https://github.com/kontourai/console/commit/cda21951b9ce91eb5cdac3073dd0b52440f3bc8e))
* embed Surface trust panel in the pipeline gate drill-in ([#65](https://github.com/kontourai/console/issues/65)) ([a54dd67](https://github.com/kontourai/console/commit/a54dd67684ef6b3576320a2f716312b525dc63df))
* honest Flow pipeline view in the operate tab ([#54](https://github.com/kontourai/console/issues/54)) ([57e9c30](https://github.com/kontourai/console/commit/57e9c3099dce848e00bc5e303267c18ebc2cad07))
* hosted session gate for the bundled UI ([#49](https://github.com/kontourai/console/issues/49)) ([a08736d](https://github.com/kontourai/console/commit/a08736d7293020e7d2193c0550a0b2f918845dda))
* load product telemetry descriptors ([#28](https://github.com/kontourai/console/issues/28)) ([fcc7a38](https://github.com/kontourai/console/commit/fcc7a388206a2051289dff89d5a665bc86a84a7d))
* move Console runtime state under .kontourai ([0b4aa8f](https://github.com/kontourai/console/commit/0b4aa8fd3487462e725c55b6af727bf7b0c116a5))
* persist hosted core records in postgres (survives redeploys) ([#50](https://github.com/kontourai/console/issues/50)) ([680fe0a](https://github.com/kontourai/console/commit/680fe0a0329124dc698624870b40a539416bfeb7))
* **projection:** interactive-session process states (needs_input, review_pending) + blockedReason ([#236](https://github.com/kontourai/console/issues/236)) ([cffecca](https://github.com/kontourai/console/commit/cffecca5b8c0450b3b78fcfdc503e6d210b1f00f))
* serve bundled console-ui from the hub at its origin ([#46](https://github.com/kontourai/console/issues/46)) ([11bf95a](https://github.com/kontourai/console/commit/11bf95a9af320cff46c807d57ef5386ed6cc12a7))
* surface telemetry dimensions ([#24](https://github.com/kontourai/console/issues/24)) ([526400c](https://github.com/kontourai/console/commit/526400c706c3c65fdd384ea7a0f2f68113334522))
* **telemetry:** @kontourai/console-telemetry contract package + pricing API ([#86](https://github.com/kontourai/console/issues/86)) ([73bbec2](https://github.com/kontourai/console/commit/73bbec282664605adccc3372049a4af762cfd6df))
* **telemetry:** aggregate token usage + cost, cost-by-model dashboard ([#84](https://github.com/kontourai/console/issues/84)) ([67cb698](https://github.com/kontourai/console/commit/67cb6980380d7ab6e8687fcb8d83ca96ee06952b))
* **telemetry:** cost-by-dimension breakdowns (project / agent / runtime) ([#89](https://github.com/kontourai/console/issues/89)) ([0d5bf43](https://github.com/kontourai/console/commit/0d5bf43c016ca389240ea4c98ac4d87c7c03d5ae))
* **telemetry:** read-model projections — action taxonomy + cost-per-turn ([#180](https://github.com/kontourai/console/issues/180)) ([6dc8f3a](https://github.com/kontourai/console/commit/6dc8f3a6d11289868c1741968760e649b0375c4a))
* **telemetry:** read-model projections — action taxonomy + cost-per-turn ([#180](https://github.com/kontourai/console/issues/180)) ([7bdc9c6](https://github.com/kontourai/console/commit/7bdc9c675e30e15cc6eadcde93f479529fe64333))
* typed flow-bridge — consume Flow's exported console-contract ([#76](https://github.com/kontourai/console/issues/76)) ([19b4135](https://github.com/kontourai/console/commit/19b4135168a842edc8739de4aac5a801817ebe6b))


### Bug Fixes

* **console-server:** define console-owned FlowIngestRequest envelope (typecheck gate) ([#81](https://github.com/kontourai/console/issues/81)) ([6ad56b9](https://github.com/kontourai/console/commit/6ad56b909baa6bf68fb5f0d36cfea07f565999db))
* **console-server:** import buildPipeline from package (fixes v1.2.0 publish) ([#55](https://github.com/kontourai/console/issues/55)) ([d771b77](https://github.com/kontourai/console/commit/d771b77907abb76192471d995074b8b00257be55))
* **console:** expire liveness actors at read time + collapse to one row per session ([b43c03d](https://github.com/kontourai/console/commit/b43c03dcd0acafa9ed1734d485adf9380b401b55))
* **console:** fail closed on missing migrations dir; resolve published dist layout ([#151](https://github.com/kontourai/console/issues/151)) ([d321c08](https://github.com/kontourai/console/commit/d321c08f911530083e3bb54b5efd614ad0482139))
* **console:** fail closed on missing migrations dir; resolve published dist layout ([#151](https://github.com/kontourai/console/issues/151)) ([5a08c93](https://github.com/kontourai/console/commit/5a08c93b83bc7e23768c052fc4cf75464a2a55a8))
* **console:** guard operating-state projections against undefined state ([#182](https://github.com/kontourai/console/issues/182)) ([#185](https://github.com/kontourai/console/issues/185)) ([e667cd3](https://github.com/kontourai/console/commit/e667cd3dfd611e32d20c94f3bb2076c1205e0325))
* **console:** incremental operating-state projection for the hosted hub (ops[#34](https://github.com/kontourai/console/issues/34)) ([#97](https://github.com/kontourai/console/issues/97)) ([80dd28f](https://github.com/kontourai/console/commit/80dd28f75b1aa0ff664c637d813627ae7cf98faa))
* **console:** liveness robustness — forced session ids, fail-closed timestamps, no resurrection ([#139](https://github.com/kontourai/console/issues/139)) ([f2ded59](https://github.com/kontourai/console/commit/f2ded59bb020486d755ec16129b117416b83efb7))
* **console:** liveness robustness — forced session ids, fail-closed timestamps, no resurrection after release ([#139](https://github.com/kontourai/console/issues/139)) ([e988583](https://github.com/kontourai/console/commit/e9885834430fd621cdb87239107900386263695c))
* **console:** validate id_token at_hash only when present (OIDC Core code-flow) ([#113](https://github.com/kontourai/console/issues/113)) ([e4a0084](https://github.com/kontourai/console/commit/e4a0084dd3dd36a8bd88b86f6a48dcd03d19daf3))
* construct pg client for postgres telemetry storage when none injected ([#44](https://github.com/kontourai/console/issues/44)) ([798d108](https://github.com/kontourai/console/commit/798d108c1835e37be0c3d4d611587a8d815e7ed6))
* **emitter:** encode path separators in scope/producer ids so repo scopes replay ([#188](https://github.com/kontourai/console/issues/188)) ([#219](https://github.com/kontourai/console/issues/219)) ([3fb1e39](https://github.com/kontourai/console/commit/3fb1e3912c21f61261344a6ad95fb7a574ce355e))
* **emitter:** export producer helpers as named exports so their types ship ([#71](https://github.com/kontourai/console/issues/71)) ([#222](https://github.com/kontourai/console/issues/222)) ([14bb378](https://github.com/kontourai/console/commit/14bb378cbb991137cee4b83fc0379046c1bed812))
* follow Flow runtime root hard cut ([#143](https://github.com/kontourai/console/issues/143)) ([48e0008](https://github.com/kontourai/console/commit/48e0008e97b6a175c0ebf9f0b551fbec302e592c))
* **publish:** ship the library entry for @kontourai/console (closes C1/C2) ([#235](https://github.com/kontourai/console/issues/235)) ([1435b82](https://github.com/kontourai/console/commit/1435b82bb7e4994efe3b8d358d299e93d71d9a20))
* register console-db-migrate bin so npx can invoke it ([#40](https://github.com/kontourai/console/issues/40)) ([7ec7645](https://github.com/kontourai/console/commit/7ec7645092e4642ee04d6d63fe46557cf8d10a8e))
* **release:** keep server workspace internal ([#192](https://github.com/kontourai/console/issues/192)) ([d158d8d](https://github.com/kontourai/console/commit/d158d8df7a3cb38db25099c197ab929827990a7f))
* **release:** publish CLI core contract ([#189](https://github.com/kontourai/console/issues/189)) ([3d038b3](https://github.com/kontourai/console/commit/3d038b37f55d115ca23a10cb0e133b4b7f3fb064))
* rename packages to the [@kontourai](https://github.com/kontourai) scope before first publish ([#36](https://github.com/kontourai/console/issues/36)) ([8442bdd](https://github.com/kontourai/console/commit/8442bdd75a5eae722f404f877133480c4aed27e0))
* **server:** allow same-origin requests so `kontour serve` can load its own UI ([#187](https://github.com/kontourai/console/issues/187)) ([#218](https://github.com/kontourai/console/issues/218)) ([86df7f9](https://github.com/kontourai/console/commit/86df7f97611061f9073e94220f8150f3e93ece7b))
* **telemetry:** stop per-event tool usage snapshots overcounting cost totals ([#209](https://github.com/kontourai/console/issues/209)) ([#211](https://github.com/kontourai/console/issues/211)) ([a3fd73c](https://github.com/kontourai/console/commit/a3fd73c59de77769b01ea1a814c7fd76238fe55d))
* **telemetry:** warn instead of silently dropping malformed product-root entries ([#64](https://github.com/kontourai/console/issues/64)) ([#220](https://github.com/kontourai/console/issues/220)) ([cbee402](https://github.com/kontourai/console/commit/cbee4020a666d911bc8b51fe8284a6c1133ad9ee))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @kontourai/console-core bumped from 0.2.0 to 0.3.0
