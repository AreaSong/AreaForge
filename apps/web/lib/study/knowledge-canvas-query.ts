import {
  clampCanvasDepth,
  clampCanvasPageSize,
  KNOWLEDGE_CANVAS_MAX_DEPTH,
  type KnowledgeCanvasEdgeInput,
  type KnowledgeCanvasEntityType,
  type KnowledgeCanvasNodeInput,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";

const MAX_CONTEXT_ROWS_PER_CANDIDATE = 8;
const MAX_PARENT_CONTEXT_DEPTH = KNOWLEDGE_CANVAS_MAX_DEPTH * 2;
const MAX_STALE_LAYOUT_CANDIDATES = 100;

interface CanvasIndexNodeRow {
  node_key: string;
  entity_type: KnowledgeCanvasEntityType;
  entity_id: string;
  parent_id: string | null;
  label: string;
  subject_id: string | null;
  candidate_visible: boolean;
  sort_index: number;
}

interface CanvasAncestorRow extends CanvasIndexNodeRow {
  origin_key: string;
  context_depth: number;
}

interface CanvasRelationRow extends CanvasIndexNodeRow {
  origin_key: string;
  edge_id: string;
  source_id: string;
  target_id: string;
  edge_kind: KnowledgeCanvasEdgeInput["kind"];
}

interface CanvasIndexAggregateRow {
  focus_node: CanvasIndexNodeRow | null;
  candidates: CanvasIndexNodeRow[];
  ancestors: CanvasAncestorRow[];
  relation_context: CanvasRelationRow[];
  graph_node_count: bigint;
  graph_edge_count: bigint;
  focus_exists: boolean;
  cursor_valid: boolean;
  ancestor_truncated: boolean;
  relation_truncated: boolean;
}

export interface KnowledgeCanvasIndexNode extends KnowledgeCanvasNodeInput {
  entityId: string;
  contextOnly: boolean;
  sortIndex: number;
}

export interface KnowledgeCanvasIndexLoadStats {
  candidateRowsRead: number;
  ancestorRowsRead: number;
  relationRowsRead: number;
  returnedNodeRows: number;
  returnedEdgeRows: number;
  candidateWindowLimit: number;
  relationWindowLimit: number;
}

export interface KnowledgeCanvasIndexPage {
  nodes: KnowledgeCanvasIndexNode[];
  edges: KnowledgeCanvasEdgeInput[];
  nextCursor: string | null;
  truncated: boolean;
  contextTruncated: boolean;
  invalidCursor: boolean;
  focusFound: boolean;
  graphNodeCount: number;
  graphEdgeCount: number;
  loadStats: KnowledgeCanvasIndexLoadStats;
}

function escapeLikePattern(value: string): string {
  return `%${value.toLowerCase().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function toIndexNode(row: CanvasIndexNodeRow): KnowledgeCanvasIndexNode {
  return {
    id: row.node_key,
    entityId: row.entity_id,
    entityType: row.entity_type,
    parentId: row.parent_id,
    label: row.label,
    subjectId: row.subject_id,
    contextOnly: !row.candidate_visible,
    sortIndex: Number(row.sort_index),
  };
}

function canonicalEdgeFor(node: KnowledgeCanvasIndexNode): KnowledgeCanvasEdgeInput | null {
  if (!node.parentId) return null;
  const kind = node.entityType === "STUDY_SESSION"
    ? "evidence"
    : node.entityType === "REVIEW_SCHEDULE"
      ? "schedules"
      : node.entityType === "TASK" && node.parentId.startsWith("TASK:")
        ? "contains"
        : node.entityType === "SUBJECT_GROUP" ||
            node.entityType === "SUBJECT" ||
            node.entityType === "SYLLABUS_NODE" ||
            node.entityType === "MILESTONE"
          ? "contains"
          : "related";
  return {
    id: `${kind}:${node.parentId}:${node.id}`,
    sourceId: node.parentId,
    targetId: node.id,
    kind,
  };
}

/**
 * PostgreSQL performs graph reachability and keyset pagination. Only the
 * candidate window plus bounded parent/relation context crosses into Node.
 */
export async function queryKnowledgeCanvasIndexPage(input: {
  workspaceId: string;
  focusId: string;
  depth?: number | null;
  cursor?: string | null;
  limit?: number | null;
  query?: string | null;
  subjectId?: string | null;
  entityType?: KnowledgeCanvasEntityType | null;
  includeAllStatuses: boolean;
}): Promise<KnowledgeCanvasIndexPage> {
  const depth = clampCanvasDepth(input.depth);
  const limit = clampCanvasPageSize(input.limit);
  const candidateWindowLimit = limit + 1;
  const relationOriginLimit = candidateWindowLimit + 1;
  const relationWindowLimit = relationOriginLimit * MAX_CONTEXT_ROWS_PER_CANDIDATE;
  const query = input.query?.trim() || null;
  const queryPattern = query ? escapeLikePattern(query) : null;
  const cursor = input.cursor?.trim() || null;

  const rows = await prisma.$queryRaw<CanvasIndexAggregateRow[]>`
    WITH RECURSIVE
    all_nodes AS (
      SELECT
        'WORKSPACE'::text AS entity_type,
        w."id" AS entity_id,
        CONCAT('WORKSPACE:', w."id") AS node_key,
        NULL::text AS parent_id,
        w."name" AS label,
        NULL::text AS subject_id,
        TRUE AS candidate_visible
      FROM "ExamWorkspace" w
      WHERE w."id" = ${input.workspaceId}

      UNION ALL
      SELECT 'SUBJECT_GROUP', g."id", CONCAT('SUBJECT_GROUP:', g."id"),
        CONCAT('WORKSPACE:', g."workspaceId"), g."name", NULL::text,
        g."archivedAt" IS NULL
      FROM "SubjectGroup" g
      WHERE g."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT 'SUBJECT', s."id", CONCAT('SUBJECT:', s."id"),
        CASE WHEN s."groupId" IS NULL
          THEN CONCAT('WORKSPACE:', s."workspaceId")
          ELSE CONCAT('SUBJECT_GROUP:', s."groupId")
        END,
        s."name", s."id", s."archivedAt" IS NULL
      FROM "Subject" s
      WHERE s."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT 'SYLLABUS_NODE', n."id", CONCAT('SYLLABUS_NODE:', n."id"),
        CASE WHEN n."parentId" IS NULL
          THEN CONCAT('SUBJECT:', n."subjectId")
          ELSE CONCAT('SYLLABUS_NODE:', n."parentId")
        END,
        n."title", n."subjectId", n."archivedAt" IS NULL
      FROM "SyllabusNode" n
      JOIN "Subject" s ON s."id" = n."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT 'NOTE', n."id", CONCAT('NOTE:', n."id"),
        CASE WHEN n."syllabusNodeId" IS NULL
          THEN CONCAT('SUBJECT:', n."subjectId")
          ELSE CONCAT('SYLLABUS_NODE:', n."syllabusNodeId")
        END,
        n."title", n."subjectId", n."archivedAt" IS NULL
      FROM "Note" n
      JOIN "Subject" s ON s."id" = n."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT 'MISTAKE', m."id", CONCAT('MISTAKE:', m."id"),
        CASE WHEN m."syllabusNodeId" IS NULL
          THEN CONCAT('SUBJECT:', m."subjectId")
          ELSE CONCAT('SYLLABUS_NODE:', m."syllabusNodeId")
        END,
        m."title", m."subjectId", m."archivedAt" IS NULL
      FROM "Mistake" m
      JOIN "Subject" s ON s."id" = m."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT 'STUDY_RESOURCE', r."id", CONCAT('STUDY_RESOURCE:', r."id"),
        CASE WHEN r."subjectId" IS NULL
          THEN CONCAT('WORKSPACE:', r."workspaceId")
          ELSE CONCAT('SUBJECT:', r."subjectId")
        END,
        r."title", r."subjectId", r."archivedAt" IS NULL
      FROM "StudyResource" r
      WHERE r."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT 'TASK', t."id", CONCAT('TASK:', t."id"),
        CASE
          WHEN t."parentTaskId" IS NOT NULL THEN CONCAT('TASK:', t."parentTaskId")
          WHEN t."syllabusNodeId" IS NOT NULL THEN CONCAT('SYLLABUS_NODE:', t."syllabusNodeId")
          ELSE CONCAT('SUBJECT:', t."subjectId")
        END,
        t."title", t."subjectId",
        (${input.includeAllStatuses} OR t."status"::text IN ('TODO', 'IN_PROGRESS', 'DEFERRED'))
      FROM "StudyTask" t
      JOIN "Subject" s ON s."id" = t."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT 'MILESTONE', m."id", CONCAT('MILESTONE:', m."id"),
        CASE WHEN m."subjectId" IS NULL
          THEN CONCAT('WORKSPACE:', m."workspaceId")
          ELSE CONCAT('SUBJECT:', m."subjectId")
        END,
        m."title", m."subjectId", m."archivedAt" IS NULL
      FROM "PlanMilestone" m
      WHERE m."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT 'STUDY_SESSION', ss."id", CONCAT('STUDY_SESSION:', ss."id"),
        CASE
          WHEN ss."taskId" IS NOT NULL THEN CONCAT('TASK:', ss."taskId")
          WHEN ss."syllabusNodeId" IS NOT NULL THEN CONCAT('SYLLABUS_NODE:', ss."syllabusNodeId")
          ELSE CONCAT('SUBJECT:', ss."subjectId")
        END,
        '进行中会话', ss."subjectId",
        (${input.includeAllStatuses} OR ss."status"::text IN ('RUNNING', 'PAUSED'))
      FROM "StudySession" ss
      JOIN "Subject" s ON s."id" = ss."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT 'REVIEW_SCHEDULE', rs."id", CONCAT('REVIEW_SCHEDULE:', rs."id"),
        COALESCE(
          CASE WHEN rs."noteId" IS NOT NULL THEN CONCAT('NOTE:', rs."noteId") END,
          CASE WHEN rs."mistakeId" IS NOT NULL THEN CONCAT('MISTAKE:', rs."mistakeId") END,
          CASE WHEN rs."studyResourceId" IS NOT NULL THEN CONCAT('STUDY_RESOURCE:', rs."studyResourceId") END,
          CASE WHEN rs."syllabusNodeId" IS NOT NULL THEN CONCAT('SYLLABUS_NODE:', rs."syllabusNodeId") END,
          CONCAT('WORKSPACE:', rs."workspaceId")
        ),
        '到期复习', COALESCE(n."subjectId", m."subjectId", r."subjectId", sn."subjectId"),
        (${input.includeAllStatuses} OR rs."status" = 'ACTIVE')
      FROM "ReviewSchedule" rs
      LEFT JOIN "Note" n ON n."id" = rs."noteId"
      LEFT JOIN "Mistake" m ON m."id" = rs."mistakeId"
      LEFT JOIN "StudyResource" r ON r."id" = rs."studyResourceId"
      LEFT JOIN "SyllabusNode" sn ON sn."id" = rs."syllabusNodeId"
      WHERE rs."workspaceId" = ${input.workspaceId}
    ),
    indexed_nodes AS (
      SELECT all_nodes.*,
        ROW_NUMBER() OVER (ORDER BY node_key COLLATE "C") - 1 AS sort_index
      FROM all_nodes
    ),
    candidate_nodes AS (
      SELECT * FROM indexed_nodes WHERE candidate_visible
    ),
    raw_edges AS (
      SELECT
        CONCAT(
          CASE
            WHEN n.entity_type = 'STUDY_SESSION' THEN 'evidence'
            WHEN n.entity_type = 'REVIEW_SCHEDULE' THEN 'schedules'
            WHEN n.entity_type = 'TASK' AND n.parent_id LIKE 'TASK:%' THEN 'contains'
            WHEN n.entity_type IN ('SUBJECT_GROUP', 'SUBJECT', 'SYLLABUS_NODE', 'MILESTONE') THEN 'contains'
            ELSE 'related'
          END,
          ':', n.parent_id, ':', n.node_key
        ) AS edge_id,
        n.parent_id AS source_id,
        n.node_key AS target_id,
        CASE
          WHEN n.entity_type = 'STUDY_SESSION' THEN 'evidence'
          WHEN n.entity_type = 'REVIEW_SCHEDULE' THEN 'schedules'
          WHEN n.entity_type = 'TASK' AND n.parent_id LIKE 'TASK:%' THEN 'contains'
          WHEN n.entity_type IN ('SUBJECT_GROUP', 'SUBJECT', 'SYLLABUS_NODE', 'MILESTONE') THEN 'contains'
          ELSE 'related'
        END AS edge_kind
      FROM indexed_nodes n
      WHERE n.parent_id IS NOT NULL

      UNION ALL
      SELECT CONCAT('evidence:TASK:', n."taskId", ':NOTE:', n."id"),
        CONCAT('TASK:', n."taskId"), CONCAT('NOTE:', n."id"), 'evidence'
      FROM "Note" n JOIN "Subject" s ON s."id" = n."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId} AND n."taskId" IS NOT NULL

      UNION ALL
      SELECT CONCAT('related:SYLLABUS_NODE:', rel."syllabusNodeId", ':NOTE:', rel."noteId"),
        CONCAT('SYLLABUS_NODE:', rel."syllabusNodeId"), CONCAT('NOTE:', rel."noteId"), 'related'
      FROM "NoteRelatedSyllabusNode" rel
      JOIN "Note" n ON n."id" = rel."noteId"
      JOIN "Subject" s ON s."id" = n."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT CONCAT('contains:MILESTONE:', t."planMilestoneId", ':TASK:', t."id"),
        CONCAT('MILESTONE:', t."planMilestoneId"), CONCAT('TASK:', t."id"), 'contains'
      FROM "StudyTask" t JOIN "Subject" s ON s."id" = t."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId} AND t."planMilestoneId" IS NOT NULL

      UNION ALL
      SELECT CONCAT('related:SYLLABUS_NODE:', t."syllabusNodeId", ':TASK:', t."id"),
        CONCAT('SYLLABUS_NODE:', t."syllabusNodeId"), CONCAT('TASK:', t."id"), 'related'
      FROM "StudyTask" t JOIN "Subject" s ON s."id" = t."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId}
        AND t."syllabusNodeId" IS NOT NULL AND t."parentTaskId" IS NOT NULL

      UNION ALL
      SELECT CONCAT('schedules:REVIEW_SCHEDULE:', t."reviewScheduleId", ':TASK:', t."id"),
        CONCAT('REVIEW_SCHEDULE:', t."reviewScheduleId"), CONCAT('TASK:', t."id"), 'schedules'
      FROM "StudyTask" t JOIN "Subject" s ON s."id" = t."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId} AND t."reviewScheduleId" IS NOT NULL

      UNION ALL
      SELECT CONCAT('related:SYLLABUS_NODE:', rel."syllabusNodeId", ':TASK:', rel."taskId"),
        CONCAT('SYLLABUS_NODE:', rel."syllabusNodeId"), CONCAT('TASK:', rel."taskId"), 'related'
      FROM "StudyTaskRelatedSyllabusNode" rel
      JOIN "StudyTask" t ON t."id" = rel."taskId"
      JOIN "Subject" s ON s."id" = t."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT CONCAT('related:STUDY_RESOURCE:', r."duplicateOfResourceId", ':STUDY_RESOURCE:', r."id"),
        CONCAT('STUDY_RESOURCE:', r."duplicateOfResourceId"), CONCAT('STUDY_RESOURCE:', r."id"), 'related'
      FROM "StudyResource" r
      WHERE r."workspaceId" = ${input.workspaceId} AND r."duplicateOfResourceId" IS NOT NULL

      UNION ALL
      SELECT CONCAT('related:TASK:', rel."taskId", ':STUDY_RESOURCE:', rel."resourceId"),
        CONCAT('TASK:', rel."taskId"), CONCAT('STUDY_RESOURCE:', rel."resourceId"), 'related'
      FROM "StudyResourceTaskLink" rel
      JOIN "StudyResource" r ON r."id" = rel."resourceId"
      WHERE r."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT CONCAT('related:NOTE:', rel."noteId", ':STUDY_RESOURCE:', rel."resourceId"),
        CONCAT('NOTE:', rel."noteId"), CONCAT('STUDY_RESOURCE:', rel."resourceId"), 'related'
      FROM "StudyResourceNoteLink" rel
      JOIN "StudyResource" r ON r."id" = rel."resourceId"
      WHERE r."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT CONCAT('related:MISTAKE:', rel."mistakeId", ':STUDY_RESOURCE:', rel."resourceId"),
        CONCAT('MISTAKE:', rel."mistakeId"), CONCAT('STUDY_RESOURCE:', rel."resourceId"), 'related'
      FROM "StudyResourceMistakeLink" rel
      JOIN "StudyResource" r ON r."id" = rel."resourceId"
      WHERE r."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT CONCAT('related:SYLLABUS_NODE:', rel."syllabusNodeId", ':STUDY_RESOURCE:', rel."resourceId"),
        CONCAT('SYLLABUS_NODE:', rel."syllabusNodeId"), CONCAT('STUDY_RESOURCE:', rel."resourceId"), 'related'
      FROM "StudyResourceSyllabusNodeLink" rel
      JOIN "StudyResource" r ON r."id" = rel."resourceId"
      WHERE r."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT CONCAT('depends:', d."id"), CONCAT('TASK:', d."predecessorId"),
        CONCAT('TASK:', d."successorId"), 'depends'
      FROM "TaskDependency" d
      JOIN "StudyTask" predecessor ON predecessor."id" = d."predecessorId"
      JOIN "StudyTask" successor ON successor."id" = d."successorId"
      JOIN "Subject" ps ON ps."id" = predecessor."subjectId"
      JOIN "Subject" ss ON ss."id" = successor."subjectId"
      WHERE ps."workspaceId" = ${input.workspaceId} AND ss."workspaceId" = ${input.workspaceId}

      UNION ALL
      SELECT CONCAT('evidence:TASK:', ss."taskId", ':STUDY_SESSION:', ss."id"),
        CONCAT('TASK:', ss."taskId"), CONCAT('STUDY_SESSION:', ss."id"), 'evidence'
      FROM "StudySession" ss JOIN "Subject" s ON s."id" = ss."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId} AND ss."taskId" IS NOT NULL

      UNION ALL
      SELECT CONCAT('evidence:SYLLABUS_NODE:', ss."syllabusNodeId", ':STUDY_SESSION:', ss."id"),
        CONCAT('SYLLABUS_NODE:', ss."syllabusNodeId"), CONCAT('STUDY_SESSION:', ss."id"), 'evidence'
      FROM "StudySession" ss JOIN "Subject" s ON s."id" = ss."subjectId"
      WHERE s."workspaceId" = ${input.workspaceId} AND ss."syllabusNodeId" IS NOT NULL
    ),
    all_edges AS (
      SELECT DISTINCT ON (raw.edge_id COLLATE "C")
        raw.edge_id, raw.source_id, raw.target_id, raw.edge_kind
      FROM raw_edges raw
      JOIN indexed_nodes source ON source.node_key = raw.source_id
      JOIN indexed_nodes target ON target.node_key = raw.target_id
      WHERE raw.source_id <> raw.target_id
      ORDER BY raw.edge_id COLLATE "C", raw.source_id COLLATE "C", raw.target_id COLLATE "C"
    ),
    candidate_edges AS (
      SELECT edge.*
      FROM all_edges edge
      JOIN candidate_nodes source ON source.node_key = edge.source_id
      JOIN candidate_nodes target ON target.node_key = edge.target_id
    ),
    reachable(node_key, context_depth, path) AS (
      SELECT n.node_key, 0, ARRAY[n.node_key]
      FROM candidate_nodes n
      WHERE n.node_key = ${input.focusId}

      UNION ALL
      SELECT next.node_key, current.context_depth + 1, current.path || next.node_key
      FROM reachable current
      JOIN candidate_edges edge
        ON edge.source_id = current.node_key OR edge.target_id = current.node_key
      JOIN candidate_nodes next
        ON next.node_key = CASE
          WHEN edge.source_id = current.node_key THEN edge.target_id
          ELSE edge.source_id
        END
      WHERE current.context_depth < ${depth}
        AND NOT next.node_key = ANY(current.path)
    ),
    eligible AS (
      SELECT n.*
      FROM candidate_nodes n
      WHERE n.node_key <> ${input.focusId}
        AND (
          CAST(${query} AS text) IS NOT NULL
          OR EXISTS (SELECT 1 FROM reachable r WHERE r.node_key = n.node_key)
        )
        AND (
          CAST(${query} AS text) IS NULL
          OR LOWER(n.label) LIKE CAST(${queryPattern} AS text) ESCAPE '\\'
        )
        AND (CAST(${input.subjectId ?? null} AS text) IS NULL OR n.subject_id = ${input.subjectId ?? null})
        AND (CAST(${input.entityType ?? null} AS text) IS NULL OR n.entity_type = ${input.entityType ?? null})
    ),
    candidate_window AS (
      SELECT *
      FROM eligible n
      WHERE CAST(${cursor} AS text) IS NULL OR n.node_key COLLATE "C" > CAST(${cursor} AS text) COLLATE "C"
      ORDER BY n.node_key COLLATE "C"
      LIMIT ${candidateWindowLimit}
    ),
    ancestor_walk AS (
      SELECT c.node_key AS origin_key, parent.*, 1 AS context_depth,
        ARRAY[c.node_key, parent.node_key] AS path
      FROM candidate_window c
      JOIN indexed_nodes parent ON parent.node_key = c.parent_id

      UNION ALL
      SELECT current.origin_key, parent.*, current.context_depth + 1,
        current.path || parent.node_key
      FROM ancestor_walk current
      JOIN indexed_nodes parent ON parent.node_key = current.parent_id
      WHERE current.context_depth < ${MAX_PARENT_CONTEXT_DEPTH}
        AND current.node_key <> ${input.focusId}
        AND NOT parent.node_key = ANY(current.path)
    ),
    relation_origins AS (
      SELECT c.node_key FROM candidate_window c
      UNION ALL
      SELECT n.node_key FROM candidate_nodes n WHERE n.node_key = ${input.focusId}
    ),
    ranked_relation_context AS (
      SELECT
        c.node_key AS origin_key,
        other.*,
        edge.edge_id,
        edge.source_id,
        edge.target_id,
        edge.edge_kind,
        ROW_NUMBER() OVER (
          PARTITION BY c.node_key
          ORDER BY edge.edge_id COLLATE "C", other.node_key COLLATE "C"
        ) AS relation_rank
      FROM relation_origins c
      JOIN all_edges edge ON edge.source_id = c.node_key OR edge.target_id = c.node_key
      JOIN indexed_nodes other ON other.node_key = CASE
        WHEN edge.source_id = c.node_key THEN edge.target_id
        ELSE edge.source_id
      END
      WHERE NOT (
        other.candidate_visible
        AND other.parent_id = c.node_key
        AND edge.edge_id = CONCAT(edge.edge_kind, ':', c.node_key, ':', other.node_key)
      )
    ),
    relation_window AS (
      SELECT * FROM ranked_relation_context
      WHERE relation_rank <= ${MAX_CONTEXT_ROWS_PER_CANDIDATE}
    )
    SELECT
      (SELECT TO_JSONB(n) FROM candidate_nodes n WHERE n.node_key = ${input.focusId}) AS focus_node,
      COALESCE((SELECT JSONB_AGG(TO_JSONB(c) ORDER BY c.node_key COLLATE "C") FROM candidate_window c), '[]'::jsonb) AS candidates,
      COALESCE((SELECT JSONB_AGG(TO_JSONB(a) ORDER BY a.origin_key COLLATE "C", a.context_depth DESC) FROM ancestor_walk a), '[]'::jsonb) AS ancestors,
      COALESCE((SELECT JSONB_AGG(TO_JSONB(r) ORDER BY r.origin_key COLLATE "C", r.edge_id COLLATE "C") FROM relation_window r), '[]'::jsonb) AS relation_context,
      (SELECT COUNT(*) FROM candidate_nodes) AS graph_node_count,
      (SELECT COUNT(*) FROM candidate_edges) AS graph_edge_count,
      EXISTS (SELECT 1 FROM candidate_nodes n WHERE n.node_key = ${input.focusId}) AS focus_exists,
      (
        CAST(${cursor} AS text) IS NULL
        OR EXISTS (SELECT 1 FROM eligible e WHERE e.node_key = ${cursor})
      ) AS cursor_valid,
      EXISTS (
        SELECT 1 FROM ancestor_walk a
        WHERE a.context_depth = ${MAX_PARENT_CONTEXT_DEPTH} AND a.parent_id IS NOT NULL
      ) AS ancestor_truncated,
      EXISTS (
        SELECT 1 FROM ranked_relation_context r
        WHERE r.relation_rank > ${MAX_CONTEXT_ROWS_PER_CANDIDATE}
      ) AS relation_truncated
  `;

  const aggregate = rows[0];
  if (!aggregate) throw new Error("knowledge canvas index query returned no aggregate row");
  const candidates = aggregate.candidates ?? [];
  const ancestors = aggregate.ancestors ?? [];
  const relationRows = aggregate.relation_context ?? [];
  const pageRows = new Map<string, CanvasIndexNodeRow>();
  if (aggregate.focus_node) pageRows.set(aggregate.focus_node.node_key, aggregate.focus_node);

  const ancestorsByOrigin = new Map<string, CanvasAncestorRow[]>();
  for (const row of ancestors) {
    ancestorsByOrigin.set(row.origin_key, [...(ancestorsByOrigin.get(row.origin_key) ?? []), row]);
  }
  const relationsByOrigin = new Map<string, CanvasRelationRow[]>();
  for (const row of relationRows) {
    relationsByOrigin.set(row.origin_key, [...(relationsByOrigin.get(row.origin_key) ?? []), row]);
  }

  const accepted: CanvasIndexNodeRow[] = [];
  let contextTruncated = aggregate.ancestor_truncated || aggregate.relation_truncated;
  const focusContextCapacity = Math.max(0, limit - pageRows.size - (candidates.length > 0 ? 1 : 0));
  let focusContextAdded = 0;
  for (const row of relationsByOrigin.get(input.focusId) ?? []) {
    if (pageRows.has(row.node_key)) continue;
    if (focusContextAdded >= focusContextCapacity) {
      contextTruncated = true;
      break;
    }
    pageRows.set(row.node_key, row);
    focusContextAdded += 1;
  }

  for (const candidate of candidates) {
    const context = [
      candidate,
      ...(ancestorsByOrigin.get(candidate.node_key) ?? []).sort((left, right) => right.context_depth - left.context_depth),
      ...(relationsByOrigin.get(candidate.node_key) ?? []),
    ];
    const additions = [...new Map(context.map((row) => [row.node_key, row])).values()]
      .filter((row) => !pageRows.has(row.node_key));
    if (pageRows.size + additions.length > limit) {
      if (accepted.length > 0) break;
      for (const row of additions) {
        if (pageRows.size >= limit) break;
        pageRows.set(row.node_key, row);
      }
      contextTruncated ||= additions.some((row) => !pageRows.has(row.node_key));
      accepted.push(candidate);
      break;
    }
    for (const row of additions) pageRows.set(row.node_key, row);
    accepted.push(candidate);
  }

  const hasMore = accepted.length < candidates.length;
  const nextCursor = hasMore && accepted.length > 0 ? accepted.at(-1)!.node_key : null;
  const acceptedKeys = new Set([input.focusId, ...accepted.map((row) => row.node_key)]);
  const pageNodeIds = new Set(pageRows.keys());
  const edgeById = new Map<string, KnowledgeCanvasEdgeInput>();
  for (const row of pageRows.values()) {
    const edge = canonicalEdgeFor(toIndexNode(row));
    if (edge && pageNodeIds.has(edge.sourceId) && pageNodeIds.has(edge.targetId)) edgeById.set(edge.id, edge);
  }
  for (const relation of relationRows) {
    if (!acceptedKeys.has(relation.origin_key)) continue;
    if (!pageNodeIds.has(relation.source_id) || !pageNodeIds.has(relation.target_id)) continue;
    edgeById.set(relation.edge_id, {
      id: relation.edge_id,
      sourceId: relation.source_id,
      targetId: relation.target_id,
      kind: relation.edge_kind,
    });
  }

  const nodes = [...pageRows.values()].map(toIndexNode);
  const edges = [...edgeById.values()];
  return {
    nodes,
    edges,
    nextCursor,
    truncated: hasMore,
    contextTruncated,
    invalidCursor: !aggregate.cursor_valid,
    focusFound: aggregate.focus_exists,
    graphNodeCount: Number(aggregate.graph_node_count),
    graphEdgeCount: Number(aggregate.graph_edge_count),
    loadStats: {
      candidateRowsRead: candidates.length,
      ancestorRowsRead: ancestors.length,
      relationRowsRead: relationRows.length,
      returnedNodeRows: nodes.length,
      returnedEdgeRows: edges.length,
      candidateWindowLimit,
      relationWindowLimit,
    },
  };
}

export async function queryKnowledgeCanvasStaleLayoutCandidates(input: {
  workspaceId: string;
  layoutId: string;
}): Promise<Array<{ entityType: KnowledgeCanvasEntityType; entityId: string }>> {
  const rows = await prisma.$queryRaw<Array<{ entity_type: KnowledgeCanvasEntityType; entity_id: string }>>`
    WITH all_entity_keys AS (
      SELECT 'WORKSPACE'::text AS entity_type, w."id" AS entity_id
      FROM "ExamWorkspace" w WHERE w."id" = ${input.workspaceId}
      UNION ALL SELECT 'SUBJECT_GROUP', g."id" FROM "SubjectGroup" g WHERE g."workspaceId" = ${input.workspaceId}
      UNION ALL SELECT 'SUBJECT', s."id" FROM "Subject" s WHERE s."workspaceId" = ${input.workspaceId}
      UNION ALL SELECT 'SYLLABUS_NODE', n."id" FROM "SyllabusNode" n
        JOIN "Subject" s ON s."id" = n."subjectId" WHERE s."workspaceId" = ${input.workspaceId}
      UNION ALL SELECT 'NOTE', n."id" FROM "Note" n
        JOIN "Subject" s ON s."id" = n."subjectId" WHERE s."workspaceId" = ${input.workspaceId}
      UNION ALL SELECT 'MISTAKE', m."id" FROM "Mistake" m
        JOIN "Subject" s ON s."id" = m."subjectId" WHERE s."workspaceId" = ${input.workspaceId}
      UNION ALL SELECT 'STUDY_RESOURCE', r."id" FROM "StudyResource" r WHERE r."workspaceId" = ${input.workspaceId}
      UNION ALL SELECT 'TASK', t."id" FROM "StudyTask" t
        JOIN "Subject" s ON s."id" = t."subjectId" WHERE s."workspaceId" = ${input.workspaceId}
      UNION ALL SELECT 'MILESTONE', m."id" FROM "PlanMilestone" m WHERE m."workspaceId" = ${input.workspaceId}
      UNION ALL SELECT 'STUDY_SESSION', ss."id" FROM "StudySession" ss
        JOIN "Subject" s ON s."id" = ss."subjectId" WHERE s."workspaceId" = ${input.workspaceId}
      UNION ALL SELECT 'REVIEW_SCHEDULE', rs."id" FROM "ReviewSchedule" rs WHERE rs."workspaceId" = ${input.workspaceId}
    )
    SELECT layout_node."entityType"::text AS entity_type, layout_node."entityId" AS entity_id
    FROM "KnowledgeCanvasNodeLayout" layout_node
    LEFT JOIN all_entity_keys entity
      ON entity.entity_type = layout_node."entityType"::text
      AND entity.entity_id = layout_node."entityId"
    WHERE layout_node."layoutId" = ${input.layoutId} AND entity.entity_id IS NULL
    ORDER BY layout_node."entityType"::text COLLATE "C", layout_node."entityId" COLLATE "C"
    LIMIT ${MAX_STALE_LAYOUT_CANDIDATES}
  `;
  return rows.map((row) => ({ entityType: row.entity_type, entityId: row.entity_id }));
}
