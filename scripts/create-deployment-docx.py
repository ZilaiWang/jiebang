from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import html

outputs = [
    Path("C:/Users/25964/Desktop/KnowBalance部署说明_精简版.docx"),
    Path("C:/Users/25964/Desktop/KnowBalance_Deployment_Guide_Short.docx"),
]
NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

def esc(s):
    return html.escape(str(s), quote=False)

def run(text, bold=False, color="111827", size=21, font="Microsoft YaHei"):
    props = [
        f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="Microsoft YaHei"/>',
        f'<w:sz w:val="{size}"/>',
        f'<w:color w:val="{color}"/>',
    ]
    if bold:
        props.append("<w:b/>")
    return f'<w:r><w:rPr>{"".join(props)}</w:rPr><w:t xml:space="preserve">{esc(text)}</w:t></w:r>'

def paragraph(text="", kind="normal"):
    if kind == "title":
        props = '<w:jc w:val="center"/><w:spacing w:after="130"/>'
        content = run(text, True, "312E81", 34)
    elif kind == "subtitle":
        props = '<w:jc w:val="center"/><w:spacing w:after="160"/>'
        content = run(text, False, "6B7280", 19)
    elif kind == "h1":
        props = '<w:spacing w:before="130" w:after="65"/><w:keepNext/>'
        content = run(text, True, "7C3AED", 26)
    elif kind == "h2":
        props = '<w:spacing w:before="80" w:after="40"/><w:keepNext/>'
        content = run(text, True, "4F46E5", 22)
    elif kind == "note":
        props = '<w:ind w:left="220"/><w:shd w:fill="EEF2FF"/><w:spacing w:before="35" w:after="55"/>'
        content = run(text, False, "374151", 20)
    elif kind == "warning":
        props = '<w:ind w:left="220"/><w:shd w:fill="FFF7ED"/><w:spacing w:before="35" w:after="55"/>'
        content = run(text, True, "9A3412", 20)
    elif kind == "code":
        props = '<w:ind w:left="280"/><w:shd w:fill="F3F4F6"/><w:spacing w:before="20" w:after="45"/>'
        content = run(text, False, "111827", 18, "Consolas")
    else:
        props = '<w:spacing w:after="35"/>'
        content = run(text)
    return f'<w:p><w:pPr>{props}</w:pPr>{content}</w:p>'

def cell(text, width, header=False, fill=None, align="left"):
    shade = fill or ("1F3A5F" if header else "FFFFFF")
    color = "FFFFFF" if header else "111827"
    para = (
        f'<w:p><w:pPr><w:jc w:val="{align}"/><w:spacing w:before="15" w:after="15"/></w:pPr>'
        f'{run(text, header, color, 18)}</w:p>'
    )
    return (
        f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>'
        f'<w:shd w:val="clear" w:fill="{shade}"/>'
        '<w:tcMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>'
        '<w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar>'
        f'</w:tcPr>{para}</w:tc>'
    )

def table(headers, rows, widths):
    borders = (
        '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:left w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:right w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="E2E8F0"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="E2E8F0"/></w:tblBorders>'
    )
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    rows_xml = ["<w:tr>" + "".join(cell(h, w, True, align="center") for h, w in zip(headers, widths)) + "</w:tr>"]
    for index, row in enumerate(rows):
        fill = "F8FAFC" if index % 2 else "FFFFFF"
        rows_xml.append("<w:tr>" + "".join(cell(value, width, fill=fill) for value, width in zip(row, widths)) + "</w:tr>")
    return (
        '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
        f'{borders}</w:tblPr><w:tblGrid>{grid}</w:tblGrid>{"".join(rows_xml)}</w:tbl>'
    )

def spacer():
    return '<w:p><w:pPr><w:spacing w:after="30"/></w:pPr></w:p>'

