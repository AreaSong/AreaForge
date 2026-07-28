"use client";

import { useState } from "react";
import { Drawer, Modal } from "@/components/ui/overlays";

export interface ConflictComparison {
  field: string;
  label?: string;
  baseline?: unknown;
  local: unknown;
  server: unknown;
}

interface ConflictResolutionModalProps {
  open: boolean;
  title: string;
  description: string;
  conflictFields: string[];
  comparisons: ConflictComparison[];
  onClose?: () => void;
  onAdoptServer: () => void;
  onManualMerge: () => void;
  adoptLabel?: string;
  mergeLabel?: string;
}

export function ConflictResolutionModal(props: ConflictResolutionModalProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const visibleComparisons = props.comparisons.filter((item) =>
    props.conflictFields.length === 0 || props.conflictFields.includes(item.field) || !valuesEqual(item.local, item.server),
  );

  return (
    <>
      <Modal
        open={props.open && !detailsOpen}
        title={props.title}
        onClose={props.onClose}
        allowEscape={false}
      >
        <div className="space-y-4 text-sm text-zinc-300">
          <p role="alert" className="leading-6 text-amber-100">{props.description}</p>
          <p>
            冲突字段：{props.conflictFields.length > 0 ? props.conflictFields.join("、") : "服务端状态"}
          </p>
          <button
            type="button"
            className="h-10 text-teal-300 underline underline-offset-4"
            onClick={() => setDetailsOpen(true)}
          >
            查看本地与服务端差异
          </button>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="h-10 rounded-md border border-white/10 px-3"
              onClick={props.onAdoptServer}
            >
              {props.adoptLabel ?? "采用服务端版本"}
            </button>
            <button
              type="button"
              className="h-10 rounded-md bg-teal-500 px-3 font-medium text-black"
              onClick={props.onManualMerge}
            >
              {props.mergeLabel ?? "保留本地输入并人工合并"}
            </button>
          </div>
        </div>
      </Modal>
      <Drawer open={props.open && detailsOpen} title={`${props.title}：字段差异`} onClose={() => setDetailsOpen(false)}>
        <dl className="space-y-4 text-sm">
          {visibleComparisons.length > 0 ? visibleComparisons.map((item) => (
            <div key={item.field} className="border-b border-white/10 pb-4">
              <dt className="font-medium text-zinc-100">{item.label ?? item.field}</dt>
              <dd className="mt-2 grid gap-2">
                {Object.prototype.hasOwnProperty.call(item, "baseline") ? (
                  <ConflictValue label="首次提交基线" value={item.baseline} />
                ) : null}
                <ConflictValue label="本地保留值" value={item.local} />
                <ConflictValue label="服务端最新值" value={item.server} />
              </dd>
            </div>
          )) : <p className="text-zinc-400">服务端状态已变化，请先采用最新基线再检查本地输入。</p>}
        </dl>
      </Drawer>
    </>
  );
}

function ConflictValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <span className="text-xs text-zinc-500">{label}</span>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
        {formatValue(value)}
      </pre>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未设置";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
