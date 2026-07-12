# npm package releases

`@kontourai/console-core` is the canonical owner of shared Console contracts and is released independently from the root Console package. The CLI uses an exact Core version because its executable loads Core package subpaths at startup.

Release Core before CLI. A CLI tag is allowed to publish only after its exact Core dependency is visible on npm and exposes both `./product-capability-descriptor` and `./product-capability-descriptor/node`. Core publication is blocking, not best effort.

Local workspace success is not adopter evidence. Pull requests must install copied CLI and Core tarballs in a temporary directory outside the repository with workspace resolution unavailable. Release verification additionally installs exact public versions into an isolated npm cache and runs the public `npx` entrypoint. Release Please owns package manifests, changelogs, component tags, and root lock workspace identities; generated release pull requests must not be repaired by hand.
