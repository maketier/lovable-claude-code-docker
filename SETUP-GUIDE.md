# Complete GitHub Setup Guide for Docker Image

## 📋 What You Have Now

All the files you need are in this folder:

```
lovable-docker-setup/
├── Dockerfile                      # Docker image definition
├── entrypoint.sh                   # Container startup script
├── .github/workflows/
│   └── docker-build.yml           # Automatic build pipeline
├── .gitignore                      # Files to ignore in Git
├── README.md                       # Documentation
└── test-docker.sh                  # Test script (optional)
```

## 🎯 Step-by-Step Instructions

### Step 1: Create GitHub Repository

1. Go to https://github.com and sign in
2. Click the **"+"** icon (top right) → **"New repository"**
3. Fill in:
   - **Repository name:** `lovable-claude-code-docker`
   - **Description:** `Docker image for Claude Code in isolated environments`
   - **Visibility:** ✅ Public (required for free container registry)
   - ✅ Check "Add a README file"
   - **Add .gitignore:** None (we have our own)
   - **License:** MIT (optional)
4. Click **"Create repository"**

### Step 2: Copy Your GitHub Repository URL

After creating, you'll see a page with your new repository.
Copy the HTTPS URL that looks like:
```
https://github.com/YOUR_USERNAME/lovable-claude-code-docker.git
```

### Step 3: Initialize Git and Push Files

Open your terminal and run these commands:

```bash
# Navigate to the setup folder
cd /home/claude/lovable-docker-setup

# Initialize Git repository
git init

# Add all files
git add .

# Create first commit
git commit -m "Initial commit: Docker image for Claude Code"

# Add your GitHub repository as remote
# Replace YOUR_USERNAME with your actual GitHub username
git remote add origin https://github.com/YOUR_USERNAME/lovable-claude-code-docker.git

# Push to GitHub
git push -u origin main
```

**Note:** If you get an error about "master" vs "main" branch:
```bash
git branch -M main
git push -u origin main
```

**Authentication:** GitHub will ask for your credentials:
- **Username:** Your GitHub username
- **Password:** Use a Personal Access Token (not your password)
  - Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
  - Click "Generate new token (classic)"
  - Select scopes: `repo`, `write:packages`, `read:packages`
  - Copy the token and use it as your password

### Step 4: Verify Files Are on GitHub

1. Go to your repository URL on GitHub
2. You should see all your files:
   - ✅ Dockerfile
   - ✅ entrypoint.sh
   - ✅ .github/workflows/docker-build.yml
   - ✅ README.md
   - ✅ .gitignore

### Step 5: Trigger First Docker Build

The GitHub Action will automatically start building your Docker image!

To watch the build:
1. Go to your repository on GitHub
2. Click **"Actions"** tab at the top
3. You should see a workflow running: "Build and Push Docker Image"
4. Click on it to see the build progress
5. Wait for it to complete (3-5 minutes)

### Step 6: Verify Docker Image is Published

1. Go to your GitHub profile
2. Click **"Packages"** (or go to `https://github.com/YOUR_USERNAME?tab=packages`)
3. You should see: `lovable-claude-code-docker`
4. Click on it to see details

Your image URL will be:
```
ghcr.io/YOUR_USERNAME/lovable-claude-code-docker:latest
```

### Step 7: Make Package Public (Important!)

By default, GitHub packages are private. Make it public:

1. Go to your package (Packages → lovable-claude-code-docker)
2. Click **"Package settings"** (right side)
3. Scroll down to **"Danger Zone"**
4. Click **"Change visibility"**
5. Select **"Public"**
6. Type the repository name to confirm
7. Click **"I understand, change package visibility"**

### Step 8: Test Your Docker Image

Now you can pull and use your image from anywhere!

```bash
# Pull your image
docker pull ghcr.io/YOUR_USERNAME/lovable-claude-code-docker:latest

# Run a test
docker run -d \
  --network none \
  -e ANTHROPIC_API_KEY="your-key-here" \
  -e PROMPT="Create a simple calculator web app" \
  ghcr.io/YOUR_USERNAME/lovable-claude-code-docker:latest
```

## 🎉 Success Checklist

- ✅ Repository created on GitHub
- ✅ Files pushed to repository
- ✅ GitHub Action built Docker image
- ✅ Package is public
- ✅ Can pull image with `docker pull`

## 🚀 Using in Your Lovable Clone Project

Now update your `daytona-docker-generator.ts`:

```typescript
// Instead of building from Dockerfile:
// execSync('docker build -t lovable-claude-code ...')

// Use pre-built image:
execSync('docker pull ghcr.io/YOUR_USERNAME/lovable-claude-code-docker:latest')

// Then run:
const containerId = execSync(`
  docker run -d --network none \
  -e ANTHROPIC_API_KEY=${apiKey} \
  -e PROMPT="${prompt}" \
  ghcr.io/YOUR_USERNAME/lovable-claude-code-docker:latest
`).toString().trim()
```

## 🔄 Future Updates

When you want to update the Docker image:

1. Edit `Dockerfile` or `entrypoint.sh` locally
2. Commit and push changes:
   ```bash
   git add .
   git commit -m "Update: describe your changes"
   git push
   ```
3. GitHub Actions automatically rebuilds and publishes
4. Pull the new version: `docker pull ghcr.io/YOUR_USERNAME/lovable-claude-code-docker:latest`

## 🆘 Troubleshooting

### "Permission denied" when pushing
- Use a Personal Access Token instead of password
- Make sure token has `repo` and `write:packages` permissions

### "main branch doesn't exist"
```bash
git branch -M main
git push -u origin main
```

### GitHub Action fails
- Check the Actions tab for error messages
- Usually it's authentication or permission issues
- Make sure repository is public

### Can't pull Docker image
- Verify package is set to public
- Check the exact image URL
- Try logging in: `docker login ghcr.io -u YOUR_USERNAME`

## 📞 Need Help?

- GitHub Docs: https://docs.github.com
- GitHub Actions: https://docs.github.com/en/actions
- GitHub Packages: https://docs.github.com/en/packages

---

**Next Step:** Follow these instructions and let me know when your image is published to GitHub! Then we'll update your Lovable Clone project to use it.
