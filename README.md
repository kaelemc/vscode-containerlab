# vscode-containerlab

A Visual Studio Code extension that integrates [containerlab](https://containerlab.dev/) directly into your editor, providing a convenient tree view for managing labs and their containers.

> [!TIP]  
> The **vscode-containerlab** extension auto-refreshes every few seconds, so your container statuses (running, exited, etc.) stay up-to-date in the tree!

---

## Features

- **Auto-discovery** of local `*.clab.yml` or `*.clab.yaml` files in your workspace.
- **Tree view** showing labs (green/red/grey icons) based on container states.
- **Right-click context menus** on labs to deploy, destroy, redeploy, or open lab files.
- **Right-click context menus** on containers to start/stop, attach a shell, SSH, or view logs.
- **Color-coded statuses**:
  - **Green**: all containers in the lab are running.
  - **Grey**: undeployed (no containers found).
  - **Yellow**: partial states (some running, some stopped).


---

## Requirements

- **containerlab** must be installed and accessible via `sudo containerlab` in your system `PATH`.
- **Docker** (or another container runtime) must be set up and running if your labs rely on container-based nodes.
- (Optional) A local folder with `*.clab.yml` or `*.clab.yaml` topologies, opened in VS Code.

---

## Getting Started

1. **Install** the extension.
2. **Open** a folder or workspace in VS Code containing `.clab.yml` files.
3. **Click** on the _Containerlab_ icon in the Activity Bar to view your labs.
4. **Right-click** on a lab or container to see context menu commands (Deploy Lab, Stop Node, etc.).



## Extension Settings

Currently, there are no user-facing settings. Future updates may add preferences (e.g. refresh interval, custom commands, etc.).


## Known Issues

- None reported. If you spot any bug or feature request, please open an issue on our repository.



## Release Notes

### 0.0.1

- Initial release of **vscode-containerlab**.  
- Basic lab discovery, container auto-refresh, and right-click commands.

---

## Feedback and Contributions

If you’d like to request features or report issues:
- Open an issue on our GitHub repository.
- PRs are welcome! Let us know how we can improve the extension.

- **GitHub Issues:** [Create an issue](https://github.com/srl-labs/vscode-containerlab/issues) on GitHub.
- **Discord:** Join our [Discord community](https://discord.gg/vAyddtaEV9)

**Enjoy managing your containerlab topologies directly from VS Code!**
