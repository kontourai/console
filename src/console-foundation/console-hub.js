const path = require("node:path");
const { LocalFileSink } = require("./emitter");

const LOCAL_KONTOUR_DIR = ".kontour";

class LocalConsoleHub {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.cwd());
    this.kontourRoot = resolveUnderRoot(this.rootDir, options.kontourRoot || options.localRoot || LOCAL_KONTOUR_DIR);
    this.sink = options.sink || new LocalFileSink({
      root: this.kontourRoot,
      sinkId: options.sinkId || "local-console-hub",
      sinkRole: options.sinkRole || "LocalConsoleHub"
    });
  }

  append(record) {
    return Promise.resolve(this.sink.deliver(record));
  }

  appendEvent(event) {
    return this.append(event);
  }

  appendProjection(projection) {
    return this.append(projection);
  }

  inspect() {
    return foundation().inspectLocalKontour({
      rootDir: this.rootDir,
      kontourRoot: this.kontourRoot
    });
  }

  currentOperatingState(options = {}) {
    return foundation().buildCurrentOperatingState(this.inspect(), options);
  }
}

function createLocalConsoleHub(options = {}) {
  return new LocalConsoleHub(options);
}

function foundation() {
  return require("./index");
}

function resolveUnderRoot(rootDir, maybeRelativePath) {
  return path.resolve(path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.join(rootDir, maybeRelativePath));
}

module.exports = {
  LocalConsoleHub,
  createLocalConsoleHub
};
