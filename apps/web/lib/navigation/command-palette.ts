export type GlobalCommandAction =
  | "confirmation-center"
  | "ai-assistant"
  | "recovery-help"
  | "quick-create";

export type GlobalCommandExecution = {
  rawQuery: string;
  argumentText: string;
  args: readonly string[];
  namedArgs: Readonly<Record<string, string>>;
};

export type GlobalCommandDefinition = {
  id: string;
  label: string;
  description: string;
  aliases: readonly string[];
  href?: string;
  hrefFor?: (execution: GlobalCommandExecution) => string;
  action?: GlobalCommandAction;
  requiresConfirmation?: boolean;
};

/**
 * Compose the core registry with module extensions without allowing a module
 * to silently replace a canonical command id.
 */
export function composeGlobalCommands(
  ...commandSets: readonly (readonly GlobalCommandDefinition[])[]
): readonly GlobalCommandDefinition[] {
  const byId = new Map<string, GlobalCommandDefinition>();
  for (const commandSet of commandSets) {
    for (const command of commandSet) {
      if (!byId.has(command.id)) byId.set(command.id, command);
    }
  }
  return [...byId.values()];
}

/**
 * The first command set is deliberately small. New modules can append their
 * own definitions without changing the command palette's matching logic.
 */
export const GLOBAL_COMMANDS: readonly GlobalCommandDefinition[] = [
  {
    id: "today",
    label: "打开今日行动",
    description: "回到今天的下一行动与闭环",
    aliases: ["$today", "today", "今日", "今日行动"],
    href: "/today",
  },
  {
    id: "start-learning",
    label: "开始学习",
    description: "进入选科目并开始专注计时",
    aliases: ["/start", "/start_to_learn", "start", "start_to_learn", "开始学习"],
    href: "/focus",
    hrefFor: ({ args }) => {
      if (args.length === 0) return "/focus";
      const params = new URLSearchParams();
      if (args[0] === "now") params.set("mode", "now");
      else params.set("command", args.join(" "));
      return `/focus?${params.toString()}`;
    },
  },
  {
    id: "knowledge",
    label: "打开知识工作台",
    description: "查看知识点、考纲、卡片、错题和复习",
    aliases: ["$knowledge", "knowledge", "知识"],
    href: "/knowledge",
  },
  {
    id: "test",
    label: "打开检验工作台",
    description: "进入专项复测和模拟考试",
    aliases: ["$test", "test", "检验", "复测", "模拟考试"],
    href: "/test/retests",
  },
  {
    id: "roadmap",
    label: "打开路线工作台",
    description: "查看投入安排、阶段和周期复盘",
    aliases: ["$roadmap", "roadmap", "路线", "计划"],
    href: "/roadmap",
  },
  {
    id: "settings",
    label: "打开设置",
    description: "管理考试工作区、偏好、AI 和系统",
    aliases: ["settings", "设置"],
    href: "/settings/exams",
  },
  {
    id: "settings-ai",
    label: "打开 AI 与隐私设置",
    description: "查看 AI provider、开关和数据边界",
    aliases: ["settings ai", "设置 ai", "ai 设置", "AI 与隐私"],
    href: "/settings/ai",
  },
  {
    id: "confirmations",
    label: "打开确认中心",
    description: "处理报告、建议和检验结果",
    aliases: ["confirmations", "confirmation", "确认", "确认中心"],
    action: "confirmation-center",
  },
  {
    id: "ai-assistant",
    label: "打开 AI 助手",
    description: "基于当前页面内容生成建议或草稿",
    aliases: ["ai", "ai assistant", "AI 助手"],
    action: "ai-assistant",
  },
  {
    id: "recovery-help",
    label: "打开恢复帮助",
    description: "学习遇到阻力时查看最小恢复行动",
    aliases: ["recovery", "help", "恢复", "我学不下去了"],
    action: "recovery-help",
  },
  {
    id: "quick-create",
    label: "快捷创建",
    description: "创建任务、考纲节点、卡片、错题或资料",
    aliases: ["+", "new", "create", "快捷创建", "新建"],
    action: "quick-create",
  },
] as const;

export function filterGlobalCommands(
  query: string,
  commands: readonly GlobalCommandDefinition[] = GLOBAL_COMMANDS,
): GlobalCommandDefinition[] {
  const normalizedQuery = normalizeCommandText(query);
  if (!normalizedQuery) return [...commands];

  return commands
    .map((command, index) => ({ command, index, score: commandMatchScore(command, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.command);
}

export function normalizeCommandText(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

export function tokenizeCommandArguments(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

export function resolveGlobalCommand(
  query: string,
  commands: readonly GlobalCommandDefinition[] = GLOBAL_COMMANDS,
): { definition: GlobalCommandDefinition; execution: GlobalCommandExecution } | null {
  const rawQuery = query.trim();
  const normalizedQuery = normalizeCommandText(rawQuery);
  if (!normalizedQuery) return null;

  const aliases = commands.flatMap((definition, definitionIndex) => definition.aliases.map((alias) => ({
    alias: normalizeCommandText(alias),
    definition,
    definitionIndex,
  })));
  const prefix = aliases
    .filter(({ alias }) => normalizedQuery === alias || normalizedQuery.startsWith(`${alias} `))
    .sort((left, right) => right.alias.length - left.alias.length || left.definitionIndex - right.definitionIndex)[0];
  const definition = prefix?.definition ?? filterGlobalCommands(normalizedQuery, commands)[0];
  if (!definition) return null;

  const argumentText = prefix ? normalizedQuery.slice(prefix.alias.length).trim() : "";
  const args = tokenizeCommandArguments(argumentText);
  const namedArgs: Record<string, string> = {};
  for (const argument of args) {
    const match = argument.match(/^--?([a-zA-Z][\w-]*)=(.+)$/);
    if (match) namedArgs[match[1]] = match[2];
  }
  return {
    definition,
    execution: { rawQuery, argumentText, args, namedArgs },
  };
}

export function getGlobalCommandHref(
  definition: GlobalCommandDefinition,
  execution: GlobalCommandExecution,
): string | undefined {
  return definition.hrefFor?.(execution) ?? definition.href;
}

export function clampCommandIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || length <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), length - 1);
}

function commandMatchScore(command: GlobalCommandDefinition, query: string): number {
  const label = normalizeCommandText(command.label);
  const description = normalizeCommandText(command.description);
  const aliases = command.aliases.map(normalizeCommandText);
  if (aliases.some((alias) => alias === query)) return 100;
  // Keep the command token extensible: `/start_to_learn now` should resolve
  // to the `/start_to_learn` command while preserving the trailing arguments
  // for a future executor implementation.
  if (aliases.some((alias) => query.startsWith(`${alias} `))) return 98;
  if (label === query) return 95;
  if (aliases.some((alias) => alias.startsWith(query))) return 80;
  if (label.startsWith(query)) return 75;
  if (aliases.some((alias) => alias.includes(query))) return 60;
  if (label.includes(query)) return 55;
  if (description.includes(query)) return 25;
  return 0;
}
