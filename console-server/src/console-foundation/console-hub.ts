const path = require("node:path");
const { LocalFileSink } = require("./emitter");
import type {
  ConsoleEventRecord,
  ConsoleProjectionRecord,
  ConsoleRecord,
  CurrentOperatingStateOptions,
  DeliveryResult,
  InspectionReport,
  LocalConsoleHubOptions,
  OperatingState,
  Sink
} from "./types";

const LOCAL_KONTOUR_DIR = ".kontour";

class LocalConsoleHub {
  rootDir: string;
  kontourRoot: string;
  sink: Sink;

  constructor(options: LocalConsoleHubOptions = {}) {
    this.rootDir = path.resolve(options.rootDir || process.cwd());
    this.kontourRoot = resolveUnderRoot(this.rootDir, options.kontourRoot || options.localRoot || LOCAL_KONTOUR_DIR);
    this.sink = options.sink || new LocalFileSink({
      root: this.kontourRoot,
      sinkId: options.sinkId || "local-console-hub",
      sinkRole: options.sinkRole || "LocalConsoleHub"
    });
  }

  append(record: ConsoleRecord): Promise<DeliveryResult> {
    return Promise.resolve(this.sink.deliver(record));
  }

  appendEvent(event: ConsoleEventRecord): Promise<DeliveryResult> {
    return this.append(event);
  }

  appendProjection(projection: ConsoleProjectionRecord): Promise<DeliveryResult> {
    return this.append(projection);
  }

  inspect(): InspectionReport {
    return foundation().inspectLocalKontour({
      rootDir: this.rootDir,
      kontourRoot: this.kontourRoot
    });
  }

  currentOperatingState(options: CurrentOperatingStateOptions = {}): OperatingState {
    return foundation().buildCurrentOperatingState(this.inspect(), options);
  }
}

function createLocalConsoleHub(options: LocalConsoleHubOptions = {}): LocalConsoleHub {
  return new LocalConsoleHub(options);
}

function foundation() {
  return require("./index");
}

function resolveUnderRoot(rootDir: string, maybeRelativePath: string): string {
  return path.resolve(path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.join(rootDir, maybeRelativePath));
}

module.exports = {
  LocalConsoleHub,
  createLocalConsoleHub
};
