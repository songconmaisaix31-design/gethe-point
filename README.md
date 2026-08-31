# 都记得（旧原型）

这是 **We Remember 的早期前身仓库**，保留「都记得」在黑客松阶段的静态交互原型、初期产品需求文档和视觉素材，用于追溯最初的产品探索。它不是当前产品主线，也不接受新功能开发。

当前产品主线与规范后续地址是 [we-remember](https://github.com/songconmaisaix31-design/we-remember)。原 `New-gethe-point` 地址会解析到同一 GitHub 仓库。

## 仓库内容

- [交互原型](prototypes/prototype.html)：单文件 HTML/CSS/JavaScript 演示。
- [视觉风格选项](prototypes/style-options.html)：早期静态视觉探索。
- [初期 PRD](docs/history/产品需求文档_都记得_PRD.md)：早期产品范围与决策记录，不代表当前实现状态。
- [屋檐图形素材](dujide-logo-roof-ink.svg)。
- [本地开发历史分类](docs/history/local-development-history.md)：只记录公开安全的审计结论，没有复制后续实现或未提交文件。

## 本地查看

仓库没有依赖或构建步骤。可直接打开 `prototypes/prototype.html`，或在仓库根目录启动静态服务器：

```bash
python -m http.server 8765
```

然后访问：

- <http://127.0.0.1:8765/prototypes/prototype.html>
- <http://127.0.0.1:8765/prototypes/style-options.html>

页面从 Google Fonts 加载可选字体；离线时会回退到系统字体，核心静态原型仍可查看。

## 历史与边界

该原型来自 SheNicest 黑客松阶段的早期探索，未获奖。仓库中的页面是静态演示，不应被描述为生产系统、真实消息渠道接入或当前 We Remember 的完整能力。

本仓库处于归档候选状态。只有本次链接更新提交通过独立 QA 并合并到默认分支后，才允许由维护者执行 GitHub Archive；详情见 [STATUS.md](STATUS.md)。

## License

见 [LICENSE](LICENSE)。
