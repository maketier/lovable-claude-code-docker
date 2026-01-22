import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const WORKSPACE = '/workspace';
const MAX_TURNS = 50;
const MODEL = 'claude-sonnet-4-20250514';
const TEMPLATES_DIR = '/templates';

// Contract mapping for project types
const CONTRACT_MAP = {
  'nextjs': 'next-fullstack/BASE_CONTRACT.md',
  'next': 'next-fullstack/BASE_CONTRACT.md',
  'node': 'node-api/BASE_CONTRACT.md',
  'api': 'node-api/BASE_CONTRACT.md',
  'static': 'static-site/BASE_CONTRACT.md',
  'html': 'static-site/BASE_CONTRACT.md',
  'vite': 'vite-react-spa/BASE_CONTRACT.md',
  'react-spa': 'vite-react-spa/BASE_CONTRACT.md',
  'react': 'vite-react-spa/BASE_CONTRACT.md',
};

// Required files per project type for validation
const REQUIRED_FILES = {
  'static': ['index.html'],
  'node': ['package.json', ['server.js', 'index.js']], // Either server.js OR index.js
  'nextjs': ['package.json', 'next.config.js', 'tsconfig.json', 'app/layout.tsx', 'app/page.tsx', 'app/globals.css'],
  'vite': ['package.json', 'vite.config.ts', 'index.html', 'src/main.tsx', 'src/App.tsx'],
};

