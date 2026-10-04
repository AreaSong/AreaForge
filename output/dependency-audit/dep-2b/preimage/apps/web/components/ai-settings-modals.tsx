import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";

interface AiSettingsModalsProps {
  runtimeConfirmOpen: boolean;
  runtimeEnabled: boolean;
  runtimePending: boolean;
  preferenceConfirmOpen: boolean;
  externalProviderEnabled: boolean;
  preferencePending: boolean;
  deleteConfirmOpen: boolean;
  providerPending: boolean;
  onCloseRuntime: () => void;
  onSaveRuntime: () => void;
  onClosePreference: () => void;
  onSavePreference: () => void;
  onCloseDelete: () => void;
  onDeleteProvider: () => void;
}

export function AiSettingsModals(props: AiSettingsModalsProps) {
  return (
    <>
      <Modal
        open={props.runtimeConfirmOpen}
        title={props.runtimeEnabled ? "确认开启全局 AI" : "确认关闭全局 AI"}
        onClose={props.runtimePending ? undefined : props.onCloseRuntime}
        allowEscape={!props.runtimePending}
      >
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            {props.runtimeEnabled
              ? "开启后，已获得浏览器授权的显式 AI 操作才可能访问账户 Provider；系统不会在页面加载、SSR 或后台任务中自动外呼。"
              : "关闭后，所有账户和浏览器的 AI 操作都会回退本地规则，不会访问外部 Provider。"}
          </p>
          <p className="text-zinc-500">
            不改变允许发送的字段，不发送附件、完整动机封存、完整复盘正文或未选择正文，也不保存 prompt/raw response。
          </p>
          <ModalActions
            pending={props.runtimePending}
            confirmLabel={props.runtimeEnabled ? "确认开启并保存" : "确认关闭并保存"}
            onClose={props.onCloseRuntime}
            onConfirm={props.onSaveRuntime}
          />
        </div>
      </Modal>
      <Modal
        open={props.preferenceConfirmOpen}
        title={props.externalProviderEnabled ? "确认开启外部 Provider" : "确认关闭外部 Provider"}
        onClose={props.preferencePending ? undefined : props.onClosePreference}
        allowEscape={!props.preferencePending}
      >
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            {props.externalProviderEnabled
              ? "开启后，只有你主动触发的 AI 请求才可能调用已配置的外部 Provider；四类文本草稿仍须先确认发送预览。"
              : "关闭后，当前浏览器的 AI 请求将使用本地规则 fallback，不调用外部 Provider。"}
          </p>
          <p className="text-zinc-500">本次设置不改变允许字段，不发送附件、未选择正文、完整动机封存或完整复盘正文。</p>
          <ModalActions
            pending={props.preferencePending}
            confirmLabel={props.externalProviderEnabled ? "确认开启并保存" : "确认关闭并保存"}
            onClose={props.onClosePreference}
            onConfirm={props.onSavePreference}
          />
        </div>
      </Modal>
      <Modal
        open={props.deleteConfirmOpen}
        title="确认删除账户 Provider 配置"
        onClose={props.providerPending ? undefined : props.onCloseDelete}
        allowEscape={!props.providerPending}
      >
        <div className="space-y-4 text-sm text-zinc-300">
          <p>删除后，当前账户配置会立即失效，API Key 密文记录会从当前数据库中删除；历史备份不会同步物理清除。</p>
          <ModalActions
            danger
            pending={props.providerPending}
            pendingLabel="删除中..."
            confirmLabel="确认删除"
            onClose={props.onCloseDelete}
            onConfirm={props.onDeleteProvider}
          />
        </div>
      </Modal>
    </>
  );
}

function ModalActions(props: {
  pending: boolean;
  pendingLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" disabled={props.pending} className="h-10 rounded-md border border-white/10 px-4 text-zinc-200 disabled:opacity-50" onClick={props.onClose}>
        取消
      </Button>
      <Button type="button" disabled={props.pending} className={`h-10 rounded-md px-4 font-medium disabled:opacity-50 ${props.danger ? "bg-red-500/90 text-white" : "bg-teal-500/90 text-black"}`} onClick={props.onConfirm}>
        {props.pending ? props.pendingLabel ?? "保存中..." : props.confirmLabel}
      </Button>
    </div>
  );
}
