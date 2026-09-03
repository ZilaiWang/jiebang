# 评测体系 v2

## 数据与入口

`src/evaluation/v2/competition-cases.v2.ts` 是 60 例的唯一可执行目录；画像位于同目录 `competition-profiles.v2.ts`。JSON/CSV 是供审阅的导出视图。历史 Week3 与 v1 命令保持独立。

| 维度 | 数量 |
| --- | ---: |
| 首轮案例 / 资源 | 60 / 180 |
| 画像 | 6 类，各 10 例 |
| 单目标 / 多目标 | 40 / 20 |
| explain / apply / trace / debug / create | 12 / 22 / 10 / 8 / 8 |
| beginner / basic / intermediate / integrated 资源 | 36 / 76 / 52 / 16 |
| 查询风格 | 6 类，各 10 例 |
| 动态轨迹 | 12：补救 3、巩固 3、进阶 4、画像更新 2 |

运行前先执行不调用模型的检查：

```sh
bun run typecheck:evaluation
bun run eval:v2:preflight
bun run eval:v2 candidate
bun run docker:role-c:doctor
bun run test:role-c:docker
```

preflight 对全部 60 例运行真实证据适配、GenerationSpec Schema、三资源规划及讲义分段规划。它验证输入可构造，不代表模型已生成成功。

## 生产合同

`GenerationSpec.artifact_tasks` 同时冻结讲义、实验、测评的独立具体任务。生产类型位于 `role-c-content/contracts/artifact-task.ts`，评测依赖生产类型，生产代码不依赖评测目录。

- 讲义：示例数、首次术语解释、状态追踪、排错与设计取舍；分段计划负责具体槽位。
- 实验：学习者需要完成的依赖步骤、starter 完成比例上限、公开/隐藏测试数、边界分区、故障程序和开放验收要求。
- 测评：分阶题数、题型、独立代码题与边界/反例题；边界事实绑定至指定题目，按题调用只携带单题合同。
- 三个作者及候选审查各自消费本资源合同。可数结构沿用现有校验器；教学依赖步骤、术语理解及核心代码完成比例由候选语义审查观察实际内容，不能用代码行数冒充教学难度。
- 讲义即时检查保留模型生成的应用与推理任务，不自动替换成事实识别题。跨资源教学功能按归属检查：独立实操由实验承载，迁移测量由测评承载。
- 讲义段落可通过后台 `used_fact_ids` 显式声明改写、步骤和代码使用的本目标事实。物化器绑定引用并拒绝目标外 ID，最终语义审核继续检查内容是否真正受支持；该字段兼容旧作者载荷，不进入公开讲义 Schema。
- 新作者载荷逐段必填 `used_fact_ids`；历史物化载荷仍可读取。误区槽位优先绑定知识库误区的完整纠错事实，并区分错误认识与诊断线索，不再固定绑定首条主题事实。
- Python 示例不经过普通文案清理，保留嵌套缩进和字符串原值。显式实验合同保留每个目标的冻结事实；整题排错与扩展同时绑定配套目标证据。
- 应用型即时检查及三级提示保留规划得到的完整事实闭包，不在下游截断。段落以计划事实与作者声明的本目标支持事实共同形成引用范围，语义审核检查实际推导。
- 作者、候选审查和外部事实审核共享情境边界：虚构记录、题设对象与普通背景不作为现实行业事实；API、运行行为、异常和技术能力仍须引用支持。
- 需要多组输入的实验在规划时采用可传参接口；非目标函数外壳由 starter 提供。函数接口不预设返回字典，具体返回类型随公开题面冻结。
- 全局 `difficulty` 保留为兼容摘要；存在独立任务时，各资源使用自身向量。补救/巩固保留事实、目标和任务身份，调整支持程度；新路径重新规划任务。
- 独立难度评审不读取目标向量、画像及期望标签，只读取最终公开资源。

## 冻结与复核

赛题要求见 XH-202630 原文第 4、5、8 页：多 Agent 协同、三种资源、动态反馈、完整测试及三项指标。双人复核、跨模型评审、60×2 均是项目评测协议的选择，并非赛题指定的方法。

复核支持双人和用户授权的单 AI 复核。单 AI 模式的每行填写 `review_mode: "single_agent"`、`review_status: "accepted" | "changes_requested"`、`reviewer_1`、`reviewer_1_decision`、`rationale`，省略第二人和裁决字段；审批同时填写 `review_mode: "single_agent"` 及 `authorization`。复核人如实标为 AI。任一 `changes_requested` 项需要处理后再审批；复核只确定输入标准，不代表实际输出已经通过。

`candidate` 生成 `evaluation/v2/manifest.candidate.json` 和 180 行 `review-template.json`。每行含候选哈希、案例、资源类型、期望及依据。选择双人模式时填写两名复核人及分歧裁决；选择单 AI 模式时采用上文的明确授权与单人字段。复核结果与候选期望不符时，修订案例并重新出候选，不能在冻结时暗改标签。

