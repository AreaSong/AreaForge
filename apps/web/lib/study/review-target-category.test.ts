import assert from "node:assert/strict";
import test from "node:test";
import { getReviewTarget } from "./review-target-service";

test("复习目标输出八类共享标签，未知历史分类显式保留", async (t) => {
  for (const [key, value] of Object.entries({ DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/unused",
    AUTH_SESSION_SECRET: "synthetic-test-secret-never-used-32-characters", AUTH_MULTI_USER_ENABLED: "false", AUTH_RBAC_ENABLED: "false", AUTH_WORKSPACES_ENABLED: "false" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  for (const [category, label] of Object.entries({ TEXTBOOK: "教材/讲义", COURSE: "课程资料", EXERCISE: "习题/题集", PAST_PAPER: "真题/模拟", SOLUTION: "题解/解析", SUMMARY: "总结/速查", IMAGE: "截图/图片", OTHER: "其他", LEGACY: "LEGACY" })) {
    const client = {
      examWorkspace: { findFirst: async () => ({ id: "w" }) },
      reviewSchedule: { findFirst: async () => ({ targetType: "STUDY_RESOURCE", studyResourceId: "r" }) },
      studyResource: { findFirst: async () => ({ id: "r", subjectId: "s", subject: { name: "自定义科目" }, category, title: "资料", sourceType: "LINK", displayHost: "example.test", tags: [] }) },
    } as unknown as NonNullable<Parameters<typeof getReviewTarget>[2]>;
    const result = await getReviewTarget("actor", "schedule", client);
    assert.equal(result.subtitle, `自定义科目 · ${label}`);
    assert.equal(result.id, "r");
  }
});