// Forbidden files per project type for validation
const FORBIDDEN_FILES = {
  'static': ['package.json'], // Static sites must NOT have package.json
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
- **Maximum file size: 32KB** - Files larger than this will be rejected
- **Recommended chunking threshold: 8KB** - Split larger files
- **Chunking method:** Use write_file for first chunk, append_file for subsequent chunks

## Writing Rules
- Prefer multiple small files over one large file
- No external CDNs unless explicitly requested
- Keep CSS minimal; prefer component-level styles
- For files >8KB: write_file (first chunk) + append_file (subsequent chunks, ≤8KB each)

## If max_tokens truncates your response
You MUST continue by chunking the current file using append_file (≤8KB each). Do not restart or repeat content.`;

// Track repeated failures per tool+key for circuit breaker
const failureTracker = new Map();
const MAX_REPEATED_FAILURES = 3;

/**
 * Load contract for a project type
 */
function getContract(projectType) {
  if (!projectType) return null;
  const contractPath = CONTRACT_MAP[projectType.toLowerCase()];
  if (!contractPath) {
    console.warn(`⚠️ Unknown project type: ${projectType}, no contract loaded`);
    return null;
  }
  const fullPath = path.join(TEMPLATES_DIR, contractPath);
  try {
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8');
    }
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
  return 'static'; // default fallback
}

/**
 * Get project type from env or infer from prompt
 */
function getProjectType(prompt) {
  const envType = process.env.PROJECT_TYPE;
  if (envType) {
    console.log(`📋 Project type: ${envType} (source: env)`);
    return envType;
  }
  const inferred = inferProjectType(prompt);
  console.log(`📋 Project type: ${inferred} (source: inferred)`);
  return inferred;
}

/**
 * Extract FILE_MANIFEST from assistant response
 */
function extractManifest(content) {
  for (const block of content) {
    if (block.type === 'text') {
      const match = block.text.match(/```json\s*\n(\{[\s\S]*?"files"[\s\S]*?\})\s*\n```/);
      if (match) {
        try {
          const manifest = JSON.parse(match[1]);
          if (manifest.files && Array.isArray(manifest.files)) {
            return manifest;
          }
        } catch {}
      }
    }
  }
  return null;
}

/**
 * Validate workspace after generation
 */
function validateWorkspace(projectType) {
  const errors = [];
  const warnings = [];

  // Normalize project type
  const typeKey = projectType?.toLowerCase() || 'static';
  const normalizedType =
    ['nextjs', 'next'].includes(typeKey) ? 'nextjs' :
    ['node', 'api'].includes(typeKey) ? 'node' :
    ['vite', 'react-spa', 'react'].includes(typeKey) ? 'vite' :
    'static';

  // Check required files
  const required = REQUIRED_FILES[normalizedType] || [];
  for (const req of required) {
    if (Array.isArray(req)) {
      // Either/or requirement
      const found = req.some(f => fs.existsSync(path.join(WORKSPACE, f)));
      if (!found) {
        errors.push(`Missing required file: one of [${req.join(', ')}]`);
      }
    } else {
      if (!fs.existsSync(path.join(WORKSPACE, req))) {
        errors.push(`Missing required file: ${req}`);
      }
    }
  }

  // Check forbidden files
  const forbidden = FORBIDDEN_FILES[normalizedType] || [];
  for (const f of forbidden) {
    if (fs.existsSync(path.join(WORKSPACE, f))) {
      errors.push(`Forbidden file for ${normalizedType}: ${f}`);
    }
  }

  // Check file sizes (max 32KB)
  function checkSizes(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        checkSizes(fullPath, relPath);
      } else {
        const stat = fs.statSync(fullPath);
        if (stat.size > 32 * 1024) {
          errors.push(`File too large (>${32}KB): ${relPath} (${Math.round(stat.size/1024)}KB)`);
        } else if (stat.size > 16 * 1024) {
          warnings.push(`Large file (>${16}KB): ${relPath} (${Math.round(stat.size/1024)}KB)`);
        }
      }
    }
  }

  try {
    checkSizes(WORKSPACE);
  } catch (err) {
    warnings.push(`Could not check file sizes: ${err.message}`);
  }

  // Node-specific: check for /health endpoint
  if (normalizedType === 'node') {
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
    if (!hasHealth) {
      errors.push('Node API must have GET /health endpoint');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Print workspace contents
 */
function printWorkspaceContents() {
  console.log('📁 Contents of /workspace:');
  try {
    const result = executeTool('list_directory', { path: '.' });
    if (result.success && result.items) {
      console.log(`total ${result.items.length}`);
      result.items.forEach(item => {
        const icon = item.type === 'directory' ? '📂' : '📄';
        console.log(`${icon} ${item.name}`);
      });
    }
  } catch (error) {
    console.log('(Could not list workspace contents)');
  }
}

// Tool definitions for Claude
const TOOLS = [
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace. Creates parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root (e.g., "src/index.js" or "README.md")'
        },
        content: {
          type: 'string',
          description: 'Complete file content to write'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a workspace directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to workspace root (use "." for root)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'create_directory',
    description: 'Create a directory in the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to workspace root'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'append_file',
    description: 'Append content to a file. Creates the file if it does not exist. Use this for writing large files in chunks: first chunk should use write_file (to overwrite), subsequent chunks use append_file.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root'
        },
        content: {
          type: 'string',
          description: 'Content to append (keep under 8KB per call)'
        }
      },
      required: ['path', 'content']
    }
  }
];

/**
 * Validate and normalize a path to ensure it stays within workspace
 */
function validatePath(inputPath) {
  // Remove leading slash if present
  const cleanPath = inputPath.replace(/^\/+/, '');

  // Block path traversal attempts
  if (cleanPath.includes('../') || cleanPath.includes('..\\')) {
    throw new Error(`Path traversal not allowed: ${inputPath}`);
  }

  // Resolve to absolute path within workspace
  const absolutePath = path.resolve(WORKSPACE, cleanPath);

  // Ensure the resolved path is still within workspace
  if (!absolutePath.startsWith(WORKSPACE)) {
    throw new Error(`Path outside workspace: ${inputPath}`);
  }

  return absolutePath;
}

/**
 * Tool handler: write_file
 */
function handleWriteFile(args) {
  try {
    // Validate content before writing
    if (args.content === undefined || args.content === null) {
      console.error(`❌ Failed to write file: content is missing/undefined`);
      return {
        success: false,
        error_code: 'INVALID_WRITE_CONTENT',
        error: 'Content is missing or undefined. This usually happens when max_tokens truncates the response.',
        hint: 'Use write_file for the first chunk, then append_file for subsequent chunks. Keep chunks under 8KB.'
      };
    }
    if (typeof args.content !== 'string') {
      console.error(`❌ Failed to write file: content is not a string (got ${typeof args.content})`);
      return {
        success: false,
        error_code: 'INVALID_WRITE_CONTENT',
        error: `Content must be a string, got ${typeof args.content}`,
        hint: 'Ensure content is a valid string.'
      };
    }

    const safePath = validatePath(args.path);

    // Create parent directories if needed
    const dir = path.dirname(safePath);
    fs.mkdirSync(dir, { recursive: true });

    // Write file
    fs.writeFileSync(safePath, args.content, 'utf8');

    const relativePath = path.relative(WORKSPACE, safePath);
    console.log(`✅ Wrote file: ${relativePath}`);

    return {
      success: true,
      path: relativePath,
      bytes: args.content.length
    };
  } catch (error) {
    console.error(`❌ Failed to write file: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Tool handler: append_file
 */
function handleAppendFile(args) {
  try {
    // Validate content before appending
    if (args.content === undefined || args.content === null) {
      console.error(`❌ Failed to append file: content is missing/undefined`);
      return {
        success: false,
        error_code: 'INVALID_WRITE_CONTENT',
        error: 'Content is missing or undefined. This usually happens when max_tokens truncates the response.',
        hint: 'Ensure content is provided. Keep chunks under 8KB.'
      };
    }
    if (typeof args.content !== 'string') {
      console.error(`❌ Failed to append file: content is not a string (got ${typeof args.content})`);
      return {
        success: false,
        error_code: 'INVALID_WRITE_CONTENT',
        error: `Content must be a string, got ${typeof args.content}`,
        hint: 'Ensure content is a valid string.'
      };
    }

    const safePath = validatePath(args.path);
    const dir = path.dirname(safePath);
    fs.mkdirSync(dir, { recursive: true });

    // Append (creates if doesn't exist)
    fs.appendFileSync(safePath, args.content, 'utf8');

    const relativePath = path.relative(WORKSPACE, safePath);
    console.log(`✅ Appended to file: ${relativePath} (+${args.content.length} bytes)`);

    return {
      success: true,
      path: relativePath,
      bytes_appended: args.content.length
    };
  } catch (error) {
    console.error(`❌ Failed to append file: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Tool handler: read_file
 */
function handleReadFile(args) {
  try {
    const safePath = validatePath(args.path);

    if (!fs.existsSync(safePath)) {
      return {
        success: false,
        error: `File not found: ${args.path}`
      };
    }

    const content = fs.readFileSync(safePath, 'utf8');
    const relativePath = path.relative(WORKSPACE, safePath);

    console.log(`📖 Read file: ${relativePath} (${content.length} bytes)`);

    return {
      success: true,
      path: relativePath,
      content: content
    };
  } catch (error) {
    console.error(`❌ Failed to read file: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Tool handler: list_directory
 */
function handleListDirectory(args) {
  try {
    const safePath = validatePath(args.path);

    if (!fs.existsSync(safePath)) {
      return {
        success: false,
        error: `Directory not found: ${args.path}`
      };
    }

    const entries = fs.readdirSync(safePath, { withFileTypes: true });
    const items = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file'
    }));

    const relativePath = path.relative(WORKSPACE, safePath);
    console.log(`📂 Listed directory: ${relativePath || '.'} (${items.length} items)`);

    return {
      success: true,
      path: relativePath || '.',
      items: items
    };
  } catch (error) {
    console.error(`❌ Failed to list directory: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Tool handler: create_directory
 */
function handleCreateDirectory(args) {
  try {
    const safePath = validatePath(args.path);

    fs.mkdirSync(safePath, { recursive: true });

    const relativePath = path.relative(WORKSPACE, safePath);
    console.log(`📁 Created directory: ${relativePath}`);

    return {
      success: true,
      path: relativePath
    };
  } catch (error) {
    console.error(`❌ Failed to create directory: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Execute a tool by name
 */
function executeTool(toolName, args) {
  switch (toolName) {
    case 'write_file':
      return handleWriteFile(args);
    case 'append_file':
      return handleAppendFile(args);
    case 'read_file':
      return handleReadFile(args);
    case 'list_directory':
      return handleListDirectory(args);
    case 'create_directory':
      return handleCreateDirectory(args);
    default:
      return {
        success: false,
        error: `Unknown tool: ${toolName}`
      };
  }
}

/**
 * Main generation loop
 */
async function generate() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const prompt = process.env.PROMPT;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  if (!prompt) {
    throw new Error('PROMPT environment variable is required');
  }

  // Get project type
  const projectType = getProjectType(prompt);

  // Load contract
  const contract = getContract(projectType);
  if (contract) {
    console.log(`📜 Contract loaded for: ${projectType}`);
  }

  // Build full prompt with contract
  let fullPrompt = prompt;
  if (contract) {
    fullPrompt = `## Base Contract\n\n${contract}\n\n---\n\n## User Request\n\n${prompt}\n\n---\n\n## Generation Protocol Reminder\n1. First output FILE_MANIFEST JSON\n2. Then write files using tools`;
  }

  console.log('🔑 API key validated');
  console.log(`📝 Prompt: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`);
  console.log(`🤖 Model: ${MODEL}`);
  console.log('');

  const client = new Anthropic({ apiKey });

  // Initial message from user
  const messages = [{
    role: 'user',
    content: fullPrompt
  }];

  let turnCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let circuitBreakerResult = null; // Set when circuit breaker triggers

  // Main agentic loop
  while (turnCount < MAX_TURNS) {
    turnCount++;
    console.log(`\n--- Turn ${turnCount}/${MAX_TURNS} ---`);

    try {
      // Call Claude with tools
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: messages
      });

      // Track token usage
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      console.log(`📊 Tokens: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`);
      console.log(`🛑 Stop reason: ${response.stop_reason}`);

      // Add assistant response to messages
      messages.push({
        role: 'assistant',
        content: response.content
      });

      // Process tool uses
      const toolUses = response.content.filter(block => block.type === 'tool_use');

      // Check for manifest (before tool use check)
      const manifest = extractManifest(response.content);
      if (manifest && toolUses.length === 0) {
        console.log(`📋 FILE_MANIFEST received (${manifest.files.length} files planned)`);
        manifest.files.forEach(f => console.log(`   - ${f.path} (~${f.estimated_bytes || '?'} bytes)`));

        // Auto-approve and prompt to continue
        messages.push({
          role: 'user',
          content: 'Manifest accepted. Now write the files.'
        });
        continue; // Next turn
      }

      // Check if task is complete
      if (response.stop_reason === 'end_turn') {
        console.log('\n✅ Generation complete');
        break;
      }

      // Handle max_tokens recovery
      if (response.stop_reason === 'max_tokens') {
        console.log('⚠️ Response hit max_tokens, sending recovery nudge...');
        messages.push({
          role: 'user',
          content: 'Your last message hit max_tokens and was truncated. You MUST continue by chunking the current file using append_file (≤8KB each). Do not repeat content that was already written.'
        });
        // Don't break, continue the loop
      }

      if (toolUses.length === 0) {
        console.log('\n✅ No more tools to execute, generation complete');
        break;
      }

      console.log(`🔧 Executing ${toolUses.length} tool(s)...`);

      // Execute tools and collect results
      const toolResults = [];

      for (const toolUse of toolUses) {
        console.log(`  → ${toolUse.name}(${JSON.stringify(toolUse.input).substring(0, 60)}...)`);

        const result = executeTool(toolUse.name, toolUse.input);

        // Circuit breaker: track repeated failures
        const trackingKey = `${toolUse.name}:${toolUse.input?.path || toolUse.id}`;

        if (!result.success) {
          const failures = (failureTracker.get(trackingKey) || 0) + 1;
          failureTracker.set(trackingKey, failures);

          if (failures >= MAX_REPEATED_FAILURES) {
            console.error(`\n🛑 CIRCUIT BREAKER: ${toolUse.name}("${toolUse.input?.path || toolUse.id}") failed ${failures} times. Stopping gracefully.`);
            console.error(`   Last error: ${result.error}`);
            console.error(`   Hint: ${result.hint || 'Try breaking the file into smaller chunks with write_file (first) + append_file (subsequent).'}`);

            // Set circuit breaker result for graceful exit
            circuitBreakerResult = {
              success: false,
              error_code: 'CIRCUIT_BREAKER',
              tool: toolUse.name,
              path: toolUse.input?.path || null,
              tool_use_id: toolUse.id,
              last_error: result.error,
              hint: result.hint || 'Try breaking the file into smaller chunks with write_file (first) + append_file (subsequent).',
              failures: failures
            };
            break; // Exit the for loop
          }
        } else if (toolUse.input?.path) {
          // Reset failure count on success for this path
          failureTracker.delete(trackingKey);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      // If circuit breaker triggered, exit the main loop
      if (circuitBreakerResult) {
        break;
      }

      // Add tool results to messages
      messages.push({
        role: 'user',
        content: toolResults
      });

    } catch (error) {
      console.error(`\n❌ Error on turn ${turnCount}:`, error.message);

      if (error.status === 429) {
        console.error('Rate limit hit, waiting 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }

      throw error;
    }
  }

  if (turnCount >= MAX_TURNS) {
    console.log(`\n⚠️ Reached maximum turns (${MAX_TURNS}), stopping`);
  }

  // Run post-generation validation
  const validation = validateWorkspace(projectType);

  if (validation.warnings.length > 0) {
    console.log('\n⚠️ VALIDATION WARNINGS:');
    validation.warnings.forEach(w => console.log(`   - ${w}`));
  }

  // Print summary (always print artifacts even on failure)
  console.log('\n================================================');
  if (circuitBreakerResult) {
    console.log('❌ Generation stopped by circuit breaker');
    console.log(`   Tool: ${circuitBreakerResult.tool}`);
    console.log(`   Path: ${circuitBreakerResult.path || 'N/A'}`);
    console.log(`   Error: ${circuitBreakerResult.last_error}`);
    console.log(`   Hint: ${circuitBreakerResult.hint}`);
  } else if (!validation.ok) {
    console.log('❌ VALIDATION FAILED:');
    validation.errors.forEach(e => console.log(`   - ${e}`));
  } else {
    console.log('✅ Generation finished');
  }

  printWorkspaceContents();

  console.log('================================================');
  console.log(`\n💰 Total tokens: ${totalInputTokens + totalOutputTokens}`);
  console.log(`   Input:  ${totalInputTokens}`);
  console.log(`   Output: ${totalOutputTokens}`);

  // Estimate cost (rough approximation for sonnet-4)
  const inputCost = (totalInputTokens / 1_000_000) * 3.0;
  const outputCost = (totalOutputTokens / 1_000_000) * 15.0;
  const totalCost = inputCost + outputCost;
  console.log(`   Cost:   ~$${totalCost.toFixed(4)}`);

  // Return result for caller
  if (circuitBreakerResult) {
    return circuitBreakerResult;
  }

  if (!validation.ok) {
    return { success: false, error_code: 'VALIDATION_FAILED', errors: validation.errors };
  }

  return { success: true, turns: turnCount, tokens: totalInputTokens + totalOutputTokens };
}

// Run generator
generate()
  .then((result) => {
    if (result && !result.success) {
      console.log('\n❌ Generator stopped with errors');
      console.log(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    console.log('\n✅ Generator completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Generator failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
