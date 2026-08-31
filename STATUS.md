# Status

## ARCHIVE CANDIDATE / NOT YET ARCHIVED

此仓库是 We Remember 的旧原型保留库，目前只是归档候选，GitHub 仓库尚未在本次整理中执行 Archive。

### 范围边界

- 只保留早期静态原型、初期 PRD、视觉素材和简洁比赛历史。
- 不再开发新功能，不引入框架、依赖或新版应用代码。
- 不从本地功能工作树、未提交文件或 Agent 证据中复制内容。
- 当前实现证据仅限可直接打开的静态 HTML/SVG；不代表生产部署或真实第三方接入。

### 启动

```bash
python -m http.server 8765
```

打开 `http://127.0.0.1:8765/prototypes/prototype.html`。也可直接用浏览器打开该 HTML 文件；联网字体不是核心功能依赖。

### 归档门槛

在 GitHub Archive 之前必须同时满足：

1. 独立 QA 验证本整理分支的内容、链接和静态原型；
2. 再次确认当前后续仓库链接 `https://github.com/songconmaisaix31-design/New-gethe-point` 可访问；
3. 若后续仓库已完成独立 QA 并实际改名，再把链接更新为真实存在的 `/we-remember` 地址；
4. 由有权限的维护者在整理合并后执行 GitHub Archive。

本分支不执行归档、改名、合并、Release 或后续仓库修改。
