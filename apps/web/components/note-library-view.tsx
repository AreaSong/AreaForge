import { BookOpenCheck, Plus } from "lucide-react";
import { NoteLibraryItem } from "@/components/note-library-item";
import type { NoteLibraryController } from "@/components/note-library";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlays";
import { Toolbar } from "@/components/ui/page";
import type { NoteMasteryStatusDto } from "@/lib/contracts";

const createControlClassName = "h-11 bg-[#0d1117] text-zinc-100";
const filterControlClassName = "h-10 !w-auto bg-[#0d1117] text-zinc-100";

export function NoteLibraryView({ controller }: { controller: NoteLibraryController }) {
  const {
    subjects, initialQuery, createTitleRef,
    subjectId, setSubjectId, syllabusNodeId, setSyllabusNodeId, taskId, setTaskId,
    title, setTitle, content, setContent, kind, setKind, masteryStatus, setMasteryStatus,
    nextReviewAt, setNextReviewAt, error, saving, createOpen, setCreateOpen, isPending,
    nodeOptions, taskOptions, filterNodeOptions, visibleNotes, filteredNotes, hasListFilters,
    noteSubjectFilter, noteNodeFilter, noteMasteryFilter, noteReviewFilter, applyListFilters,
    attachmentOperations, submit, uploadAttachment,
  } = controller;

  return (
    <>
      <Drawer open={createOpen} title="新增卡片" onClose={() => setCreateOpen(false)}>
        <form className="grid min-w-0 gap-3" onSubmit={submit}>
          <div className="af-content-grid-two grid min-w-0 gap-3">
            <Select
              className={createControlClassName}
              value={subjectId}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setSyllabusNodeId("");
                setTaskId("");
              }}
              required
            >
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </Select>
            <Select className={createControlClassName} aria-label="卡片类型" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              <option value="GENERAL">通用</option><option value="CONCEPT">概念</option><option value="METHOD">方法</option><option value="EXAMPLE">例题</option><option value="JOURNAL">学习记录</option><option value="SUMMARY">总结</option>
            </Select>
            <Select className={createControlClassName} value={masteryStatus} onChange={(event) => setMasteryStatus(event.target.value as NoteMasteryStatusDto)}>
              <option value="understood">理解了</option><option value="partial">似懂非懂</option><option value="unknown">不会</option><option value="relearn">需要重学</option><option value="before_exam">考前再看</option>
            </Select>
          </div>
          <Select className={createControlClassName} value={syllabusNodeId} onChange={(event) => setSyllabusNodeId(event.target.value)}>
            <option value="">不关联考纲节点</option>
            {nodeOptions.map((node) => <option key={node.id} value={node.id}>{"  ".repeat(node.depth)}{node.title}</option>)}
          </Select>
          <Select className={createControlClassName} value={taskId} onChange={(event) => setTaskId(event.target.value)}>
            <option value="">不关联任务</option>
            {taskOptions.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </Select>
          <Input className={createControlClassName} ref={createTitleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="卡片标题" required />
          <Textarea className="min-h-44 bg-[#0d1117] text-zinc-100" controlHeight="lg" value={content} onChange={(event) => setContent(event.target.value)} placeholder="写下自己的理解、题解或复盘产出" required />
          <Input className={createControlClassName} type="datetime-local" value={nextReviewAt} onChange={(event) => setNextReviewAt(event.target.value)} aria-label="下次复习时间" />
          <Button variant="primary" size="lg" type="submit" disabled={isPending || saving || !subjectId}>
            <BookOpenCheck className="h-4 w-4" aria-hidden="true" />保存卡片
          </Button>
        </form>
        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
      </Drawer>

      {!createOpen && error ? <p className="text-sm text-red-200">{error}</p> : null}
      <section className="min-w-0 border-y border-white/10 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-white">我的卡片</h2>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">{filteredNotes.length} / {visibleNotes.length} 条</span>
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />新增卡片</Button>
          </div>
        </div>

        <Toolbar className="mt-5" label="卡片筛选">
          <Select className={filterControlClassName} aria-label="筛选卡片科目" value={noteSubjectFilter} onChange={(event) => applyListFilters({ subject: event.target.value, node: "all" })}>
            <option value="all">全部科目</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </Select>
          <Select className={filterControlClassName} aria-label="筛选卡片考纲节点" value={noteNodeFilter} onChange={(event) => applyListFilters({ node: event.target.value })}>
            <option value="all">全部节点</option><option value="none">未关联节点</option>
            {filterNodeOptions.map((node) => <option key={node.id} value={node.id}>{"  ".repeat(node.depth)}{node.title}</option>)}
          </Select>
          <Select className={filterControlClassName} aria-label="筛选卡片掌握状态" value={noteMasteryFilter} onChange={(event) => applyListFilters({ mastery: event.target.value as "all" | NoteMasteryStatusDto })}>
            <option value="all">全部掌握状态</option><option value="understood">理解了</option><option value="partial">似懂非懂</option><option value="unknown">不会</option><option value="relearn">需要重学</option><option value="before_exam">考前再看</option>
          </Select>
          <Select className={filterControlClassName} aria-label="筛选卡片复习状态" value={noteReviewFilter} onChange={(event) => applyListFilters({ review: event.target.value as "all" | "due" | "scheduled" | "none" })}>
            <option value="all">全部复习提醒</option><option value="due">已到期</option><option value="scheduled">已设置</option><option value="none">未设置</option>
          </Select>
          {initialQuery ? <Badge tone="info">搜索：{initialQuery}</Badge> : null}
          {hasListFilters ? <Button type="button" size="sm" variant="ghost" onClick={() => applyListFilters({ subject: "all", node: "all", mastery: "all", review: "all" })}>清除筛选</Button> : null}
        </Toolbar>

        <div className="mt-5">
          {visibleNotes.length === 0 ? <EmptyState title={initialQuery ? "没有匹配的卡片" : "还没有卡片"} description={initialQuery ? "尝试修改搜索词或清除筛选。" : "计时结束后的最小产出可以在这里沉淀下来。"} /> : null}
          {visibleNotes.length > 0 && filteredNotes.length === 0 ? <EmptyState title="当前筛选没有结果" description="调整筛选条件，或清除筛选查看全部卡片。" action={<Button type="button" size="sm" onClick={() => applyListFilters({ subject: "all", node: "all", mastery: "all", review: "all" })}>清除筛选</Button>} /> : null}
          {filteredNotes.length > 0 ? (
            <div className="divide-y divide-white/10 border-y border-white/10">
              {filteredNotes.map((note) => {
                const upload = attachmentOperations.get(note.id);
                return <NoteLibraryItem key={note.id} note={note} uploading={upload.pending} uploadError={upload.error} onUpload={(file) => void uploadAttachment(note.id, file)} />;
              })}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
