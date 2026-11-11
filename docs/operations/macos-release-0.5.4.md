# PiBrowse 0.5.4 macOS 发布

- 基于已合并的客户端优化与推广目录，发布Apple Silicon / arm64版。
- Cargo、npm及锁文件和生成的deploy/workspace.toml均为0.5.4。
- PiBrowse.app使用dev.pibrowse.desktop标识及项目已有图标，设置目录与旧Fury客户端不同；Agent数据目录保留兼容，不迁移或删除环境数据。
- 客户端更新检查只使用aronhy/pibrowse；未配置自有updater公钥时在访问Agent前进入手动下载回退。不生成、不发布上游签名feed；Chromium内核下载保持原有来源。
- 现有Mac无有效Developer ID签名身份，因此本版为ad-hoc签名、未公证预览版。

构建：

```sh
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
npm --prefix desktop ci
npm --prefix desktop test
npm --prefix desktop run tauri -- build --bundles app
cargo test --locked --release -p fury-desktop update::tests
```

在临时目录复制PiBrowse.app和Applications链接，先对内置fury-agent及外层App分别作ad-hoc签名，再使用hdiutil create生成UDZO格式的pibrowse-0.5.4-macos-arm64.dmg。旧package.sh及sign-shell.sh仍硬编码Fury.app，本轮不用于制作新包。

验收最终DMG：只读挂载后检查Info.plist版本/标识、arm64桌面程序和Agent、codesign --verify --deep --strict；检查桌面程序内嵌的服务端安装资料也为0.5.4；生成SHA256SUMS.txt。上传GitHub Releases后重新下载并比较SHA-256。不能把ad-hoc签名有效表述为已通过Apple公证或Gatekeeper。

## 本轮验收结果

- 28项前端测试、TypeScript/Vite构建通过。
- 完整release模式下7项Rust更新测试通过，包含未配置公钥的手动下载回退。
- 最终DMG已只读挂载验收；应用/Agent均为arm64、版本0.5.4，App深度签名校验有效；内嵌服务端安装资料版本也为0.5.4。
- 最终App的隔离测试副本通过FURY_HOME/FURY_SOCKET独立运行，原生窗口正常启动；快速创建入口、四家服务商及修订后的底部文案均已观察确认，没有创建真实环境或启动浏览器内核。
- 该验证不等于在其他Mac上通过Gatekeeper、真实代理网络或完整团队使用验收。
