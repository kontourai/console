/**
 * Declarative product capabilities consumed by suite-level discovery.
 *
 * A descriptor is inert data. This module deliberately contains no discovery,
 * command execution, network access, or product-kernel imports. The product
 * named by a command's authority remains responsible for interpreting and
 * executing that command.
 */

export const PRODUCT_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION = "1.0.0" as const;
export const PRODUCT_CAPABILITY_PROTOCOL_VERSION = "1.0.0" as const;
export const PRODUCT_CAPABILITY_PROTOCOL_SUPPORTED_MAJOR = 1 as const;

export type ProductCapabilityDescriptorSchemaVersion =
  typeof PRODUCT_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION;

export type ProductCapabilityProtocolVersion = string;

export type ProductCommandSideEffect =
  | "none"
  | "read-local"
  | "write-local"
  | "write-external";

export type ProductCommandConfirmation =
  | "never"
  | "user-request"
  | "operator-request";

export type ProductArtifactDirection = "input" | "output" | "input-output";

export interface ProductCapabilityIdentity {
  id: string;
  displayName: string;
  packageName: string;
}

export interface ProductExecutableDeclaration {
  /** Descriptor-local identifier referenced by commands. */
  id: string;
  /** Exact key from the installed package's `bin` map. */
  packageBin: string;
  /** Literal argv tokens inserted before command argv; never a shell string. */
  argvPrefix?: readonly string[];
}

export interface ProductCommandAuthority {
  /** Execution and command semantics always remain product-owned. */
  kind: "product";
  /** Product identifier that owns execution of this command. */
  productId: string;
  /** Minimum authority required before a router may delegate the command. */
  confirmation: ProductCommandConfirmation;
}

export interface ProductCommandDeclaration {
  /** Bounded CLI path segments below the product namespace. */
  path: readonly string[];
  summary: string;
  executableId: string;
  /** Literal argv tokens appended after argvPrefix; never interpreted as shell. */
  argv: readonly string[];
  sideEffect: ProductCommandSideEffect;
  authority: ProductCommandAuthority;
}

export interface ProductArtifactDeclaration {
  id: string;
  direction: ProductArtifactDirection;
  mediaType: string;
  description: string;
}

export interface ProductProjectionDeclaration {
  id: string;
  schemaRef: string;
  description: string;
}

/**
 * Canonical v1 product capability descriptor.
 *
 * The checked-in JSON Schema is the validation contract for untrusted data.
 * This type is the matching authoring and consumer contract for TypeScript.
 */
export interface ProductCapabilityDescriptor {
  schemaVersion: ProductCapabilityDescriptorSchemaVersion;
  protocolVersion: ProductCapabilityProtocolVersion;
  product: ProductCapabilityIdentity;
  executables: readonly ProductExecutableDeclaration[];
  commands: readonly ProductCommandDeclaration[];
  artifacts: readonly ProductArtifactDeclaration[];
  projections: readonly ProductProjectionDeclaration[];
}

export type ProductCapabilityDiagnosticCode =
  | "DESCRIPTOR_MALFORMED"
  | "DESCRIPTOR_UNKNOWN_FIELD"
  | "DESCRIPTOR_SCHEMA_UNSUPPORTED"
  | "DESCRIPTOR_PROTOCOL_UNSUPPORTED"
  | "DESCRIPTOR_DUPLICATE_IDENTITY"
  | "DESCRIPTOR_DUPLICATE_EXECUTABLE"
  | "DESCRIPTOR_DUPLICATE_COMMAND"
  | "DESCRIPTOR_UNKNOWN_EXECUTABLE"
  | "DESCRIPTOR_AUTHORITY_MISMATCH"
  | "DESCRIPTOR_UNSAFE_ARGV"
  | "DESCRIPTOR_EXECUTABLE_MISSING"
  | "DESCRIPTOR_EXECUTABLE_UNSAFE";

export interface ProductCapabilityDiagnostic {
  code: ProductCapabilityDiagnosticCode;
  severity: "error";
  message: string;
  productId?: string;
  commandPath?: string;
}

export type ProductCapabilityValidationResult =
  | { ok: true; descriptor: ProductCapabilityDescriptor; diagnostics: readonly [] }
  | { ok: false; diagnostics: readonly ProductCapabilityDiagnostic[] };

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SEMVER = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const UNSAFE_ARGV = /^(?:--exec(?:utable)?|--shell)(?:=|$)|^-c$/;

