# Status

## ARCHIVE CANDIDATE / NOT YET ARCHIVED

此仓库是 We Remember 的旧原型保留库，目前只是归档候选，GitHub 仓库尚未在本次整理中执行 Archive。

当前产品主线与规范后续地址是 `https://github.com/songconmaisaix31-design/we-remember`；原 `New-gethe-point` 地址解析到同一 GitHub 仓库。

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

1. 本次链接更新提交通过独立 QA，覆盖内容、相对链接和静态原型；
2. 该提交合并到默认分支；
3. 由有权限的维护者在合并后执行 GitHub Archive。

本分支不执行归档、改名、合并、Release 或后续仓库修改。
