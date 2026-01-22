import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const WORKSPACE = '/workspace';

// Reliability limits
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TURNS = 12;                 // <- stop burning tokens
const MAX_FILE_BYTES = 32 * 1024;     // 32KB hard limit
const CHUNK_BYTES = 8 * 1024;         // 8KB chunk target
const MAX_PROJECT_BYTES = 160 * 1024; // total budget (tune as needed)

// templates path configurable
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/templates';

// Circuit breaker
const failureTracker = new Map();
const MAX_REPEATED_FAILURES = 3;

// Contract mapping for project types
const CONTRACT_MAP = {
  nextjs: 'next-fullstack/BASE_CONTRACT.md',
  next: 'next-fullstack/BASE_CONTRACT.md',
  node: 'node-api/BASE_CONTRACT.md',
  api: 'node-api/BASE_CONTRACT.md',
  static: 'static-site/BASE_CONTRACT.md',
  html: 'static-site/BASE_CONTRACT.md',
  vite: 'vite-react-spa/BASE_CONTRACT.md',
  'react-spa': 'vite-react-spa/BASE_CONTRACT.md',
  react: 'vite-react-spa/BASE_CONTRACT.md',
};

// Required files per project type for validation
const REQUIRED_FILES = {
  static: ['index.html'],
  node: ['package.json', ['server.js', 'index.js']],
  nextjs: ['package.json', 'next.config.js', 'tsconfig.json', 'app/layout.tsx', 'app/page.tsx', 'app/globals.css'],
  vite: ['package.json', 'vite.config.ts', 'index.html', 'src/main.tsx', 'src/App.tsx'],
};

// Forbidden files per project type for validation
const FORBIDDEN_FILES = {
  static: ['package.json'],
};

// System prompt with manifest-first workflow
const SYSTEM_PROMPT = `You are an expert full-stack developer generating production-ready code.

## CRITICAL: Generation Protocol

**Step 1: FILE_MANIFEST (REQUIRED FIRST)**
Your FIRST response MUST be a FILE_MANIFEST JSON block listing all files you plan to create:
\`\`\`json
{
  "files": [
    { "path": "package.json", "purpose": "Dependencies", "estimated_bytes": 500 },
    { "path": "src/App.tsx", "purpose": "Main component", "estimated_bytes": 2000 }
  ]
}
\`\`\`

**Step 2: Write Files**
After manifest, write files using tools. Follow these rules:

## File Size Limits (STRICT)
- Maximum file size: 32KB (hard)
- Chunk threshold: 8KB (write_file then append_file in <=8KB chunks)

## Writing Rules
- Prefer multiple small files over one large file
- No external CDNs unless explicitly requested
- Keep CSS minimal

## If max_tokens truncates your response
Continue by chunking the current file using append_file (<=8KB each). Do not restart or repeat content.`;

/**
 * Load contract for a project type
 */
function getContract(projectType) {
  if (!projectType) return null;
  const contractPath = CONTRACT_MAP[projectType.toLowerCase()];
  if (!contractPath) return null;

  const fullPath = path.join(TEMPLATES_DIR, contractPath);
  try {
    if (fs.existsSync(fullPath)) return fs.readFileSync(fullPath, 'utf8');
    console.warn(`⚠️ Contract not found: ${fullPath}`);
    return null;
  } catch (err) {
    console.warn(`⚠️ Could not read contract: ${err.message}`);
    return null;
  }
}

/**
 * Infer project type from prompt
 */
function inferProjectType(prompt) {
  const lower = prompt.toLowerCase();
  if (lower.includes('next.js') || lower.includes('nextjs')) return 'nextjs';
  if (lower.includes('express') || lower.includes('api server') || lower.includes('backend')) return 'node';
  if (lower.includes('react') || lower.includes('vite') || lower.includes('spa')) return 'vite';
  if (lower.includes('static') || lower.includes('html') || lower.includes('landing page')) return 'static';
  return 'static';
}

function getProjectType(prompt) {
  const envType = process.env.PROJECT_TYPE;
  return envType ? envType : inferProjectType(prompt);
}

function normalizeProjectType(projectType) {
  const typeKey = projectType?.toLowerCase() || 'static';
  return (
    ['nextjs', 'next'].includes(typeKey) ? 'nextjs' :
    ['node', 'api'].includes(typeKey) ? 'node' :
    ['vite', 'react-spa', 'react'].includes(typeKey) ? 'vite' :
    'static'
  );
}

/**
 * More robust manifest extraction:
 * - handles fenced ```json
 * - handles plain JSON
 */
function extractManifest(contentBlocks) {
  const text = contentBlocks
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  // 1) fenced json
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) {
    const maybe = tryParseManifest(fenced[1]);
    if (maybe) return maybe;
  }

  // 2) any JSON object containing "files":[...]
  const loose = text.match(/(\{[\s\S]*"files"\s*:\s*\[[\s\S]*?\][\s\S]*\})/);
  if (loose) {
    const maybe = tryParseManifest(loose[1]);
    if (maybe) return maybe;
  }

  return null;
}

