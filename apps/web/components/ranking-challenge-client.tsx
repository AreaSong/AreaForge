"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, BarChart3, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, SectionCard } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import {
  createPrivateChallenge,
  getRankingPreference,
  inviteChallengeParticipant,
  joinOrLeaveChallenge,
  listPrivateChallenges,
  rebuildChallengeProjection,
  transitionPrivateChallenge,
  updateRankingPreference,
} from "@/lib/api/ranking";
import type { PrivateChallengeDto, RankingPreferenceDto, RankingProjectionViewDto } from "@/lib/ranking/contracts";

export interface RankingWorkspaceOption { id: string; name: string }

export function RankingChallengeClient(props: { enabled: boolean; currentUserId: string; workspaces: RankingWorkspaceOption[] }) {
  const [workspaceId, setWorkspaceId] = useState(props.workspaces[0]?.id ?? "");
  const [preference, setPreference] = useState<RankingPreferenceDto | null>(null);
  const [challenges, setChallenges] = useState<PrivateChallengeDto[]>([]);
  const [projection, setProjection] = useState<Record<string, RankingProjectionViewDto>>({});
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [targetMinutes, setTargetMinutes] = useState(60);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!props.enabled || !workspaceId) return;
    setPending(true);
    const [preferenceResult, challengeResult] = await Promise.all([getRankingPreference(workspaceId), listPrivateChallenges(workspaceId)]);
    setPending(false);
    if (preferenceResult.ok) setPreference(preferenceResult.body?.preference ?? null);
    if (challengeResult.ok) setChallenges(challengeResult.body?.challenges ?? []);
    if (!preferenceResult.ok || !challengeResult.ok) setNotice("排名候选能力暂时不可用，请确认开关和成员权限。");
  }, [props.enabled, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!props.enabled) return <SectionCard variant="subtle"><p className="text-sm text-zinc-400">私有挑战与排名默认关闭；开启前不会读取或写入排名数据。</p></SectionCard>;

  async function toggleOptIn() {
    if (!preference) return;
    setPending(true);
    const result = await updateRankingPreference(workspaceId, { enabled: !preference.enabled, timezone: preference.timezone, authorizedFields: preference.authorizedFields, expectedRevision: preference.revision || undefined });
    setPending(false);
    if (!result.ok || !result.body?.preference) return setNotice("排名授权更新失败，请刷新后重试。");
    setPreference(result.body.preference);
    setNotice(result.body.preference.enabled ? "已主动加入排名；默认只分享分数。" : "已退出排名，相关投影将被清理。");
  }

  async function createChallenge() {
    if (!name.trim() || !startDate || !endDate) return setNotice("请填写挑战名称和日期窗口。");
    setPending(true);
    const result = await createPrivateChallenge({ workspaceId, name, timezone: preference?.timezone ?? "UTC", startDate, endDate, targetEffectiveMinutesPerDay: targetMinutes, publishedFields: ["score"] });
    setPending(false);
    if (!result.ok || !result.body?.challenge) return setNotice("挑战创建失败，请确认已主动加入排名。");
    setChallenges((current) => [result.body!.challenge!, ...current]);
    setName("");
    setNotice("私有挑战已创建，尚未公开任何学习正文。");
  }

  async function transition(challenge: PrivateChallengeDto, action: "start" | "end" | "close" | "dissolve") {
    setPending(true);
    const result = await transitionPrivateChallenge(challenge.id, action, challenge.revision);
    setPending(false);
    if (!result.ok || !result.body?.challenge) return setNotice("挑战状态更新失败，请刷新后重试。");
    setChallenges((current) => current.map((item) => item.id === challenge.id ? result.body!.challenge! : item));
  }

  async function rebuild(challenge: PrivateChallengeDto) {
    setPending(true);
    const result = await rebuildChallengeProjection(challenge.id, challenge.revision);
    setPending(false);
    if (!result.ok || !result.body?.projection) return setNotice("排名投影重建失败；学习源事实不会被修改。");
    setProjection((current) => ({ ...current, [challenge.id]: result.body!.projection! }));
  }

  return <div className="space-y-6">
    {notice ? <Alert tone="info" role="status">{notice}</Alert> : null}
    <SectionCard variant="master" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-base font-semibold text-white"><ShieldCheck className="size-4 text-teal-300" aria-hidden="true" />主动加入与隐私字段</h2><p className="mt-1 text-xs text-zinc-400">排名只读取白名单学习事实，不包含动机、复盘正文、笔记、错题、附件或任务标题。</p></div><Select className="w-56" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">选择工作区</option>{props.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</Select></div><div className="flex flex-wrap items-center gap-3"><Badge tone={preference?.enabled ? "success" : "warning"}>{preference?.enabled ? "已主动加入" : "未加入"}</Badge><Button disabled={pending || !preference} onClick={() => void toggleOptIn()} size="sm" type="button" variant="secondary">{preference?.enabled ? "退出排名" : "主动加入排名"}</Button><span className="text-xs text-zinc-500">分享字段：{preference?.authorizedFields.join("、") || "score"}</span></div></SectionCard>
    <SectionCard variant="subtle" className="space-y-4"><CardHeader className="p-0"><CardTitle className="flex items-center gap-2 text-sm"><Award className="size-4 text-amber-300" aria-hidden="true" />创建私有挑战</CardTitle></CardHeader><CardContent className="grid gap-3 p-0 md:grid-cols-4"><label className="text-xs text-zinc-400 md:col-span-2">名称<Input className="mt-2" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} /></label><label className="text-xs text-zinc-400">开始日期<Input className="mt-2" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={pending} /></label><label className="text-xs text-zinc-400">结束日期<Input className="mt-2" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={pending} /></label><label className="text-xs text-zinc-400">每日目标分钟<Input className="mt-2" type="number" min={1} max={1440} value={targetMinutes} onChange={(event) => setTargetMinutes(Number(event.target.value))} disabled={pending} /></label><div className="flex items-end"><Button disabled={pending || !preference?.enabled || !workspaceId} onClick={() => void createChallenge()} type="button"><Award className="size-4" aria-hidden="true" />创建挑战</Button></div></CardContent></SectionCard>
    <SectionCard variant="subtle" className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-white">我的私有挑战</h2><p className="mt-1 text-xs text-zinc-500">规则开始后冻结；投影可重建，故障不影响学习主链。异常排名可通过申诉状态链处理，不会改写学习源事实。</p></div><Button disabled={pending} onClick={() => void load()} size="sm" type="button" variant="secondary"><RefreshCw className="size-3.5" aria-hidden="true" />刷新</Button></div>{challenges.length === 0 ? <EmptyState title="暂无私有挑战" description="主动加入排名后创建第一个挑战。" /> : <div className="space-y-3">{challenges.map((challenge) => <ChallengeRow key={challenge.id} challenge={challenge} currentUserId={props.currentUserId} projection={projection[challenge.id]} pending={pending} onReload={load} onTransition={transition} onRebuild={rebuild} />)}</div>}</SectionCard>
  </div>;
}