`review-context.json` 配套保存六组画像、完整案例目录和知识库事实正文。复核时对照此文件与候选内的三个资源任务，不能仅根据期望标签填写判断。

同目录 `legacy-core-fact-drift.json` 对比旧 60 例事实 ID 集合。当前基线有 57 例变化，案例—事实单元从 216 变为 285；v1 未保存事实正文哈希，不能据此声称历史正文未变。新 60 例另有自己的冻结分母。

将完成的行保存为 `reviews.json`。审批文件 `approval.json` 格式：

```json
{
  "version": "manifest-approval.v2",
  "candidate_hash": "候选 semantic_contract_hash",
  "review_hash": "contentHash(完整 reviews 数组)",
  "approved_at": "ISO 时间",
  "approved_by": "审批人"
}
```

```sh
bun run eval:v2 freeze --reviews=evaluation/v2/reviews.json --approval=evaluation/v2/approval.json
```

冻结文件 `evaluation/v2/frozen.json` 使用独占写入，禁止覆盖。事实正文、核心事实集、前置关系、示例、画像、查询、任务、难度或动态定义变更会使哈希校验失败。正式运行还要求 Git 工作区干净；运行目录保存协议、manifest 快照和源码哈希。

协议同时记录 Git commit、生成/评审配置、提示词版本、依赖与容器源码哈希及实际 Docker 镜像 digest。镜像或协议变化后不能混入原实验的断点续跑。

`required_fact_ids` 的评测分母固定为候选中的核心事实。生产生成可以附加支持动作所需的过程、边界等事实；不会删除冻结核心事实，也不会扩大指标分母以外的事实贡献。

## 模型配置与运行

生成使用现有 `.env.role-c.local`。评测可叠加忽略提交的 `.env.evaluation-v2.local` 或 `--env-file=绝对或相对路径`。独立评审字段：

```text
COMPETITION_JUDGE_ENDPOINT=评审模型兼容接口
COMPETITION_JUDGE_MODEL_ID=不同于生成模型的模型名称
COMPETITION_JUDGE_API_KEY=评审密钥
COMPETITION_JUDGE_THINKING=disabled
```

```sh
# 开发：6 类画像各 2 例，一轮；可以先用 --case-id 指定少量代表例
bun run eval:v2:dev --limit=12 --output-dir=.tmp/v2-dev
# 同模型评审需显式选择；开发和全量均可使用
bun run eval:v2:dev --self-audit --limit=12 --output-dir=.tmp/v2-dev-reviewed
# 全量：60 例，可使用授权单 AI 复核冻结；默认重复两次，可显式只跑一次
bun run eval:v2:final --self-audit --repeats=1 --output-dir=.tmp/v2-final-glm
# 跨模型稳定性实验：配置独立评审模型，60×2
bun run eval:v2:final --output-dir=.tmp/v2-final
# 相同协议断点续跑；失败结果也保留，不能只覆盖失败项
bun run eval:v2:final --output-dir=.tmp/v2-final --resume
```

开发默认不额外调用评审模型，以节省费用。未审核指标保留未完成状态。样例串行执行，样例内部使用生产并行策略；生成候选数、修订预算沿用生产配置。输出目录不能复用为新实验；变更代码、配置或模型后应创建新目录。

`--self-audit` 明确使用生成模型进行分开的盲评调用，不需要另一厂商或另一 API Key。协议中的 `judge_mode` 如实区分 `same_model_separate_calls`、`cross_model`、`not_configured`。同模型结果属于同模型自动评测，不能称作跨模型独立验证；跨模型也不自动保证正确。全量运行仍要求输入标准已批准、60 例齐全和源码可追溯，失败与漏审始终保留。

## 文件读写任务

代码实验与代码测评在 Docker 内使用真实 Python 文件 I/O。每个测试使用单独子进程和临时目录，允许 `open/read/write/with`，不访问宿主路径、绝对路径、子目录、文件描述符或网络。每文件上限 1 MiB，最多打开 32 个不同文件；容器继续限制内存、CPU、输出与临时磁盘总量。

需要初始文件时，function 调用采用 `{"args":["data.txt"],"kwargs":{},"files":{"data.txt":"初始文本"}}`。`files` 是测试前准备的 UTF-8 文本，不传给学习者函数；最多 16 个文件、共 64 KiB。公开样例、私有测试与自定义调试共用该结构。stdin/stdout 合同保持原始字符串输入，程序根据输入创建文件，不能假定存在外部文件。文件句柄、内容与模块状态不在不同用例间复用。

文件学习目标必须通过实际文件操作实现，不用字符串处理替代。临时目录、夹具与配额属于运行环境约定，题面需说明；知识事实和解题依据仍来自证据包。

实验发布前，参考解还会实际执行全部公开样例，覆盖任务卡中的额外样例。缺少初始文件时，仅向作者提供公开题面、参数和失败类型，补齐已承诺的文件夹具，再执行验证；不提供隐藏输入或答案。已有参数、文件内容及预期行为保持不变。答案清理保留函数声明等执行接口，填空模板也单独检查入口一致性。

