# 角色 A Week 2 验收报告：引用门禁 MVP 与知识溯源

## 1. 角色 A Week 2 目标

角色 A 在 Week 2 的核心任务是把 Week 1 的知识库与 RAG 检索能力升级为“引用门禁 MVP + 知识溯源”。

一句话：C 生成内容以后，A 先用可测试的硬规则检查 `source_id/fact_id` 是否存在于当前 RAG 证据中，并做基础词面支撑检查。当前版本不是完整语义事实审核。

## 2. 已交付内容

| 类型 | 路径 | 说明 |
|---|---|---|
| 事实审核类型 | `src/fact-audit/types.ts` | 定义 `FactAuditInput`、`FactAuditResult`、`pass/revise/reject` |
| 证据索引 | `src/fact-audit/evidence-index.ts` | 把 RAG facts 建成 `source_id:fact_id -> fact` 索引 |
| 审核器 | `src/fact-audit/auditor.ts` | `auditGeneratedContent()` 引用存在性与词面支撑审核入口 |
| Role C 适配器 | `src/fact-audit/adapters/role-c-block-adapter.ts` | 把 C 的 blocks 或 ConceptLesson artifact 转成审核输入 |
| C 接入说明 | `docs/fact_audit_api.md` | 告诉 C 必须输出 `blockId/text/citations` |
| C 输出 Word 说明 | `D:/MR_fan/unveiling_the_list/RoleC输出格式说明_给C同学.docx` | 给 C 同学看的通俗版说明 |
| Week2 Demo | `scripts/week2-role-a-demo.ts` | 展示 pass / revise / reject 三种审核结果 |
| JSON 审核 CLI | `scripts/audit-role-c-json.ts` | 审核 C 发来的 JSON 文件，并对常见格式错误输出稳定错误码 |
| 正例 JSON | `examples/role_c_artifact_example.json` | 合规 C 输出样例，预期 `pass` |
| 负例 JSON | `examples/role_c_artifact_missing_citation.json`、`examples/role_c_artifact_fake_citation.json` | 缺引用与假引用样例，预期 `revise` / `reject` |
| 测试 | `tests/fact-audit.test.ts`、`tests/fact-audit-role-c-adapter.test.ts`、`tests/week2-role-a-assets.test.ts` | 保护审核器、adapter、文档、CLI 和正负例 |

## 3. Role C 必须输出什么

C 的每个知识性内容块必须包含三个字段：

```json
{
  "blockId": "claim-1",
  "text": "for 循环常用于遍历序列中的元素。",
  "citations": [
    { "source_id": "K007", "fact_id": "F001", "relation": "supports" }
  ]
}
```

字段说明：

| 字段 | 含义 | 要求 |
|---|---|---|
| `blockId` | 内容块编号 | 在 C artifact 内唯一 |
| `text` | 生成的知识性内容 | 一句或一小段，不要混太多事实 |
| `citations` | 引用依据 | 必须来自 `rag_result.results[*].facts` |

## 4. 审核状态

| status | 含义 | 后续动作 |
|---|---|---|
| `pass` | 内容有真实 citation，且能被引用事实支撑 | 可交给 D 展示 |
| `revise` | 内容缺少 citation | C 补引用后重新提交 |
| `reject` | 引用不存在、引用错位或出现知识库外内容 | C 重写，或向 A 请求补知识 |

## 5. 当前审核规则

当前版本是“引用存在性 + 当前 RAG fact 校验 + 词面支撑检查”的硬门禁 MVP，规则如下：

1. 每个知识性 block 必须有 citation。
2. citation 必须存在于当前 RAG 结果中。
3. claim 文本必须和引用 fact 有词面支撑。
4. 少量演示级知识库外术语会被驳回；完整外部知识检测仍需后续增强。

## 6. 如何审核 C 发来的 JSON

如果 C 发来一个 JSON 文件，放到：

```text
examples/role_c_artifact_example.json
```

运行：

```bash
npm exec -- bun scripts/audit-role-c-json.ts examples/role_c_artifact_example.json
```

输出会包含：

```text
workflow: Audit_RoleC_JSON_File
ok: true / false
audit.status: pass / revise / reject
audit.checkedClaims[*].verdict
audit.conflicts
```

CLI 对常见输入格式错误会输出稳定 JSON 错误，例如：

```json
{
  "workflow": "Audit_RoleC_JSON_File",
  "ok": false,
  "error": { "code": "MISSING_BLOCKS", "message": "Role C artifact requires a blocks array." }
}
```

## 7. 验证命令

Week 2 A 当前推荐验证命令：

```bash
npm exec -- bun run typecheck
npm exec -- bun test tests/fact-audit.test.ts tests/fact-audit-role-c-adapter.test.ts tests/week2-role-a-assets.test.ts
npm exec -- bun scripts/week2-role-a-demo.ts
npm exec -- bun scripts/audit-role-c-json.ts examples/role_c_artifact_example.json
npm exec -- bun scripts/audit-role-c-json.ts examples/role_c_artifact_missing_citation.json
npm exec -- bun scripts/audit-role-c-json.ts examples/role_c_artifact_fake_citation.json
```

## 8. 和 B/C/D 的关系

| 角色 | 与 A 的关系 |
|---|---|
| B | B 产出画像，A 根据画像检索知识证据 |
| C | C 只能基于 A 的 RAG facts/examples/practiceTasks/quizItems 生成内容，并给每个知识性 block 加 citations |
| D | D 展示内容时可展示 citations、retrieval_trace 和审核状态，让评委看到溯源链路 |

## 9. 当前限制

1. 当前事实审核是硬门禁 MVP，不是 embedding、LLM 或人工级语义事实审核。
2. 词面支撑规则能拦截明显错引用，但对复杂改写、反义表达、多事实混合的判断仍有限。
3. 当前 adapter 优先覆盖 Role C 的 block 契约和 ConceptLessonPayload；后续如果 C 的 code-lab / assessment 输出结构变化，需要补 adapter。
4. 当前 CLI 默认重新执行 `retrieveKnowledge()`，还未支持冻结版 `ragResult` 或 evidence pack 输入；真实联调时需确认 C 生成时和 A 审核时使用同一组证据。
5. 当前不自动请求 A 新增知识；如果 C 需要知识库外内容，先人工提出新增知识点需求。
6. 当前本地目录不是 git repo，PR 前需要迁移到正式 Git 工作树并重新验证。
7. 完整 repo check 曾暴露 C 侧测试失败；A PR 描述中必须区分“Role A 目标测试通过”和“全仓库集成仍需团队处理”。

## 10. Week 2 A 结论

角色 A 的 Week 2 引用门禁 MVP 已经具备：

- C 输出格式约束；
- A 引用存在性与词面支撑审核入口；
- pass / revise / reject 三态；
- JSON 文件审核 CLI；
- Role C adapter；
- 正负例 JSON；
- 测试和 demo 验证。

下一步应等待 C 的真实输出或 GitHub 分支，再做一次 B→A→C→A Audit→D 的完整联调。