parts = [
    paragraph("KnowBalance 网页部署说明", "title"),
    paragraph("队友部署与启动操作手册（Windows）", "subtitle"),
    paragraph("一、快速启动", "h1"),
    table(["步骤", "操作", "完成标准"], [
        ["1", "安装 Bun", "运行 bun --version 能看到版本号"],
        ["2", "安装并打开 Docker Desktop", "运行 docker info 能输出 Docker 信息"],
        ["3", "把项目解压到 D:\\KnowBalance", "根目录能看到 package.json 和 启动KnowBalance.bat"],
        ["4", "双击 启动KnowBalance.bat", "脚本提示前端和主 Agent 已启动"],
        ["5", "打开 http://127.0.0.1:4175/", "能看到 KnowBalance 首页"],
        ["6", "点击首页右上角“API设置”", "填写接口地址、模型 ID、自己的 API Key"],
        ["7", "保存并启用", "右上角显示模型名；Docker 状态显示已就绪"],
    ], [800, 4100, 4100]),
    spacer(),
    paragraph("二、需要提前准备", "h1"),
    table(["项目", "地址或命令", "说明"], [
        ["Bun", "https://bun.sh/", "负责安装依赖和启动前后端"],
        ["Docker Desktop", "https://www.docker.com/products/docker-desktop/", "负责运行 C 代码题安全沙箱；安装后必须打开"],
        ["模型 API Key", "使用自己的 Key", "不要使用或转发队友的 Key"],
    ], [1800, 3800, 3400]),
    paragraph("推荐项目路径", "h2"),
    paragraph("D:\\KnowBalance", "code"),
    paragraph("不要直接在压缩包、微信临时目录或 OneDrive 同步目录中运行。", "note"),
    paragraph("三、首页 API 设置", "h1"),
    table(["输入项", "DeepSeek 示例", "填写要求"], [
        ["兼容接口地址", "https://api.deepseek.com/chat/completions", "必须是 OpenAI-compatible 的 chat/completions 地址"],
        ["模型 ID", "deepseek-chat", "必须与接口支持的模型名称一致"],
        ["API Key", "填写自己的 Key", "保存后不会通过配置查询接口返回前端"],
    ], [2200, 3900, 2900]),
    paragraph("保存后检查", "h2"),
    paragraph("http://127.0.0.1:8787/orchestrator/provider-config", "code"),
    paragraph("返回 configured: true，说明 API 配置已保存。"),
    paragraph("四、Docker 检测与配置", "h1"),
    table(["检查方式", "操作", "正常结果"], [
        ["网页检查", "首页右上角 API设置", "弹窗显示 Docker 代码沙箱已就绪"],
        ["一键配置", "Docker 未就绪时点“一键配置 Docker”", "自动检查 Docker 引擎并准备沙箱镜像"],
        ["后端检查", "打开 /orchestrator/docker-setup", "返回 ready: true"],
        ["命令检查", "运行 docker info", "能输出引擎信息"],
    ], [1800, 3800, 3400]),
    paragraph("Docker 检查地址", "h2"),
    paragraph("http://127.0.0.1:8787/orchestrator/docker-setup", "code"),
    paragraph("五、服务状态检查", "h1"),
    table(["检查项", "地址", "正常结果"], [
        ["前端网页", "http://127.0.0.1:4175/", "能打开 KnowBalance 首页"],
        ["主 Agent", "http://127.0.0.1:8787/health", "返回 status: ok"],
        ["API 配置", "http://127.0.0.1:8787/orchestrator/provider-config", "返回 configured: true"],
        ["Docker", "http://127.0.0.1:8787/orchestrator/docker-setup", "返回 ready: true"],
    ], [1800, 4800, 2400]),
    paragraph("六、双击脚本失败时手动启动", "h1"),
    paragraph("终端 1：启动主 Agent", "h2"),
    paragraph("bun --env-file=.env.role-c.local scripts/learning-orchestrator-api.ts --host=127.0.0.1 --port=8787 --data-root=.tmp/integrated-orchestrator", "code"),
    paragraph("终端 2：启动前端", "h2"),
    paragraph("bun run role-d:v2:dev -- --host 127.0.0.1 --port 4175", "code"),
    paragraph("如果第一次运行缺少依赖，先在项目根目录执行 bun install。", "note"),
    paragraph("七、常见问题", "h1"),
    table(["问题", "先检查", "处理方法"], [
        ["网页打不开", "4175 前端是否启动", "重新启动前端；关闭占用 4175 的旧进程"],
        ["主 Agent 请求失败", "8787/health 是否能打开", "重新启动主 Agent；确认运行目录是当前项目"],
        ["API 显示未配置", "provider-config 是否为 configured: true", "重新填写三项并点“保存并启用”"],
        ["Docker 未就绪", "Docker Desktop 是否已打开", "打开 Docker Desktop，再点“一键配置 Docker”"],
        ["code-lab 可信门禁 blocked", "查看主 Agent 终端最后 20 行", "这是 C 内容未通过安全/隐藏测试，不要修改 D 前端或伪造数据"],
    ], [2300, 3000, 3700]),
    paragraph("八、打包给队友前必须删除", "h1"),
    table(["不要发送", "原因"], [
        [".tmp/", "可能包含本地会话、模型配置和 API Key"],
        [".env.role-c.local", "可能包含敏感配置"],
        ["node_modules/", "体积大，队友运行 bun install 即可"],
        ["dist/", "构建产物可在本地重新生成"],
        ["provider-config.json", "可能保存 API Key，禁止随项目分发"],
    ], [3300, 5700]),
    paragraph("重点：每名队友必须在自己的电脑上填写自己的 API Key。", "warning"),
    paragraph("九、最短操作顺序", "h1"),
    table(["顺序", "操作"], [
        ["1", "打开 Docker Desktop"],
        ["2", "双击 启动KnowBalance.bat"],
        ["3", "打开 http://127.0.0.1:4175/"],
        ["4", "进入 API设置，填写接口、模型和自己的 Key"],
        ["5", "确认 API 已配置、Docker 已就绪"],
        ["6", "新建学习计划并开始测试"],
    ], [1200, 7800]),
    paragraph("提示：4175 是网页，8787 是主 Agent。网页打不开先查 4175；请求失败先查 8787/health。", "note"),
]

body = "".join(parts)
document = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{NS}"><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="900" w:bottom="850" w:left="900" w:header="500" w:footer="500"/><w:docGrid w:linePitch="312"/></w:sectPr></w:body></w:document>'''
styles = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{NS}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/></w:rPr></w:style></w:styles>'''
content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'''
rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'''
doc_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'''

for output in outputs:
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("word/_rels/document.xml.rels", doc_rels)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", styles)
    print(output, output.exists(), output.stat().st_size)
