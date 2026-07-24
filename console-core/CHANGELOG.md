# Changelog

## [0.4.0](https://github.com/kontourai/console/compare/console-core-v0.3.0...console-core-v0.4.0) (2026-07-24)


### Features

* **console-ui:** gate trust panel — mount &lt;surface-trust-panel&gt; live ([#255](https://github.com/kontourai/console/issues/255)) ([#262](https://github.com/kontourai/console/issues/262)) ([293bfb4](https://github.com/kontourai/console/commit/293bfb4e32a6508c738ba33ada734fb9819b2bbf))

## [0.3.0](https://github.com/kontourai/console/compare/console-core-v0.2.0...console-core-v0.3.0) (2026-07-23)


### Features

* **act-plane:** intent-binding + consent contract with enforced never-authority ([#238](https://github.com/kontourai/console/issues/238)) ([b8bb955](https://github.com/kontourai/console/commit/b8bb955faab680a5bf60ef257d9ab167a7adcfb7))
* **cli:** opt-in standalone action runner (consent-gated, never-authority) ([#240](https://github.com/kontourai/console/issues/240)) ([14ae169](https://github.com/kontourai/console/commit/14ae169906d4ac0cc8c0ad55f16ddaa368e2ce3c))
* **projection:** interactive-session process states (needs_input, review_pending) + blockedReason ([#236](https://github.com/kontourai/console/issues/236)) ([cffecca](https://github.com/kontourai/console/commit/cffecca5b8c0450b3b78fcfdc503e6d210b1f00f))

## [0.2.0](https://github.com/kontourai/console/compare/console-core-v0.1.0...console-core-v0.2.0) (2026-07-12)


### Features

* add product capability descriptor protocol ([#165](https://github.com/kontourai/console/issues/165)) ([6705709](https://github.com/kontourai/console/commit/6705709cb25df1f43760c3870006648b249e8bc6))
* bridge reads Flow trust.bundle evidence into the trust panel ([#72](https://github.com/kontourai/console/issues/72)) ([9a1d976](https://github.com/kontourai/console/commit/9a1d976c52826eb1b63cf7cd0337b7a8f9fbaa64))
* **console:** fleet coordination pills — session-id join + fresh/reclaimable tri-state ([#125](https://github.com/kontourai/console/issues/125)) ([3905376](https://github.com/kontourai/console/commit/390537650cc1a9018c39cf7a60fc091b5f1febc0))
* **console:** fleet coordination pills — session-id join + fresh/reclaimable tri-state ([#125](https://github.com/kontourai/console/issues/125)) ([1906e15](https://github.com/kontourai/console/commit/1906e150f874f48157289fc7a1a9737c0f94bf94))
* **console:** fold kontour.console.liveness into the OperatingState projection ([417fa4b](https://github.com/kontourai/console/commit/417fa4b51b33b770c49b6a8b6f346768b095e988))
* **console:** live-session (liveness) actors in the operating-state projection ([ec28708](https://github.com/kontourai/console/commit/ec28708666a8bcdbe5d64339274b322709d7fec1))
* embed Surface trust panel in the pipeline gate drill-in ([#65](https://github.com/kontourai/console/issues/65)) ([a54dd67](https://github.com/kontourai/console/commit/a54dd67684ef6b3576320a2f716312b525dc63df))
* honest Flow pipeline view in the operate tab ([#54](https://github.com/kontourai/console/issues/54)) ([57e9c30](https://github.com/kontourai/console/commit/57e9c3099dce848e00bc5e303267c18ebc2cad07))
* render dependency-DAG pipelines in the operate view ([#57](https://github.com/kontourai/console/issues/57)) ([390e8fa](https://github.com/kontourai/console/commit/390e8fab4e64b7c05926ab93fa697e98920d9fd9))
* stage-status reasons, config warnings, and fixed gate chips ([#61](https://github.com/kontourai/console/issues/61)) ([0bfbd2b](https://github.com/kontourai/console/commit/0bfbd2bab7f4b0d61d958c7b8e0583ff4fd12abe))
* typed flow-bridge — consume Flow's exported console-contract ([#76](https://github.com/kontourai/console/issues/76)) ([19b4135](https://github.com/kontourai/console/commit/19b4135168a842edc8739de4aac5a801817ebe6b))


### Bug Fixes

* **console-server:** import buildPipeline from package (fixes v1.2.0 publish) ([#55](https://github.com/kontourai/console/issues/55)) ([d771b77](https://github.com/kontourai/console/commit/d771b77907abb76192471d995074b8b00257be55))
* **console:** expire liveness actors at read time + collapse to one row per session ([b43c03d](https://github.com/kontourai/console/commit/b43c03dcd0acafa9ed1734d485adf9380b401b55))
* **console:** guard operating-state projections against undefined state ([#182](https://github.com/kontourai/console/issues/182)) ([#185](https://github.com/kontourai/console/issues/185)) ([e667cd3](https://github.com/kontourai/console/commit/e667cd3dfd611e32d20c94f3bb2076c1205e0325))
* **release:** publish CLI core contract ([#189](https://github.com/kontourai/console/issues/189)) ([3d038b3](https://github.com/kontourai/console/commit/3d038b37f55d115ca23a10cb0e133b4b7f3fb064))
