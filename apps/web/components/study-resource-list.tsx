import { StudyResourceCard } from "@/components/study-resource-card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";
import type { StudyResourceDto } from "@/lib/contracts";

export function StudyResourceList(props: {
  title: string;
  resources: StudyResourceDto[];
  subjects: Array<{ id: string; name: string }>;
}) {
  const subjectById = new Map(props.subjects.map((subject) => [subject.id, subject.name]));
  return (
    <section className="space-y-4">
      <SectionHeader title={props.title} meta={<Badge>{props.resources.length}</Badge>} />
      {props.resources.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {props.resources.map((resource) => (
            <StudyResourceCard
              key={resource.id}
              resource={resource}
              subjectName={subjectById.get(resource.subjectId ?? "") ?? "未分科"}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="暂无资料" description="当前筛选下没有资料。" />
      )}
    </section>
  );
}
