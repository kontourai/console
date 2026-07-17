// GENERATED from src/console-foundation/types.ts by scripts/generate-openapi-schemas.mjs.
// Do not edit by hand. Run: npm run generate:openapi -w console-server
// JSON Schema (draft-07) definitions for the console API types; consumed by openapi.ts.
export const GENERATED_DEFINITIONS: Record<string, unknown> = {
  "DeliveryOutcome": {
    "type": "string",
    "enum": [
      "accepted",
      "skipped",
      "failed"
    ]
  },
  "DeliveryResult": {
    "type": "object",
    "properties": {
      "sinkId": {
        "type": "string"
      },
      "sinkRole": {
        "type": "string"
      },
      "outcome": {
        "$ref": "#/definitions/DeliveryOutcome"
      },
      "status": {
        "type": "string"
      },
      "recordId": {
        "type": "string"
      },
      "recordKind": {
        "$ref": "#/definitions/RecordKind"
      },
      "observedAt": {
        "type": "string"
      },
      "destination": {
        "type": "string"
      },
      "retryable": {
        "type": "boolean"
      },
      "errorCode": {
        "type": "string"
      },
      "safeMessage": {
        "type": "string"
      },
      "children": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/DeliveryResult"
        }
      }
    },
    "required": [
      "sinkId",
      "sinkRole",
      "outcome",
      "status",
      "recordId",
      "recordKind",
      "observedAt"
    ],
    "additionalProperties": {}
  },
  "RecordKind": {
    "type": "string",
    "enum": [
      "event",
      "projection",
      "economics"
    ]
  },
  "TelemetryActionClass": {
    "type": "string",
    "enum": [
      "edit",
      "read",
      "search",
      "execute",
      "web",
      "delegate",
      "other"
    ]
  },
  "TelemetryActionClassSummary": {
    "type": "object",
    "properties": {
      "actionClass": {
        "$ref": "#/definitions/TelemetryActionClass"
      },
      "label": {
        "type": "string"
      },
      "count": {
        "type": "number",
        "description": "Distinct tool *actions* (tool.invoke events; tool.result is the paired completion of the same action and is not counted again)."
      },
      "sessionCount": {
        "type": "number",
        "description": "Distinct sessions that performed at least one action in this class."
      }
    },
    "required": [
      "actionClass",
      "label",
      "count",
      "sessionCount"
    ],
    "additionalProperties": false
  },
  "TelemetryActivityBucket": {
    "type": "object",
    "properties": {
      "startedAt": {
        "type": "string",
        "description": "ISO start of the bucket window."
      },
      "byActionClass": {
        "type": "object",
        "properties": {
          "edit": {
            "type": "number"
          },
          "read": {
            "type": "number"
          },
          "search": {
            "type": "number"
          },
          "execute": {
            "type": "number"
          },
          "web": {
            "type": "number"
          },
          "delegate": {
            "type": "number"
          },
          "other": {
            "type": "number"
          }
        },
        "required": [
          "edit",
          "read",
          "search",
          "execute",
          "web",
          "delegate",
          "other"
        ],
        "additionalProperties": false,
        "description": "Count of tool.invoke actions in this bucket, per action class (zero-filled across all classes for a stable stacked-chart shape)."
      },
      "total": {
        "type": "number",
        "description": "Sum of byActionClass — total actions in the bucket."
      }
    },
    "required": [
      "startedAt",
      "byActionClass",
      "total"
    ],
    "additionalProperties": false,
    "description": "One time bucket of tool.invoke activity, split by action class."
  },
  "TelemetryActivityTimeline": {
    "type": "object",
    "properties": {
      "bucket": {
        "type": "string",
        "enum": [
          "hour",
          "day"
        ]
      },
      "buckets": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryActivityBucket"
        }
      }
    },
    "required": [
      "bucket",
      "buckets"
    ],
    "additionalProperties": false,
    "description": "Activity (tool.invoke) over time, bucketed at a fixed granularity. Sparse: only buckets with activity are emitted, most-recent window first trimmed to a cap. Counts invokes only (like actionClasses) to avoid double-counting the paired tool.result."
  },
  "TelemetryAnalyticsSummary": {
    "type": "object",
    "properties": {
      "facets": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryFacetSummary"
        }
      },
      "flows": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryFlowSummary"
        }
      },
      "usageByModel": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryUsageBreakdown"
        }
      },
      "usageByProject": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryUsageBreakdown"
        }
      },
      "usageByAgent": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryUsageBreakdown"
        }
      },
      "usageByRuntime": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryUsageBreakdown"
        }
      },
      "usageByTaskSlug": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryUsageBreakdown"
        },
        "description": "Cost grouped by Builder work-item (task_slug). Populated once the emitter stamps task attribution; empty for runtimes/sessions without a work item."
      },
      "actionClasses": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryActionClassSummary"
        }
      },
      "costPerTurn": {
        "$ref": "#/definitions/TelemetryTurnCostSummary"
      },
      "toolReliability": {
        "$ref": "#/definitions/TelemetryToolReliabilitySummary"
      },
      "activityTimeline": {
        "$ref": "#/definitions/TelemetryActivityTimeline"
      }
    },
    "required": [
      "facets",
      "flows",
      "usageByModel",
      "usageByProject",
      "usageByAgent",
      "usageByRuntime",
      "usageByTaskSlug",
      "actionClasses",
      "costPerTurn",
      "toolReliability",
      "activityTimeline"
    ],
    "additionalProperties": false
  },
  "TelemetryCountSummary": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string"
      },
      "count": {
        "type": "number"
      }
    },
    "required": [
      "name",
      "count"
    ],
    "additionalProperties": false
  },
  "TelemetryFacetSummary": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "label": {
        "type": "string"
      },
      "counts": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryCountSummary"
        }
      }
    },
    "required": [
      "id",
      "label",
      "counts"
    ],
    "additionalProperties": false
  },
  "TelemetryFlowItem": {
    "type": "object",
    "properties": {
      "slug": {
        "type": "string"
      },
      "title": {
        "type": "string"
      },
      "status": {
        "type": "string"
      },
      "updatedAt": {
        "type": "string"
      },
      "attributes": {
        "type": "object",
        "additionalProperties": {
          "type": "string"
        }
      },
      "details": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "label": {
              "type": "string"
            },
            "value": {
              "type": "string"
            }
          },
          "required": [
            "label",
            "value"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "slug"
    ],
    "additionalProperties": false
  },
  "TelemetryFlowSummary": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "label": {
        "type": "string"
      },
      "total": {
        "type": "number"
      },
      "items": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryFlowItem"
        }
      }
    },
    "required": [
      "id",
      "label",
      "total",
      "items"
    ],
    "additionalProperties": false
  },
  "TelemetryPaginationSummary": {
    "type": "object",
    "properties": {
      "limit": {
        "type": "number"
      },
      "offset": {
        "type": "number"
      },
      "returnedCount": {
        "type": "number"
      },
      "totalMatchedCount": {
        "type": "number"
      },
      "nextOffset": {
        "type": "number"
      }
    },
    "required": [
      "limit",
      "offset",
      "returnedCount",
      "totalMatchedCount"
    ],
    "additionalProperties": false
  },
  "TelemetryQueryFilter": {
    "type": "object",
    "properties": {
      "facetId": {
        "type": "string"
      },
      "label": {
        "type": "string"
      },
      "value": {
        "type": "string"
      }
    },
    "required": [
      "facetId",
      "label",
      "value"
    ],
    "additionalProperties": false
  },
  "TelemetryQueryPreset": {
    "type": "string",
    "enum": [
      "live",
      "15m",
      "24h",
      "7d",
      "custom"
    ]
  },
  "TelemetryQuerySummary": {
    "type": "object",
    "properties": {
      "preset": {
        "$ref": "#/definitions/TelemetryQueryPreset"
      },
      "from": {
        "type": "string"
      },
      "to": {
        "type": "string"
      },
      "q": {
        "type": "string"
      },
      "filters": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryQueryFilter"
        }
      },
      "sort": {
        "$ref": "#/definitions/TelemetrySortDirection"
      }
    },
    "required": [
      "filters",
      "sort"
    ],
    "additionalProperties": false
  },
  "TelemetryRecord": {
    "type": "object",
    "properties": {
      "schema_version": {
        "type": "string"
      },
      "event_type": {
        "type": "string"
      },
      "session_id": {
        "type": "string"
      },
      "event_id": {
        "type": "string"
      }
    },
    "required": [
      "schema_version",
      "event_type",
      "session_id",
      "event_id"
    ]
  },
  "TelemetryRecordKind": {
    "type": "string",
    "enum": [
      "runtime",
      "workflow-sidecar"
    ]
  },
  "TelemetryRecordSummary": {
    "type": "object",
    "properties": {
      "sourceId": {
        "type": "string"
      },
      "sourceKind": {
        "$ref": "#/definitions/TelemetryRecordKind"
      },
      "eventId": {
        "type": "string"
      },
      "eventType": {
        "type": "string"
      },
      "sessionId": {
        "type": "string"
      },
      "observedAt": {
        "type": "string"
      },
      "status": {
        "type": "string"
      },
      "outcome": {
        "type": "string"
      },
      "durationMs": {
        "type": "number"
      },
      "agentName": {
        "type": "string"
      },
      "runtime": {
        "type": "string"
      },
      "runtimeVersion": {
        "type": "string"
      },
      "model": {
        "type": "string"
      },
      "hookEventName": {
        "type": "string"
      },
      "runtimeSessionId": {
        "type": "string"
      },
      "turnId": {
        "type": "string"
      },
      "project": {
        "type": "string"
      },
      "cwd": {
        "type": "string"
      },
      "delegationTarget": {
        "type": "string"
      },
      "toolName": {
        "type": "string"
      },
      "toolDurationMs": {
        "type": "number",
        "description": "tool.result latency in ms (flow-agents #580); null/absent when the runtime did not measure it. Feeds the per-tool p50/p95 reliability projection."
      },
      "toolOutcome": {
        "type": "string",
        "description": "tool.result honest outcome (flow-agents #580): \"pass\" | \"fail\" | \"ambiguous\". Ambiguous is neither success nor failure and is reported separately."
      },
      "taskSlug": {
        "type": "string"
      },
      "title": {
        "type": "string"
      },
      "inputTokens": {
        "type": "number"
      },
      "outputTokens": {
        "type": "number"
      },
      "cacheCreationInputTokens": {
        "type": "number"
      },
      "cacheReadInputTokens": {
        "type": "number"
      },
      "estimatedCostUsd": {
        "type": "number"
      },
      "usageByModel": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryUsageBreakdown"
        }
      },
      "attributes": {
        "type": "object",
        "additionalProperties": {
          "type": "string"
        }
      },
      "path": {
        "type": "string"
      }
    },
    "required": [
      "sourceId",
      "sourceKind",
      "eventId",
      "eventType",
      "sessionId"
    ],
    "additionalProperties": false
  },
  "TelemetrySortDirection": {
    "type": "string",
    "enum": [
      "desc",
      "asc"
    ]
  },
  "TelemetrySourceSummary": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "kind": {
        "$ref": "#/definitions/TelemetryRecordKind"
      },
      "path": {
        "type": "string"
      },
      "recordCount": {
        "type": "number"
      },
      "warningCount": {
        "type": "number"
      },
      "warnings": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/ValidationIssue"
        }
      }
    },
    "required": [
      "id",
      "kind",
      "path",
      "recordCount",
      "warningCount",
      "warnings"
    ],
    "additionalProperties": false
  },
  "TelemetrySummary": {
    "type": "object",
    "properties": {
      "generatedAt": {
        "type": "string"
      },
      "sources": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetrySourceSummary"
        }
      },
      "totals": {
        "type": "object",
        "properties": {
          "recordCount": {
            "type": "number"
          },
          "sessionCount": {
            "type": "number"
          },
          "eventTypeCounts": {
            "type": "object",
            "additionalProperties": {
              "type": "number"
            }
          },
          "productRecordCount": {
            "type": "number"
          },
          "usage": {
            "$ref": "#/definitions/TelemetryUsageTotals"
          }
        },
        "required": [
          "recordCount",
          "sessionCount",
          "eventTypeCounts",
          "productRecordCount",
          "usage"
        ],
        "additionalProperties": false
      },
      "analytics": {
        "$ref": "#/definitions/TelemetryAnalyticsSummary"
      },
      "records": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryRecordSummary"
        }
      },
      "query": {
        "$ref": "#/definitions/TelemetryQuerySummary"
      },
      "pagination": {
        "$ref": "#/definitions/TelemetryPaginationSummary"
      },
      "warnings": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/ValidationIssue"
        }
      }
    },
    "required": [
      "generatedAt",
      "sources",
      "totals",
      "analytics",
      "records",
      "warnings"
    ],
    "additionalProperties": false
  },
  "TelemetryToolReliability": {
    "type": "object",
    "properties": {
      "toolName": {
        "type": "string"
      },
      "actionClass": {
        "$ref": "#/definitions/TelemetryActionClass"
      },
      "count": {
        "type": "number",
        "description": "tool.result events observed for this tool (all outcomes, timed or not)."
      },
      "p50DurationMs": {
        "type": [
          "number",
          "null"
        ],
        "description": "p50 latency over non-null durations; null when no result carried a duration."
      },
      "p95DurationMs": {
        "type": [
          "number",
          "null"
        ],
        "description": "p95 latency over non-null durations; null when no result carried a duration."
      },
      "failureRate": {
        "type": "number",
        "description": "fail / (pass + fail) — ambiguous excluded from the denominator. 0 when no pass-or-fail result exists yet."
      },
      "failCount": {
        "type": "number"
      },
      "passCount": {
        "type": "number"
      },
      "ambiguousCount": {
        "type": "number"
      }
    },
    "required": [
      "toolName",
      "actionClass",
      "count",
      "p50DurationMs",
      "p95DurationMs",
      "failureRate",
      "failCount",
      "passCount",
      "ambiguousCount"
    ],
    "additionalProperties": false,
    "description": "Per-tool latency + outcome reliability over the tool.result stream (flow-agents #580). Honest by construction: `ambiguous` results are excluded from the failure-rate denominator and reported separately as ambiguousCount, never folded into pass or fail."
  },
  "TelemetryToolReliabilitySummary": {
    "type": "object",
    "properties": {
      "tools": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryToolReliability"
        },
        "description": "One row per tool, ordered by result volume (desc), then name."
      }
    },
    "required": [
      "tools"
    ],
    "additionalProperties": false
  },
  "TelemetryTurnCost": {
    "type": "object",
    "properties": {
      "inputTokens": {
        "type": "number"
      },
      "outputTokens": {
        "type": "number"
      },
      "cacheCreationInputTokens": {
        "type": "number"
      },
      "cacheReadInputTokens": {
        "type": "number"
      },
      "totalTokens": {
        "type": "number"
      },
      "estimatedCostUsd": {
        "type": "number"
      },
      "turnId": {
        "type": "string"
      },
      "sessionId": {
        "type": "string"
      },
      "model": {
        "type": "string"
      },
      "toolCount": {
        "type": "number",
        "description": "tool.invoke events observed in this turn."
      },
      "startedAt": {
        "type": "string"
      }
    },
    "required": [
      "cacheCreationInputTokens",
      "cacheReadInputTokens",
      "estimatedCostUsd",
      "inputTokens",
      "outputTokens",
      "sessionId",
      "toolCount",
      "totalTokens",
      "turnId"
    ],
    "additionalProperties": false,
    "description": "One turn's cost, de-duplicated from the per-event usage snapshot that every tool event of the turn carries (flow-agents emitter slice #568). The snapshot is identical across a turn's events, so the turn is attributed its cost once — NOT once per tool call. This is the correct per-turn cost basis."
  },
  "TelemetryTurnCostSummary": {
    "type": "object",
    "properties": {
      "turns": {
        "type": "array",
        "items": {
          "$ref": "#/definitions/TelemetryTurnCost"
        }
      },
      "turnCount": {
        "type": "number"
      },
      "totalEstimatedCostUsd": {
        "type": "number",
        "description": "Sum of each distinct turn's cost — every turn counted once."
      }
    },
    "required": [
      "turns",
      "turnCount",
      "totalEstimatedCostUsd"
    ],
    "additionalProperties": false
  },
  "TelemetryUsageBreakdown": {
    "type": "object",
    "properties": {
      "inputTokens": {
        "type": "number"
      },
      "outputTokens": {
        "type": "number"
      },
      "cacheCreationInputTokens": {
        "type": "number"
      },
      "cacheReadInputTokens": {
        "type": "number"
      },
      "totalTokens": {
        "type": "number"
      },
      "estimatedCostUsd": {
        "type": "number"
      },
      "key": {
        "type": "string"
      },
      "label": {
        "type": "string"
      }
    },
    "required": [
      "cacheCreationInputTokens",
      "cacheReadInputTokens",
      "estimatedCostUsd",
      "inputTokens",
      "key",
      "label",
      "outputTokens",
      "totalTokens"
    ],
    "additionalProperties": false
  },
  "TelemetryUsageTotals": {
    "type": "object",
    "properties": {
      "inputTokens": {
        "type": "number"
      },
      "outputTokens": {
        "type": "number"
      },
      "cacheCreationInputTokens": {
        "type": "number"
      },
      "cacheReadInputTokens": {
        "type": "number"
      },
      "totalTokens": {
        "type": "number"
      },
      "estimatedCostUsd": {
        "type": "number"
      }
    },
    "required": [
      "inputTokens",
      "outputTokens",
      "cacheCreationInputTokens",
      "cacheReadInputTokens",
      "totalTokens",
      "estimatedCostUsd"
    ],
    "additionalProperties": false
  },
  "ValidationIssue": {
    "type": "object",
    "properties": {
      "severity": {
        "$ref": "#/definitions/ValidationSeverity"
      },
      "path": {
        "type": "string"
      },
      "message": {
        "type": "string"
      }
    },
    "required": [
      "severity",
      "path",
      "message"
    ],
    "additionalProperties": false
  },
  "ValidationSeverity": {
    "type": "string",
    "enum": [
      "error",
      "warning"
    ]
  }
};
