// Shared scope-qualified "flow-agents workflow" subject identity (console#254).
//
// Two INDEPENDENT flow-agents projection envelope families describe the same
// underlying workflow directory: `workflow-process-projection.ts` (console#239,
// consumed by workflow-process-bridge.ts) and `workflow-trust-projection.ts`
// (flow-agents#891, consumed by workflow-trust-bridge.ts). Each envelope's own
// top-level `entry.id` is a hash of a DIFFERENT source file's relative path
// plus the task slug (`state.json` for process entries, `trust.bundle` for
// trust entries) -- those two hashes never coincide, so qualifying a folded
// subject id by `entry.id` (as workflow-process-bridge originally did, console#239
// review finding 1) makes it structurally IMPOSSIBLE for the trust bridge to
// point a `gate.*` event's `processRef` at the exact process card the process
// bridge already created for the same workflow: the trust envelope never
// carries the process envelope's `entry.id`.
//
// The one field BOTH envelope families carry byte-identically for a given
// workflow is `entry.subjectRef` (`{product:"flow-agents", kind:"workflow",
// id:<task_slug>, label:<task_slug>}` -- see workflow-process-projection.ts's
// `mapProcessSource` and workflow-trust-projection.ts's `mapTrustSource`, both
// setting `subjectRef.id` to the workflow's `task_slug`). Qualifying by
// `subjectRef.id` instead of `entry.id` keeps the SAME collision protection
// console#239 review finding 1 established (`task_slug` is not itself
// scope-qualified upstream, so two different scopes could legitimately reuse
// the same slug) while letting two independently-bridged envelope families
// derive the IDENTICAL process subject id for the same workflow in the same
// scope -- the join key console#254 (gate trust panel bridging) needs.
export function qualifiedWorkflowSubjectId(
  producerProduct: string,
  scope: { kind: string; id: string },
  taskSlug: string,
): string {
  return [producerProduct, scope.kind, scope.id, taskSlug].join(":");
}