编程作者 Schema 随冻结题型投影：填空必须生成模板，完整代码题不生成填空模板。作答动作说明由协议确定，具体题目仍由模型生成。实操指南允许学习者定义骨架中尚不存在的局部变量；只有明确声称某变量已在给定骨架中、实际却不存在时，才判为字段不一致。扩展变量与主任务变量分开检查。

正式放量前先检查关键回归案例发布、180 资源合同及 Docker 链路。60 例按固定顺序运行，前一批完成后观察共性失败，继续运行时不重复已经保存的案例；开发报告不能作为正式成绩。

## 报告

- `latest.json/md`：每次重复独立统计三项指标与完整率。
- `runs/repeat-N/案例.json`：状态、公开资源、事实证据、逐声明审查、资源难度判断、错误与耗时。
- `stability.json`：全部选中案例的状态序列、状态一致率和连续发布率；未运行不算稳定成功。
- `difficulty-confusion.json`：三资源分别记录期望—观测矩阵，未审资源单列。
- `manual-audit-template.json`：固定每画像前两例、三类资源，共 36 份/重复，供 20% 人工抽查；选择不依赖运行结果。
- `model-usage.json`：生成及生产内部审查的阶段调用数、token 和排队/调用耗时；不含额外独立评审费用。金额需要结合实际平台计费。
- `counterfactuals.json`：18 组跨画像资源对照。若行为或难度也不同，明确记为课程任务比较，不能把所有变化归因于学科。
- `private-runtime/**/docker-executions.jsonl`：实际代码、测试与执行结果，用于后台追查验证失败；属于私有判题材料，不用于前端或公开报告。

独立评审读取完整公开题面、填空模板、分层提示和实操指南；不读取测评的 Tier/难度标签、分值、目标向量或隐藏答案。事实审核同时覆盖新版实验字段。

逐声明拆分保留原段落与字段职责。排错指南的错误现象、原因、修复步骤作为同组上下文提供，避免把待修复症状当成正确程序的行为；公开样例同时提供公开输入。上下文只能帮助解释范围与产物自描述，不能代替专业事实证据。修改评审版本后，定点复核独立保存，不覆盖旧批次指标。

blocked、failed、not_run 保留在案例/资源完整率及覆盖分母中。无声明审核时幻觉率为 null；未完成难度评审不会产生“100%”。Docker 成功取已发布实验的可信执行记录，不从 ready 状态推断。

服务熔断、认证失败或余额不足时批次停止，剩余记录为 not_run；服务恢复后使用相同协议续跑。长时间本机评测应保持接电、开盖，系统睡眠会消耗绝对截止时间并中断网络请求。

## 独立辅助实验

```sh
# 原始 Query → A 检索 → B 选路 → 按路径取证；12 条、6 风格
bun run eval:v2 robustness --output-dir=.tmp/v2-query
# 现有 12 条异常、证据与工程恢复回归
bun run eval:competition:robustness
# 使用真实第一轮私有持久化记录，提交合成答卷并继续下一轮
bun run eval:v2 dynamic --main-run-dir=.tmp/v2-final --output-dir=.tmp/v2-dynamic
# 固定同一课程，只替换学科背景；每次明确选一组，执行两条真实生成链
bun run eval:v2 counterfactual --group-id=CF-K002 --output-dir=.tmp/v2-controlled-k002
```

动态答卷只在私有评测进程中读取 secure artifact，真实调用正式提交、最弱目标动作策略、B 路径/画像更新、A 刷新与 C 下一轮生成。报告不写入参考代码、隐藏用例或答卷文本。轨迹缺失、动作不符、发布失败均保留；后续资源不计入主集三项指标。

补救答卷聚焦一个薄弱目标，其他目标保持稳定；巩固按实际分值选择答卷，同时检查最弱目标区间。P05-05 用于连续已掌握目标表现冲突，P05-09 用于新目标补救，避免把本应更新画像的行为误标为补救。动态定义从主目录派生，动作准确率和下一轮发布率的分母固定为 12。

受控对比固定诊断能力、目标、偏好、事实与任务；两边的自由背景摘要都使用同一中性描述，只替换结构化学科。事实/任务不变量按哈希核验。表达是否可感知由人工抽查，不能用 artifact ID 不同或随机文本差异代替。

原始 Query 辅助报告分别记录 A 召回、B 路径、先修覆盖、取证缺口和缺目标时的澄清结果。它不包括浏览器交互或模型生成，不能替代用户端完整体验验收。隐私关闭、无命中、工程异常另见项目对应回归测试。

## 新增知识事实来源

K003 的数字转换边界、K004 的字符串输入与相加、K007 的 range 结束边界、K009 的索引边界，依据 Python 官方说明补充，用于支持真实诊断任务：

- [内置函数](https://docs.python.org/3/library/functions.html)
- [内置类型](https://docs.python.org/3/library/stdtypes.html)

这些事实参与知识库内容哈希，变更后需要重新生成候选并复核。
