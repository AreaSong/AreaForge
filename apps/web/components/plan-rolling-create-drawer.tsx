import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { Drawer } from "@/components/ui/overlays";
import type {
  KnowledgePointDto,
  PlanMilestoneDto,
  StagePlanDto,
  SyllabusOptionNodeDto,
  TaskPriorityDto,
} from "@/lib/contracts";

export function PlanRollingCreateDrawer(props: {
  open: boolean;
  selectedDate?: string;
  title: string;
  subjectId: string;
  subjects: Array<{ id: string; name: string }>;
  planMilestoneId: string;
  availableMilestones: PlanMilestoneDto[];
  syllabusNodeId: string;
  availableNodes: Array<SyllabusOptionNodeDto & { depth: number }>;
  estimatedMinutes: number;
  taskType: string;
  priority: TaskPriorityDto;
  relatedSyllabusNodeIds: string[];
  knowledgePointIds: string[];
  knowledgePoints: KnowledgePointDto[];
  stagePlanIds: string[];
  availableStagePlans: StagePlanDto[];
  error: string | null;
  pending: boolean;
  creatingTask: boolean;
  sourceResourceArchived: boolean;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onPlanMilestoneChange: (value: string) => void;
  onSyllabusNodeChange: (value: string) => void;
  onEstimatedMinutesChange: (value: number) => void;
  onTaskTypeChange: (value: string) => void;
  onPriorityChange: (value: TaskPriorityDto) => void;
  onRelatedSyllabusNodeToggle: (nodeId: string) => void;
  onKnowledgePointToggle: (pointId: string) => void;
  onStagePlanToggle: (stagePlanId: string) => void;
  onCreate: () => void;
}) {
  return (
    <Drawer open={props.open} title={`新建任务 · ${props.selectedDate ?? "未排期"}`} onClose={props.onClose}>
      <div className="af-content-grid-two grid gap-3">
        <label className="text-sm">
          <span className="text-zinc-400">标题</span>
          <Input
            className="mt-1"
            value={props.title}
            onChange={(event) => props.onTitleChange(event.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">科目</span>
          <Select
            className="mt-1"
            value={props.subjectId}
            onChange={(event) => props.onSubjectChange(event.target.value)}
          >
            {props.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">里程碑</span>
          <Select className="mt-1" value={props.planMilestoneId} onChange={(event) => props.onPlanMilestoneChange(event.target.value)}>
            <option value="">不关联里程碑</option>
            {props.availableMilestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
          </Select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">主考纲节点</span>
          <Select
            className="mt-1"
            value={props.syllabusNodeId}
            onChange={(event) => props.onSyllabusNodeChange(event.target.value)}
          >
            <option value="">不关联考纲节点</option>
            {props.availableNodes.map((node) => <option key={node.id} value={node.id}>{`${"  ".repeat(node.depth)}${node.title}`}</option>)}
          </Select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">预计分钟</span>
          <Input
            type="number"
            min={5}
            max={720}
            className="mt-1"
            value={props.estimatedMinutes}
            onChange={(event) => props.onEstimatedMinutesChange(Number(event.target.value) || 25)}
          />
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">任务类型</span>
          <Select className="mt-1" value={props.taskType} onChange={(event) => props.onTaskTypeChange(event.target.value)}>
            <option value="study">学习</option><option value="review">复习</option><option value="practice">刷题</option><option value="mistake">错题</option><option value="simulation_exam">模拟</option>
          </Select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">优先级</span>
          <Select className="mt-1" value={props.priority} onChange={(event) => props.onPriorityChange(event.target.value as TaskPriorityDto)}>
            <option value="critical">最高</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option>
          </Select>
        </label>
      </div>
      <fieldset className="mt-3 space-y-2">
        <legend className="text-sm text-zinc-400">其他相关考纲节点（最多 20 个）</legend>
        <div className="af-content-grid-two grid max-h-44 gap-2 overflow-y-auto border-l border-white/10 pl-3">
          {props.availableNodes.filter((node) => node.id !== props.syllabusNodeId).map((node) => (
            <label key={node.id} className="flex min-w-0 items-start gap-2 text-sm text-zinc-300">
              <Checkbox className="mt-1" checked={props.relatedSyllabusNodeIds.includes(node.id)} onChange={() => props.onRelatedSyllabusNodeToggle(node.id)} />
              <span className="min-w-0 break-words">{`${"  ".repeat(node.depth)}${node.title}`}</span>
            </label>
          ))}
          {props.availableNodes.length === 0 ? <p className="text-sm text-zinc-500">该科目暂无可关联节点</p> : null}
        </div>
      </fieldset>
      <fieldset className="mt-3 space-y-2">
        <legend className="text-sm text-zinc-400">关联知识点（可多选，最多 50 个）</legend>
        <div className="af-content-grid-two grid max-h-44 gap-2 overflow-y-auto border-l border-white/10 pl-3">
          {props.knowledgePoints.filter((point) => point.subject.id === props.subjectId || point.relatedSubjects.some((subject) => subject.id === props.subjectId)).map((point) => (
            <label key={point.id} className="flex min-w-0 items-start gap-2 text-sm text-zinc-300">
              <Checkbox className="mt-1" checked={props.knowledgePointIds.includes(point.id)} onChange={() => props.onKnowledgePointToggle(point.id)} />
              <span className="min-w-0 break-words">{point.title}</span>
            </label>
          ))}
          {props.knowledgePoints.length === 0 ? <p className="text-sm text-zinc-500">当前还没有知识点</p> : null}
        </div>
      </fieldset>
      <fieldset className="mt-3 space-y-2">
        <legend className="text-sm text-zinc-400">所属阶段（可多选，最多 20 个）</legend>
        <div className="af-content-grid-two grid max-h-44 gap-2 overflow-y-auto border-l border-white/10 pl-3">
          {props.availableStagePlans.map((stagePlan) => (
            <label key={stagePlan.id} className="flex min-w-0 items-start gap-2 text-sm text-zinc-300">
              <Checkbox
                className="mt-1"
                checked={props.stagePlanIds.includes(stagePlan.id)}
                onChange={() => props.onStagePlanToggle(stagePlan.id)}
              />
              <span className="min-w-0 break-words">{stagePlan.name}</span>
            </label>
          ))}
          {props.availableStagePlans.length === 0 ? <p className="text-sm text-zinc-500">当前没有可关联的阶段</p> : null}
        </div>
      </fieldset>
      {props.error ? <p className="mt-2 text-sm text-red-300" role="alert">{props.error}</p> : null}
      <Button
        variant="primary"
        size="lg"
        type="button"
        disabled={props.pending || props.creatingTask || props.sourceResourceArchived}
        className="mt-4 w-full"
        onClick={props.onCreate}
      >
        {props.creatingTask ? "创建中..." : "新建任务"}
      </Button>
    </Drawer>
  );
}
