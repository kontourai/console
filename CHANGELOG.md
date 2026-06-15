# Changelog

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