function tryParseManifest(jsonText) {
  try {
    const obj = JSON.parse(jsonText);
    if (obj && Array.isArray(obj.files)) return obj;
  } catch {}
  return null;
}

/**
 * Validate manifest before allowing any file writes
 */
function validateManifest(manifest, projectType) {
  const errors = [];

  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    errors.push('Manifest is missing or empty.');
    return { ok: false, errors };
  }

  // basic path sanity + budgets
  let total = 0;
  for (const f of manifest.files) {
    if (!f.path || typeof f.path !== 'string') errors.push('Manifest file missing valid path.');
    const est = Number(f.estimated_bytes || 0);
    if (Number.isNaN(est) || est < 0) errors.push(`Invalid estimated_bytes for ${f.path}`);
    if (est > MAX_FILE_BYTES) errors.push(`Manifest estimates file too large (>32KB): ${f.path} (${est} bytes)`);
    total += est;

    // block absolute paths / traversal early
    if (f.path.startsWith('/')) errors.push(`Manifest path must be relative: ${f.path}`);
    if (f.path.includes('..')) errors.push(`Manifest path traversal not allowed: ${f.path}`);
  }

  if (total > MAX_PROJECT_BYTES) {
    errors.push(`Manifest total estimated bytes exceeds budget (${MAX_PROJECT_BYTES}): ${total}`);
  }

  // contract-lite checks: required/forbidden presence in manifest
  const type = normalizeProjectType(projectType);
  const paths = new Set(manifest.files.map(x => x.path));

  const required = REQUIRED_FILES[type] || [];
  for (const req of required) {
    if (Array.isArray(req)) {
      if (!req.some(p => paths.has(p))) errors.push(`Manifest missing required file: one of [${req.join(', ')}]`);
    } else {
      if (!paths.has(req)) errors.push(`Manifest missing required file: ${req}`);
    }
  }

  const forbidden = FORBIDDEN_FILES[type] || [];
  for (const f of forbidden) {
    if (paths.has(f)) errors.push(`Manifest includes forbidden file for ${type}: ${f}`);
  }

  return { ok: errors.length === 0, errors };
}

