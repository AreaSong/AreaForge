export const deletionErrors: Record<string, string> = {
  REAUTHENTICATION_REQUIRED: "请先重新验证当前密码。", DATA_DELETE_REAUTHENTICATION_REQUIRED: "请先重新验证当前密码。",
  CURRENT_PASSWORD_INVALID: "当前密码不正确，请检查后重试。", UNAUTHORIZED: "登录已失效；如已提交账户删除，请查看当前页的回执。",
  DATA_DELETE_DISABLED: "删除功能未启用。已有请求仍可取消或恢复。",
  DATA_DELETE_FOREIGN_REFERENCE: "仍关联其他成员的数据，请先处理共享关系。",
  DATA_DELETE_RETAINED_REFERENCE: "存在需独立处理的协作或运维记录，当前范围不能删除。",
  DATA_DELETE_CHALLENGE_OWNED: "请先解散或转移本人拥有的挑战。", DATA_DELETE_INVITATION_ACTIVE: "请先撤销待处理邀请。",
  DATA_DELETE_SESSION_ACTIVE: "请先结束正在进行的学习。", DATA_DELETE_JOB_ACTIVE: "请先结束或取消其他后台任务。",
  DATA_DELETE_ATTACHMENT_UNSETTLED: "附件尚未就绪，请先完成上传或对账。", DATA_DELETE_EXPORT_UNSETTLED: "导出副本尚未完成处理，请稍后重试。",
  DATA_DELETE_ALREADY_FROZEN: "这些对象已在其他删除请求或回收站中。", DATA_DELETE_SCHEMA_DRIFT: "数据结构不一致，已停止处理，请联系维护者。",
  DATA_DELETE_PREVIEW_CHANGED: "数据已变化，请重新预览并核对范围。", DATA_DELETE_FROZEN_SCOPE_CHANGED: "权限条件已变化，请重新验证后重试。",
  DATA_DELETE_RECONFIRMATION_SCOPE_CHANGED: "冻结对象发生变化，已停止；需要维护者核对。",
  DATA_DELETE_AUTHORIZATION_CHANGED: "当前权限已变化，请刷新并重新选择范围。", DATA_DELETE_NOT_FOUND: "对象不存在，或当前不可访问。",
  DATA_DELETE_REVISION_CONFLICT: "状态已变化，请刷新后再操作。", DATA_DELETE_CONTROL_INVALID: "已超过可操作阶段，请刷新查看最新状态。",
  DATA_DELETE_FILE_MISMATCH: "附件校验不一致，已保持隔离，没有声明完成。", DATA_DELETE_FILE_MISSING: "附件缺失，已保持隔离，需要先核对存储。",
  DATA_DELETE_UNSAFE_STORAGE: "文件存储检查未通过，已停止删除。", DATA_DELETE_READ_BUSY: "状态正在变化；请刷新确认刚才的操作结果。",
  DATA_DELETE_FILE_REFERENCE_AMBIGUOUS: "附件存储身份存在重复引用，请先对账，不会直接删除文件。",
};
export const deletionError = (code?: string) => deletionErrors[code ?? ""] ?? "请求结果尚未确认，请刷新查看；输入和本次请求标识已保留。";
export const deletionStates: Record<string, string> = { COOLDOWN: "冷静期", TRASHED: "回收站", RUNNING: "处理中", RETRY_WAIT: "等待重试",
  FAILED: "需处理", SUCCEEDED: "已完成删除", CANCELLED: "已取消", RESTORED: "已恢复" };
export const deletionKinds: Record<string, string> = { Note: "知识卡片", Mistake: "错题", StudyTask: "学习任务", StudyResource: "学习资料", KnowledgePoint: "知识点",
  Attachment: "附件", User: "账户", ExamWorkspace: "工作区", Subject: "科目", SyllabusNode: "考纲节点", StudySession: "学习记录", DailyReview: "复盘",
  MotivationVault: "动机档案", AuthSession: "登录会话", WorkspaceMembership: "成员关系", AuditEvent: "操作记录" };