function diagnostic(code: ProductCapabilityDiagnosticCode, message: string, context: Partial<ProductCapabilityDiagnostic> = {}): ProductCapabilityDiagnostic {
  return { code, severity: "error", message, ...context };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closed(value: Record<string, unknown>, allowed: readonly string[], diagnostics: ProductCapabilityDiagnostic[], context: Partial<ProductCapabilityDiagnostic> = {}): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    diagnostics.push(diagnostic("DESCRIPTOR_UNKNOWN_FIELD", "Descriptor object contains an unknown field.", context));
  }
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !CONTROL.test(value);
}

function identifier(value: unknown): value is string {
  return text(value, 64) && ID.test(value);
}

function argv(value: unknown, diagnostics: ProductCapabilityDiagnostic[], context: Partial<ProductCapabilityDiagnostic>): value is string[] {
  if (!Array.isArray(value) || value.length > 64 || value.some((token) => !text(token, 1024))) return false;
  if (value.some((token) => UNSAFE_ARGV.test(token))) {
    diagnostics.push(diagnostic("DESCRIPTOR_UNSAFE_ARGV", "Command argv contains an executable-selection or shell-evaluation option.", context));
    return false;
  }
  return true;
}

/** Validate untrusted descriptor data without importing a product or executing code. */
export function validateProductCapabilityDescriptor(input: unknown): ProductCapabilityValidationResult {
  const diagnostics: ProductCapabilityDiagnostic[] = [];
  if (!object(input)) return { ok: false, diagnostics: [diagnostic("DESCRIPTOR_MALFORMED", "Descriptor must be an object.")] };
  closed(input, ["schemaVersion", "protocolVersion", "product", "executables", "commands", "artifacts", "projections"], diagnostics);

  const product = input.product;
  let productId: string | undefined;
  if (object(product)) {
    closed(product, ["id", "displayName", "packageName"], diagnostics);
    if (identifier(product.id)) productId = product.id;
    if (!identifier(product.id) || !text(product.displayName, 128) || typeof product.packageName !== "string" || product.packageName.length > 214 || !PACKAGE.test(product.packageName)) {
      diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", "Descriptor product identity is malformed."));
    }
  } else diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", "Descriptor product identity is required."));

  if (input.schemaVersion !== PRODUCT_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("DESCRIPTOR_SCHEMA_UNSUPPORTED", "Descriptor schema version is unsupported; regenerate it with the installed protocol tooling.", { productId }));
  }
  const version = typeof input.protocolVersion === "string" ? SEMVER.exec(input.protocolVersion) : null;
  if (!version) diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", "Descriptor protocolVersion must be a semantic version.", { productId }));
  else if (Number(version[1]) !== PRODUCT_CAPABILITY_PROTOCOL_SUPPORTED_MAJOR) diagnostics.push(diagnostic("DESCRIPTOR_PROTOCOL_UNSUPPORTED", `Descriptor protocol major ${version[1]} is unsupported.`, { productId }));

  const executableIds = new Set<string>();
  if (!Array.isArray(input.executables) || input.executables.length < 1 || input.executables.length > 16) {
    diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", "Descriptor executables must contain between 1 and 16 entries.", { productId }));
  } else for (const entry of input.executables) {
    if (!object(entry)) { diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", "Executable declaration is malformed.", { productId })); continue; }
    closed(entry, ["id", "packageBin", "argvPrefix"], diagnostics, { productId });
    if (!identifier(entry.id) || !identifier(entry.packageBin) || (entry.argvPrefix !== undefined && !argv(entry.argvPrefix, diagnostics, { productId }))) {
      diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", "Executable declaration is malformed.", { productId })); continue;
    }
    if (executableIds.has(entry.id)) diagnostics.push(diagnostic("DESCRIPTOR_DUPLICATE_EXECUTABLE", `Executable identity '${entry.id}' is duplicated.`, { productId }));
    executableIds.add(entry.id);
  }

  const commandPaths = new Set<string>();
  if (!Array.isArray(input.commands) || input.commands.length < 1 || input.commands.length > 256) {
    diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", "Descriptor commands must contain between 1 and 256 entries.", { productId }));
  } else for (const entry of input.commands) {
    if (!object(entry)) { diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", "Command declaration is malformed.", { productId })); continue; }
    closed(entry, ["path", "summary", "executableId", "argv", "sideEffect", "authority"], diagnostics, { productId });
    const path = Array.isArray(entry.path) && entry.path.length >= 1 && entry.path.length <= 8 && entry.path.every(identifier) ? entry.path.join(" ") : undefined;
    const context = { productId, commandPath: path };
    const authority = entry.authority;
    if (object(authority)) closed(authority, ["kind", "productId", "confirmation"], diagnostics, context);
    const valid = path !== undefined && text(entry.summary, 256) && identifier(entry.executableId) && argv(entry.argv, diagnostics, context)
      && ["none", "read-local", "write-local", "write-external"].includes(entry.sideEffect as string)
      && object(authority) && authority.kind === "product" && identifier(authority.productId)
      && ["never", "user-request", "operator-request"].includes(authority.confirmation as string);
    if (!valid) diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", "Command declaration is malformed.", context));
    if (path && commandPaths.has(path)) diagnostics.push(diagnostic("DESCRIPTOR_DUPLICATE_COMMAND", `Command path '${path}' is duplicated.`, context));
    if (path) commandPaths.add(path);
    if (identifier(entry.executableId) && !executableIds.has(entry.executableId)) diagnostics.push(diagnostic("DESCRIPTOR_UNKNOWN_EXECUTABLE", `Command '${path ?? "unknown"}' references an unknown executable.`, context));
    if (object(authority) && productId && authority.productId !== productId) diagnostics.push(diagnostic("DESCRIPTOR_AUTHORITY_MISMATCH", "Command authority does not match the descriptor product.", context));
  }

  for (const [field, limit, allowed, validEntry] of [
    ["artifacts", 128, ["id", "direction", "mediaType", "description"], (entry: Record<string, unknown>) => identifier(entry.id) && ["input", "output", "input-output"].includes(entry.direction as string) && typeof entry.mediaType === "string" && entry.mediaType.length <= 127 && MEDIA_TYPE.test(entry.mediaType) && text(entry.description, 256)],
    ["projections", 128, ["id", "schemaRef", "description"], (entry: Record<string, unknown>) => identifier(entry.id) && text(entry.schemaRef, 512) && text(entry.description, 256)]
  ] as const) {
    const entries = input[field];
    if (!Array.isArray(entries) || entries.length > limit) { diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", `Descriptor ${field} is malformed.`, { productId })); continue; }
    for (const entry of entries) {
      if (!object(entry)) { diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", `${field} declaration is malformed.`, { productId })); continue; }
      closed(entry, allowed, diagnostics, { productId });
      if (!validEntry(entry)) diagnostics.push(diagnostic("DESCRIPTOR_MALFORMED", `${field} declaration is malformed.`, { productId }));
    }
  }

  diagnostics.sort((a, b) => a.code.localeCompare(b.code) || (a.productId ?? "").localeCompare(b.productId ?? "") || (a.commandPath ?? "").localeCompare(b.commandPath ?? "") || a.message.localeCompare(b.message));
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, descriptor: input as unknown as ProductCapabilityDescriptor, diagnostics: [] };
}

export interface ProductDescriptorNegotiationResult {
  ok: boolean;
  descriptors: readonly ProductCapabilityDescriptor[];
  diagnostics: readonly ProductCapabilityDiagnostic[];
}

/** Validate and order a caller-supplied candidate set; later duplicates never win. */
export function negotiateProductCapabilityDescriptors(inputs: readonly unknown[]): ProductDescriptorNegotiationResult {
  const descriptors: ProductCapabilityDescriptor[] = [];
  const diagnostics: ProductCapabilityDiagnostic[] = [];
  const ids = new Set<string>();
  for (const input of inputs) {
    const result = validateProductCapabilityDescriptor(input);
    if (!result.ok) { diagnostics.push(...result.diagnostics); continue; }
    const id = result.descriptor.product.id;
    if (ids.has(id)) diagnostics.push(diagnostic("DESCRIPTOR_DUPLICATE_IDENTITY", `Product identity '${id}' is duplicated.`, { productId: id }));
    else { ids.add(id); descriptors.push(result.descriptor); }
  }
  diagnostics.sort((a, b) => a.code.localeCompare(b.code) || (a.productId ?? "").localeCompare(b.productId ?? "") || a.message.localeCompare(b.message));
  return { ok: diagnostics.length === 0, descriptors, diagnostics };
}

export interface LocalProductPackageCandidate {
  /** Explicit caller-owned package root; ambient locations are never searched. */
  root: string;
  /** Exact name parsed from this root's package.json. */
  packageName: string;
  /** Parsed package.json bin map. Relative paths only. */
  bins: Readonly<Record<string, string>>;
}

export interface ResolvedProductExecutable {
  executablePath: string;
  argvPrefix: readonly string[];
}

export type ProductExecutableResolutionResult =
  | { ok: true; value: ResolvedProductExecutable; diagnostics: readonly [] }
  | { ok: false; diagnostics: readonly ProductCapabilityDiagnostic[] };