// Tool definitions for Claude
const TOOLS = [
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace. Creates parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'append_file',
    description: 'Append content to a file. Keep chunks under 8KB.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the workspace.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'list_directory',
    description: 'List files/directories in workspace.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'create_directory',
    description: 'Create a directory in workspace.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

function validatePath(inputPath) {
  const cleanPath = inputPath.replace(/^\/+/, '');
  if (cleanPath.includes('../') || cleanPath.includes('..\\')) throw new Error(`Path traversal not allowed: ${inputPath}`);
  const absolutePath = path.resolve(WORKSPACE, cleanPath);
  if (!absolutePath.startsWith(WORKSPACE)) throw new Error(`Path outside workspace: ${inputPath}`);
  return absolutePath;
}

function executeTool(toolName, args) {
  try {
    switch (toolName) {
      case 'write_file': {
        if (typeof args.content !== 'string') return { success: false, error: 'Content must be a string' };
        if (Buffer.byteLength(args.content, 'utf8') > MAX_FILE_BYTES) {
          return { success: false, error: `File exceeds 32KB limit: ${args.path}` };
        }
        const safePath = validatePath(args.path);
        fs.mkdirSync(path.dirname(safePath), { recursive: true });
        fs.writeFileSync(safePath, args.content, 'utf8');
        return { success: true, path: args.path, bytes: Buffer.byteLength(args.content, 'utf8') };
      }
      case 'append_file': {
        if (typeof args.content !== 'string') return { success: false, error: 'Content must be a string' };
        if (Buffer.byteLength(args.content, 'utf8') > CHUNK_BYTES) {
          return { success: false, error: `Append chunk exceeds 8KB: ${args.path}` };
        }
        const safePath = validatePath(args.path);
        fs.mkdirSync(path.dirname(safePath), { recursive: true });
        fs.appendFileSync(safePath, args.content, 'utf8');
        // enforce max file size after append
        const size = fs.statSync(safePath).size;
        if (size > MAX_FILE_BYTES) return { success: false, error: `File exceeds 32KB after append: ${args.path}` };
        return { success: true, path: args.path, bytes_appended: Buffer.byteLength(args.content, 'utf8') };
      }
      case 'read_file': {
        const safePath = validatePath(args.path);
        if (!fs.existsSync(safePath)) return { success: false, error: `File not found: ${args.path}` };
        return { success: true, path: args.path, content: fs.readFileSync(safePath, 'utf8') };
      }
      case 'list_directory': {
        const safePath = validatePath(args.path);
        if (!fs.existsSync(safePath)) return { success: false, error: `Directory not found: ${args.path}` };
        const entries = fs.readdirSync(safePath, { withFileTypes: true });
        return {
          success: true,
          path: args.path,
          items: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' })),
        };
      }
      case 'create_directory': {
        const safePath = validatePath(args.path);
        fs.mkdirSync(safePath, { recursive: true });
        return { success: true, path: args.path };
      }
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function validateWorkspace(projectType) {
  const errors = [];
  const warnings = [];
  const type = normalizeProjectType(projectType);

  const required = REQUIRED_FILES[type] || [];
  for (const req of required) {
    if (Array.isArray(req)) {
      const found = req.some(f => fs.existsSync(path.join(WORKSPACE, f)));
      if (!found) errors.push(`Missing required file: one of [${req.join(', ')}]`);
    } else {
      if (!fs.existsSync(path.join(WORKSPACE, req))) errors.push(`Missing required file: ${req}`);
    }
  }

  const forbidden = FORBIDDEN_FILES[type] || [];
  for (const f of forbidden) {
    if (fs.existsSync(path.join(WORKSPACE, f))) errors.push(`Forbidden file for ${type}: ${f}`);
  }

  // Node /health presence check
  if (type === 'node') {
    const serverFiles = ['server.js', 'index.js', 'src/server.js', 'src/index.js'];
    let hasHealth = false;
    for (const sf of serverFiles) {
      const fp = path.join(WORKSPACE, sf);
      if (fs.existsSync(fp)) {
        const content = fs.readFileSync(fp, 'utf8');
        if (/['"`]\/health['"`]/.test(content) || /get\s*\(\s*['"`]\/health/.test(content)) {
          hasHealth = true;
          break;
        }
      }
    }
    if (!hasHealth) errors.push('Node API must have GET /health endpoint');
  }

  return { ok: errors.length === 0, errors, warnings };
}

function printWorkspaceContents() {
  console.log('📁 Contents of /workspace:');
  const result = executeTool('list_directory', { path: '.' });
  if (result.success && result.items) {
    result.items.forEach(item => console.log(`${item.type === 'directory' ? '📂' : '📄'} ${item.name}`));
  }
}

async function generate() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const prompt = process.env.PROMPT;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required');
  if (!prompt) throw new Error('PROMPT environment variable is required');

  const projectType = getProjectType(prompt);
  const contract = getContract(projectType);

  let fullPrompt = prompt;
  if (contract) {
    fullPrompt = `## Base Contract\n\n${contract}\n\n---\n\n## User Request\n\n${prompt}\n\n---\n\n## Protocol\n1) Output FILE_MANIFEST JSON\n2) Wait for approval\n3) Write files with tools`;
  }

  const client = new Anthropic({ apiKey });

  const messages = [{ role: 'user', content: fullPrompt }];

  let manifestApproved = false;
  let turnCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let circuitBreakerResult = null;

  while (turnCount < MAX_TURNS) {
    turnCount++;
    console.log(`\n--- Turn ${turnCount}/${MAX_TURNS} ---`);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(block => block.type === 'tool_use');

    // manifest gate (must happen before any tool use)
    if (!manifestApproved) {
      const manifest = extractManifest(response.content);
      if (manifest) {
        const verdict = validateManifest(manifest, projectType);
        if (!verdict.ok) {
          console.error('❌ Manifest rejected:');
          verdict.errors.forEach(e => console.error(`  - ${e}`));
          return { success: false, error_code: 'MANIFEST_REJECTED', errors: verdict.errors };
        }
        manifestApproved = true;
        console.log(`📋 Manifest approved (${manifest.files.length} files, <=${MAX_PROJECT_BYTES} bytes est.)`);
        messages.push({ role: 'user', content: 'Manifest accepted. Now write the files.' });
        continue;
      }

      // If model tried tool_use before manifest, hard stop
      if (toolUses.length > 0) {
        return { success: false, error_code: 'PROTOCOL_VIOLATION', error: 'Model used tools before providing FILE_MANIFEST.' };
      }
    }

    if (response.stop_reason === 'end_turn' && toolUses.length === 0) break;

    if (response.stop_reason === 'max_tokens') {
      messages.push({
        role: 'user',
        content: 'Your last message hit max_tokens and was truncated. Continue by chunking with append_file (<=8KB). Do not repeat content.',
      });
    }

    if (toolUses.length === 0) break;

    const toolResults = [];

    for (const toolUse of toolUses) {
      const result = executeTool(toolUse.name, toolUse.input);

      const trackingKey = `${toolUse.name}:${toolUse.input?.path || toolUse.id}`;
      if (!result.success) {
        const failures = (failureTracker.get(trackingKey) || 0) + 1;
        failureTracker.set(trackingKey, failures);

        if (failures >= MAX_REPEATED_FAILURES) {
          circuitBreakerResult = {
            success: false,
            error_code: 'CIRCUIT_BREAKER',
            tool: toolUse.name,
            path: toolUse.input?.path || null,
            last_error: result.error,
            failures,
          };
          break;
        }
      } else {
        failureTracker.delete(trackingKey);
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    if (circuitBreakerResult) break;

    messages.push({ role: 'user', content: toolResults });
  }

  const validation = validateWorkspace(projectType);

  printWorkspaceContents();

  if (circuitBreakerResult) return circuitBreakerResult;
  if (!validation.ok) return { success: false, error_code: 'VALIDATION_FAILED', errors: validation.errors };

  return { success: true, turns: turnCount, tokens: totalInputTokens + totalOutputTokens };
}

generate()
  .then((result) => {
    if (result && !result.success) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    console.log('✅ Generator completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Generator failed:', error.message);
    process.exit(1);
  });