function ChallengeRow(props: { challenge: PrivateChallengeDto; currentUserId: string; projection?: RankingProjectionViewDto; pending: boolean; onReload: () => Promise<void>; onTransition: (challenge: PrivateChallengeDto, action: "start" | "end" | "close" | "dissolve") => Promise<void>; onRebuild: (challenge: PrivateChallengeDto) => Promise<void> }) {
  const challenge = props.challenge;
  const canManage = challenge.ownerUserId === props.currentUserId;
  const selfParticipant = challenge.participants?.find((participant) => participant.userId === props.currentUserId);
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteNickname, setInviteNickname] = useState("");
  const [invitePending, setInvitePending] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  async function changeParticipation(action: "join" | "leave") {
    setInvitePending(true);
    const result = await joinOrLeaveChallenge(challenge.id, action);
    setInvitePending(false);
    if (!result.ok || !result.body?.participant) {
      setInviteNotice(action === "join" ? "接受邀请失败，请确认排名授权仍有效。" : "退出失败，请刷新后重试。");
      return;
    }
    setInviteNotice(action === "join" ? "已加入挑战，等待 Owner 重建排名。" : "已退出挑战，个人投影已清理。");
    await props.onReload();
  }

  async function inviteParticipant() {
    const userId = inviteUserId.trim();
    if (!userId) {
      setInviteNotice("请输入成员 ID；不会向排名发送学习正文。");
      return;
    }
    setInvitePending(true);
    const result = await inviteChallengeParticipant(challenge.id, {
      userId,
      nickname: inviteNickname.trim() || null,
      authorizedFields: ["score"],
    });
    setInvitePending(false);
    if (!result.ok || !result.body?.participant) {
      setInviteNotice("邀请失败，请确认成员仍在当前工作区且已主动加入排名。");
      return;
    }
    setInviteUserId("");
    setInviteNickname("");
    setInviteNotice("邀请已创建；成员接受后才会进入投影。");
  }

  return <Card variant="subtle"><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-white">{challenge.name}</p><p className="mt-1 text-xs text-zinc-500">{challenge.startDate} → {challenge.endDate} · 每日 {challenge.targetEffectiveMinutesPerDay} 分钟</p></div><Badge>{challenge.status}</Badge></div><div className="flex flex-wrap gap-2">{canManage && challenge.status === "DRAFT" ? <Button disabled={props.pending} onClick={() => void props.onTransition(challenge, "start")} size="sm" type="button">开始</Button> : null}{canManage && challenge.status === "ACTIVE" ? <Button disabled={props.pending} onClick={() => void props.onTransition(challenge, "end")} size="sm" type="button" variant="secondary">结束</Button> : null}{canManage && challenge.status === "ENDED" ? <Button disabled={props.pending} onClick={() => void props.onTransition(challenge, "close")} size="sm" type="button" variant="secondary">关闭</Button> : null}{canManage && challenge.status !== "DISSOLVED" ? <Button disabled={props.pending} onClick={() => void props.onTransition(challenge, "dissolve")} size="sm" type="button" variant="secondary">解散</Button> : null}{canManage && (challenge.status === "ACTIVE" || challenge.status === "ENDED" || challenge.status === "CLOSED") ? <Button disabled={props.pending} onClick={() => void props.onRebuild(challenge)} size="sm" type="button" variant="secondary"><BarChart3 className="size-3.5" aria-hidden="true" />重建排名</Button> : null}{selfParticipant?.status === "INVITED" ? <Button disabled={invitePending || props.pending} onClick={() => void changeParticipation("join")} size="sm" type="button">接受邀请</Button> : null}{!canManage && selfParticipant?.status === "ACTIVE" && challenge.status !== "ENDED" && challenge.status !== "CLOSED" ? <Button disabled={invitePending || props.pending} onClick={() => void changeParticipation("leave")} size="sm" type="button" variant="secondary">退出挑战</Button> : null}</div>{canManage && challenge.status !== "DISSOLVED" ? <div className="grid gap-2 border-t border-white/10 pt-3 md:grid-cols-[1fr_1fr_auto]"><Input aria-label="被邀请成员 ID" placeholder="成员 ID" value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)} disabled={invitePending || props.pending} /><Input aria-label="排名昵称（可选）" placeholder="昵称（可选）" value={inviteNickname} onChange={(event) => setInviteNickname(event.target.value)} disabled={invitePending || props.pending} /><Button disabled={invitePending || props.pending} onClick={() => void inviteParticipant()} size="sm" type="button" variant="secondary">邀请成员</Button></div> : null}{inviteNotice ? <p className="text-xs text-zinc-400" role="status">{inviteNotice}</p> : null}{props.projection ? <p className="text-xs text-zinc-400">投影 {props.projection.entries.length} 人 · {props.projection.stale ? "需要重建" : "当前版本"}</p> : null}</CardContent></Card>;
}
