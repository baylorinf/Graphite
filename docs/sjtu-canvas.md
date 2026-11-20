# 交大 Canvas

从 Graphite 新标签页打开「交大 Canvas」，点击「使用 jAccount 登录」。在学校页面完成登录后，Graphite 会关闭登录窗口并在后台读取本人在 Canvas 中可以打开的课程页面。第一次读取可能需要几分钟。应用打开期间约每 15 分钟更新一次，也可点「同步」。普通网页登录无需向学校申请 Graphite 开发者密钥。

- 打开课程可查看作业、课件、课程单元、公告、测验、讨论和页面。学校开放日历订阅时，Graphite 会从日历页面使用其提供的私人订阅链接。也可手动将「日历 → 日历订阅」的链接添加到工作台。时间按本机时区显示，全天事件保留原日期。
- 在工作台点击「一键拉取所有课程资料」，将可访问的课件、作业说明及其附件保存到笔记库的 `Canvas/` 目录。重复拉取会识别相同内容，保留本地编辑。各门课也可以单独下载文件。学校窗口中手动下载的常见学习文件进入 `Canvas/Downloads/`。
- 打开一门课，选择「课程大纲与要求」阅读校方发布的说明。在「作业」中可查看每份作业的要求、截止时间和附件。老师在外部教学工具发布的材料可从对应的课程页面打开。
- 在一份允许文件上传的作业上，从笔记库勾选一个或多个文件，也可从电脑添加文件。核对课程、作业和文件后确认，Graphite 使用当前登录会话完成支持的学校提交表单，并显示可核实的回执。外部工具、需要额外声明或无法识别的页面提供学校作业入口。提交结果不明确时，先查看校方记录再决定是否重交。
- 「断开」清除此库在本机保存的账户、日历订阅、课程缓存和隔离的学校浏览会话。此前下载的课程文件继续保存在笔记库。学校密码只在学校登录页输入。

## 可选的官方 API 接入

有 Canvas Developer Key 的机构可启用应用授权。这个入口支持结构化课程同步、在 Graphite 内提交文本、网址和附件，以及显示校方返回的提交时间与次数。登录和首次写入分别使用只读与提交权限；实际作业提交前显示预览供学生确认。第三方教学工具的作业仍在学校原站完成。

维护者在受管设备的运行环境提供 `GRAPHITE_CANVAS_CLIENT_ID` 与 `GRAPHITE_CANVAS_CLIENT_SECRET`。机构需按 Canvas 原生应用授权配置 `urn:ietf:wg:oauth:2.0:oob`，启用 `canvas-api.js` 的 `SCOPES` 和需要提交时 `canvas-submission.js` 的 `WRITE_SCOPES`。分发给学生的安装包不含机构密钥。开放发布若需启用统一 API 授权，应由机构的受管服务持有密钥。Windows 桌面使用系统加密存储保存连接与课程快照，按笔记库隔离。浏览器开发预览支持学校原站入口和当前服务进程内的日历订阅。

[交大 Canvas](https://oc.sjtu.edu.cn/) · [学校使用手册](https://v.sjtu.edu.cn/guide/file/canvas%40sjtu_quickstart.pdf) · [Canvas 授权接口](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth) · [Canvas 作业提交接口](https://developerdocs.instructure.com/services/canvas/resources/submissions)
