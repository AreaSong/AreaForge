-- 独立可见性代次避免跨请求缓存旧回收站范围；仅栅栏变化推进。
CREATE TABLE "DataDeletionVisibility" ("id" INTEGER NOT NULL DEFAULT 1 PRIMARY KEY, "revision" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "DataDeletionVisibility_singleton" CHECK ("id"=1));
INSERT INTO "DataDeletionVisibility" ("id","revision") VALUES (1,0);
CREATE FUNCTION areaforge_delete_visibility_advance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE "DataDeletionVisibility" SET revision=revision+1 WHERE id=1; RETURN NULL; END $$;
CREATE TRIGGER areaforge_delete_visibility_advance AFTER INSERT OR UPDATE OR DELETE ON "DataDeletionFence"
  FOR EACH STATEMENT EXECUTE FUNCTION areaforge_delete_visibility_advance();

CREATE OR REPLACE FUNCTION areaforge_delete_fence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate JSONB; blocked_intent TEXT; relation RECORD; parent_key JSONB; allowed_intent TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(718420260913::bigint);
  IF NOT EXISTS (SELECT 1 FROM "DataDeletionFence") THEN RETURN COALESCE(NEW, OLD); END IF;
  -- 会话、凭证和 AUTH 安全审计是账户计划内显式的可变撤销集合，不冻结登录/重新验证。
  IF TG_TABLE_NAME IN ('AuthSession','AuthActionToken') OR
    (TG_TABLE_NAME='AuditEvent' AND left(to_jsonb(COALESCE(NEW,OLD))->>'action',5)='AUTH_')
    THEN RETURN COALESCE(NEW,OLD); END IF;
  IF TG_TABLE_NAME='User' AND TG_OP='UPDATE' AND
    (to_jsonb(NEW) - ARRAY['status','authRevision','passwordHash','passwordChangedAt','emailVerifiedAt','updatedAt']) =
    (to_jsonb(OLD) - ARRAY['status','authRevision','passwordHash','passwordChangedAt','emailVerifiedAt','updatedAt']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='WorkspaceMembership' AND TG_OP='UPDATE' AND
    (to_jsonb(NEW) - ARRAY['status','role','revision','joinedAt','leftAt','removedAt','updatedAt']) =
    (to_jsonb(OLD) - ARRAY['status','role','revision','joinedAt','leftAt','removedAt','updatedAt']) THEN RETURN NEW; END IF;
  SELECT i.id INTO allowed_intent FROM "DataDeletionIntent" i
    WHERE i.id=current_setting('areaforge.delete_intent',true) AND i.state='RUNNING'
    AND i."executionPid"=pg_backend_pid() AND i."leaseExpiresAt">clock_timestamp();
  FOREACH candidate IN ARRAY CASE WHEN TG_OP = 'UPDATE' THEN ARRAY[to_jsonb(OLD),to_jsonb(NEW)]
    ELSE ARRAY[to_jsonb(COALESCE(NEW,OLD))] END LOOP
    SELECT f."intentId" INTO blocked_intent FROM "DataDeletionFence" f
      WHERE f."model" = TG_TABLE_NAME AND f."intentId" IS DISTINCT FROM allowed_intent AND candidate @> f."keyJson" LIMIT 1;
    IF blocked_intent IS NULL THEN
      FOR relation IN SELECT c.confrelid::regclass::text AS parent_name,
        array_agg(a.attname ORDER BY k.ordinality) AS child_columns,
        array_agg(b.attname ORDER BY k.ordinality) AS parent_columns
        FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY k(child_num,parent_num,ordinality)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.child_num
        JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.parent_num
        WHERE c.contype='f' AND c.conrelid=TG_RELID GROUP BY c.oid,c.confrelid LOOP
        SELECT jsonb_object_agg(relation.parent_columns[n], candidate->relation.child_columns[n]) INTO parent_key
          FROM generate_subscripts(relation.child_columns,1) n;
        SELECT f."intentId" INTO blocked_intent FROM "DataDeletionFence" f
          WHERE f."model"=replace(relation.parent_name,'"','') AND f."intentId" IS DISTINCT FROM allowed_intent AND f."keyJson" @> parent_key LIMIT 1;
        EXIT WHEN blocked_intent IS NOT NULL;
      END LOOP;
    END IF;
    IF blocked_intent IS NULL THEN
      FOR relation IN SELECT * FROM (VALUES
        ('WorkspaceShareGrant','resourceId','Note','resourceType',ARRAY['NOTE','Note','note']::text[],false),
        ('WorkspaceShareGrant','resourceId','Mistake','resourceType',ARRAY['MISTAKE','Mistake','mistake']::text[],false),
        ('WorkspaceShareGrant','resourceId','Attachment','resourceType',ARRAY['ATTACHMENT','Attachment','attachment']::text[],false),
        ('WorkspaceShareGrant','resourceId','DailyReview','resourceType',ARRAY['DAILY_REVIEW','DailyReview']::text[],false),
        ('WorkspaceShareGrant','resourceId','MotivationVault','resourceType',ARRAY['MOTIVATION','MotivationVault']::text[],false),
        ('WorkspaceShareGrant','resourceId','AiDraftOperation','resourceType',ARRAY['AI_DRAFT','AiDraftOperation']::text[],false),
        ('CoachSuggestion','sourceResourceId','Note','sourceResourceType',ARRAY['NOTE','Note','note']::text[],false),
        ('CoachSuggestion','sourceResourceId','Mistake','sourceResourceType',ARRAY['MISTAKE','Mistake','mistake']::text[],false),
        ('CoachSuggestion','sourceResourceId','Attachment','sourceResourceType',ARRAY['ATTACHMENT','Attachment','attachment']::text[],false),
        ('CoachSuggestion','sourceResourceId','DailyReview','sourceResourceType',ARRAY['DAILY_REVIEW','DailyReview']::text[],false),
        ('CoachSuggestion','sourceResourceId','MotivationVault','sourceResourceType',ARRAY['MOTIVATION','MotivationVault']::text[],false),
        ('CoachSuggestion','sourceResourceId','AiDraftOperation','sourceResourceType',ARRAY['AI_DRAFT','AiDraftOperation']::text[],false),
        ('PlanInboxItem','subjectId','Subject',NULL,NULL::text[],false),
        ('PlanInboxItem','primaryNodeId','SyllabusNode',NULL,NULL::text[],false),
        ('PlanInboxItem','relatedNodeIds','SyllabusNode',NULL,NULL::text[],true),
        ('StageAdjustmentDraft','sourceReportDecisionId','PeriodicReportDecision',NULL,NULL::text[],false),
        ('PlanInboxDependencyRef','importBatchId','LearningTreeImportBatch',NULL,NULL::text[],false),
        ('LearningTreeImportItem','mappedTargetId','Subject','objectType',ARRAY['SUBJECT','subject']::text[],false),
        ('LearningTreeImportItem','mappedTargetId','SyllabusNode','objectType',ARRAY['SYLLABUS_NODE','syllabus_node','node']::text[],false),
        ('LearningTreeImportItem','mappedTargetId','StudyTask','objectType',ARRAY['TASK','task']::text[],false),
        ('LearningTreeImportItem','mappedTargetId','Note','objectType',ARRAY['NOTE','note']::text[],false),
        ('LearningTreeImportItem','mappedTargetId','StudyResource','objectType',ARRAY['RESOURCE','resource']::text[],false),
        ('LearningTreeImportItem','mappedTargetId','PlanInboxItem','objectType',ARRAY['INBOX_ITEM','inboxItem']::text[],false),
        ('KnowledgeCanvasNodeLayout','entityId','Note','entityType',ARRAY['NOTE','note']::text[],false),
        ('KnowledgeCanvasNodeLayout','entityId','Mistake','entityType',ARRAY['MISTAKE','mistake']::text[],false),
        ('KnowledgeCanvasNodeLayout','entityId','StudyResource','entityType',ARRAY['RESOURCE','resource']::text[],false),
        ('KnowledgeCanvasNodeLayout','entityId','SyllabusNode','entityType',ARRAY['SYLLABUS_NODE','syllabusNode']::text[],false),
        ('KnowledgeCanvasNodeLayout','entityId','KnowledgePoint','entityType',ARRAY['KNOWLEDGE_POINT','knowledgePoint']::text[],false),
        ('UserNotification','sourceEntityId','PrivateChallenge','sourceEntityType',ARRAY['PrivateChallenge']::text[],false),
        ('UserNotification','sourceEntityId','PrivateChallengeParticipant','sourceEntityType',ARRAY['PrivateChallengeParticipant']::text[],false),
        ('UserNotification','sourceEntityId','RankingAppeal','sourceEntityType',ARRAY['RankingAppeal']::text[],false),
        ('AuditEvent','entityId','User','entityType',ARRAY['User']::text[],false),
        ('AuditEvent','entityId','AuthSession','entityType',ARRAY['AuthSession']::text[],false),
        ('AuditEvent','entityId','ExamWorkspace','entityType',ARRAY['ExamWorkspace']::text[],false),
        ('AuditEvent','entityId','AuthActionToken','entityType',ARRAY['AuthActionToken']::text[],false),
        ('AuditEvent','entityId','WorkspaceMembership','entityType',ARRAY['WorkspaceMembership']::text[],false),
        ('AuditEvent','entityId','WorkspaceInvitation','entityType',ARRAY['WorkspaceInvitation']::text[],false),
        ('AuditEvent','entityId','WorkspaceSelection','entityType',ARRAY['WorkspaceSelection']::text[],false),
        ('AuditEvent','entityId','WorkspaceShareGrant','entityType',ARRAY['WorkspaceShareGrant']::text[],false),
        ('AuditEvent','entityId','CoachSuggestion','entityType',ARRAY['CoachSuggestion']::text[],false),
        ('AuditEvent','entityId','AuthThrottleBucket','entityType',ARRAY['AuthThrottleBucket']::text[],false),
        ('AuditEvent','entityId','DataJob','entityType',ARRAY['DataJob']::text[],false),
        ('AuditEvent','entityId','ControlledOperationRequest','entityType',ARRAY['ControlledOperationRequest']::text[],false),
        ('AuditEvent','entityId','DataExportArtifact','entityType',ARRAY['DataExportArtifact']::text[],false),
        ('AuditEvent','entityId','DataExportPackage','entityType',ARRAY['DataExportPackage']::text[],false),
        ('AuditEvent','entityId','DataExportDownloadGrant','entityType',ARRAY['DataExportDownloadGrant']::text[],false),
        ('AuditEvent','entityId','SubjectGroup','entityType',ARRAY['SubjectGroup']::text[],false),
        ('AuditEvent','entityId','Subject','entityType',ARRAY['Subject']::text[],false),
        ('AuditEvent','entityId','SyllabusNode','entityType',ARRAY['SyllabusNode']::text[],false),
        ('AuditEvent','entityId','SyllabusNodeProgress','entityType',ARRAY['SyllabusNodeProgress']::text[],false),
        ('AuditEvent','entityId','StudyTask','entityType',ARRAY['StudyTask']::text[],false),
        ('AuditEvent','entityId','StudyTaskRelatedSyllabusNode','entityType',ARRAY['StudyTaskRelatedSyllabusNode']::text[],false),
        ('AuditEvent','entityId','StudyTaskStageLink','entityType',ARRAY['StudyTaskStageLink']::text[],false),
        ('AuditEvent','entityId','StudyTaskKnowledgePoint','entityType',ARRAY['StudyTaskKnowledgePoint']::text[],false),
        ('AuditEvent','entityId','StudySession','entityType',ARRAY['StudySession']::text[],false),
        ('AuditEvent','entityId','StudySessionDevicePresence','entityType',ARRAY['StudySessionDevicePresence']::text[],false),
        ('AuditEvent','entityId','DailyReview','entityType',ARRAY['DailyReview']::text[],false),
        ('AuditEvent','entityId','CheckIn','entityType',ARRAY['CheckIn']::text[],false),
        ('AuditEvent','entityId','TaskDebtEvent','entityType',ARRAY['TaskDebtEvent']::text[],false),
        ('AuditEvent','entityId','RecoveryState','entityType',ARRAY['RecoveryState']::text[],false),
        ('AuditEvent','entityId','Note','entityType',ARRAY['Note']::text[],false),
        ('AuditEvent','entityId','NoteRelatedSyllabusNode','entityType',ARRAY['NoteRelatedSyllabusNode']::text[],false),
        ('AuditEvent','entityId','Attachment','entityType',ARRAY['Attachment']::text[],false),
        ('AuditEvent','entityId','Mistake','entityType',ARRAY['Mistake']::text[],false),
        ('AuditEvent','entityId','MotivationVault','entityType',ARRAY['MotivationVault']::text[],false),
        ('AuditEvent','entityId','PeriodicReportDecision','entityType',ARRAY['PeriodicReportDecision']::text[],false),
        ('AuditEvent','entityId','MasteryConditionRecord','entityType',ARRAY['MasteryConditionRecord']::text[],false),
        ('AuditEvent','entityId','MasteryEvidence','entityType',ARRAY['MasteryEvidence']::text[],false),
        ('AuditEvent','entityId','MasteryRetest','entityType',ARRAY['MasteryRetest']::text[],false),
        ('AuditEvent','entityId','SimulationExam','entityType',ARRAY['SimulationExam']::text[],false),
        ('AuditEvent','entityId','SimulationSubjectResult','entityType',ARRAY['SimulationSubjectResult']::text[],false),
        ('AuditEvent','entityId','SimulationLossItem','entityType',ARRAY['SimulationLossItem']::text[],false),
        ('AuditEvent','entityId','StagePlan','entityType',ARRAY['StagePlan']::text[],false),
        ('AuditEvent','entityId','StageAdjustmentDraft','entityType',ARRAY['StageAdjustmentDraft']::text[],false),
        ('AuditEvent','entityId','PlanMilestone','entityType',ARRAY['PlanMilestone']::text[],false),
        ('AuditEvent','entityId','TaskDependency','entityType',ARRAY['TaskDependency']::text[],false),
        ('AuditEvent','entityId','PlanInboxItem','entityType',ARRAY['PlanInboxItem']::text[],false),
        ('AuditEvent','entityId','PlanInboxDependencyRef','entityType',ARRAY['PlanInboxDependencyRef']::text[],false),
        ('AuditEvent','entityId','StudyResource','entityType',ARRAY['StudyResource']::text[],false),
        ('AuditEvent','entityId','StudyResourceTag','entityType',ARRAY['StudyResourceTag']::text[],false),
        ('AuditEvent','entityId','StudyResourceTaskLink','entityType',ARRAY['StudyResourceTaskLink']::text[],false),
        ('AuditEvent','entityId','StudyResourceNoteLink','entityType',ARRAY['StudyResourceNoteLink']::text[],false),
        ('AuditEvent','entityId','NoteMistakeLink','entityType',ARRAY['NoteMistakeLink']::text[],false),
        ('AuditEvent','entityId','StudyResourceMistakeLink','entityType',ARRAY['StudyResourceMistakeLink']::text[],false),
        ('AuditEvent','entityId','StudyResourceSyllabusNodeLink','entityType',ARRAY['StudyResourceSyllabusNodeLink']::text[],false),
        ('AuditEvent','entityId','LearningTreeImportBatch','entityType',ARRAY['LearningTreeImportBatch']::text[],false),
        ('AuditEvent','entityId','LearningTreeImportItem','entityType',ARRAY['LearningTreeImportItem']::text[],false),
        ('AuditEvent','entityId','LearningTreeExportGrant','entityType',ARRAY['LearningTreeExportGrant']::text[],false),
        ('AuditEvent','entityId','ReviewSchedule','entityType',ARRAY['ReviewSchedule']::text[],false),
        ('AuditEvent','entityId','ReviewEvent','entityType',ARRAY['ReviewEvent']::text[],false),
        ('AuditEvent','entityId','MistakeAttempt','entityType',ARRAY['MistakeAttempt']::text[],false),
        ('AuditEvent','entityId','KnowledgeCanvasLayout','entityType',ARRAY['KnowledgeCanvasLayout']::text[],false),
        ('AuditEvent','entityId','KnowledgeCanvasNodeLayout','entityType',ARRAY['KnowledgeCanvasNodeLayout']::text[],false),
        ('AuditEvent','entityId','MotivationItem','entityType',ARRAY['MotivationItem']::text[],false),
        ('AuditEvent','entityId','MotivationReminderState','entityType',ARRAY['MotivationReminderState']::text[],false),
        ('AuditEvent','entityId','NotificationPreference','entityType',ARRAY['NotificationPreference']::text[],false),
        ('AuditEvent','entityId','AiDraftOperation','entityType',ARRAY['AiDraftOperation']::text[],false),
        ('AuditEvent','entityId','AiProviderCredential','entityType',ARRAY['AiProviderCredential']::text[],false),
        ('AuditEvent','entityId','TerminalGoal','entityType',ARRAY['TerminalGoal']::text[],false),
        ('AuditEvent','entityId','KnowledgeGroup','entityType',ARRAY['KnowledgeGroup']::text[],false),
        ('AuditEvent','entityId','KnowledgePoint','entityType',ARRAY['KnowledgePoint']::text[],false),
        ('AuditEvent','entityId','KnowledgePointSubject','entityType',ARRAY['KnowledgePointSubject']::text[],false),
        ('AuditEvent','entityId','KnowledgePointRelation','entityType',ARRAY['KnowledgePointRelation']::text[],false),
        ('AuditEvent','entityId','KnowledgeSyllabusLink','entityType',ARRAY['KnowledgeSyllabusLink']::text[],false),
        ('AuditEvent','entityId','StageGoalLink','entityType',ARRAY['StageGoalLink']::text[],false),
        ('AuditEvent','entityId','StageKnowledgeTarget','entityType',ARRAY['StageKnowledgeTarget']::text[],false),
        ('AuditEvent','entityId','LearningArrangement','entityType',ARRAY['LearningArrangement']::text[],false),
        ('AuditEvent','entityId','LearningArrangementKnowledgePoint','entityType',ARRAY['LearningArrangementKnowledgePoint']::text[],false),
        ('AuditEvent','entityId','StudySessionCloseout','entityType',ARRAY['StudySessionCloseout']::text[],false),
        ('AuditEvent','entityId','StudySessionKnowledgePoint','entityType',ARRAY['StudySessionKnowledgePoint']::text[],false),
        ('AuditEvent','entityId','KnowledgeRetest','entityType',ARRAY['KnowledgeRetest']::text[],false),
        ('AuditEvent','entityId','KnowledgeRetestPoint','entityType',ARRAY['KnowledgeRetestPoint']::text[],false),
        ('AuditEvent','entityId','KnowledgeEvidence','entityType',ARRAY['KnowledgeEvidence']::text[],false),
        ('AuditEvent','entityId','AiRuntimeSetting','entityType',ARRAY['AiRuntimeSetting']::text[],false),
        ('AuditEvent','entityId','RankingPreference','entityType',ARRAY['RankingPreference']::text[],false),
        ('AuditEvent','entityId','PrivateChallenge','entityType',ARRAY['PrivateChallenge']::text[],false),
        ('AuditEvent','entityId','PrivateChallengeParticipant','entityType',ARRAY['PrivateChallengeParticipant']::text[],false),
        ('AuditEvent','entityId','RankingProjection','entityType',ARRAY['RankingProjection']::text[],false),
        ('AuditEvent','entityId','RankingAppeal','entityType',ARRAY['RankingAppeal']::text[],false),
        ('AuditEvent','entityId','UserNotification','entityType',ARRAY['UserNotification']::text[],false)
      ) refs(child_model,child_column,parent_model,discriminator,allowed_values,is_array)
      WHERE child_model=TG_TABLE_NAME LOOP
        IF relation.discriminator IS NULL OR candidate->>relation.discriminator=ANY(relation.allowed_values) THEN
          SELECT f."intentId" INTO blocked_intent FROM "DataDeletionFence" f
          WHERE f."model"=relation.parent_model AND f."intentId" IS DISTINCT FROM allowed_intent
          AND CASE WHEN relation.is_array THEN (candidate->relation.child_column) @> jsonb_build_array(f."keyJson"->>'id')
            ELSE candidate->>relation.child_column=f."keyJson"->>'id' END LIMIT 1;
        END IF;
        EXIT WHEN blocked_intent IS NOT NULL;
      END LOOP;
    END IF;
    IF blocked_intent IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "DataDeletionIntent" i WHERE i.id=blocked_intent AND i.id=allowed_intent
      AND i.state='RUNNING' AND i."executionPid"=pg_backend_pid() AND i."leaseExpiresAt">clock_timestamp()
    ) THEN RAISE EXCEPTION 'DATA_DELETE_SCOPE_FROZEN' USING ERRCODE='55000'; END IF;
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END $$;
