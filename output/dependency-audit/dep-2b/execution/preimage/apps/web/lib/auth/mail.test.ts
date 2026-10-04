import assert from "node:assert/strict";
import test from "node:test";
import nodemailer, { type SendMailOptions } from "nodemailer";
import addressparser from "nodemailer/lib/addressparser";
import MimeNode, { type MimeNodeHeaderValue } from "nodemailer/lib/mime-node";
import { buildAuthMailContent, sendAuthMail, validateAuthActionUrl } from "./mail";

test("auth mail contains only the action link and minimal product copy", () => {
  const token = "synthetic-token-with-at-least-thirty-two-bytes";
  const url = `https://forge.example.test/auth/reset#token=${token}`;
  const content = buildAuthMailContent("PASSWORD_RESET", url);
  assert.match(content.subject, /重置/);
  assert.match(content.text, new RegExp(token));
  assert.match(content.html, new RegExp(token));
  assert.doesNotMatch(content.text, /\?token=/);
  assert.doesNotMatch(content.text, /Workspace 成员|学习正文|附件/);
});

test("auth action links keep tokens in the fragment and reject query credentials", () => {
  const appUrl = "https://forge.example.test";
  const token = "synthetic-token-with-at-least-thirty-two-bytes";
  const fragmentUrl = `${appUrl}/reset-password#token=${token}`;

  assert.equal(validateAuthActionUrl(fragmentUrl, appUrl), fragmentUrl);
  assert.throws(
    () => validateAuthActionUrl(`${appUrl}/reset-password?token=${token}`, appUrl),
    /configured AreaForge origin/,
  );
  assert.throws(
    () => validateAuthActionUrl(`https://attacker.example/reset-password#token=${token}`, appUrl),
    /configured AreaForge origin/,
  );
});

test("认证邮件三种用途通过 JSON transport 保留正文和收发信封", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const actionUrl = "https://forge.example.test/reset-password#token=synthetic-token-with-at-least-thirty-two-bytes";
  for (const purpose of ["INVITATION", "EMAIL_VERIFICATION", "PASSWORD_RESET"] as const) {
    const content = buildAuthMailContent(purpose, actionUrl);
    const result = await transport.sendMail({
      from: "AreaForge <no-reply@example.test>",
      to: "学习者 <student+tag@example.test>",
      ...content,
    });
    assert.deepEqual(result.envelope, { from: "no-reply@example.test", to: ["student+tag@example.test"] });
    assert.ok(typeof result.message === "string");
    const message = JSON.parse(result.message);
    assert.equal(message.subject, content.subject);
    assert.equal(message.text, content.text);
    assert.equal(message.html, content.html);
    assert.match(message.html, /#token=synthetic-token/);
  }
});

test("带引号地址后的注释及尾随域名不能改变 envelope 收件人", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  for (const [input, expected] of [
    ["Learner <student@example.test>", "student@example.test"],
    ['"user"@example.test(x)evil.test', "user@example.test"],
    ['"a"@b.test(c)d.test(e)f.test', "a@b.test"],
  ]) {
    assert.deepEqual(addressparser(input).map((entry) => entry.address), [expected]);
    const result = await transport.sendMail({ from: "no-reply@example.test", to: input, text: "合成邮件" });
    assert.deepEqual(result.envelope.to, [expected]);
  }
});

test("深层及自引用结构化地址在构造信封时终止且不丢失收件人", () => {
  let nested: MimeNodeHeaderValue = { name: "学习者", address: "student@example.test" };
  for (let depth = 0; depth < 12000; depth += 1) nested = [nested];
  const cyclic: MimeNodeHeaderValue[] = [nested];
  cyclic.push(cyclic);
  const message = new MimeNode();
  message.setHeader("To", cyclic);
  assert.deepEqual(message.getEnvelope().to, ["student@example.test"]);
});

test("地址解析的长自由文本与连续注释边界保持有限输出", () => {
  for (const input of ["[x]".repeat(4000), `${"[x]".repeat(4000)}@`, `a${"@b(c)".repeat(4000)}`]) {
    const result = addressparser(input);
    assert.ok(result.length <= 1);
    assert.ok(result.every((entry) => (entry.address?.length ?? 0) <= input.length));
  }
});

test("sendAuthMail 规范化地址并透传进程内 transport 成功和失败", async (t) => {
  const previous = { ...process.env };
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const send = transport.sendMail.bind(transport);
  const deliveries: string[] = [];
  t.mock.method(nodemailer, "createTransport", () => transport);
  t.mock.method(transport, "sendMail", async (input: SendMailOptions) => {
    const result = await send(input);
    assert.ok(typeof result.message === "string");
    deliveries.push(JSON.stringify({ envelope: result.envelope, message: JSON.parse(result.message) }));
    return result;
  });
  try {
    Object.assign(process.env, {
      APP_ENV: "test", APP_URL: "https://forge.example.test",
      DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/unused",
      AUTH_SESSION_SECRET: "synthetic-mail-test-secret-at-least-thirty-two-bytes",
      SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "",
    });
    const input = { to: "  STUDENT@EXAMPLE.TEST  ", purpose: "PASSWORD_RESET" as const,
      actionUrl: "https://forge.example.test/reset-password#token=synthetic-token-with-at-least-thirty-two-bytes" };
    assert.ok((await sendAuthMail(input)).messageId);
    const delivery = JSON.parse(deliveries[0]);
    assert.deepEqual(delivery.envelope, { from: "no-reply@localhost", to: ["student@example.test"] });
    assert.equal(delivery.message.text, buildAuthMailContent(input.purpose, input.actionUrl).text);
    t.mock.method(transport, "sendMail", async () => { throw new Error("SYNTHETIC_MAIL_FAILURE"); });
    await assert.rejects(sendAuthMail(input), /SYNTHETIC_MAIL_FAILURE/);
    assert.equal(deliveries.length, 1);
  } finally {
    process.env = previous;
  }
});
