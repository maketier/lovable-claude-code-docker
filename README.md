# Claude Code Docker Image

Docker image for running Claude Code CLI in isolated, secure environments. Designed for Maketier's AI automation workflows.

## 🎯 Purpose

This Docker image provides a secure, network-isolated environment for generating applications using Claude Code. It's specifically designed to run inside Daytona sandboxes for maximum isolation.

## 🏗️ What's Inside

- **Node.js 20**: Runtime environment
- **Claude Code CLI**: Latest version from Anthropic
- **Python 3**: For Python-based generations
- **Build tools**: For compiling native dependencies
- **Git**: For version control operations

## 🚀 Quick Start

### Pull the Image

```bash
docker pull ghcr.io/YOUR_GITHUB_USERNAME/lovable-claude-code-docker:latest
```

### Run a Generation

```bash
docker run -d \
  --network none \
  -e ANTHROPIC_API_KEY="your-api-key-here" \
  -e PROMPT="Create a simple calculator web app" \
  ghcr.io/YOUR_GITHUB_USERNAME/lovable-claude-code-docker:latest
```

### Extract Generated Files

```bash
# Get container ID
CONTAINER_ID=$(docker ps -lq)

# List generated files
docker exec $CONTAINER_ID ls -la /workspace

# Copy files to your machine
docker cp $CONTAINER_ID:/workspace/. ./output/
```

## 🔒 Security Features

- **Network Isolation**: Runs with `--network none` by default
- **No persistent storage**: Files only exist in container
- **Minimal attack surface**: Only essential tools installed
- **Ephemeral containers**: Designed to be destroyed after use

## 📋 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ Yes | Your Anthropic API key |
| `PROMPT` | ✅ Yes | The generation prompt for Claude |
| `OUTPUT_DIR` | ❌ No | Output directory (default: `/workspace`) |

## 🏗️ Building Locally

```bash
# Clone the repository
git clone https://github.com/YOUR_GITHUB_USERNAME/lovable-claude-code-docker.git
cd lovable-claude-code-docker

# Build the image
docker build -t lovable-claude-code:local .

# Test it
docker run -d \
  --network none \
  -e ANTHROPIC_API_KEY="your-key" \
  -e PROMPT="Create a todo list app" \
  lovable-claude-code:local
```

## 🔄 Automatic Builds

This repository uses GitHub Actions to automatically build and push Docker images when:

- Code is pushed to the `main` branch
- A new release is published
- Manually triggered from the Actions tab

Images are published to GitHub Container Registry (ghcr.io).

## 🛠️ Usage in Daytona

This image is designed to run inside Daytona sandboxes for nested isolation:

```typescript
// Inside your Daytona sandbox
await execInSandbox(
  sandbox,
  `docker pull ghcr.io/YOUR_GITHUB_USERNAME/lovable-claude-code-docker:latest`
);

const containerId = await execInSandbox(
  sandbox,
  `docker run -d --network none \
   -e ANTHROPIC_API_KEY=${apiKey} \
   -e PROMPT="${prompt}" \
   ghcr.io/YOUR_GITHUB_USERNAME/lovable-claude-code-docker:latest`
);
```

## 📦 File Structure

```
.
├── Dockerfile              # Docker image definition
├── entrypoint.sh          # Container startup script
├── .github/
│   └── workflows/
│       └── docker-build.yml  # Automated build pipeline
└── README.md              # This file
```

## 🤝 Contributing

This is part of Maketier's internal infrastructure. For issues or improvements, please contact the development team.

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Related Projects

- [Anthropic Claude Code](https://docs.claude.com/docs/claude-code)
- [Daytona](https://www.daytona.io/)
- [Maketier AI Automation](https://maketier.com/)

## 💬 Support

For questions or issues:
- Open an issue in this repository
- Contact: paolo@maketier.com

---

Built with ❤️ by Maketier
